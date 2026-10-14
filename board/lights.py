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

"When it gets dark" switches lights on by itself, once a day: when the sun goes down
at the board's latitude and longitude, or when a paired Zigbee light sensor says the
room has gone dim. It only acts between noon and the time it stops, so it never fights
someone who switched the lights off, and never wakes anyone up.

Motion sensors pair the same way. Each can keep the board's own screen on: when
none of them has seen anyone for a while (30 minutes, say), the monitor is switched
off (``board.screen``), and it comes back the moment one sees someone, or someone taps
it. Their own settings (how long they wait before reporting clear, how sensitive they
are) are changed through Zigbee2MQTT.
"""
import copy
import json
import logging
import math
import re
import threading
import time
import uuid
from datetime import datetime, timedelta

from .mqtt import MqttClient
from .store import JsonStore, NotFound, ValidationError, tidy_text

log = logging.getLogger(__name__)

DEFAULT_PORT = 1883
DEFAULT_BASE_TOPIC = "zigbee2mqtt"
MAX_SCHEDULES = 40
MAX_NAME_LENGTH = 40
MAX_LIGHTS = 64
# A schedule missed by more than this (the Pi's clock jumped, say) isn't caught up on.
MAX_CATCH_UP_MINUTES = 5
# How long pairing stays open: Zigbee2MQTT's longest, a little over four minutes.
PAIR_SECONDS = 254
# Lands each check just after the minute turns over.
TICK_MARGIN_SECONDS = 0.2

TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
LIGHT_ID = re.compile(r"^0x[0-9a-f]{16}$")
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
TOPIC_SAFE = re.compile(r"^[^#+\x00]+$")
SCHEDULE_FIELDS = ("time", "on", "lights", "days", "enabled", "offAgain", "watchFor")
# "Turn off again": a light switched back on after a Turn off schedule goes off again
# after offAgain minutes, for watchFor hours after the schedule ran.
MAX_OFF_AGAIN_MINUTES = 240
DEFAULT_WATCH_HOURS = 8
MAX_WATCH_HOURS = 12
MINUTE_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
DARK_FIELDS = ("enabled", "lights", "level", "until", "sensor")
# How dark is dark enough, per level: the sun's height (degrees) or a light sensor's lux.
DARK_LEVELS = {"early": (4.0, 100), "sunset": (-0.833, 30), "late": (-5.0, 10)}
# The lights are only switched on by darkness from noon until the setting's stop time
# ("00:00" is midnight, the end of the day).
DARK_FROM = "12:00"
DEFAULT_DARK_UNTIL = "23:00"
# A sensor must read dark this long, so a passing shadow doesn't switch the lights on.
DARK_FOR_MINUTES = 3
# A sensor that hasn't reported for this long is ignored, and the sun decides instead.
SENSOR_STALE_HOURS = 3
MAX_SENSORS = 16
ILLUMINANCE = ("illuminance_lux", "illuminance")
# Motion sensors: what Zigbee2MQTT calls seeing someone (mmWave presence sensors say "presence").
MOTION = ("occupancy", "presence")
MAX_MOTION = 16
MOTION_RULE_FIELDS = ("enabled", "offAfter")
# Minutes without motion before the screen goes off.
DEFAULT_SCREEN_OFF_AFTER = 30
MIN_SCREEN_OFF_AFTER = 5
MAX_SCREEN_OFF_AFTER = 240
# A sensor's own settings people may change, when Zigbee2MQTT says the sensor accepts them.
MOTION_SETTINGS = ("motion_timeout", "occupancy_timeout", "detection_interval",
                   "occupancy_sensitivity", "motion_sensitivity", "sensitivity")
MAX_SETTING_CHOICES = 8


class LightsUnavailable(Exception):
    """The broker or Zigbee2MQTT can't be reached, so a light can't be switched now."""


def settings_from(raw):
    """Reads the `lights` setting: where the MQTT broker is.

    Left out, the board looks for Mosquitto on the Pi itself, where pi/install.sh
    puts it, so the lights work without touching config.json. `false` turns them off.
    """
    if raw is False:
        return None
    if raw is None or raw is True:
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


def display_name(friendly_name, light_id, noun="Light"):
    """'bedroom_light' → 'Bedroom', 'living_room/ceiling' → 'Living room ceiling'.

    Everything here is a light, so a trailing "light" only crowds the tile. A device
    nobody has named yet gets what it is and the end of its address.
    """
    if friendly_name == light_id or not friendly_name:
        return "%s %s" % (noun, light_id[-4:].upper())
    words = [w for w in re.split(r"[_/\-\s]+", friendly_name) if w]
    if len(words) > 1 and words[-1].lower() in ("light", "lights"):
        words.pop()
    text = " ".join(words)
    return (text[:1].upper() + text[1:]) or friendly_name


def clean_name(raw):
    if not isinstance(raw, str):
        raise ValidationError("A light's name must be text.")
    return tidy_text(
        raw,
        max_length=MAX_NAME_LENGTH,
        empty_message="Give the light a name.",
        too_long_message="Keep light names under %d characters." % MAX_NAME_LENGTH,
    )


def topic_name(name):
    """'Bedroom Lamp' → 'bedroom_lamp': the name Zigbee2MQTT is asked to use, a safe MQTT topic."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _usable(device):
    """(id, topic) for a paired, interviewed device in bridge/devices, or None."""
    if not isinstance(device, dict) or device.get("type") == "Coordinator" or device.get("disabled"):
        return None
    device_id = str(device.get("ieee_address", "")).lower()
    topic = device.get("friendly_name")
    if not LIGHT_ID.match(device_id) or not isinstance(topic, str) or not TOPIC_SAFE.match(topic):
        return None
    if not device.get("interview_completed", False):
        return None
    return device_id, topic


def _flat_exposes(device):
    """Everything a device exposes, with the features of composite exposes alongside."""
    flat = []
    for expose in (device.get("definition") or {}).get("exposes") or []:
        if isinstance(expose, dict):
            flat.append(expose)
            flat += [f for f in expose.get("features") or [] if isinstance(f, dict)]
    return flat


