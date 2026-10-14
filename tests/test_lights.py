import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from board.lights import (
    MAX_CATCH_UP_MINUTES,
    Lights,
    LightsUnavailable,
    display_name,
    due,
    lights_in,
    motion_in,
    sensors_in,
    settings_from,
    sun_elevation,
)
from board.store import ChangeFeed, NotFound, ValidationError

BEDROOM = "0xffffb40e060aceac"
KITCHEN = "0x00124b0029aa0102"


def switch(ieee, name, interviewed=True):
    return {
        "ieee_address": ieee,
        "friendly_name": name,
        "type": "Router",
        "interview_completed": interviewed,
        "definition": {"model": "3RSS009Z", "exposes": [{"type": "switch", "features": [{"property": "state"}]}]},
    }


DEVICES = [
    {"ieee_address": "0x00124b0000000000", "friendly_name": "Coordinator", "type": "Coordinator"},
    switch(BEDROOM, "bedroom_light"),
    switch(KITCHEN, "kitchen_light"),
    switch("0x0000000000000003", "half_paired", interviewed=False),
    {
        "ieee_address": "0x0000000000000004",
        "friendly_name": "hall_sensor",
        "type": "EndDevice",
        "interview_completed": True,
        "definition": {"exposes": [{"type": "binary", "property": "occupancy"}]},
    },
]


class FakeClient:
    """Stands in for MqttClient: records what the lights send."""

    def __init__(self, host, port, **callbacks):
        self.host, self.port = host, port
        self.callbacks = callbacks
        self.published = []
        self.subscribed = []
        self.unsubscribed = []
        self.up = True

    def start(self):
        pass

    def stop(self):
        pass

    def publish(self, topic, payload, retain=False):
        if not self.up:
            return False
        self.published.append((topic, json.loads(payload)))
        return True

    def subscribe(self, topics):
        self.subscribed += list(topics)
        return True

    def unsubscribe(self, topics):
        self.unsubscribed += list(topics)
        return True


def connected_lights(path=None, feed=None, clock=None, devices=DEVICES, **options):
    lights = Lights(path, mqtt=settings_from(True), feed=feed, clock=clock, epoch_ms=lambda: 1_000_000,
                    client_factory=FakeClient, **options)
    lights.handle_connect()
    lights.handle_message("zigbee2mqtt/bridge/state", b'{"state":"online"}')
    lights.handle_message("zigbee2mqtt/bridge/devices", json.dumps(devices).encode())
    return lights


def light(lights, light_id):
    return next(item for item in lights.snapshot()["lights"] if item["id"] == light_id)


class ConfigTest(unittest.TestCase):
    def test_settings_default_to_a_local_broker(self):
        local = {"host": "localhost", "port": 1883, "base_topic": "zigbee2mqtt", "username": None, "password": None}
        self.assertEqual(settings_from(None), local, "nothing in config.json")
        self.assertEqual(settings_from(True), local)
        self.assertEqual(settings_from({}), local)
        self.assertEqual(settings_from({"mqtt_host": "pi.local", "mqtt_port": 1884, "base_topic": "z2m/",
                                        "username": "board", "password": "pw"})["base_topic"], "z2m")

    def test_false_or_unusable_settings_leave_the_lights_off(self):
        self.assertIsNone(settings_from(False))
        with self.assertLogs("board.lights", level="WARNING"):
            self.assertIsNone(settings_from({"mqtt_port": "nope"}))
        with self.assertLogs("board.lights", level="WARNING"):
            self.assertIsNone(settings_from({"base_topic": "zigbee2mqtt/#"}))

    def test_a_board_without_settings_says_so_and_refuses_to_switch(self):
        lights = Lights()
        state = lights.snapshot()
        self.assertFalse(state["configured"])
        self.assertEqual(state["lights"], [])
        lights.start()  # nothing to start, and no error


class DevicesTest(unittest.TestCase):
    def test_only_interviewed_on_off_switches_are_lights(self):
        found = lights_in(DEVICES)
        self.assertEqual(set(found), {BEDROOM, KITCHEN})
        self.assertEqual(found[BEDROOM], {"topic": "bedroom_light", "name": "Bedroom"})

    def test_names_read_like_words(self):
        self.assertEqual(display_name("living_room/ceiling", BEDROOM), "Living room ceiling")
        self.assertEqual(display_name("desk_lamp", BEDROOM), "Desk lamp")
        self.assertEqual(display_name("light", BEDROOM), "Light", "a name that is only 'light' stays")
        self.assertEqual(display_name(BEDROOM, BEDROOM), "Light CEAC", "not named in Zigbee2MQTT yet")

    def test_connecting_follows_the_bridge_then_each_light(self):
        lights = connected_lights()
        client = lights._client
        self.assertIn("zigbee2mqtt/bridge/devices", client.subscribed)
        self.assertIn("zigbee2mqtt/bedroom_light", client.subscribed)
        self.assertIn("zigbee2mqtt/kitchen_light/availability", client.subscribed)
        self.assertIn(("zigbee2mqtt/bedroom_light/get", {"state": ""}), client.published)
        state = lights.snapshot()
        self.assertTrue(state["connected"])
        self.assertTrue(state["hub"])
        self.assertEqual([item["name"] for item in state["lights"]], ["Bedroom", "Kitchen"])
        self.assertIsNone(state["lights"][0]["on"], "unknown until the switch reports")

    def test_reports_change_what_every_screen_sees(self):
        feed = ChangeFeed()
        lights = connected_lights(feed=feed)
        before = (lights.snapshot()["version"], feed.seq)
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON","linkquality":120}')
        self.assertTrue(light(lights, BEDROOM)["on"])
        self.assertGreater(lights.snapshot()["version"], before[0])
        self.assertGreater(feed.seq, before[1])

        quiet = lights.snapshot()["version"]
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON","linkquality":90}')
        lights.handle_message("zigbee2mqtt/someone_else", b'{"state":"OFF"}')
        lights.handle_message("zigbee2mqtt/bedroom_light", b"not json")
        lights.handle_message("elsewhere/bedroom_light", b'{"state":"OFF"}')
        self.assertEqual(lights.snapshot()["version"], quiet, "nothing that shows changed")
        self.assertTrue(light(lights, BEDROOM)["on"])

    def test_a_light_or_the_hub_going_offline_makes_it_unreachable(self):
        lights = connected_lights()
        lights.handle_message("zigbee2mqtt/kitchen_light/availability", b'{"state":"offline"}')
        self.assertFalse(light(lights, KITCHEN)["reachable"])
        self.assertTrue(light(lights, BEDROOM)["reachable"])
        lights.handle_message("zigbee2mqtt/bridge/state", b"offline")
        self.assertFalse(light(lights, BEDROOM)["reachable"])
        with self.assertRaises(LightsUnavailable):
            lights.set(BEDROOM, True)

    def test_renaming_a_switch_in_zigbee2mqtt_keeps_its_settings(self):
        lights = connected_lights()
        lights.swap(KITCHEN, True)
        renamed = [d if d.get("ieee_address") != KITCHEN else switch(KITCHEN, "kitchen_ceiling") for d in DEVICES]
        lights.handle_message("zigbee2mqtt/bridge/devices", json.dumps(renamed).encode())
        self.assertIn("zigbee2mqtt/kitchen_light", lights._client.unsubscribed)
        self.assertIn("zigbee2mqtt/kitchen_ceiling", lights._client.subscribed)
        self.assertEqual(light(lights, KITCHEN)["name"], "Kitchen ceiling")
        self.assertTrue(light(lights, KITCHEN)["swapped"])


