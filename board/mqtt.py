"""A small MQTT 3.1.1 client: just enough to talk to Zigbee2MQTT through Mosquitto.

The board is standard library only, so this stands in for paho-mqtt. It does what the
lights need and nothing more: QoS 0 publish and subscribe, keepalive pings, and
reconnecting with a backoff when the broker goes away (the Pi may boot before it).
One thread reads from the broker; publish() and subscribe() can be called from any.
"""
import logging
import socket
import struct
import threading
import time
import uuid

log = logging.getLogger(__name__)

CONNECT = 1
CONNACK = 2
PUBLISH = 3
PUBACK = 4
SUBSCRIBE = 8
SUBACK = 9
UNSUBSCRIBE = 10
UNSUBACK = 11
PINGREQ = 12
PINGRESP = 13
DISCONNECT = 14

PROTOCOL_LEVEL = 4  # MQTT 3.1.1
# Zigbee2MQTT's device list is the biggest thing it sends; this is far more than a home needs.
MAX_PACKET_BYTES = 4 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 10
# How often the reading thread looks up from the socket to ping or notice it should stop.
READ_TICK_SECONDS = 1.0
MIN_RETRY_SECONDS = 2
MAX_RETRY_SECONDS = 60

REFUSED = {
    1: "it doesn't speak MQTT 3.1.1",
    2: "it rejected the client id",
    3: "the broker is unavailable",
    4: "the username or password is wrong",
    5: "the board isn't allowed to connect",
}


class MqttError(Exception):
    pass


# Packets


def encode_length(n):
    out = bytearray()
    while True:
        byte, n = n % 128, n // 128
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def encode_string(text):
    raw = text.encode("utf-8") if isinstance(text, str) else bytes(text)
    if len(raw) > 0xFFFF:
        raise ValueError("MQTT strings are at most 65535 bytes")
    return struct.pack("!H", len(raw)) + raw


def packet(kind, flags, body=b""):
    return bytes([(kind << 4) | flags]) + encode_length(len(body)) + body


def connect_packet(client_id, keepalive, username=None, password=None):
    flags = 0x02  # clean session: subscriptions are made again on every connect
    payload = encode_string(client_id)
    if username is not None:
        flags |= 0x80
        payload += encode_string(username)
        if password is not None:
            flags |= 0x40
            payload += encode_string(password)
    body = encode_string("MQTT") + bytes([PROTOCOL_LEVEL, flags]) + struct.pack("!H", keepalive) + payload
    return packet(CONNECT, 0, body)


def publish_packet(topic, payload, retain=False):
    data = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
    return packet(PUBLISH, 0x01 if retain else 0, encode_string(topic) + data)


def subscribe_packet(packet_id, topics):
    body = struct.pack("!H", packet_id) + b"".join(encode_string(t) + b"\x00" for t in topics)
    return packet(SUBSCRIBE, 0x02, body)


def unsubscribe_packet(packet_id, topics):
    body = struct.pack("!H", packet_id) + b"".join(encode_string(t) for t in topics)
    return packet(UNSUBSCRIBE, 0x02, body)


