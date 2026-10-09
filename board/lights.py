"""The ceiling lights: Zigbee switches reached through Zigbee2MQTT, and their schedules.

The switches are paired with Zigbee2MQTT (github.com/NLBoa/zigbee_ceiling), which
puts each one on the MQTT broker (Mosquitto) under its own topic: state reports
arrive on ``zigbee2mqtt/<name>`` and ``{"state": "ON"}`` sent to
``zigbee2mqtt/<name>/set`` switches it. The board joins the same broker with its own
small client (``board.mqtt``), so there's nothing extra to install.

``data/lights.json`` keeps the schedules, which switches have On and Off swapped (a
relay wired or paired the other way round), and the last list of switches so the
board can show them before Zigbee2MQTT has answered. What each light is doing right
now is only kept in memory, and goes to every screen over the event stream.

Lights are known by their IEEE address, which survives renaming them in Zigbee2MQTT.
"""
import copy
import json
import logging
import re
import threading
import uuid
from datetime import datetime, timedelta

from .mqtt import MqttClient
from .store import JsonStore, NotFound, ValidationError

log = logging.getLogger(__name__)

DEFAULT_PORT = 1883
DEFAULT_BASE_TOPIC = "zigbee2mqtt"
MAX_SCHEDULES = 40
MAX_LIGHTS = 64
# A schedule missed by more than this (the Pi's clock jumped, say) isn't caught up on.
MAX_CATCH_UP_MINUTES = 5
# Lands each check just after the minute turns over.
TICK_MARGIN_SECONDS = 0.2

TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
LIGHT_ID = re.compile(r"^0x[0-9a-f]{16}$")
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
TOPIC_SAFE = re.compile(r"^[^#+\x00]+$")
SCHEDULE_FIELDS = ("time", "on", "lights", "days", "enabled")


class LightsUnavailable(Exception):
    """The broker or Zigbee2MQTT can't be reached, so a light can't be switched now."""


def settings_from(raw):
    """Reads the `lights` setting: where the MQTT broker is. None leaves the lights off."""
    if raw is None or raw is False:
        return None
    if raw is True:
        raw = {}
    if not isinstance(raw, dict):
        log.warning("Ignoring 'lights' in config.json: it should be an object like {\"mqtt_host\": \"localhost\"}.")
        return None
    host = raw.get("mqtt_host", "localhost")
    port = raw.get("mqtt_port", DEFAULT_PORT)
    base = raw.get("base_topic", DEFAULT_BASE_TOPIC)
    username, password = raw.get("username"), raw.get("password")
    if not (isinstance(host, str) and host.strip()):
        log.warning("Ignoring 'lights' in config.json: 'mqtt_host' must be a hostname.")
        return None
    if not (isinstance(port, int) and 0 < port < 65536):
        log.warning("Ignoring 'lights' in config.json: 'mqtt_port' must be a port number.")
        return None
    if not (isinstance(base, str) and base.strip("/") and TOPIC_SAFE.match(base)):
        log.warning("Ignoring 'lights' in config.json: 'base_topic' must be a topic like zigbee2mqtt.")
        return None
    return {
        "host": host.strip(),
        "port": port,
        "base_topic": base.strip("/"),
        "username": username if isinstance(username, str) and username else None,
        "password": password if isinstance(password, str) else None,
    }


def display_name(friendly_name, light_id):
    """'bedroom_light' → 'Bedroom', 'living_room/ceiling' → 'Living room ceiling'.

    Everything here is a light, so a trailing "light" only crowds the tile. A switch
    nobody has named yet gets the end of its address.
    """
    if friendly_name == light_id or not friendly_name:
        return "Light %s" % light_id[-4:].upper()
    words = [w for w in re.split(r"[_/\-\s]+", friendly_name) if w]
    if len(words) > 1 and words[-1].lower() in ("light", "lights"):
        words.pop()
    text = " ".join(words)
    return (text[:1].upper() + text[1:]) or friendly_name


def lights_in(device_list):
    """The on/off switches in Zigbee2MQTT's bridge/devices list, as {id: {"topic", "name"}}."""
    found = {}
    for device in device_list if isinstance(device_list, list) else []:
        if not isinstance(device, dict) or device.get("type") == "Coordinator" or device.get("disabled"):
            continue
        light_id = str(device.get("ieee_address", "")).lower()
        topic = device.get("friendly_name")
        if not LIGHT_ID.match(light_id) or not isinstance(topic, str) or not TOPIC_SAFE.match(topic):
            continue
        if not device.get("interview_completed", False):
            continue
        exposes = (device.get("definition") or {}).get("exposes") or []
        switches = any(
            isinstance(e, dict)
            and e.get("type") in ("switch", "light")
            and any(isinstance(f, dict) and f.get("property") == "state" for f in e.get("features") or [])
            for e in exposes
        )
        if switches:
            found[light_id] = {"topic": topic, "name": display_name(topic, light_id)}
        if len(found) >= MAX_LIGHTS:
            break
    return found