def lights_in(device_list):
    """The on/off switches in Zigbee2MQTT's bridge/devices list, as {id: {"topic", "name"}}."""
    found = {}
    for device in device_list if isinstance(device_list, list) else []:
        usable = _usable(device)
        if usable is None:
            continue
        light_id, topic = usable
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


def sensors_in(device_list):
    """The light sensors in Zigbee2MQTT's bridge/devices list, as {id: {"topic", "name", "property"}}.

    Newer Zigbee2MQTT reports lux as `illuminance`; older versions as `illuminance_lux`,
    next to a raw `illuminance`. The one measured in lux is used when there's a choice.
    """
    found = {}
    for device in device_list if isinstance(device_list, list) else []:
        usable = _usable(device)
        if usable is None:
            continue
        sensor_id, topic = usable
        readings = [e for e in _flat_exposes(device) if e.get("type") == "numeric" and e.get("property") in ILLUMINANCE]
        if not readings:
            continue
        best = min(readings, key=lambda e: (e.get("unit") != "lx", e["property"] != "illuminance_lux"))
        found[sensor_id] = {"topic": topic, "name": display_name(topic, sensor_id, "Sensor"), "property": best["property"]}
        if len(found) >= MAX_SENSORS:
            break
    return found


def motion_in(device_list):
    """The motion sensors in bridge/devices, as {id: {"topic", "name", "property", "settings"}}.

    `settings` are the ones people may change (see MOTION_SETTINGS): numbers with their
    range, or a short list of words, as Zigbee2MQTT describes them.
    """
    found = {}
    for device in device_list if isinstance(device_list, list) else []:
        usable = _usable(device)
        if usable is None:
            continue
        sensor_id, topic = usable
        flat = _flat_exposes(device)
        motion = next((e for e in flat if e.get("type") == "binary" and e.get("property") in MOTION), None)
        if motion is None:
            continue
        found[sensor_id] = {
            "topic": topic,
            "name": display_name(topic, sensor_id, "Motion sensor"),
            "property": motion["property"],
            "settings": _settings_in(flat),
        }
        if len(found) >= MAX_MOTION:
            break
    return found


def _settings_in(flat):
    settings = []
    for expose in flat:
        prop = expose.get("property")
        access = expose.get("access", 0)
        if prop not in MOTION_SETTINGS or any(s["property"] == prop for s in settings):
            continue
        if not (_whole(access) and access & 2):
            continue  # Zigbee2MQTT can't set it
        setting = _valid_setting({**expose, "type": expose.get("type"), "min": expose.get("value_min"),
                                  "max": expose.get("value_max"), "values": expose.get("values")})
        if setting is not None:
            settings.append(setting)
    return settings


def _valid_setting(raw):
    """A setting as the board keeps it, or None if it can't be offered safely."""
    if not isinstance(raw, dict) or raw.get("property") not in MOTION_SETTINGS:
        return None
    if raw.get("type") == "numeric":
        low, high, unit = raw.get("min"), raw.get("max"), raw.get("unit")
        if not (_whole(low) and _whole(high) and 0 <= low <= high):
            return None
        return {"property": raw["property"], "type": "numeric", "min": low, "max": high,
                "unit": unit if isinstance(unit, str) and len(unit) <= 12 else None}
    values = raw.get("values")
    if raw.get("type") == "enum" and isinstance(values, list) and 0 < len(values) <= MAX_SETTING_CHOICES \
            and all(isinstance(v, str) and 0 < len(v) <= 24 for v in values):
        return {"property": raw["property"], "type": "enum", "values": list(values)}
    return None


def setting_accepts(setting, value):
    if setting["type"] == "numeric":
        return _whole(value) and setting["min"] <= value <= setting["max"]
    return value in setting["values"]


def sun_elevation(moment, latitude, longitude):
    """The sun's height above the horizon in degrees at an aware datetime, worked out as web/js/sky.js does."""
    d = moment.timestamp() / 86400 - 10957.5  # days since J2000.0
    g = math.radians((357.529 + 0.98560028 * d) % 360)
    q = (280.459 + 0.98564736 * d) % 360
    ecliptic = math.radians(q + 1.915 * math.sin(g) + 0.02 * math.sin(2 * g))
    tilt = math.radians(23.439 - 0.00000036 * d)
    right_ascension = math.degrees(math.atan2(math.cos(tilt) * math.sin(ecliptic), math.cos(ecliptic)))
    declination = math.asin(math.sin(tilt) * math.sin(ecliptic))
    sidereal = (280.46061837 + 360.98564736629 * d) % 360
    hour_angle = math.radians(sidereal + longitude - right_ascension)
    lat = math.radians(latitude)
    return math.degrees(math.asin(
        math.sin(lat) * math.sin(declination) + math.cos(lat) * math.cos(declination) * math.cos(hour_angle)))


def _pairing_event(event, kind="light"):
    """What a bridge/event says about a device that's joining: (found or None, pairing done).

    `kind` is what's being paired ("light" or "motion"), for the name of a device that
    hasn't said what it is yet. Whatever it turns out to be, a light or a motion sensor
    is ready to use.
    """
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    light_id = str(data.get("ieee_address", "")).lower()
    if not LIGHT_ID.match(light_id):
        return None, False
    name = display_name(data.get("friendly_name"), light_id, PAIRING_NOUNS.get(kind, "Light"))
    kind, status = event.get("type"), data.get("status")
    if kind == "device_joined" or (kind == "device_interview" and status == "started"):
        return {"state": "joining", "name": name, "id": light_id}, False
    if kind == "device_interview" and status == "failed":
        return {"state": "failed", "name": name, "id": light_id}, False
    if kind == "device_interview" and status == "successful":
        device = {**data, "type": "Router", "interview_completed": True}
        if lights_in([device]):
            name = display_name(data.get("friendly_name"), light_id)
            return {"state": "ready", "name": name, "id": light_id, "kind": "light"}, True
        if motion_in([device]):
            name = display_name(data.get("friendly_name"), light_id, "Motion sensor")
            return {"state": "ready", "name": name, "id": light_id, "kind": "motion"}, True
        return {"state": "other", "name": name, "id": light_id}, False
    return None, False


