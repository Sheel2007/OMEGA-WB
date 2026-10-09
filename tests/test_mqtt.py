import queue
import socket
import struct
import threading
import unittest

from board import mqtt
from board.mqtt import MqttClient, MqttError


class FakeBroker:
    """A one-connection MQTT broker on localhost: answers CONNECT, SUBSCRIBE and PINGREQ, records the rest."""

    def __init__(self, refuse=0):
        self.refuse = refuse
        self.received = queue.Queue()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.port = self.listener.getsockname()[1]
        self.conn = None
        self.connected = threading.Event()
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        try:
            self.conn, _ = self.listener.accept()
        except OSError:
            return
        self.connected.set()
        buffer = bytearray()
        while True:
            try:
                chunk = self.conn.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            buffer += chunk
            while True:
                found = mqtt.take_packet(buffer)
                if found is None:
                    break
                kind, flags, body = found
                self.received.put(found)
                if kind == mqtt.CONNECT:
                    self.conn.sendall(bytes([0x20, 0x02, 0x00, self.refuse]))
                elif kind == mqtt.SUBSCRIBE:
                    self.conn.sendall(mqtt.packet(mqtt.SUBACK, 0, body[:2] + b"\x00"))
                elif kind == mqtt.PINGREQ:
                    self.conn.sendall(mqtt.packet(mqtt.PINGRESP, 0))

    def send(self, data):
        self.conn.sendall(data)

    def next(self, kind, timeout=5):
        while True:
            found = self.received.get(timeout=timeout)
            if found[0] == kind:
                return found

    def close(self):
        for sock in (self.conn, self.listener):
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass


class PacketTest(unittest.TestCase):
    def test_remaining_length_uses_seven_bits_a_byte(self):
        self.assertEqual(mqtt.encode_length(0), b"\x00")
        self.assertEqual(mqtt.encode_length(127), b"\x7f")
        self.assertEqual(mqtt.encode_length(128), b"\x80\x01")
        self.assertEqual(mqtt.encode_length(16383), b"\xff\x7f")
        self.assertEqual(mqtt.encode_length(2097152), b"\x80\x80\x80\x01")

    def test_take_packet_waits_for_the_whole_packet_and_leaves_the_rest(self):
        whole = mqtt.publish_packet("a/b", "x" * 300)
        buffer = bytearray(whole[:10])
        self.assertIsNone(mqtt.take_packet(buffer))
        buffer += whole[10:] + b"\xd0"
        kind, flags, body = mqtt.take_packet(buffer)
        self.assertEqual(kind, mqtt.PUBLISH)
        self.assertEqual(mqtt.parse_publish(flags, body)[:2], ("a/b", b"x" * 300))
        self.assertEqual(buffer, bytearray(b"\xd0"), "the next packet's first byte is still there")
        self.assertIsNone(mqtt.take_packet(bytearray()))

    def test_take_packet_refuses_malformed_or_huge_packets(self):
        with self.assertRaises(MqttError):
            mqtt.take_packet(bytearray(b"\x30\xff\xff\xff\xff\x01"))
        with self.assertRaises(MqttError):
            mqtt.take_packet(bytearray(b"\x30" + mqtt.encode_length(mqtt.MAX_PACKET_BYTES + 1)))

    def test_connect_packet_carries_the_login(self):
        kind, flags, body = mqtt.take_packet(bytearray(mqtt.connect_packet("board", 30, "user", "pass")))
        self.assertEqual(kind, mqtt.CONNECT)
        self.assertEqual(body[:6], b"\x00\x04MQTT")
        self.assertEqual(body[6], 4, "MQTT 3.1.1")
        self.assertEqual(body[7], 0xC2, "username, password and a clean session")
        self.assertEqual(struct.unpack("!H", body[8:10])[0], 30)
        self.assertIn(b"user", body)
        self.assertIn(b"pass", body)
        anonymous = mqtt.take_packet(bytearray(mqtt.connect_packet("board", 30)))[2]
        self.assertEqual(anonymous[7], 0x02)

    def test_qos_1_publishes_carry_a_packet_id(self):
        body = mqtt.encode_string("t") + struct.pack("!H", 7) + b"hi"
        self.assertEqual(mqtt.parse_publish(0x02, body), ("t", b"hi", 7))


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.broker = FakeBroker()
        self.messages = queue.Queue()
        self.connects = queue.Queue()
        self.client = MqttClient(
            "127.0.0.1",
            self.broker.port,
            keepalive=30,
            on_connect=lambda: (self.client.subscribe(["zigbee2mqtt/#"]), self.connects.put(True)),
            on_message=lambda topic, payload: self.messages.put((topic, payload)),
        )

    def tearDown(self):
        self.client.stop()
        self.broker.close()

    def test_connects_subscribes_receives_and_publishes(self):
        self.assertFalse(self.client.publish("x", "y"), "nothing to send on before connecting")
        self.client.start()
        self.assertTrue(self.connects.get(timeout=5))
        _, _, body = self.broker.next(mqtt.SUBSCRIBE)
        self.assertIn(b"zigbee2mqtt/#", body)

        self.broker.send(mqtt.publish_packet("zigbee2mqtt/lamp", '{"state":"ON"}'))
        self.assertEqual(self.messages.get(timeout=5), ("zigbee2mqtt/lamp", b'{"state":"ON"}'))

        self.assertTrue(self.client.publish("zigbee2mqtt/lamp/set", '{"state":"OFF"}'))
        _, flags, body = self.broker.next(mqtt.PUBLISH)
        self.assertEqual(mqtt.parse_publish(flags, body)[:2], ("zigbee2mqtt/lamp/set", b'{"state":"OFF"}'))

    def test_acknowledges_qos_1_messages(self):
        self.client.start()
        self.connects.get(timeout=5)
        body = mqtt.encode_string("zigbee2mqtt/lamp") + struct.pack("!H", 42) + b"{}"
        self.broker.send(mqtt.packet(mqtt.PUBLISH, 0x02, body))
        _, _, ack = self.broker.next(mqtt.PUBACK)
        self.assertEqual(ack, struct.pack("!H", 42))
        self.assertEqual(self.messages.get(timeout=5)[0], "zigbee2mqtt/lamp")

    def test_says_goodbye_when_stopped(self):
        self.client.start()
        self.connects.get(timeout=5)
        self.client.stop()
        self.assertEqual(self.broker.next(mqtt.DISCONNECT)[0], mqtt.DISCONNECT)
        self.assertFalse(self.client.connected)


class RefusedTest(unittest.TestCase):
    def test_a_refused_login_is_logged_and_never_counts_as_connected(self):
        broker = FakeBroker(refuse=4)
        connected = threading.Event()
        client = MqttClient("127.0.0.1", broker.port, on_connect=connected.set)
        try:
            with self.assertLogs("board.mqtt", level="WARNING") as logs:
                client.start()
                broker.next(mqtt.CONNECT)
                for _ in range(50):
                    if logs.output:
                        break
                    threading.Event().wait(0.05)
            self.assertIn("username or password", logs.output[0])
            self.assertFalse(connected.is_set())
            self.assertFalse(client.connected)
        finally:
            client.stop()
            broker.close()


if __name__ == "__main__":
    unittest.main()
