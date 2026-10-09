import json
import os
import tempfile
import unittest
from datetime import datetime

from board.lights import (
    MAX_CATCH_UP_MINUTES,
    Lights,
    LightsUnavailable,
    display_name,
    due,
    lights_in,
    settings_from,
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


def connected_lights(path=None, feed=None, clock=None):
    lights = Lights(path, mqtt=settings_from(True), feed=feed, clock=clock, epoch_ms=lambda: 1_000_000,
                    client_factory=FakeClient)
    lights.handle_connect()
    lights.handle_message("zigbee2mqtt/bridge/state", b'{"state":"online"}')
    lights.handle_message("zigbee2mqtt/bridge/devices", json.dumps(DEVICES).encode())
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
        self.assertEqual(state["pairing"], {"open": True, "until": 1_000_000 + 254_000, "found": None, "error": None})

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