class RenameTest(unittest.TestCase):
    def test_a_light_keeps_the_name_it_is_given_and_zigbee2mqtt_is_asked_to_match(self):
        lights = connected_lights()
        state = lights.rename(KITCHEN, "  Kitchen   Island Light ")["state"]
        self.assertEqual(next(i for i in state["lights"] if i["id"] == KITCHEN)["name"], "Kitchen Island Light",
                         "exactly as typed (tidied), not shortened like Zigbee2MQTT names")
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/bridge/request/device/rename",
                         {"from": "kitchen_light", "to": "kitchen_island_light", "homeassistant_rename": False}))

        renamed = [d if d.get("ieee_address") != KITCHEN else switch(KITCHEN, "kitchen_island_light") for d in DEVICES]
        lights.handle_message("zigbee2mqtt/bridge/devices", json.dumps(renamed).encode())
        self.assertEqual(light(lights, KITCHEN)["name"], "Kitchen Island Light")
        lights.set(KITCHEN, True)
        self.assertEqual(lights._client.published[-1][0], "zigbee2mqtt/kitchen_island_light/set", "follows the new topic")

    def test_zigbee2mqtt_is_not_asked_for_a_name_another_switch_has(self):
        lights = connected_lights()
        sent = len(lights._client.published)
        lights.rename(KITCHEN, "Bedroom Light")
        self.assertEqual(len(lights._client.published), sent, "bedroom_light is taken")
        self.assertEqual(light(lights, KITCHEN)["name"], "Bedroom Light", "the board's name still changes")

    def test_names_are_checked(self):
        lights = connected_lights()
        with self.assertRaises(ValidationError):
            lights.rename(KITCHEN, "   ")
        with self.assertRaises(ValidationError):
            lights.rename(KITCHEN, "x" * 41)
        with self.assertRaises(ValidationError):
            lights.rename(KITCHEN, 7)
        with self.assertRaises(NotFound):
            lights.rename("0x0000000000000009", "Garage")

    def test_a_name_works_without_the_broker_and_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            lights = connected_lights(path)
            lights.handle_disconnect()
            lights.rename(BEDROOM, "Reading Lamp")
            again = Lights(path)
            self.assertEqual(next(i for i in again.snapshot()["lights"] if i["id"] == BEDROOM)["name"], "Reading Lamp")


class BatteryTest(unittest.TestCase):
    def test_battery_reports_are_kept_and_shown(self):
        lights = connected_lights()
        self.assertIsNone(light(lights, BEDROOM)["battery"], "unknown until the switch says")
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON","battery":63.5,"linkquality":90}')
        self.assertEqual(light(lights, BEDROOM)["battery"], 64)
        self.assertEqual(light(lights, BEDROOM)["batteryAt"], 1_000_000)
        version = lights.snapshot()["version"]
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON","battery":64}')
        self.assertEqual(lights.snapshot()["version"], version, "the same level isn't news")
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON","battery":28}')
        self.assertEqual(light(lights, BEDROOM)["battery"], 28)
        self.assertGreater(lights.snapshot()["version"], version)

    def test_nonsense_battery_values_are_ignored(self):
        lights = connected_lights()
        for payload in (b'{"battery":"low"}', b'{"battery":-5}', b'{"battery":180}', b'{"battery":true}', b'[1, 2]'):
            lights.handle_message("zigbee2mqtt/kitchen_light", payload)
        self.assertIsNone(light(lights, KITCHEN)["battery"])

    def test_the_battery_level_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            lights = connected_lights(path)
            lights.handle_message("zigbee2mqtt/kitchen_light", b'{"state":"OFF","battery":22}')
            again = Lights(path)
            kitchen = next(i for i in again.snapshot()["lights"] if i["id"] == KITCHEN)
            self.assertEqual((kitchen["battery"], kitchen["batteryAt"]), (22, 1_000_000))


class SwitchingTest(unittest.TestCase):
    def test_set_sends_the_state_and_shows_it_straight_away(self):
        lights = connected_lights()
        result = lights.set(BEDROOM, True)
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/bedroom_light/set", {"state": "ON"}))
        self.assertTrue(next(i for i in result["state"]["lights"] if i["id"] == BEDROOM)["on"])
        lights.set(BEDROOM, False)
        self.assertEqual(lights._client.published[-1][1], {"state": "OFF"})

    def test_a_swapped_switch_is_sent_the_opposite_and_shown_the_right_way_round(self):
        lights = connected_lights()
        lights.handle_message("zigbee2mqtt/kitchen_light", b'{"state":"ON"}')
        self.assertTrue(light(lights, KITCHEN)["on"])
        lights.swap(KITCHEN, True)
        self.assertFalse(light(lights, KITCHEN)["on"], "its ON report means the light is off")
        lights.set(KITCHEN, True)
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/kitchen_light/set", {"state": "OFF"}))
        self.assertTrue(light(lights, KITCHEN)["on"])
        lights.swap(KITCHEN, False)
        self.assertFalse(light(lights, KITCHEN)["on"])

    def test_bad_requests_say_what_is_wrong(self):
        lights = connected_lights()
        with self.assertRaises(ValidationError):
            lights.set(BEDROOM, "yes")
        with self.assertRaises(NotFound):
            lights.set("0x0000000000000009", True)
        with self.assertRaises(NotFound):
            lights.swap("0x0000000000000009", True)
        with self.assertRaises(ValidationError):
            lights.swap(BEDROOM, 1)

    def test_nothing_is_switched_without_the_broker(self):
        lights = connected_lights()
        lights.handle_disconnect()
        self.assertFalse(lights.snapshot()["connected"])
        self.assertFalse(light(lights, BEDROOM)["reachable"])
        with self.assertRaises(LightsUnavailable):
            lights.set(BEDROOM, True)
        lights.handle_connect()
        lights._client.up = False
        with self.assertRaises(LightsUnavailable):
            lights.set(BEDROOM, True)