def _payload_state(payload):
    """'online'/'ON'-style word from a payload that's either JSON {"state": ...} or plain text."""
    text = payload.decode("utf-8", "replace").strip() if isinstance(payload, bytes) else str(payload)
    try:
        data = json.loads(text)
    except ValueError:
        return text
    if isinstance(data, dict):
        state = data.get("state")
        return state if isinstance(state, str) else None
    return data if isinstance(data, str) else None


# Schedules


def clean_schedule(raw):
    if not isinstance(raw, dict):
        raise ValidationError("Send the schedule as a JSON object.")
    time = raw.get("time")
    if not isinstance(time, str) or not TIME.match(time):
        raise ValidationError("Pick a time for the schedule.")
    on = raw.get("on")
    if not isinstance(on, bool):
        raise ValidationError("Say whether the schedule turns the lights on or off.")
    days = raw.get("days", [])
    if not isinstance(days, list) or not all(isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6 for d in days):
        raise ValidationError("Days must be numbers from 0 (Sunday) to 6 (Saturday).")
    lights = raw.get("lights", [])
    if not isinstance(lights, list) or not all(isinstance(i, str) and LIGHT_ID.match(i.lower()) for i in lights):
        raise ValidationError("Pick which lights the schedule switches.")
    if len(lights) > MAX_LIGHTS:
        raise ValidationError("That's more lights than the board knows about.")
    enabled = raw.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValidationError("'enabled' must be true or false.")
    return {
        "time": time,
        "on": on,
        # No days means once, the next time that time comes round.
        "days": sorted(set(days)),
        # No lights means every light, including ones paired later.
        "lights": list(dict.fromkeys(i.lower() for i in lights)),
        "enabled": enabled,
    }


def weekday(moment):
    """0 for Sunday through 6 for Saturday, the way the screens count them."""
    return (moment.weekday() + 1) % 7


def due(schedules, after, until):
    """Each (minute, schedule) set for a minute after `after`, up to and including `until`.

    Both are the board's local wall-clock time, without a time zone.
    """
    found = []
    minute = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(MAX_CATCH_UP_MINUTES):
        if minute > until:
            break
        clock = minute.strftime("%H:%M")
        for schedule in schedules:
            if schedule["enabled"] and schedule["time"] == clock and (not schedule["days"] or weekday(minute) in schedule["days"]):
                found.append((minute, schedule))
        minute += timedelta(minutes=1)
    return found


def _order(schedule):
    return (schedule["time"], schedule["id"])


# The lights


