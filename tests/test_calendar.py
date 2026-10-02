import os
import tempfile
import unittest
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from board.calendar import (
    COLORS,
    MAX_EVENTS,
    CalendarFeeds,
    CalendarStore,
    NotFound,
    ValidationError,
    sources_from,
)

NEW_YORK = ZoneInfo("America/New_York")
TODAY = date(2026, 10, 2)


def ics(*events, name="Home"):
    body = "".join("BEGIN:VEVENT\r\n%s\r\nEND:VEVENT\r\n" % event.replace("\n", "\r\n") for event in events)
    return "BEGIN:VCALENDAR\r\nX-WR-CALNAME:%s\r\n%sEND:VCALENDAR\r\n" % (name, body)


class CalendarStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "calendar.json")
        self.store = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")

    def tearDown(self):
        self.tmp.cleanup()

    def events(self, state=None):
        state = state or self.store.snapshot()
        return [(event["date"], event["time"], event["title"]) for event in state["events"]]

    def test_starts_empty(self):
        self.assertEqual(self.store.snapshot(), {"version": 0, "events": []})

    def test_add_tidies_the_title_and_keeps_the_list_in_date_order(self):
        self.store.add("Dentist", "2026-10-20", "15:00")
        self.store.add("  Bin   day ", "2026-10-05")
        result = self.store.add("Film night", "2026-10-05", "19:30")
        self.assertEqual(
            self.events(result["state"]),
            [("2026-10-05", None, "Bin day"), ("2026-10-05", "19:30", "Film night"), ("2026-10-20", "15:00", "Dentist")],
        )
        self.assertEqual(result["event"]["created"], "2026-10-02T12:00:00Z")

    def test_an_event_with_no_time_is_all_day(self):
        for blank in (None, ""):
            self.assertIsNone(self.store.add("Holiday", "2026-12-25", blank)["event"]["time"])

    def test_rejects_blank_overlong_and_non_text_titles(self):
        for bad in ["   ", "x" * 81, None, 5]:
            with self.assertRaises(ValidationError):
                self.store.add(bad, "2026-10-20")

    def test_rejects_bad_dates_and_times(self):
        for bad in ["20261020", "2026-13-01", "tomorrow", None, "2026-02-30"]:
            with self.assertRaises(ValidationError):
                self.store.add("Thing", bad)
        for bad in ["7pm", "25:00", "19:5", 19]:
            with self.assertRaises(ValidationError):
                self.store.add("Thing", "2026-10-20", bad)

    def test_rejects_dates_far_outside_the_next_few_years(self):
        for bad in ["1999-01-01", "2099-01-01"]:
            with self.assertRaises(ValidationError):
                self.store.add("Thing", bad)

    def test_uses_the_client_id_when_it_is_valid_and_free(self):
        self.assertEqual(self.store.add("A", "2026-10-20", event_id="a1b2c3d4e5f6")["event"]["id"], "a1b2c3d4e5f6")
        self.assertNotEqual(self.store.add("B", "2026-10-20", event_id="a1b2c3d4e5f6")["event"]["id"], "a1b2c3d4e5f6")
        self.assertNotEqual(self.store.add("C", "2026-10-20", event_id="<b>")["event"]["id"], "<b>")

    def test_the_calendar_has_a_size_limit(self):
        for i in range(MAX_EVENTS):
            self.store.add("Event %d" % i, "2026-10-20")
        with self.assertRaises(ValidationError):
            self.store.add("One too many", "2026-10-20")

    def test_adding_forgets_events_from_long_ago(self):
        self.store.add("Old news", "2026-04-01")
        self.store.add("Last week", "2026-09-25")
        self.store.add("Soon", "2026-10-20")
        self.assertEqual([title for _d, _t, title in self.events()], ["Last week", "Soon"])

    def test_remove_then_restore_puts_the_event_back(self):
        event_id = self.store.add("Dentist", "2026-10-20", "15:00")["event"]["id"]
        self.store.add("Bin day", "2026-10-05")
        self.store.remove(event_id)
        self.assertEqual([title for _d, _t, title in self.events()], ["Bin day"])
        result = self.store.restore([event_id, "missing"])
        self.assertEqual(result["restored"], [event_id])
        self.assertEqual([title for _d, _t, title in self.events()], ["Bin day", "Dentist"])

    def test_removing_an_unknown_event_is_not_found(self):
        with self.assertRaises(NotFound):
            self.store.remove("nope")

    def test_survives_a_restart_and_drops_corrupt_entries(self):
        self.store.add("Dentist", "2026-10-20", "15:00")
        with open(self.path, encoding="utf-8") as f:
            saved = f.read()
        self.assertIn("Dentist", saved)
        reopened = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")
        self.assertEqual(self.events(reopened.snapshot()), [("2026-10-20", "15:00", "Dentist")])

        with open(self.path, "w", encoding="utf-8") as f:
            f.write('{"version": 3, "events": [{"id": "x", "title": "No date"}]}')
        fresh = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")
        self.assertEqual(fresh.snapshot(), {"version": 0, "events": []})