class PairingTest(unittest.TestCase):
    NEW = "0x00124b00aaaa0009"

    def event(self, lights, kind, **data):
        payload = {"type": kind, "data": {"ieee_address": self.NEW, "friendly_name": self.NEW, **data}}
        lights.handle_message("zigbee2mqtt/bridge/event", json.dumps(payload).encode())

    def test_pairing_asks_zigbee2mqtt_and_shows_the_countdown_straight_away(self):
        lights = connected_lights()
        self.assertIn("zigbee2mqtt/bridge/event", lights._client.subscribed)
        self.assertFalse(lights.snapshot()["pairing"]["open"])
        state = lights.pair(True)["state"]
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/bridge/request/permit_join", {"time": 254}))
        self.assertEqual(state["pairing"], {"open": True, "until": 1_000_000 + 254_000, "kind": "light", "found": None, "error": None})

        lights.handle_message("zigbee2mqtt/bridge/info", b'{"permit_join": true, "permit_join_end": 1200000, "config": {}}')
        self.assertEqual(lights.snapshot()["pairing"]["until"], 1_200_000, "Zigbee2MQTT's own end time wins")

        lights.pair(False)
        self.assertEqual(lights._client.published[-1][1], {"time": 0})
        self.assertFalse(lights.snapshot()["pairing"]["open"])
        lights.handle_message("zigbee2mqtt/bridge/info", b'{"permit_join": false}')
        self.assertIsNone(lights.snapshot()["pairing"]["until"])

    def test_a_new_switch_is_followed_until_it_is_ready_then_pairing_stops(self):
        lights = connected_lights()
        lights.pair(True)
        self.event(lights, "device_joined")
        self.assertEqual(lights.snapshot()["pairing"]["found"], {"state": "joining", "name": "Light 0009", "id": self.NEW})
        self.event(lights, "device_interview", status="failed")
        self.assertEqual(lights.snapshot()["pairing"]["found"]["state"], "failed")
        self.event(lights, "device_interview", status="successful",
                   definition={"exposes": [{"type": "switch", "features": [{"property": "state"}]}]})
        self.assertEqual(lights.snapshot()["pairing"]["found"]["state"], "ready")
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/bridge/request/permit_join", {"time": 0}),
                         "one switch at a time")

    def test_a_device_that_is_not_a_switch_is_reported_and_pairing_stays_open(self):
        lights = connected_lights()
        lights.pair(True)
        sent = len(lights._client.published)
        self.event(lights, "device_interview", status="successful", definition={"exposes": [{"type": "binary"}]})
        self.assertEqual(lights.snapshot()["pairing"]["found"]["state"], "other")
        self.assertEqual(len(lights._client.published), sent)

    def test_events_while_pairing_is_closed_are_ignored(self):
        lights = connected_lights()
        self.event(lights, "device_joined")
        self.assertIsNone(lights.snapshot()["pairing"]["found"])

    def test_a_refusal_from_zigbee2mqtt_closes_pairing_with_its_reason(self):
        lights = connected_lights()
        lights.pair(True)
        lights.handle_message("zigbee2mqtt/bridge/response/permit_join", b'{"status": "error", "error": "Adapter busy"}')
        pairing = lights.snapshot()["pairing"]
        self.assertFalse(pairing["open"])
        self.assertEqual(pairing["error"], "Adapter busy")

    def test_pairing_needs_the_broker_and_zigbee2mqtt(self):
        lights = connected_lights()
        with self.assertRaises(ValidationError):
            lights.pair("yes")
        lights.pair(True)
        lights.handle_disconnect()
        self.assertFalse(lights.snapshot()["pairing"]["open"])
        with self.assertRaises(LightsUnavailable):
            lights.pair(True)
        lights.handle_connect()
        lights.handle_message("zigbee2mqtt/bridge/state", b'{"state":"offline"}')
        with self.assertRaises(LightsUnavailable):
            lights.pair(True)
        with self.assertRaises(LightsUnavailable):
            Lights().pair(True)
        never_ran = Lights(mqtt=settings_from(None), client_factory=FakeClient)
        never_ran.handle_connect()
        with self.assertRaises(LightsUnavailable, msg="Zigbee2MQTT hasn't said it's online"):
            never_ran.pair(True)