def take_packet(buffer):
    """Removes one whole packet from the front of `buffer` (a bytearray).

    Returns (kind, flags, body), or None while the packet hasn't all arrived yet.
    """
    length, multiplier, index = 0, 1, 1
    while True:
        if index >= len(buffer):
            return None
        byte = buffer[index]
        length += (byte & 0x7F) * multiplier
        index += 1
        if not byte & 0x80:
            break
        if index > 4:
            raise MqttError("the broker sent a malformed packet")
        multiplier *= 128
    if length > MAX_PACKET_BYTES:
        raise MqttError("the broker sent a packet larger than %d MB" % (MAX_PACKET_BYTES // (1024 * 1024)))
    if len(buffer) < index + length:
        return None
    kind, flags = buffer[0] >> 4, buffer[0] & 0x0F
    body = bytes(buffer[index:index + length])
    del buffer[:index + length]
    return kind, flags, body


def parse_publish(flags, body):
    """(topic, payload, packet id) from a PUBLISH; the id is None at QoS 0."""
    (size,) = struct.unpack_from("!H", body)
    topic = body[2:2 + size].decode("utf-8", "replace")
    at = 2 + size
    packet_id = None
    if (flags >> 1) & 0x03:
        (packet_id,) = struct.unpack_from("!H", body, at)
        at += 2
    return topic, body[at:], packet_id


# Client


class MqttClient:
    """Stays connected to one broker, calling back on connect, disconnect and each message.

    Callbacks run on the client's own thread, and never while it holds its own lock,
    so they may publish or subscribe.
    """

    def __init__(self, host, port=1883, *, username=None, password=None, keepalive=30,
                 client_id=None, on_connect=None, on_disconnect=None, on_message=None):
        self.host = host
        self.port = port
        self._username = username
        self._password = password
        self._keepalive = keepalive
        self._client_id = client_id or "widget-board-" + uuid.uuid4().hex[:8]
        self._on_connect = on_connect
        self._on_disconnect = on_disconnect
        self._on_message = on_message
        self._send_lock = threading.Lock()
        self._sock = None
        self._last_sent = 0.0
        self._next_id = 0
        self._stopped = threading.Event()
        self._thread = None
        self.connected = False

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="mqtt", daemon=True)
            self._thread.start()

    def stop(self):
        self._stopped.set()
        with self._send_lock:
            sock = self._sock
            if sock is not None and self.connected:
                try:
                    sock.sendall(packet(DISCONNECT, 0))
                except OSError:
                    pass
        self._close()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=READ_TICK_SECONDS * 3)

    # Sending (any thread). Each returns False when there's no connection to send on.

    def publish(self, topic, payload, retain=False):
        return self._send(publish_packet(topic, payload, retain))

    def subscribe(self, topics):
        topics = list(topics)
        return not topics or self._send(subscribe_packet(self._packet_id(), topics))

    def unsubscribe(self, topics):
        topics = list(topics)
        return not topics or self._send(unsubscribe_packet(self._packet_id(), topics))

    def _packet_id(self):
        with self._send_lock:
            self._next_id = self._next_id % 0xFFFF + 1
            return self._next_id

    def _send(self, data):
        with self._send_lock:
            sock = self._sock
            if sock is None or not self.connected:
                return False
            try:
                sock.sendall(data)
            except OSError:
                # The reading thread notices the dead socket and reconnects.
                return False
            self._last_sent = time.monotonic()
            return True

    # The connection thread

    def _run(self):
        delay = MIN_RETRY_SECONDS
        reported = False
        while not self._stopped.is_set():
            try:
                self._session()
            except (OSError, MqttError) as err:
                if not self._stopped.is_set() and not reported:
                    log.warning("Lights: can't reach the MQTT broker at %s:%s (%s). Retrying.", self.host, self.port, err)
                    reported = True
            finally:
                if self._close():
                    # Was connected: try again straight away, then back off.
                    delay = MIN_RETRY_SECONDS
                    reported = False
            if self._stopped.wait(delay):
                break
            delay = min(delay * 2, MAX_RETRY_SECONDS)

    def _session(self):
        sock = socket.create_connection((self.host, self.port), timeout=CONNECT_TIMEOUT_SECONDS)
        with self._send_lock:
            if self._stopped.is_set():
                sock.close()
                return
            self._sock = sock
        sock.sendall(connect_packet(self._client_id, self._keepalive, self._username, self._password))
        buffer = bytearray()
        first = self._read_packet(sock, buffer)
        if first[0] != CONNACK or len(first[2]) < 2:
            raise MqttError("the broker didn't answer the connection")
        code = first[2][1]
        if code:
            raise MqttError("the broker refused the connection: %s" % REFUSED.get(code, "code %d" % code))

        sock.settimeout(READ_TICK_SECONDS)
        with self._send_lock:
            self.connected = True
            self._last_sent = time.monotonic()
        log.info("Lights: connected to the MQTT broker at %s:%s", self.host, self.port)
        heard = time.monotonic()
        self._call(self._on_connect)

        while not self._stopped.is_set():
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                chunk = None
            now = time.monotonic()
            if chunk == b"":
                raise MqttError("the broker closed the connection")
            if chunk:
                heard = now
                buffer += chunk
                while True:
                    found = take_packet(buffer)
                    if found is None:
                        break
                    self._handle(*found)
            if now - self._last_sent >= self._keepalive / 2:
                self._send(packet(PINGREQ, 0))
            if now - heard > self._keepalive * 1.5:
                raise MqttError("the broker stopped answering")

    def _read_packet(self, sock, buffer):
        while True:
            found = take_packet(buffer)
            if found is not None:
                return found
            chunk = sock.recv(65536)
            if not chunk:
                raise MqttError("the broker closed the connection")
            buffer += chunk

    def _handle(self, kind, flags, body):
        if kind != PUBLISH:
            return  # SUBACK, UNSUBACK, PINGRESP and PUBACK need nothing from us.
        topic, payload, packet_id = parse_publish(flags, body)
        if packet_id is not None:
            self._send(packet(PUBACK, 0, struct.pack("!H", packet_id)))
        self._call(self._on_message, topic, payload)

    def _close(self):
        """Drops the connection. True if it had been connected."""
        with self._send_lock:
            sock, self._sock = self._sock, None
            was_connected, self.connected = self.connected, False
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        if was_connected:
            self._call(self._on_disconnect)
        return was_connected

    def _call(self, callback, *args):
        if callback is None:
            return
        try:
            callback(*args)
        except Exception:
            log.exception("Lights: an MQTT callback failed")