PAIRING_NOUNS = {"light": "Light", "motion": "Motion sensor"}


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
    lights = _light_ids(raw.get("lights", []), "Pick which lights the schedule switches.")
    enabled = raw.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValidationError("'enabled' must be true or false.")
    off_again = raw.get("offAgain", 0)
    if not _whole(off_again) or not (off_again == 0 or 5 <= off_again <= MAX_OFF_AGAIN_MINUTES):
        raise ValidationError("Turn lights off again after 5 minutes to 4 hours, or never.")
    watch_for = raw.get("watchFor", DEFAULT_WATCH_HOURS)
    if not _whole(watch_for) or not 1 <= watch_for <= MAX_WATCH_HOURS:
        raise ValidationError("Keep watching for 1 to %d hours." % MAX_WATCH_HOURS)
    return {
        "time": time,
        "on": on,
        # No days means once, the next time that time comes round.
        "days": sorted(set(days)),
        # No lights means every light, including ones paired later.
        "lights": lights,
        "enabled": enabled,
        # Only a Turn off schedule watches for lights being switched back on.
        "offAgain": 0 if on else off_again,
        "watchFor": watch_for,
    }


def clean_dark(raw):
    """The "When it gets dark" setting: on or off, which lights, how dark, until when, and by which sensor."""
    if not isinstance(raw, dict):
        raise ValidationError("Send the setting as a JSON object.")
    enabled = raw.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ValidationError("'enabled' must be true or false.")
    level = raw.get("level", "sunset")
    if level not in DARK_LEVELS:
        raise ValidationError("Pick how dark it should get.")
    until = raw.get("until", DEFAULT_DARK_UNTIL)
    if not isinstance(until, str) or not TIME.match(until) or not (until == "00:00" or until > DARK_FROM):
        raise ValidationError("Pick a time after noon, up to midnight, for it to stop.")
    sensor = raw.get("sensor")
    if sensor is not None and not (isinstance(sensor, str) and LIGHT_ID.match(sensor.lower())):
        raise ValidationError("Pick a light sensor, or the sun.")
    return {
        "enabled": enabled,
        # No lights means every light, as in a schedule.
        "lights": _light_ids(raw.get("lights", []), "Pick which lights come on."),
        "level": level,
        "until": until,
        # None means the sun decides.
        "sensor": sensor.lower() if sensor else None,
    }


def clean_motion_rule(raw):
    """What a motion sensor does: whether it keeps the screen on, and for how long after the last motion."""
    if not isinstance(raw, dict):
        raise ValidationError("Send the setting as a JSON object.")
    enabled = raw.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ValidationError("'enabled' must be true or false.")
    off_after = raw.get("offAfter", DEFAULT_SCREEN_OFF_AFTER)
    if not _whole(off_after) or not MIN_SCREEN_OFF_AFTER <= off_after <= MAX_SCREEN_OFF_AFTER:
        raise ValidationError("Turn the screen off 5 minutes to 4 hours after the last motion.")
    return {"enabled": enabled, "offAfter": off_after}


def _light_ids(lights, message):
    if not isinstance(lights, list) or not all(isinstance(i, str) and LIGHT_ID.match(i.lower()) for i in lights):
        raise ValidationError(message)
    if len(lights) > MAX_LIGHTS:
        raise ValidationError("That's more lights than the board knows about.")
    return list(dict.fromkeys(i.lower() for i in lights))


def in_dark_window(clock, until):
    """Whether "HH:MM" is between noon and the stop time, when darkness may switch lights on."""
    return clock >= DARK_FROM and (until == "00:00" or clock < until)