class ScheduleTest(unittest.TestCase):
    def test_schedules_are_validated_and_kept_in_time_order(self):
        lights = connected_lights()
        late = lights.add_schedule({"time": "23:00", "on": False, "days": [5, 1, 1], "lights": [BEDROOM.upper().replace("0X", "0x")]})
        early = lights.add_schedule({"time": "07:30", "on": True}, schedule_id="abcdef12")
        self.assertEqual(early["schedule"]["id"], "abcdef12")
        self.assertEqual(early["schedule"]["days"], [], "no days means once")
        self.assertEqual(early["schedule"]["lights"], [], "no lights means every light")
        self.assertEqual(late["schedule"]["days"], [1, 5])
        self.assertEqual(late["schedule"]["lights"], [BEDROOM])
        self.assertEqual([s["time"] for s in lights.snapshot()["schedules"]], ["07:30", "23:00"])

        for bad in (
            {"time": "24:00", "on": True},
            {"time": "7:30", "on": True},
            {"time": "07:30", "on": "yes"},
            {"time": "07:30", "on": True, "days": [7]},
            {"time": "07:30", "on": True, "days": [True]},
            {"time": "07:30", "on": True, "lights": ["kitchen"]},
            {"time": "07:30", "on": True, "enabled": "no"},
            "07:30",
        ):
            with self.assertRaises(ValidationError, msg=bad):
                lights.add_schedule(bad)

    def test_update_remove_and_restore(self):
        lights = connected_lights()
        schedule_id = lights.add_schedule({"time": "07:30", "on": True, "days": [1, 2, 3, 4, 5]})["schedule"]["id"]
        updated = lights.update_schedule(schedule_id, {"enabled": False, "time": "06:45", "id": "ignored"})
        self.assertEqual(updated["schedule"]["time"], "06:45")
        self.assertFalse(updated["schedule"]["enabled"])
        self.assertEqual(updated["schedule"]["id"], schedule_id)
        with self.assertRaises(ValidationError):
            lights.update_schedule(schedule_id, {"time": "late"})
        self.assertEqual(lights.snapshot()["schedules"][0]["time"], "06:45", "a bad change changes nothing")

        lights.remove_schedule(schedule_id)
        self.assertEqual(lights.snapshot()["schedules"], [])
        with self.assertRaises(NotFound):
            lights.remove_schedule(schedule_id)
        self.assertEqual(lights.restore_schedules([schedule_id])["restored"], [schedule_id])
        self.assertEqual(lights.snapshot()["schedules"][0]["time"], "06:45")

    def test_due_matches_the_time_and_the_day(self):
        weekdays = {"id": "a", "time": "07:00", "on": True, "days": [1, 2, 3, 4, 5], "lights": [], "enabled": True}
        once = {"id": "b", "time": "07:01", "on": False, "days": [], "lights": [], "enabled": True}
        off = {"id": "c", "time": "07:00", "on": False, "days": [], "lights": [], "enabled": False}
        schedules = [weekdays, once, off]
        friday = datetime(2026, 10, 9, 6, 59, 30)
        saturday = datetime(2026, 10, 10, 6, 59, 30)
        self.assertEqual([s["id"] for _, s in due(schedules, friday, friday.replace(minute=59, hour=6, second=59))], [])
        self.assertEqual([s["id"] for _, s in due(schedules, friday, datetime(2026, 10, 9, 7, 0, 0))], ["a"])
        self.assertEqual([s["id"] for _, s in due(schedules, friday, datetime(2026, 10, 9, 7, 1, 5))], ["a", "b"])
        self.assertEqual([s["id"] for _, s in due(schedules, saturday, datetime(2026, 10, 10, 7, 1))], ["b"])

    def test_due_does_not_catch_up_on_a_big_clock_jump(self):
        schedule = {"id": "a", "time": "07:00", "on": True, "days": [], "lights": [], "enabled": True}
        start = datetime(2026, 10, 9, 6, 50)
        self.assertEqual(due([schedule], start, datetime(2026, 10, 9, 8, 0)), [])
        self.assertEqual(MAX_CATCH_UP_MINUTES, 5)

    def test_running_a_schedule_switches_its_lights_once(self):
        lights = connected_lights()
        lights.swap(KITCHEN, True)
        lights.add_schedule({"time": "22:30", "on": False, "days": [0, 1, 2, 3, 4, 5, 6]})
        lights.add_schedule({"time": "22:31", "on": True, "lights": [BEDROOM]})
        client = lights._client
        client.published.clear()

        lights.run_due(datetime(2026, 10, 9, 22, 29), datetime(2026, 10, 9, 22, 30))
        self.assertEqual(sorted(client.published), [
            ("zigbee2mqtt/bedroom_light/set", {"state": "OFF"}),
            ("zigbee2mqtt/kitchen_light/set", {"state": "ON"}),
        ], "the kitchen switch is swapped, so it's sent ON to turn off")
        self.assertFalse(light(lights, KITCHEN)["on"])

        client.published.clear()
        lights.run_due(datetime(2026, 10, 9, 22, 29), datetime(2026, 10, 9, 22, 30))
        self.assertEqual(client.published, [], "a minute only runs once, even if the clock goes back")

        lights.run_due(datetime(2026, 10, 9, 22, 30), datetime(2026, 10, 9, 22, 31))
        self.assertEqual(client.published, [("zigbee2mqtt/bedroom_light/set", {"state": "ON"})])
        once = next(s for s in lights.snapshot()["schedules"] if s["time"] == "22:31")
        self.assertFalse(once["enabled"], "a one-off schedule switches itself off after running")

    def test_a_schedule_that_cannot_reach_the_lights_is_logged(self):
        lights = connected_lights()
        lights.add_schedule({"time": "08:00", "on": True, "days": [5]})
        lights.handle_disconnect()
        with self.assertLogs("board.lights", level="WARNING"):
            lights.run_due(datetime(2026, 10, 9, 7, 59), datetime(2026, 10, 9, 8, 0))


class Clock:
    """The board's wall clock, moved by hand."""

    def __init__(self, *parts):
        self.now = datetime(*parts)

    def __call__(self):
        return self.now

    def at(self, *parts):
        self.now = datetime(*parts)
        return self.now