class Lights(JsonStore):
    label = "lights"

    def __init__(self, path=None, *, mqtt=None, zone=None, feed=None, clock=None, client_factory=MqttClient):
        self._mqtt = mqtt
        self._zone = zone
        self._wall_clock = clock or self._local_now
        self._raw = {}         # id -> "ON"/"OFF" as the switch last reported it
        self._online = {}      # id -> bool, when Zigbee2MQTT reports availability
        self._hub = None       # Zigbee2MQTT itself: True/False, None until it says
        self._connected = False
        self._subscribed = set()
        self._fired = {}       # schedule id -> the local minute it last ran
        self._stop = threading.Event()
        self._thread = None
        super().__init__(path, feed=feed)
        self._client = None
        if mqtt is not None:
            self._client = client_factory(
                mqtt["host"],
                mqtt["port"],
                username=mqtt.get("username"),
                password=mqtt.get("password"),
                on_connect=self.handle_connect,
                on_disconnect=self.handle_disconnect,
                on_message=self.handle_message,
            )

    def _local_now(self):
        return datetime.now(self._zone).replace(tzinfo=None)

    # Running

    def start(self):
        if self._client is None or self._thread is not None:
            return
        self._client.start()
        self._thread = threading.Thread(target=self._schedule_loop, name="light-schedules", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._client is not None:
            self._client.stop()

    def _schedule_loop(self):
        last = self._wall_clock()
        while True:
            now = self._wall_clock()
            wait = 60 - now.second - now.microsecond / 1e6 + TICK_MARGIN_SECONDS
            if self._stop.wait(wait):
                return
            now = self._wall_clock()
            if now > last:
                try:
                    self.run_due(max(last, now - timedelta(minutes=MAX_CATCH_UP_MINUTES)), now)
                except Exception:
                    log.exception("Lights: a schedule failed to run")
            # A clock that went back just waits; _fired stops a minute running twice.
            last = now

    def run_due(self, after, until):
        """Carries out every schedule due after `after`, up to and including `until`."""
        sends = []
        with self._changed:
            changed = False
            for minute, schedule in due(self._schedules, after, until):
                stamp = minute.isoformat(timespec="minutes")
                if self._fired.get(schedule["id"]) == stamp:
                    continue
                self._fired[schedule["id"]] = stamp
                targets = schedule["lights"] or sorted(self._devices)
                sends += [(light_id, schedule["on"]) for light_id in targets if light_id in self._devices]
                log.info("Lights: %s schedule turning %s %s", schedule["time"], "on" if schedule["on"] else "off",
                         "%d light(s)" % len(schedule["lights"]) if schedule["lights"] else "every light")
                if not schedule["days"]:
                    schedule["enabled"] = False
                    changed = True
            if changed:
                self._commit()
        for light_id, on in sends:
            try:
                self.set(light_id, on)
            except (LightsUnavailable, NotFound) as err:
                log.warning("Lights: a schedule couldn't switch %s: %s", light_id, err)

    # From the broker (the MQTT thread)

    def handle_connect(self):
        base = self._mqtt["base_topic"]
        with self._changed:
            self._connected = True
            self._subscribed = set()
            self._announce()
        self._client.subscribe(["%s/bridge/devices" % base, "%s/bridge/state" % base])
        self._follow()

    def handle_disconnect(self):
        with self._changed:
            self._connected = False
            self._subscribed = set()
            self._announce()

    def handle_message(self, topic, payload):
        base = self._mqtt["base_topic"] + "/"
        if not topic.startswith(base):
            return
        rest = topic[len(base):]
        if rest == "bridge/devices":
            try:
                found = lights_in(json.loads(payload))
            except ValueError:
                return
            with self._changed:
                if found != self._devices:
                    self._devices = found
                    for gone in set(self._raw) - set(found):
                        self._raw.pop(gone, None)
                        self._online.pop(gone, None)
                    self._commit()
            self._follow()
            return
        if rest == "bridge/state":
            state = _payload_state(payload)
            with self._changed:
                hub = state == "online" if state in ("online", "offline") else None
                if hub != self._hub:
                    self._hub = hub
                    self._announce()
            return
        availability = rest.endswith("/availability")
        name = rest[: -len("/availability")] if availability else rest
        with self._changed:
            light_id = next((i for i, d in self._devices.items() if d["topic"] == name), None)
            if light_id is None:
                return
            if availability:
                state = _payload_state(payload)
                if state in ("online", "offline") and self._online.get(light_id) != (state == "online"):
                    self._online[light_id] = state == "online"
                    self._announce()
                return
            try:
                report = json.loads(payload)
            except ValueError:
                return
            state = report.get("state") if isinstance(report, dict) else None
            if state in ("ON", "OFF") and self._raw.get(light_id) != state:
                self._raw[light_id] = state
                self._announce()

    def _follow(self):
        """Subscribes to every light's reports, and asks the new ones how they are."""
        if self._client is None:
            return
        base = self._mqtt["base_topic"]
        with self._changed:
            if not self._connected:
                return
            wanted = {}
            for device in self._devices.values():
                wanted["%s/%s" % (base, device["topic"])] = device["topic"]
                wanted["%s/%s/availability" % (base, device["topic"])] = None
            new = [t for t in wanted if t not in self._subscribed]
            old = [t for t in self._subscribed if t not in wanted]
            self._subscribed = set(wanted)
        self._client.unsubscribe(old)
        self._client.subscribe(new)
        # Zigbee2MQTT doesn't keep a switch's state on the broker, so ask for it.
        for topic in new:
            if wanted[topic] is not None:
                self._client.publish("%s/%s/get" % (base, wanted[topic]), json.dumps({"state": ""}))

    # Switching

    def set(self, light_id, on):
        if not isinstance(on, bool):
            raise ValidationError("'on' must be true or false.")
        with self._changed:
            device = self._devices.get(light_id)
            if device is None:
                raise NotFound("That light isn't paired with the board any more.")
            if self._client is None:
                raise LightsUnavailable("The lights aren't set up on this board yet.")
            if not self._connected:
                raise LightsUnavailable("Can't reach the lights right now. Check that Mosquitto is running on the Pi.")
            if self._hub is False:
                raise LightsUnavailable("Zigbee2MQTT isn't running, so the lights can't be switched.")
            command = "ON" if on != (light_id in self._swapped) else "OFF"
            topic = "%s/%s/set" % (self._mqtt["base_topic"], device["topic"])
        if not self._client.publish(topic, json.dumps({"state": command})):
            raise LightsUnavailable("Can't reach the lights right now. Try again in a moment.")
        with self._changed:
            # Shown straight away; the switch's own report confirms it (or puts it right).
            if light_id in self._devices and self._raw.get(light_id) != command:
                self._raw[light_id] = command
                self._announce()
            return {"state": self._state()}

    def swap(self, light_id, swapped):
        """Treats this switch's On as Off and its Off as On, here and in every schedule."""
        if not isinstance(swapped, bool):
            raise ValidationError("'swapped' must be true or false.")
        with self._changed:
            if light_id not in self._devices:
                raise NotFound("That light isn't paired with the board any more.")
            if swapped != (light_id in self._swapped):
                self._swapped.add(light_id) if swapped else self._swapped.discard(light_id)
                self._commit()
            return {"state": self._state()}

    # Schedules

    def add_schedule(self, raw, schedule_id=None):
        schedule = clean_schedule(raw)
        with self._changed:
            if len(self._schedules) >= MAX_SCHEDULES:
                raise ValidationError("That's a lot of schedules. Delete one to make room.")
            schedule["id"] = self._new_id(schedule_id)
            self._schedules.append(schedule)
            self._schedules.sort(key=_order)
            self._commit()
            return {"state": self._state(), "schedule": copy.deepcopy(schedule)}

    def update_schedule(self, schedule_id, raw):
        if not isinstance(raw, dict):
            raise ValidationError("Send the changes as a JSON object.")
        with self._changed:
            schedule = self._find(schedule_id)
            merged = {**schedule, **{k: raw[k] for k in SCHEDULE_FIELDS if k in raw}}
            cleaned = clean_schedule(merged)
            if any(cleaned[k] != schedule[k] for k in SCHEDULE_FIELDS):
                schedule.update(cleaned)
                # A schedule switched back on (or moved) may run again today.
                self._fired.pop(schedule_id, None)
                self._schedules.sort(key=_order)
                self._commit()
            return {"state": self._state(), "schedule": copy.deepcopy(schedule)}

    def remove_schedule(self, schedule_id):
        with self._changed:
            schedule = self._find(schedule_id)
            index = self._schedules.index(schedule)
            self._schedules.pop(index)
            self._discard(index, schedule)
            self._fired.pop(schedule_id, None)
            self._commit()
            return {"state": self._state(), "schedule": copy.deepcopy(schedule)}

    def restore_schedules(self, schedule_ids):
        with self._changed:
            present = {s["id"] for s in self._schedules}
            entries = self._take_from_trash(schedule_ids, present)
            for _, schedule in entries:
                self._schedules.append(schedule)
            if entries:
                self._schedules.sort(key=_order)
                self._commit()
            return {"state": self._state(), "restored": [s["id"] for _, s in entries]}

    def _find(self, schedule_id):
        schedule = next((s for s in self._schedules if s["id"] == schedule_id), None)
        if schedule is None:
            raise NotFound("That schedule was already deleted.")
        return schedule

    def _new_id(self, requested):
        taken = {s["id"] for s in self._schedules} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    # Internals

    def _announce(self):
        """Tells every screen about a change that isn't worth writing to the SD card."""
        self._version += 1
        self._changed.notify_all()
        if self._feed is not None:
            self._feed.notify()

    def _reachable(self, light_id):
        return self._connected and self._hub is not False and self._online.get(light_id, True)

    # JsonStore hooks

    def _reset(self):
        self._devices = {}
        self._swapped = set()
        self._schedules = []

    def _state(self):
        lights = []
        for light_id, device in self._devices.items():
            raw = self._raw.get(light_id)
            swapped = light_id in self._swapped
            lights.append({
                "id": light_id,
                "name": device["name"],
                "on": None if raw is None else (raw == "ON") != swapped,
                "reachable": self._reachable(light_id),
                "swapped": swapped,
            })
        lights.sort(key=lambda light: (light["name"].lower(), light["id"]))
        return {
            "version": self._version,
            "configured": self._mqtt is not None,
            "connected": self._connected,
            "hub": self._hub,
            "lights": lights,
            "schedules": copy.deepcopy(self._schedules),
        }

    def _to_disk(self):
        return {
            "lights": {light_id: dict(device) for light_id, device in self._devices.items()},
            "swapped": sorted(self._swapped),
            "schedules": self._schedules,
        }

    def _from_disk(self, data):
        devices = {}
        for light_id, device in (data.get("lights") or {}).items():
            if LIGHT_ID.match(light_id) and isinstance(device.get("topic"), str) and isinstance(device.get("name"), str):
                devices[light_id] = {"topic": device["topic"], "name": device["name"]}
        self._devices = devices
        self._swapped = {i for i in data.get("swapped", []) if isinstance(i, str) and LIGHT_ID.match(i)}
        schedules = []
        for raw in data.get("schedules", []):
            schedule = clean_schedule(raw)
            if not isinstance(raw.get("id"), str):
                raise ValueError("bad schedule")
            schedule["id"] = raw["id"]
            schedules.append(schedule)
        self._schedules = sorted(schedules, key=_order)