def _whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


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

    def __init__(self, path=None, *, mqtt=None, zone=None, location=None, feed=None, clock=None, epoch_ms=None,
                 screen=None, client_factory=MqttClient):
        self._mqtt = mqtt
        self._zone = zone
        # {"latitude", "longitude"}: where the sun is worked out for "When it gets dark".
        self._location = location
        self._lux = {}         # sensor id -> {"lux", "at", "below": {level: local time it went under}}
        self._sun_times = None  # (date, {level: "HH:MM" or None}): when it gets dark today, by the sun
        self._wall_clock = clock or self._local_now
        self._epoch_ms = epoch_ms or (lambda: int(time.time() * 1000))
        # Whether new devices may join, until when (epoch ms), what's being paired
        # ("light" or "motion"), and how the newest one is getting on.
        self._pairing = {"open": False, "until": None, "kind": "light", "found": None, "error": None}
        # Motion sensors, in memory only: id -> {"occupied", "at", "atMs", "clearAt", "values"}.
        self._motion_live = {}
        # The board's monitor (board.screen.Screen), switched off when the motion sensors see nobody.
        self._screen = screen
        self._screen_awake_at = self._wall_clock()  # the last motion, tap or test that counts as someone there
        self._raw = {}         # id -> "ON"/"OFF" as the switch last reported it
        self._online = {}      # id -> bool, when Zigbee2MQTT reports availability
        self._hub = None       # Zigbee2MQTT itself: True/False, None until it says
        self._connected = False
        self._subscribed = set()
        self._fired = {}       # schedule id -> the local minute it last ran
        self._on_since = {}    # id -> local time the light was last seen coming on
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
        if screen is not None:
            screen.on_change = self._screen_changed

    def _local_now(self):
        return datetime.now(self._zone).replace(tzinfo=None)

    # Running

    def start(self):
        if self._client is None or self._thread is not None:
            return
        if self._screen is not None:
            self._screen.start()
        self._client.start()
        self._thread = threading.Thread(target=self._schedule_loop, name="light-schedules", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._client is not None:
            self._client.stop()
        if self._screen is not None:
            self._screen.stop()
            # Never leave the board dark when it stops.
            if not self._screen.on:
                self._screen.set(True)

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
            try:
                self.enforce(now)
            except Exception:
                log.exception("Lights: couldn't turn a light off again")
            try:
                self.check_dark(now)
            except Exception:
                log.exception("Lights: couldn't turn the lights on for the dark")
            try:
                self.check_screen(now)
            except Exception:
                log.exception("Lights: couldn't switch the screen")
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
                if schedule["on"]:
                    # Lights scheduled on aren't switched off again by an earlier watch.
                    changed = self._stop_watching(targets) or changed
                elif schedule["offAgain"]:
                    self._watches = [w for w in self._watches if w["schedule"] != schedule["id"]]
                    self._watches.append({
                        "schedule": schedule["id"],
                        "lights": list(schedule["lights"]) or None,
                        "after": schedule["offAgain"],
                        "until": (minute + timedelta(hours=schedule["watchFor"])).isoformat(timespec="minutes"),
                    })
                    changed = True
            if changed:
                self._commit()
        for light_id, on in sends:
            try:
                self.set(light_id, on)
            except (LightsUnavailable, NotFound) as err:
                log.warning("Lights: a schedule couldn't switch %s: %s", light_id, err)

    def enforce(self, now):
        """Turns off again any light switched back on while a Turn off schedule watches it."""
        sends = []
        with self._changed:
            stamp = now.isoformat(timespec="minutes")
            live = [w for w in self._watches if w["until"] > stamp]
            for light_id in self._devices:
                deadline = self._deadline(light_id, live)
                if deadline is not None and now >= deadline:
                    sends.append(light_id)
            if len(live) != len(self._watches):
                self._watches = live
                self._commit()
        for light_id in sends:
            device = self._devices.get(light_id) or {}
            log.info("Lights: turning %s off again; it was left on", self._names.get(light_id) or device.get("name", light_id))
            try:
                self.set(light_id, False)
            except (LightsUnavailable, NotFound) as err:
                log.warning("Lights: couldn't turn %s off again: %s", light_id, err)

    def _deadline(self, light_id, watches):
        """When a light that's on gets turned off again, or None. Call with self._changed held."""
        since = self._on_since.get(light_id)
        if since is None or not self._is_on(light_id):
            return None
        best = None
        for watch in watches:
            if watch["lights"] is not None and light_id not in watch["lights"]:
                continue
            deadline = since + timedelta(minutes=watch["after"])
            # Only while that watch lasts: a light switched on near its end stays on.
            if deadline.isoformat(timespec="minutes") < watch["until"] and (best is None or deadline < best):
                best = deadline
        return best

    def _stop_watching(self, light_ids):
        """Takes lights out of every watch. Call with self._changed held; True if anything changed."""
        gone = set(light_ids)
        kept = []
        for watch in self._watches:
            if watch["lights"] is None and not gone & set(self._devices):
                kept.append(watch)
                continue
            # "Every light" becomes the lights that are still being watched.
            lights = [i for i in (watch["lights"] or sorted(self._devices)) if i not in gone]
            if lights:
                kept.append({**watch, "lights": lights})
        changed = kept != self._watches
        self._watches = kept
        return changed

    # When it gets dark

    def check_dark(self, now):
        """Switches the lights on the first time it's dark enough today, between noon and the stop time."""
        with self._changed:
            dark = self._dark
            today = now.date().isoformat()
            if not dark["enabled"] or (self._dark_ran or "")[:10] == today:
                return
            if not in_dark_window(now.strftime("%H:%M"), dark["until"]) or not self._is_dark(now):
                return
            # Without the broker nothing would come on; it's tried again next minute.
            if not self._connected or self._hub is False:
                return
            targets = [i for i in (dark["lights"] or sorted(self._devices)) if i in self._devices]
            if not targets:
                return
            self._dark_ran = now.isoformat(timespec="minutes")
            # Like a Turn on schedule: an earlier watch doesn't switch these straight back off.
            self._stop_watching(targets)
            self._commit()
        log.info("Lights: it's dark, turning on %d light(s)", len(targets))
        for light_id in targets:
            try:
                self.set(light_id, True)
            except (LightsUnavailable, NotFound) as err:
                log.warning("Lights: couldn't turn %s on for the dark: %s", light_id, err)

    def set_dark(self, raw):
        if not isinstance(raw, dict):
            raise ValidationError("Send the changes as a JSON object.")
        with self._changed:
            cleaned = clean_dark({**self._dark, **{k: raw[k] for k in DARK_FIELDS if k in raw}})
            if cleaned != self._dark:
                self._dark = cleaned
                self._commit()
            return {"state": self._state()}

    def _dark_source(self, now):
        """What decides whether it's dark: "sensor", "sun", or None. Call with self._changed held."""
        reading = self._lux.get(self._dark["sensor"])
        if reading is not None and now - reading["at"] <= timedelta(hours=SENSOR_STALE_HOURS):
            return "sensor"
        return "sun" if self._location else None

    def _is_dark(self, now):
        """Call with self._changed held."""
        source = self._dark_source(now)
        level = self._dark["level"]
        if source == "sensor":
            since = self._lux[self._dark["sensor"]]["below"].get(level)
            return since is not None and now - since >= timedelta(minutes=DARK_FOR_MINUTES)
        if source == "sun":
            return self._elevation(now) < DARK_LEVELS[level][0]
        return False

    def _elevation(self, now):
        moment = now.replace(tzinfo=self._zone) if self._zone else now.astimezone()
        return sun_elevation(moment, self._location["latitude"], self._location["longitude"])

    def _sun_times_on(self, day):
        """{level: "HH:MM"}: when the sun gets low enough for each level that day, after noon.

        None for a level the sun doesn't reach before midnight. Worked out once a day.
        """
        if self._sun_times is None or self._sun_times[0] != day:
            times = dict.fromkeys(DARK_LEVELS)
            minute = datetime.combine(day, datetime.min.time()).replace(hour=12)
            while minute.date() == day and None in times.values():
                elevation = self._elevation(minute)
                for level, (below, _) in DARK_LEVELS.items():
                    if times[level] is None and elevation < below:
                        times[level] = minute.strftime("%H:%M")
                minute += timedelta(minutes=1)
            self._sun_times = (day, times)
        return dict(self._sun_times[1])

    def _note_lux(self, sensor_id, value):
        """Keeps a light sensor's latest reading. Call with self._changed held."""
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value < 1e6:
            return
        now = self._wall_clock()
        reading = self._lux.setdefault(sensor_id, {"lux": None, "at": None, "below": {}})
        first = reading["at"] is None
        reading["lux"], reading["at"] = value, now
        for level, (_, limit) in DARK_LEVELS.items():
            if value < limit:
                reading["below"].setdefault(level, now)
            else:
                reading["below"].pop(level, None)
        # Readings can come every few seconds, so screens only hear that a sensor has started reporting.
        if first:
            self._announce()

    def _is_on(self, light_id):
        raw = self._raw.get(light_id)
        return raw is not None and (raw == "ON") != (light_id in self._swapped)

    def _note_on(self, light_id):
        """Keeps track of when each light came on. Call with self._changed held."""
        if self._is_on(light_id):
            self._on_since.setdefault(light_id, self._wall_clock())
        else:
            self._on_since.pop(light_id, None)

    # From the broker (the MQTT thread)

    def handle_connect(self):
        base = self._mqtt["base_topic"]
        with self._changed:
            self._connected = True
            self._subscribed = set()
            self._announce()
        self._client.subscribe(["%s/bridge/%s" % (base, name) for name in
                                ("devices", "state", "info", "event", "response/permit_join")])
        self._follow()

    def handle_disconnect(self):
        with self._changed:
            self._connected = False
            self._subscribed = set()
            # Zigbee2MQTT closes pairing on its own timer; without the broker we can't tell.
            self._pairing["open"] = False
            self._pairing["until"] = None
            self._announce()

    def handle_message(self, topic, payload):
        base = self._mqtt["base_topic"] + "/"
        if not topic.startswith(base):
            return
        rest = topic[len(base):]
        if rest in ("bridge/info", "bridge/event", "bridge/response/permit_join"):
            try:
                data = json.loads(payload)
            except ValueError:
                return
            if isinstance(data, dict):
                self._read_pairing(rest, data)
            return
        if rest == "bridge/devices":
            try:
                devices = json.loads(payload)
            except ValueError:
                return
            found, sensors, motion = lights_in(devices), sensors_in(devices), motion_in(devices)
            with self._changed:
                if found != self._devices or sensors != self._sensors or motion != self._motion:
                    self._devices = found
                    self._sensors = sensors
                    self._motion = motion
                    for gone in set(self._raw) - set(found):
                        self._raw.pop(gone, None)
                        self._online.pop(gone, None)
                    for gone in set(self._battery) - set(found) - set(motion):
                        self._battery.pop(gone, None)
                    for gone in set(self._lux) - set(sensors):
                        self._lux.pop(gone, None)
                    for gone in set(self._motion_live) - set(motion):
                        self._motion_live.pop(gone, None)
                    for gone in set(self._motion_rules) - set(motion):
                        self._motion_rules.pop(gone, None)
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
        report = None
        if not availability:
            try:
                report = json.loads(payload)
            except ValueError:
                return
            if not isinstance(report, dict):
                return
        wake = False
        with self._changed:
            light_id = next((i for i, d in self._devices.items() if d["topic"] == name), None)
            sensor_id = next((i for i, d in self._sensors.items() if d["topic"] == name), None)
            motion_id = next((i for i, d in self._motion.items() if d["topic"] == name), None)
            # The light level first: a motion report often carries the reading to judge it by.
            if sensor_id is not None and report is not None:
                self._note_lux(sensor_id, report.get(self._sensors[sensor_id]["property"]))
            if motion_id is not None and report is not None:
                wake = self._note_motion(motion_id, report)
            if light_id is not None and availability:
                state = _payload_state(payload)
                if state in ("online", "offline") and self._online.get(light_id) != (state == "online"):
                    self._online[light_id] = state == "online"
                    self._announce()
            elif light_id is not None:
                state = report.get("state")
                if state in ("ON", "OFF") and self._raw.get(light_id) != state:
                    self._raw[light_id] = state
                    self._note_on(light_id)
                    self._announce()
                self._note_battery(light_id, report.get("battery"))
        if wake:
            self._screen.set(True)

    def _note_battery(self, light_id, level):
        """Keeps a battery-powered switch's charge (percent). Call with self._changed held.

        Saved to disk only when the percentage changes, which is rarely; the time of
        the latest report is kept in memory and goes out with the next update.
        """
        if not isinstance(level, (int, float)) or isinstance(level, bool) or not 0 <= level <= 100:
            return
        level = round(level)
        known = self._battery.get(light_id)
        self._battery[light_id] = {"level": level, "at": self._epoch_ms()}
        if known is None or known["level"] != level:
            self._commit()

    def _follow(self):
        """Subscribes to every light's reports, and asks the new ones how they are."""
        if self._client is None:
            return
        base = self._mqtt["base_topic"]
        with self._changed:
            if not self._connected:
                return
            wanted = {}
            # Sensors only report; they're never asked (most sleep on batteries).
            for device in [*self._sensors.values(), *self._motion.values()]:
                wanted["%s/%s" % (base, device["topic"])] = None
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

    # Pairing

    def pair(self, open_, kind="light"):
        """Lets a new switch (or motion sensor) join for a few minutes, or stops that early."""
        if not isinstance(open_, bool):
            raise ValidationError("'open' must be true or false.")
        if kind is None:
            kind = "light"
        if kind not in PAIRING_NOUNS:
            raise ValidationError("Pair a light or a motion sensor.")
        with self._changed:
            self._require_hub()
            if self._hub is not True:
                # Zigbee2MQTT says so on bridge/state as soon as it runs; until then nothing would listen.
                raise LightsUnavailable("Zigbee2MQTT isn't running on the Pi yet, so pairing can't start.")
        if not self._send_permit_join(PAIR_SECONDS if open_ else 0):
            raise LightsUnavailable("Can't reach the lights right now. Try again in a moment.")
        with self._changed:
            # Shown straight away; Zigbee2MQTT's bridge/info confirms it.
            self._pairing = {
                "open": open_,
                "until": self._epoch_ms() + PAIR_SECONDS * 1000 if open_ else None,
                "kind": kind if open_ else self._pairing["kind"],
                "found": None if open_ else self._pairing["found"],
                "error": None,
            }
            self._announce()
            return {"state": self._state()}

    def _send_permit_join(self, seconds):
        topic = "%s/bridge/request/permit_join" % self._mqtt["base_topic"]
        return self._client.publish(topic, json.dumps({"time": seconds}))

    def _read_pairing(self, topic, data):
        close = False
        with self._changed:
            pairing = dict(self._pairing)
            if topic == "bridge/info":
                pairing["open"] = bool(data.get("permit_join"))
                end, timeout = data.get("permit_join_end"), data.get("permit_join_timeout")
                if not pairing["open"]:
                    pairing["until"] = None
                elif isinstance(end, int):
                    pairing["until"] = end
                elif isinstance(timeout, int):
                    pairing["until"] = self._epoch_ms() + timeout * 1000
            elif topic == "bridge/response/permit_join":
                if data.get("status") == "error":
                    pairing.update(open=False, until=None, error=str(data.get("error") or "Zigbee2MQTT couldn't start pairing."))
            elif pairing["open"]:
                found, close = _pairing_event(data, pairing["kind"])
                if found is not None:
                    pairing["found"] = found
            if pairing != self._pairing:
                self._pairing = pairing
                self._announce()
        if close:
            # One switch at a time, as Zigbee2MQTT recommends: it's in, so stop listening.
            self._send_permit_join(0)

    # Switching

    def set(self, light_id, on):
        if not isinstance(on, bool):
            raise ValidationError("'on' must be true or false.")
        with self._changed:
            device = self._devices.get(light_id)
            if device is None:
                raise NotFound("That light isn't paired with the board any more.")
            self._require_hub()
            command = "ON" if on != (light_id in self._swapped) else "OFF"
            topic = "%s/%s/set" % (self._mqtt["base_topic"], device["topic"])
        if not self._client.publish(topic, json.dumps({"state": command})):
            raise LightsUnavailable("Can't reach the lights right now. Try again in a moment.")
        with self._changed:
            # Shown straight away; the switch's own report confirms it (or puts it right).
            if light_id in self._devices and self._raw.get(light_id) != command:
                self._raw[light_id] = command
                self._note_on(light_id)
                self._announce()
            return {"state": self._state()}

    def rename(self, light_id, raw_name):
        """Names a light (or a sensor) on the board, and asks Zigbee2MQTT to call it the same.

        The board's name is what every screen shows, kept by address so it survives
        anything Zigbee2MQTT does. Zigbee2MQTT's own name (its page, its MQTT topic) is
        a tidy version of it, if that's free; if Zigbee2MQTT says no, nothing shows it.
        """
        name = clean_name(raw_name)
        with self._changed:
            kinds = (self._devices, self._motion, self._sensors)
            device = next((k[light_id] for k in kinds if light_id in k), None)
            if device is None:
                raise NotFound("That isn't paired with the board any more.")
            if self._names.get(light_id) != name:
                self._names[light_id] = name
                self._commit()
            wanted = topic_name(name)
            taken = {d["topic"] for k in kinds for i, d in k.items() if i != light_id}
            ask = self._connected and wanted and wanted != device["topic"] and wanted not in taken
            old = device["topic"]
            state = self._state()
        if ask:
            self._client.publish("%s/bridge/request/device/rename" % self._mqtt["base_topic"],
                                 json.dumps({"from": old, "to": wanted, "homeassistant_rename": False}))
        return {"state": state}

    def swap(self, light_id, swapped):
        """Treats this switch's On as Off and its Off as On, here and in every schedule."""
        if not isinstance(swapped, bool):
            raise ValidationError("'swapped' must be true or false.")
        with self._changed:
            if light_id not in self._devices:
                raise NotFound("That light isn't paired with the board any more.")
            if swapped != (light_id in self._swapped):
                self._swapped.add(light_id) if swapped else self._swapped.discard(light_id)
                self._note_on(light_id)
                self._commit()
            return {"state": self._state()}

    # Motion sensors

    def set_motion(self, sensor_id, raw):
        """Changes what a motion sensor does (see clean_motion_rule)."""
        if not isinstance(raw, dict):
            raise ValidationError("Send the changes as a JSON object.")
        with self._changed:
            if sensor_id not in self._motion:
                raise NotFound("That motion sensor isn't paired with the board any more.")
            current = self._motion_rules.get(sensor_id) or clean_motion_rule({})
            cleaned = clean_motion_rule({**current, **{k: raw[k] for k in MOTION_RULE_FIELDS if k in raw}})
            if cleaned != current:
                self._motion_rules[sensor_id] = cleaned
                self._commit()
            return {"state": self._state()}

    def set_motion_setting(self, sensor_id, prop, value):
        """Changes one of the sensor's own settings, through Zigbee2MQTT.

        A sensor on batteries only listens when it wakes, so the value shown is put
        right by the sensor's next report if it didn't take it.
        """
        with self._changed:
            device = self._motion.get(sensor_id)
            if device is None:
                raise NotFound("That motion sensor isn't paired with the board any more.")
            setting = next((s for s in device["settings"] if s["property"] == prop), None)
            if setting is None:
                raise ValidationError("That sensor doesn't have that setting.")
            if not setting_accepts(setting, value):
                raise ValidationError("Pick one of the sensor's own choices.")
            self._require_hub()
            topic = "%s/%s/set" % (self._mqtt["base_topic"], device["topic"])
        if not self._client.publish(topic, json.dumps({prop: value})):
            raise LightsUnavailable("Can't reach the sensor right now. Try again in a moment.")
        with self._changed:
            live = self._motion_live_for(sensor_id)
            if live["values"].get(prop) != value:
                live["values"][prop] = value
                self._announce()
            return {"state": self._state()}

    def check_screen(self, now):
        """Switches the screen off once every sensor that keeps it on has seen nobody for long enough.

        Turning every one of them off (or unpairing them) brings a dark screen back.
        """
        if self._screen is None:
            return
        with self._changed:
            rules = [(i, r) for i, r in self._motion_rules.items() if r["enabled"] and i in self._motion]
            if not rules:
                wanted = None if self._screen.on else True
            else:
                lives = [self._motion_live.get(i) or {} for i, _ in rules]
                if any(live.get("occupied") for live in lives):
                    wanted = None
                else:
                    last = max([self._screen_awake_at] + [live.get("clearAt") or live.get("at") or self._screen_awake_at
                                                          for live in lives])
                    quiet = now >= last + timedelta(minutes=max(r["offAfter"] for _, r in rules))
                    wanted = False if quiet and self._screen.on else None
        if wanted is not None:
            if not wanted:
                log.info("Lights: no motion for a while, switching the screen off")
            self._screen.set(wanted)

    def screen_wake(self):
        """Someone tapped the dark screen: on again, and the wait starts afresh."""
        screen = self._require_screen()
        with self._changed:
            self._screen_awake_at = self._wall_clock()
        if not screen.set(True):
            raise LightsUnavailable(screen.status()["error"] or "Couldn't switch the screen on.")
        return {"state": self.snapshot()}

    def screen_test(self):
        """Switches the screen off for a few seconds and on again, to show it works on this Pi."""
        screen = self._require_screen()
        worked = screen.test()
        with self._changed:
            self._screen_awake_at = self._wall_clock()
        if not worked:
            raise LightsUnavailable(screen.status()["error"] or "Couldn't switch the screen off.")
        return {"state": self.snapshot()}

    def _require_screen(self):
        if self._screen is None:
            raise LightsUnavailable("Switching the screen off is turned off in config.json (\"screen\": false).")
        return self._screen

    def _screen_changed(self):
        with self._changed:
            self._announce()

    def _motion_live_for(self, sensor_id):
        """Call with self._changed held."""
        return self._motion_live.setdefault(sensor_id, {
            "occupied": None, "at": None, "atMs": None, "clearAt": None, "values": {},
        })

    def _note_motion(self, sensor_id, report):
        """Keeps a motion sensor's report. Call with self._changed held; True if the screen should come on."""
        device = self._motion[sensor_id]
        live = self._motion_live_for(sensor_id)
        now = self._wall_clock()
        changed = False
        self._note_battery(sensor_id, report.get("battery"))
        for setting in device["settings"]:
            value = report.get(setting["property"])
            if value is not None and setting_accepts(setting, value) and live["values"].get(setting["property"]) != value:
                live["values"][setting["property"]] = value
                changed = True
        seen = report.get(device["property"])
        wake = False
        if isinstance(seen, bool):
            if seen:
                live["at"], live["atMs"] = now, self._epoch_ms()
                rule = self._motion_rules.get(sensor_id)
                if self._screen is not None and rule and rule["enabled"]:
                    self._screen_awake_at = now
                    wake = not self._screen.on
            elif live["occupied"] is not False:
                live["clearAt"] = now
            if live["occupied"] != seen:
                live["occupied"] = seen
                changed = True
        if changed:
            self._announce()
        return wake

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
                # Changing a schedule (or pausing it) ends tonight's watch; it starts afresh next run.
                self._watches = [w for w in self._watches if w["schedule"] != schedule_id]
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
            self._watches = [w for w in self._watches if w["schedule"] != schedule_id]
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

    def _require_hub(self):
        """Call with self._changed held."""
        if self._client is None:
            raise LightsUnavailable("The lights aren't set up on this board yet.")
        if not self._connected:
            raise LightsUnavailable("Can't reach the lights right now. Check that Mosquitto is running on the Pi.")
        if self._hub is False:
            raise LightsUnavailable("Zigbee2MQTT isn't running, so the lights can't be switched.")

    def _reachable(self, light_id):
        return self._connected and self._hub is not False and self._online.get(light_id, True)

    # JsonStore hooks

    def _reset(self):
        self._devices = {}
        self._names = {}       # id -> the name people gave it on the board
        self._swapped = set()
        self._schedules = []
        self._watches = []     # lights to turn off again if they're switched back on (see enforce)
        self._battery = {}     # id -> {"level": percent, "at": epoch ms of the latest report}
        self._sensors = {}     # light sensors: id -> {"topic", "name", "property"}
        self._dark = clean_dark({})
        self._dark_ran = None  # the local minute "When it gets dark" last switched lights on
        self._motion = {}        # motion sensors: id -> {"topic", "name", "property", "settings"}
        self._motion_rules = {}  # id -> what it does (clean_motion_rule)

    def _state(self):
        lights = []
        stamp = self._wall_clock().isoformat(timespec="minutes")
        live = [w for w in self._watches if w["until"] > stamp]
        for light_id, device in self._devices.items():
            deadline = self._deadline(light_id, live)
            raw = self._raw.get(light_id)
            swapped = light_id in self._swapped
            lights.append({
                "id": light_id,
                "name": self._names.get(light_id) or device["name"],
                "on": None if raw is None else (raw == "ON") != swapped,
                "reachable": self._reachable(light_id),
                "swapped": swapped,
                # "23:45": when it'll be turned off again, if a Turn off schedule is watching it.
                "offAt": deadline.strftime("%H:%M") if deadline else None,
                # Percent, for switches that run on batteries; None for the rest.
                "battery": self._battery.get(light_id, {}).get("level"),
                "batteryAt": self._battery.get(light_id, {}).get("at"),
            })
        lights.sort(key=lambda light: (light["name"].lower(), light["id"]))
        now = self._wall_clock()
        stale = timedelta(hours=SENSOR_STALE_HOURS)
        sensors = sorted(
            ({"id": i, "name": self._names.get(i) or d["name"],
              "reporting": i in self._lux and now - self._lux[i]["at"] <= stale}
             for i, d in self._sensors.items()),
            key=lambda sensor: (sensor["name"].lower(), sensor["id"]),
        )
        motion = []
        for sensor_id, device in self._motion.items():
            live = self._motion_live.get(sensor_id) or {}
            values = live.get("values") or {}
            motion.append({
                "id": sensor_id,
                "name": self._names.get(sensor_id) or device["name"],
                # True while it sees someone, False once clear, None until it first reports.
                "occupied": live.get("occupied"),
                "lastMotion": live.get("atMs"),
                "battery": self._battery.get(sensor_id, {}).get("level"),
                "batteryAt": self._battery.get(sensor_id, {}).get("at"),
                "rule": copy.deepcopy(self._motion_rules.get(sensor_id) or clean_motion_rule({})),
                "settings": [{**s, "value": values.get(s["property"])} for s in device["settings"]],
            })
        motion.sort(key=lambda sensor: (sensor["name"].lower(), sensor["id"]))
        return {
            "version": self._version,
            "configured": self._mqtt is not None,
            "connected": self._connected,
            "hub": self._hub,
            "lights": lights,
            "schedules": copy.deepcopy(self._schedules),
            "pairing": copy.deepcopy(self._pairing),
            "sensors": sensors,
            "motion": motion,
            # The board's monitor: {"on", "testing", "method", "problem", "error"}, or None when that's turned off.
            "screen": self._screen.status() if self._screen is not None else None,
            "dark": {
                **copy.deepcopy(self._dark),
                # What decides it right now: "sensor", "sun", or None (no location and no sensor).
                "using": self._dark_source(now),
                # {"sunset": "18:21", ...}: when the sun gets low enough today, for each level.
                "sunTimes": self._sun_times_on(now.date()) if self._location else None,
                # "2026-10-10T17:42": the last time it switched lights on.
                "ranAt": self._dark_ran,
            },
        }

    def _to_disk(self):
        return {
            "lights": {light_id: dict(device) for light_id, device in self._devices.items()},
            "names": dict(self._names),
            "swapped": sorted(self._swapped),
            "schedules": self._schedules,
            "watches": self._watches,
            "battery": self._battery,
            "sensors": {sensor_id: dict(sensor) for sensor_id, sensor in self._sensors.items()},
            "dark": self._dark,
            "darkRan": self._dark_ran,
            "motion": {sensor_id: copy.deepcopy(device) for sensor_id, device in self._motion.items()},
            "motionRules": self._motion_rules,
        }

    def _from_disk(self, data):
        devices = {}
        for light_id, device in (data.get("lights") or {}).items():
            if LIGHT_ID.match(light_id) and isinstance(device.get("topic"), str) and isinstance(device.get("name"), str):
                devices[light_id] = {"topic": device["topic"], "name": device["name"]}
        self._devices = devices
        self._names = {i: n for i, n in (data.get("names") or {}).items()
                       if LIGHT_ID.match(i) and isinstance(n, str) and n.strip()}
        self._swapped = {i for i in data.get("swapped", []) if isinstance(i, str) and LIGHT_ID.match(i)}
        schedules = []
        for raw in data.get("schedules", []):
            schedule = clean_schedule(raw)
            if not isinstance(raw.get("id"), str):
                raise ValueError("bad schedule")
            schedule["id"] = raw["id"]
            schedules.append(schedule)
        self._schedules = sorted(schedules, key=_order)
        self._watches = [w for w in (_valid_watch(raw) for raw in data.get("watches", [])) if w]
        self._battery = {
            i: {"level": b["level"], "at": b.get("at") if _whole(b.get("at")) else None}
            for i, b in (data.get("battery") or {}).items()
            if LIGHT_ID.match(i) and isinstance(b, dict) and _whole(b.get("level")) and 0 <= b["level"] <= 100
        }
        self._sensors = {
            i: {"topic": d["topic"], "name": d["name"], "property": d["property"]}
            for i, d in (data.get("sensors") or {}).items()
            if LIGHT_ID.match(i) and isinstance(d, dict) and isinstance(d.get("topic"), str)
            and isinstance(d.get("name"), str) and d.get("property") in ILLUMINANCE
        }
        self._dark = clean_dark(data.get("dark") or {})
        ran = data.get("darkRan")
        self._dark_ran = ran if isinstance(ran, str) and MINUTE_STAMP.match(ran) else None
        self._motion = {}
        for sensor_id, device in (data.get("motion") or {}).items():
            if LIGHT_ID.match(sensor_id) and isinstance(device, dict) and isinstance(device.get("topic"), str) \
                    and isinstance(device.get("name"), str) and device.get("property") in MOTION:
                settings = [_valid_setting(s) for s in device.get("settings") or []]
                self._motion[sensor_id] = {"topic": device["topic"], "name": device["name"],
                                           "property": device["property"], "settings": [s for s in settings if s]}
        self._motion_rules = {i: clean_motion_rule(r) for i, r in (data.get("motionRules") or {}).items()
                              if LIGHT_ID.match(i) and isinstance(r, dict)}


def _valid_watch(raw):
    if not isinstance(raw, dict):
        return None
    lights = raw.get("lights")
    if lights is not None and not (isinstance(lights, list) and all(isinstance(i, str) and LIGHT_ID.match(i) for i in lights)):
        return None
    if not (isinstance(raw.get("schedule"), str) and _whole(raw.get("after")) and raw["after"] > 0
            and isinstance(raw.get("until"), str) and MINUTE_STAMP.match(raw["until"])):
        return None
    return {"schedule": raw["schedule"], "lights": lights, "after": raw["after"], "until": raw["until"]}