class TurnOffAgainTest(unittest.TestCase):
    def night(self, path=None, **fields):
        """11 PM: everything off, and anything switched back on goes off again after 30 minutes."""
        clock = Clock(2026, 10, 9, 22, 0)
        lights = connected_lights(path, clock=clock)
        lights.add_schedule({"time": "23:00", "on": False, "days": [0, 1, 2, 3, 4, 5, 6], "offAgain": 30, "watchFor": 8, **fields})
        lights.run_due(datetime(2026, 10, 9, 22, 59), clock.at(2026, 10, 9, 23, 0))
        lights._client.published.clear()
        return lights, clock

    def test_a_light_switched_back_on_goes_off_again_after_the_wait(self):
        lights, clock = self.night()
        clock.at(2026, 10, 9, 23, 15)
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON"}')
        self.assertEqual(light(lights, BEDROOM)["offAt"], "23:45", "every screen can say when")

        lights.enforce(clock.at(2026, 10, 9, 23, 44))
        self.assertEqual(lights._client.published, [])
        lights.enforce(clock.at(2026, 10, 9, 23, 45))
        self.assertEqual(lights._client.published, [("zigbee2mqtt/bedroom_light/set", {"state": "OFF"})])
        self.assertFalse(light(lights, BEDROOM)["on"])
        self.assertIsNone(light(lights, BEDROOM)["offAt"])

        # On again later: a fresh 30 minutes from then.
        clock.at(2026, 10, 9, 23, 50)
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON"}')
        self.assertEqual(light(lights, BEDROOM)["offAt"], "00:20")

    def test_a_swapped_switch_is_turned_off_the_right_way_round(self):
        lights, clock = self.night()
        lights.swap(KITCHEN, True)
        clock.at(2026, 10, 9, 23, 30)
        lights.handle_message("zigbee2mqtt/kitchen_light", b'{"state":"OFF"}')  # swapped: the light is on
        lights._client.published.clear()
        lights.enforce(clock.at(2026, 10, 10, 0, 0))
        self.assertEqual(lights._client.published, [("zigbee2mqtt/kitchen_light/set", {"state": "ON"})])

    def test_watching_stops_when_its_time_is_up(self):
        lights, clock = self.night()
        clock.at(2026, 10, 10, 6, 45)
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON"}')
        self.assertIsNone(light(lights, BEDROOM)["offAt"], "7:15 is after the watch ends at 7:00")
        lights.enforce(clock.at(2026, 10, 10, 7, 15))
        self.assertEqual(lights._client.published, [])
        self.assertEqual(lights._watches, [], "the finished watch is dropped")

    def test_a_turn_on_schedule_ends_the_watch_for_its_lights(self):
        lights, clock = self.night()
        lights.add_schedule({"time": "06:00", "on": True, "lights": [BEDROOM], "days": [5, 6]})
        lights.run_due(datetime(2026, 10, 10, 5, 59), clock.at(2026, 10, 10, 6, 0))
        self.assertTrue(light(lights, BEDROOM)["on"])
        lights.handle_message("zigbee2mqtt/kitchen_light", b'{"state":"ON"}')
        lights._client.published.clear()
        lights.enforce(clock.at(2026, 10, 10, 6, 40))
        self.assertEqual(lights._client.published, [("zigbee2mqtt/kitchen_light/set", {"state": "OFF"})],
                         "the bedroom stays on as scheduled; the kitchen is still watched")

    def test_only_the_schedules_own_lights_are_watched(self):
        lights, clock = self.night(lights=[BEDROOM])
        clock.at(2026, 10, 9, 23, 10)
        lights.handle_message("zigbee2mqtt/kitchen_light", b'{"state":"ON"}')
        lights.enforce(clock.at(2026, 10, 10, 1, 0))
        self.assertEqual(lights._client.published, [])
        self.assertIsNone(light(lights, KITCHEN)["offAt"])

    def test_changing_or_deleting_the_schedule_ends_tonights_watch(self):
        lights, _ = self.night()
        schedule_id = lights.snapshot()["schedules"][0]["id"]
        lights.update_schedule(schedule_id, {"offAgain": 15})
        self.assertEqual(lights._watches, [])
        lights, _ = self.night()
        lights.remove_schedule(lights.snapshot()["schedules"][0]["id"])
        self.assertEqual(lights._watches, [])

    def test_a_watch_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            self.night(path)
            clock = Clock(2026, 10, 9, 23, 20)
            again = Lights(path, mqtt=settings_from(True), clock=clock, client_factory=FakeClient)
            again.handle_connect()
            again.handle_message("zigbee2mqtt/bridge/state", b'{"state":"online"}')
            again.handle_message("zigbee2mqtt/bridge/devices", json.dumps(DEVICES).encode())
            again.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON"}')
            again._client.published.clear()
            again.enforce(clock.at(2026, 10, 9, 23, 50))
            self.assertEqual(again._client.published, [("zigbee2mqtt/bedroom_light/set", {"state": "OFF"})])

    def test_turn_off_again_settings_are_checked(self):
        lights = connected_lights()
        on = lights.add_schedule({"time": "07:00", "on": True, "offAgain": 30})["schedule"]
        self.assertEqual(on["offAgain"], 0, "only a Turn off schedule watches")
        plain = lights.add_schedule({"time": "23:00", "on": False})["schedule"]
        self.assertEqual((plain["offAgain"], plain["watchFor"]), (0, 8))
        for bad in ({"offAgain": 3}, {"offAgain": 241}, {"offAgain": True}, {"watchFor": 0}, {"watchFor": 13}):
            with self.assertRaises(ValidationError, msg=bad):
                lights.add_schedule({"time": "23:00", "on": False, **bad})


HALL = "0x00158d0001a2b3c4"
NEW_YORK = {"latitude": 40.71, "longitude": -74.01}


def light_sensor(ieee, name, exposes):
    return {"ieee_address": ieee, "friendly_name": name, "type": "EndDevice", "interview_completed": True,
            "definition": {"exposes": exposes}}


WITH_SENSOR = DEVICES + [light_sensor(HALL, "hall_motion", [
    {"type": "binary", "property": "occupancy"},
    {"type": "numeric", "property": "illuminance", "name": "illuminance"},
    {"type": "numeric", "property": "illuminance_lux", "name": "illuminance_lux", "unit": "lx"},
])]