class SourcesTest(unittest.TestCase):
    def test_accepts_plain_urls_and_objects_and_assigns_colours(self):
        sources = sources_from(["https://example.com/a.ics", {"url": "https://example.com/b.ics", "name": " Home "}])
        self.assertEqual([s["url"] for s in sources], ["https://example.com/a.ics", "https://example.com/b.ics"])
        self.assertEqual([s["name"] for s in sources], [None, "Home"])
        self.assertEqual([s["color"] for s in sources], [COLORS[0], COLORS[1]])

    def test_keeps_a_colour_the_user_chose(self):
        self.assertEqual(sources_from([{"url": "https://e.com/a.ics", "color": "pink"}])[0]["color"], "pink")
        self.assertIn(sources_from([{"url": "https://e.com/a.ics", "color": "chartreuse"}])[0]["color"], COLORS)

    def test_ignores_anything_that_isn_t_an_http_calendar(self):
        self.assertEqual(sources_from(None), [])
        self.assertEqual(sources_from(["file:///etc/passwd", {"nope": 1}, 5, {"url": 7}]), [])

    def test_uses_at_most_six_calendars(self):
        self.assertEqual(len(sources_from(["https://e.com/%d.ics" % i for i in range(20)])), 6)


class CalendarFeedsTest(unittest.TestCase):
    def setUp(self):
        self.clock = [1000.0]
        self.pages = {}
        self.fetched = []

    def feeds(self, sources, **kwargs):
        def fetch(url):
            self.fetched.append(url)
            page = self.pages[url]
            if isinstance(page, Exception):
                raise page
            return page

        return CalendarFeeds(
            sources_from(sources),
            zone=NEW_YORK,
            fetch=fetch,
            now=lambda: self.clock[0],
            today=lambda: TODAY,
            **kwargs,
        )

    def test_says_so_when_no_calendars_are_configured(self):
        result = self.feeds([]).upcoming()
        self.assertEqual(result, {"configured": False, "calendars": [], "events": [], "updated": None, "stale": False})

    def test_merges_events_from_every_calendar_in_date_order(self):
        self.pages["https://e.com/a.ics"] = ics("UID:1\nSUMMARY:Dentist\nDTSTART:20261020T190000Z", name="Home")
        self.pages["https://e.com/b.ics"] = ics(
            "UID:2\nSUMMARY:Sam's birthday\nDTSTART;VALUE=DATE:19911218\nRRULE:FREQ=YEARLY", name="Birthdays"
        )
        result = self.feeds(["https://e.com/a.ics", {"url": "https://e.com/b.ics", "color": "pink"}]).upcoming()
        self.assertTrue(result["configured"])
        self.assertFalse(result["stale"])
        self.assertEqual([c["name"] for c in result["calendars"]], ["Home", "Birthdays"])
        self.assertTrue(all(c["ok"] for c in result["calendars"]))
        self.assertEqual(
            [(e["date"], e["time"], e["title"], e["calendar"], e["color"]) for e in result["events"]],
            [
                ("2026-10-20", "15:00", "Dentist", "Home", COLORS[0]),
                ("2026-12-18", None, "Sam's birthday", "Birthdays", "pink"),
            ],
        )

    def test_a_name_in_the_config_wins_over_the_one_in_the_feed(self):
        self.pages["https://e.com/a.ics"] = ics("UID:1\nSUMMARY:X\nDTSTART;VALUE=DATE:20261020", name="Ignored")
        result = self.feeds([{"url": "https://e.com/a.ics", "name": "Ours"}]).upcoming()
        self.assertEqual(result["calendars"][0]["name"], "Ours")

    def test_event_ids_are_unique_per_occurrence(self):
        self.pages["https://e.com/a.ics"] = ics("UID:1\nSUMMARY:Bins\nDTSTART;VALUE=DATE:20261005\nRRULE:FREQ=WEEKLY")
        events = self.feeds(["https://e.com/a.ics"]).upcoming()["events"]
        self.assertGreater(len(events), 1)
        self.assertEqual(len({e["id"] for e in events}), len(events))

    def test_one_broken_calendar_doesn_t_hide_the_others(self):
        self.pages["https://e.com/a.ics"] = ics("UID:1\nSUMMARY:Dentist\nDTSTART;VALUE=DATE:20261020")
        self.pages["https://e.com/b.ics"] = OSError("no route to host")
        result = self.feeds(["https://e.com/a.ics", "https://e.com/b.ics"]).upcoming()
        self.assertEqual([e["title"] for e in result["events"]], ["Dentist"])
        self.assertEqual([c["ok"] for c in result["calendars"]], [True, False])
        self.assertIn("Couldn't read", result["calendars"][1]["error"])

    def test_one_fetch_is_shared_until_the_cache_expires(self):
        self.pages["https://e.com/a.ics"] = ics("UID:1\nSUMMARY:Dentist\nDTSTART;VALUE=DATE:20261020")
        feeds = self.feeds(["https://e.com/a.ics"])
        feeds.upcoming()
        feeds.upcoming()
        self.assertEqual(len(self.fetched), 1)
        self.clock[0] += 16 * 60
        self.assertTrue(feeds.upcoming()["stale"] is False)
        self.assertEqual(len(self.fetched), 2)

    def test_keeps_showing_the_last_sync_when_the_pi_goes_offline(self):
        self.pages["https://e.com/a.ics"] = ics("UID:1\nSUMMARY:Dentist\nDTSTART;VALUE=DATE:20261020")
        feeds = self.feeds(["https://e.com/a.ics"])
        feeds.upcoming()
        self.pages["https://e.com/a.ics"] = OSError("offline")
        self.clock[0] += 16 * 60
        stale = feeds.upcoming()
        self.assertTrue(stale["stale"])
        self.assertEqual([e["title"] for e in stale["events"]], ["Dentist"])

        # It doesn't hammer a dead network: the next few calls come from the cache.
        before = len(self.fetched)
        feeds.upcoming()
        self.assertEqual(len(self.fetched), before)

        # After six hours an old calendar isn't worth showing any more.
        self.clock[0] += 7 * 60 * 60
        gave_up = feeds.upcoming()
        self.assertEqual(gave_up["events"], [])
        self.assertTrue(gave_up["stale"])
        self.assertIn("Can't reach", gave_up["calendars"][0]["error"])

    def test_a_calendar_that_never_loads_reports_itself_rather_than_failing(self):
        self.pages["https://e.com/a.ics"] = OSError("offline")
        result = self.feeds(["https://e.com/a.ics"]).upcoming()
        self.assertEqual(result["events"], [])
        self.assertFalse(result["calendars"][0]["ok"])

    def test_the_window_covers_the_months_ahead_but_not_the_past(self):
        self.pages["https://e.com/a.ics"] = ics(
            "UID:1\nSUMMARY:Last month\nDTSTART;VALUE=DATE:20260901",
            "UID:2\nSUMMARY:In three months\nDTSTART;VALUE=DATE:%s" % (TODAY + timedelta(days=90)).strftime("%Y%m%d"),
            "UID:3\nSUMMARY:In a year\nDTSTART;VALUE=DATE:20271002",
        )
        titles = [e["title"] for e in self.feeds(["https://e.com/a.ics"]).upcoming()["events"]]
        self.assertEqual(titles, ["In three months"])


if __name__ == "__main__":
    unittest.main()