class WhenItGetsDarkTest(unittest.TestCase):
    def by_sun(self, clock, **dark):
        lights = connected_lights(clock=clock, zone=ZoneInfo("America/New_York"), location=NEW_YORK)
        lights.set_dark({"enabled": True, **dark})
        lights._client.published.clear()
        return lights

    def on_messages(self, lights):
        return sorted(t for t, payload in lights._client.published if payload == {"state": "ON"})

    def test_the_sun_is_worked_out_like_the_wallpaper(self):
        noon = sun_elevation(datetime(2026, 6, 21, 16, 55, tzinfo=timezone.utc), **NEW_YORK)
        self.assertAlmostEqual(noon, 90 - 40.71 + 23.44, delta=0.5, msg="midsummer noon in New York")
        night = sun_elevation(datetime(2026, 6, 21, 4, 55, tzinfo=timezone.utc), **NEW_YORK)
        self.assertLess(night, -20)

    def test_it_is_off_until_switched_on(self):
        clock = Clock(2026, 10, 10, 20, 0)
        lights = connected_lights(clock=clock, zone=ZoneInfo("America/New_York"), location=NEW_YORK)
        dark = lights.snapshot()["dark"]
        self.assertEqual((dark["enabled"], dark["level"], dark["until"], dark["using"]), (False, "sunset", "23:00", "sun"))
        lights.check_dark(clock())
        self.assertEqual(self.on_messages(lights), [])

    def test_the_lights_come_on_once_when_the_sun_goes_down(self):
        clock = Clock(2026, 10, 10, 17, 0)
        lights = self.by_sun(clock)
        sun_at = lights.snapshot()["dark"]["sunTimes"]["sunset"]
        self.assertTrue("18:20" <= sun_at <= "18:35", "New York sunset in October, not %s" % sun_at)

        lights.check_dark(clock.at(2026, 10, 10, 18, 0))
        self.assertEqual(lights._client.published, [], "still light out")
        lights.check_dark(clock.at(2026, 10, 10, 18, 40))
        self.assertEqual(self.on_messages(lights), ["zigbee2mqtt/bedroom_light/set", "zigbee2mqtt/kitchen_light/set"])
        self.assertEqual(lights.snapshot()["dark"]["ranAt"], "2026-10-10T18:40")

        # Someone switches them off: they stay off for the rest of the evening.
        lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"OFF"}')
        lights._client.published.clear()
        lights.check_dark(clock.at(2026, 10, 10, 20, 0))
        self.assertEqual(lights._client.published, [])

        lights.check_dark(clock.at(2026, 10, 11, 18, 45))
        self.assertEqual(len(self.on_messages(lights)), 2, "and again the next evening")

    def test_only_between_noon_and_the_stop_time(self):
        lights = self.by_sun(Clock(2026, 10, 10, 6, 0), until="22:00", lights=[KITCHEN])
        lights.check_dark(datetime(2026, 10, 10, 6, 0))
        self.assertEqual(lights._client.published, [], "dark before dawn, but it's morning")
        lights.check_dark(datetime(2026, 10, 10, 22, 0))
        self.assertEqual(lights._client.published, [], "too late: people may be asleep")
        lights.check_dark(datetime(2026, 10, 10, 21, 59))
        self.assertEqual(self.on_messages(lights), ["zigbee2mqtt/kitchen_light/set"], "only the lights it names")

    def test_how_dark_moves_the_time(self):
        times = self.by_sun(Clock(2026, 10, 10, 17, 0)).snapshot()["dark"]["sunTimes"]
        self.assertLess(times["early"], times["sunset"])
        self.assertLess(times["sunset"], times["late"])
        lights = self.by_sun(Clock(2026, 10, 10, 18, 40), level="late")
        lights.check_dark(datetime(2026, 10, 10, 18, 40))
        self.assertEqual(self.on_messages(lights), [], "After sunset waits past the moment the sun sets")

    def test_without_the_broker_it_tries_again_next_minute(self):
        clock = Clock(2026, 10, 10, 19, 0)
        lights = self.by_sun(clock)
        lights.handle_disconnect()
        lights.check_dark(clock())
        self.assertIsNone(lights.snapshot()["dark"]["ranAt"])
        lights.handle_connect()
        lights._client.published.clear()
        lights.check_dark(clock.at(2026, 10, 10, 19, 1))
        self.assertEqual(len(self.on_messages(lights)), 2)

    def test_it_ends_a_turn_off_watch_for_the_lights_it_turns_on(self):
        clock = Clock(2026, 10, 10, 16, 0)
        lights = self.by_sun(clock)
        lights.add_schedule({"time": "16:00", "on": False, "days": [6], "offAgain": 15, "watchFor": 6})
        lights.run_due(datetime(2026, 10, 10, 15, 59), clock())
        lights.check_dark(clock.at(2026, 10, 10, 19, 0))
        self.assertEqual(lights._watches, [])

    def test_a_light_sensor_decides_when_one_is_picked(self):
        clock = Clock(2026, 10, 10, 13, 0)
        lights = connected_lights(clock=clock, devices=WITH_SENSOR)
        self.assertIn("zigbee2mqtt/hall_motion", lights._client.subscribed)
        self.assertNotIn(("zigbee2mqtt/hall_motion/get", {"state": ""}), lights._client.published)
        self.assertEqual(lights.snapshot()["sensors"], [{"id": HALL, "name": "Hall motion", "reporting": False}])
        lights.set_dark({"enabled": True, "sensor": HALL, "level": "sunset"})
        self.assertIsNone(lights.snapshot()["dark"]["using"], "no reading yet, and no location for the sun")

        lights.handle_message("zigbee2mqtt/hall_motion", b'{"illuminance": 9000, "illuminance_lux": 250}')
        self.assertEqual(lights.snapshot()["dark"]["using"], "sensor")
        self.assertTrue(lights.snapshot()["sensors"][0]["reporting"])
        clock.at(2026, 10, 10, 14, 0)
        lights.handle_message("zigbee2mqtt/hall_motion", b'{"illuminance_lux": 12}')
        lights._client.published.clear()
        lights.check_dark(clock.at(2026, 10, 10, 14, 2))
        self.assertEqual(lights._client.published, [], "a shadow, not yet dark for long")
        lights.check_dark(clock.at(2026, 10, 10, 14, 3))
        self.assertEqual(len(self.on_messages(lights)), 2, "a stormy afternoon counts")

    def test_a_brief_bright_reading_starts_the_wait_again(self):
        clock = Clock(2026, 10, 10, 15, 0)
        lights = connected_lights(clock=clock, devices=WITH_SENSOR)
        lights.set_dark({"enabled": True, "sensor": HALL})
        lights.handle_message("zigbee2mqtt/hall_motion", b'{"illuminance_lux": 5}')
        clock.at(2026, 10, 10, 15, 2)
        lights.handle_message("zigbee2mqtt/hall_motion", b'{"illuminance_lux": 80}')
        clock.at(2026, 10, 10, 15, 3)
        lights.handle_message("zigbee2mqtt/hall_motion", b'{"illuminance_lux": 5}')
        lights._client.published.clear()
        lights.check_dark(clock.at(2026, 10, 10, 15, 4))
        self.assertEqual(lights._client.published, [])

    def test_a_quiet_sensor_hands_over_to_the_sun(self):
        clock = Clock(2026, 10, 10, 13, 0)
        lights = connected_lights(clock=clock, devices=WITH_SENSOR, zone=ZoneInfo("America/New_York"), location=NEW_YORK)
        lights.set_dark({"enabled": True, "sensor": HALL})
        lights.handle_message("zigbee2mqtt/hall_motion", b'{"illuminance_lux": 400}')
        clock.at(2026, 10, 10, 19, 0)
        self.assertEqual(lights.snapshot()["dark"]["using"], "sun")
        lights._client.published.clear()
        lights.check_dark(clock())
        self.assertEqual(len(self.on_messages(lights)), 2)

    def test_sensors_are_found_by_their_illuminance(self):
        found = sensors_in(WITH_SENSOR)
        self.assertEqual(found, {HALL: {"topic": "hall_motion", "name": "Hall motion", "property": "illuminance_lux"}})
        newer = sensors_in([light_sensor(HALL, "hall", [
            {"type": "numeric", "property": "illuminance", "name": "illuminance", "unit": "lx"}])])
        self.assertEqual(newer[HALL]["property"], "illuminance")
        self.assertEqual(sensors_in(DEVICES), {})

    def test_settings_are_checked_and_survive_a_restart(self):
        lights = connected_lights()
        for bad in ({"enabled": "yes"}, {"level": "pitch"}, {"until": "11:00"}, {"until": "25:00"},
                    {"sensor": "hall"}, {"lights": ["nope"]}):
            with self.assertRaises(ValidationError, msg=bad):
                lights.set_dark(bad)
        self.assertEqual(lights.set_dark({"until": "00:00"})["state"]["dark"]["until"], "00:00", "midnight is fine")
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            lights = self.by_sun(Clock(2026, 10, 10, 19, 0))
            lights._path = path
            lights.check_dark(datetime(2026, 10, 10, 19, 0))
            lights.set_dark({"lights": [BEDROOM], "level": "late"})
            again = Lights(path, mqtt=settings_from(True), clock=Clock(2026, 10, 10, 19, 30), client_factory=FakeClient,
                           zone=ZoneInfo("America/New_York"), location=NEW_YORK)
            again.handle_connect()
            again.handle_message("zigbee2mqtt/bridge/state", b'{"state":"online"}')
            dark = again.snapshot()["dark"]
            self.assertEqual((dark["enabled"], dark["lights"], dark["level"]), (True, [BEDROOM], "late"))
            again.check_dark(datetime(2026, 10, 10, 19, 30))
            self.assertEqual(self.on_messages(again), [], "a restart doesn't switch them on twice in one evening")


MOTION = "0x00124b00bbbb0005"


def motion_sensor(ieee=MOTION, name="hall_motion", extra=()):
    """Like Sonoff's SNZB-03P: occupancy, battery, dim or bright, and a timeout Zigbee2MQTT can set."""
    return light_sensor(ieee, name, [
        {"type": "binary", "property": "occupancy", "value_on": True, "value_off": False, "access": 1},
        {"type": "numeric", "property": "battery", "unit": "%", "access": 1},
        {"type": "enum", "property": "illumination", "values": ["dim", "bright"], "access": 1},
        {"type": "numeric", "property": "motion_timeout", "unit": "s", "value_min": 5, "value_max": 60, "access": 7},
        *extra,
    ])


WITH_MOTION = DEVICES + [motion_sensor()]


class FakeScreen:
    """Stands in for board.screen.Screen: records what it's asked to do."""

    def __init__(self, works=True):
        self.on = True
        self.works = works
        self.calls = []
        self.on_change = None

    def status(self):
        return {"on": self.on, "testing": False, "method": "wlopm", "problem": None,
                "error": None if self.works else "wlopm couldn't switch the screen off: no output"}

    def start(self):
        self.calls.append("start")

    def stop(self):
        self.calls.append("stop")

    def set(self, on):
        self.calls.append(on)
        if self.works:
            self.on = on
            self.on_change and self.on_change()
        return self.works

    def test(self, seconds=5):
        self.calls.append("test")
        return self.works


class MotionTest(unittest.TestCase):
    def hallway(self, works=True, **rule):
        """9 PM, and the hall sensor keeping the screen on for 30 minutes after the last motion."""
        clock = Clock(2026, 10, 10, 21, 0)
        screen = FakeScreen(works)
        lights = connected_lights(clock=clock, devices=WITH_MOTION, screen=screen)
        lights.set_motion(MOTION, {"enabled": True, **rule})
        return lights, clock, screen

    def motion(self, lights, seen, **more):
        lights.handle_message("zigbee2mqtt/hall_motion", json.dumps({"occupancy": seen, **more}).encode())

    def test_sensors_are_found_with_the_settings_people_can_change(self):
        found = motion_in(WITH_MOTION)
        self.assertEqual(set(found), {"0x0000000000000004", MOTION})
        self.assertEqual(found[MOTION], {
            "topic": "hall_motion", "name": "Hall motion", "property": "occupancy",
            "settings": [{"property": "motion_timeout", "type": "numeric", "min": 5, "max": 60, "unit": "s"}],
        })
        presence = motion_in([motion_sensor(name=MOTION, extra=[
            {"type": "enum", "property": "occupancy_sensitivity", "values": ["low", "medium", "high"], "access": 7},
            {"type": "numeric", "property": "detection_interval", "value_min": 2, "value_max": 65535, "access": 1},
        ])])[MOTION]
        self.assertEqual(presence["name"], "Motion sensor 0005", "unnamed, it says what it is")
        self.assertEqual([s["property"] for s in presence["settings"]], ["motion_timeout", "occupancy_sensitivity"],
                         "a setting Zigbee2MQTT can only read is left out")
        self.assertEqual(motion_in(DEVICES[:3]), {})

    def test_a_motion_sensor_pairs_like_a_switch(self):
        lights = connected_lights()
        lights.pair(True, "motion")
        self.assertEqual(lights.snapshot()["pairing"]["kind"], "motion")
        new = {"ieee_address": "0x00124b00aaaa0009", "friendly_name": "0x00124b00aaaa0009"}
        lights.handle_message("zigbee2mqtt/bridge/event", json.dumps({"type": "device_joined", "data": new}).encode())
        self.assertEqual(lights.snapshot()["pairing"]["found"]["name"], "Motion sensor 0009")
        done = {**new, "status": "successful", "definition": motion_sensor()["definition"]}
        lights.handle_message("zigbee2mqtt/bridge/event", json.dumps({"type": "device_interview", "data": done}).encode())
        found = lights.snapshot()["pairing"]["found"]
        self.assertEqual((found["state"], found["kind"]), ("ready", "motion"))
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/bridge/request/permit_join", {"time": 0}))
        with self.assertRaises(ValidationError):
            lights.pair(True, "toaster")

    def test_reports_reach_every_screen(self):
        lights = connected_lights(clock=Clock(2026, 10, 10, 21, 0), devices=WITH_MOTION)
        self.assertIn("zigbee2mqtt/hall_motion", lights._client.subscribed)
        self.assertNotIn(("zigbee2mqtt/hall_motion/get", {"state": ""}), lights._client.published, "it sleeps")
        sensor = next(m for m in lights.snapshot()["motion"] if m["id"] == MOTION)
        self.assertIsNone(sensor["occupied"])
        self.assertEqual(sensor["rule"], {"enabled": False, "offAfter": 30})
        self.motion(lights, True, battery=64, motion_timeout=30)
        sensor = next(m for m in lights.snapshot()["motion"] if m["id"] == MOTION)
        self.assertEqual((sensor["occupied"], sensor["lastMotion"], sensor["battery"]), (True, 1_000_000, 64))
        self.assertEqual(sensor["settings"][0]["value"], 30)
        self.assertIsNone(lights.snapshot()["screen"], "no screen to switch on this board")
        self.assertEqual([t for t, _ in lights._client.published if t.endswith("/set")], [], "motion switches no lights")

    def test_the_screen_goes_off_after_no_motion_and_on_again_for_motion(self):
        lights, clock, screen = self.hallway()
        self.motion(lights, True)
        lights.check_screen(clock.at(2026, 10, 10, 22, 0))
        self.assertEqual(screen.calls, [], "someone's still there")
        self.motion(lights, False)
        lights.check_screen(clock.at(2026, 10, 10, 22, 29))
        self.assertEqual(screen.calls, [])
        lights.check_screen(clock.at(2026, 10, 10, 22, 30))
        self.assertEqual(screen.calls, [False], "30 minutes after it went quiet")
        self.assertFalse(lights.snapshot()["screen"]["on"], "every screen hears it's off")
        lights.check_screen(clock.at(2026, 10, 10, 22, 31))
        self.assertEqual(screen.calls, [False], "only once")

        self.motion(lights, True)
        self.assertEqual(screen.calls, [False, True], "straight back on")
        self.motion(lights, True)
        self.assertEqual(screen.calls, [False, True])

    def test_it_waits_from_the_start_when_nobody_has_moved(self):
        lights, clock, screen = self.hallway(offAfter=10)
        lights.check_screen(clock.at(2026, 10, 10, 21, 9))
        self.assertEqual(screen.calls, [])
        lights.check_screen(clock.at(2026, 10, 10, 21, 10))
        self.assertEqual(screen.calls, [False])

    def test_a_tap_wakes_the_screen_and_restarts_the_wait(self):
        lights, clock, screen = self.hallway()
        lights.check_screen(clock.at(2026, 10, 10, 21, 30))
        clock.at(2026, 10, 10, 23, 0)
        self.assertTrue(lights.screen_wake()["state"]["screen"]["on"])
        lights.check_screen(clock.at(2026, 10, 10, 23, 29))
        self.assertEqual(screen.calls, [False, True])
        lights.check_screen(clock.at(2026, 10, 10, 23, 30))
        self.assertEqual(screen.calls, [False, True, False])

    def test_a_sensor_without_the_rule_does_not_wake_it(self):
        lights, clock, screen = self.hallway()
        lights.check_screen(clock.at(2026, 10, 10, 21, 30))
        lights.handle_message("zigbee2mqtt/hall_sensor", b'{"occupancy": true}')
        self.assertEqual(screen.calls, [False])

    def test_switching_the_rule_off_brings_a_dark_screen_back(self):
        lights, clock, screen = self.hallway()
        lights.check_screen(clock.at(2026, 10, 10, 21, 30))
        lights.set_motion(MOTION, {"enabled": False})
        lights.check_screen(clock.at(2026, 10, 10, 21, 31))
        self.assertEqual(screen.calls, [False, True])

    def test_the_test_button_and_what_goes_wrong(self):
        lights, _, screen = self.hallway()
        self.assertEqual(lights.screen_test()["state"]["screen"]["method"], "wlopm")
        self.assertEqual(screen.calls, ["test"])
        broken, _, _ = self.hallway(works=False)
        with self.assertRaisesRegex(LightsUnavailable, "no output"):
            broken.screen_test()
        with self.assertRaisesRegex(LightsUnavailable, "turned off"):
            connected_lights().screen_test()

    def test_starting_and_stopping_never_leave_it_dark(self):
        lights = Lights(mqtt=settings_from(True), screen=FakeScreen(), client_factory=FakeClient)
        lights.start()
        lights._screen.on = False
        lights.stop()
        self.assertEqual(lights._screen.calls, ["start", "stop", True])

    def test_the_sensors_own_settings_go_through_zigbee2mqtt(self):
        lights = connected_lights(devices=WITH_MOTION)
        state = lights.set_motion_setting(MOTION, "motion_timeout", 15)["state"]
        self.assertEqual(lights._client.published[-1], ("zigbee2mqtt/hall_motion/set", {"motion_timeout": 15}))
        self.assertEqual(next(m for m in state["motion"] if m["id"] == MOTION)["settings"][0]["value"], 15)
        for prop, value in (("motion_timeout", 61), ("motion_timeout", "15"), ("sensitivity", "high")):
            with self.assertRaises(ValidationError):
                lights.set_motion_setting(MOTION, prop, value)
        with self.assertRaises(NotFound):
            lights.set_motion_setting(BEDROOM, "motion_timeout", 15)
        lights.handle_disconnect()
        with self.assertRaises(LightsUnavailable):
            lights.set_motion_setting(MOTION, "motion_timeout", 30)

    def test_rules_are_checked_and_survive_a_restart_with_the_name(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            lights = connected_lights(path, devices=WITH_MOTION)
            for bad in ({"offAfter": 4}, {"offAfter": 241}, {"offAfter": True}, {"enabled": "yes"}):
                with self.assertRaises(ValidationError):
                    lights.set_motion(MOTION, bad)
            with self.assertRaises(NotFound):
                lights.set_motion(BEDROOM, {"enabled": True})
            lights.set_motion(MOTION, {"enabled": True, "offAfter": 60})
            lights.rename(MOTION, "Front Door")
            self.assertEqual(lights._client.published[-1][1], {"from": "hall_motion", "to": "front_door", "homeassistant_rename": False})
            again = Lights(path)
            sensor = next(m for m in again.snapshot()["motion"] if m["id"] == MOTION)
            self.assertEqual(sensor["name"], "Front Door")
            self.assertEqual(sensor["rule"], {"enabled": True, "offAfter": 60})
            self.assertEqual(sensor["settings"][0]["max"], 60)

    def test_a_sensor_taken_out_of_zigbee2mqtt_goes_with_its_rule(self):
        lights, _, _ = self.hallway()
        lights.handle_message("zigbee2mqtt/bridge/devices", json.dumps(DEVICES).encode())
        self.assertNotIn(MOTION, [m["id"] for m in lights.snapshot()["motion"]])
        self.assertEqual(lights._motion_rules, {})


class PersistenceTest(unittest.TestCase):
    def test_schedules_swaps_and_the_light_list_survive_a_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            lights = connected_lights(path)
            lights.handle_message("zigbee2mqtt/bedroom_light", b'{"state":"ON"}')
            lights.swap(BEDROOM, True)
            lights.add_schedule({"time": "07:00", "on": True, "days": [1]})

            again = Lights(path, mqtt=settings_from(True), client_factory=FakeClient)
            state = again.snapshot()
            self.assertEqual([s["time"] for s in state["schedules"]], ["07:00"])
            bedroom = next(i for i in state["lights"] if i["id"] == BEDROOM)
            self.assertTrue(bedroom["swapped"])
            self.assertIsNone(bedroom["on"], "what a light is doing isn't saved")
            self.assertFalse(bedroom["reachable"], "not until the broker answers")
            with open(path, encoding="utf-8") as f:
                self.assertNotIn("ON", json.dumps(json.load(f)["lights"]))

    def test_a_corrupt_file_is_set_aside(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lights.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"version": 3, "schedules": [{"id": "x", "time": "nope", "on": True}]}, f)
            with self.assertLogs("board.store", level="WARNING"):
                lights = Lights(path)
            self.assertEqual(lights.snapshot()["schedules"], [])
            self.assertTrue(any(name.startswith("lights.json.corrupt-") for name in os.listdir(folder)))


if __name__ == "__main__":
    unittest.main()
