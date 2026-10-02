import os
import tempfile
import unittest
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from board import google
from board.calendar import (
    COLORS,
    MAX_EVENTS,
    CalendarSources,
    CalendarStore,
    NotFound,
    ValidationError,
    sources_from,
)
from board.store import ChangeFeed

NEW_YORK = ZoneInfo("America/New_York")
TODAY = date(2026, 10, 2)


def ics(*events, name="Home"):
    body = "".join("BEGIN:VEVENT\r\n%s\r\nEND:VEVENT\r\n" % event.replace("\n", "\r\n") for event in events)
    return "BEGIN:VCALENDAR\r\nX-WR-CALNAME:%s\r\n%sEND:VCALENDAR\r\n" % (name, body)


class FakeAccount:
    """Stands in for a linked Google account, without the network."""

    def __init__(self, calendars=None, events=None):
        self.configured = True
        self.linked = True
        self.target = "me@example.com"
        self._calendars = calendars if calendars is not None else [
            {"id": "me@example.com", "name": "Sheel", "color": "blue", "writable": True, "primary": True},
            {"id": "holidays@group.v", "name": "Holidays", "color": "orange", "writable": False, "primary": False},
        ]
        self.events_by_calendar = events or {}
        self.inserted = []
        self.deleted = []
        self.fail_calendars = None
        self.fail_events = {}
        self.next_id = 1000

    def status(self):
        return {"configured": True, "linked": True, "account": "me@example.com", "target": self.target, "pending": None}

    def calendars(self):
        if self.fail_calendars:
            raise google.GoogleError(self.fail_calendars)
        return [dict(c) for c in self._calendars]

    def events(self, calendar_id, window_start, window_end):
        if calendar_id in self.fail_events:
            raise google.GoogleError(self.fail_events[calendar_id])
        return list(self.events_by_calendar.get(calendar_id, []))

    def insert(self, calendar_id, body):
        self.next_id += 1
        created = {"id": "evt%d" % self.next_id, **body}
        self.inserted.append((calendar_id, body))
        self.events_by_calendar.setdefault(calendar_id, []).append(created)
        return created

    def delete(self, calendar_id, event_id):
        self.deleted.append((calendar_id, event_id))
        self.events_by_calendar[calendar_id] = [
            e for e in self.events_by_calendar.get(calendar_id, []) if e["id"] != event_id
        ]


def timed(event_id, summary, day, start, end):
    return {"id": event_id, "summary": summary,
            "start": {"dateTime": "%sT%s:00-04:00" % (day, start)},
            "end": {"dateTime": "%sT%s:00-04:00" % (day, end)}}


def all_day(event_id, summary, day, last=None):
    finish = date.fromisoformat(last or day) + timedelta(days=1)
    return {"id": event_id, "summary": summary, "start": {"date": day}, "end": {"date": finish.isoformat()}}


class CalendarStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "calendar.json")
        self.store = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, title, day, **rest):
        return self.store.add({"title": title, "date": day, **rest})

    def events(self, state=None):
        state = state or self.store.snapshot()
        return [(e["date"], e["time"], e["title"]) for e in state["events"]]

    def test_starts_empty(self):
        self.assertEqual(self.store.snapshot(), {"version": 0, "events": []})

    def test_add_tidies_the_title_and_keeps_the_list_in_date_order(self):
        self.add("Dentist", "2026-10-20", time="15:00")
        self.add("  Bin   day ", "2026-10-05")
        result = self.add("Film night", "2026-10-05", time="19:30")
        self.assertEqual(
            self.events(result["state"]),
            [("2026-10-05", None, "Bin day"), ("2026-10-05", "19:30", "Film night"), ("2026-10-20", "15:00", "Dentist")],
        )
        self.assertEqual(result["event"]["created"], "2026-10-02T12:00:00Z")

    def test_keeps_the_end_time_location_and_notes(self):
        event = self.add(
            "Dentist", "2026-10-20", time="15:00", endTime="16:30",
            location="  Dr   Patel ", description="Bring the referral letter",
        )["event"]
        self.assertEqual(event["endTime"], "16:30")
        self.assertEqual(event["location"], "Dr Patel")
        self.assertEqual(event["description"], "Bring the referral letter")
        self.assertEqual(event["endDate"], "2026-10-20")

    def test_an_all_day_event_can_run_over_several_days(self):
        event = self.add("Trip", "2026-10-10", endDate="2026-10-13")["event"]
        self.assertEqual((event["time"], event["endDate"]), (None, "2026-10-13"))

    def test_an_end_that_makes_no_sense_is_dropped_rather_than_refused(self):
        event = self.add("Call", "2026-10-20", time="15:00", endTime="14:00")["event"]
        self.assertIsNone(event["endTime"])
        # A timed event belongs to one day, whatever last day was sent.
        event = self.add("Call", "2026-10-21", time="15:00", endDate="2026-10-25")["event"]
        self.assertEqual(event["endDate"], "2026-10-21")

    def test_rejects_a_last_day_before_the_first_or_a_silly_span(self):
        with self.assertRaises(ValidationError):
            self.add("Trip", "2026-10-10", endDate="2026-10-09")
        with self.assertRaises(ValidationError):
            self.add("Sabbatical", "2026-10-10", endDate="2026-12-10")

    def test_rejects_blank_overlong_and_non_text_titles(self):
        for bad in ["   ", "x" * 81, None, 5]:
            with self.assertRaises(ValidationError):
                self.add(bad, "2026-10-20")

    def test_rejects_bad_dates_and_times(self):
        for bad in ["20261020", "2026-13-01", "tomorrow", None, "2026-02-30"]:
            with self.assertRaises(ValidationError):
                self.add("Thing", bad)
        for bad in ["7pm", "25:00", "19:5", 19]:
            with self.assertRaises(ValidationError):
                self.add("Thing", "2026-10-20", time=bad)

    def test_rejects_overlong_location_and_notes(self):
        with self.assertRaises(ValidationError):
            self.add("Thing", "2026-10-20", location="x" * 121)
        with self.assertRaises(ValidationError):
            self.add("Thing", "2026-10-20", description="x" * 501)

    def test_rejects_dates_far_outside_the_next_few_years(self):
        for bad in ["1999-01-01", "2099-01-01"]:
            with self.assertRaises(ValidationError):
                self.add("Thing", bad)

    def test_uses_the_client_id_when_it_is_valid_and_free(self):
        self.assertEqual(self.store.add({"title": "A", "date": "2026-10-20"}, "a1b2c3d4e5f6")["event"]["id"],
                         "a1b2c3d4e5f6")
        self.assertNotEqual(self.store.add({"title": "B", "date": "2026-10-20"}, "a1b2c3d4e5f6")["event"]["id"],
                            "a1b2c3d4e5f6")
        self.assertNotEqual(self.store.add({"title": "C", "date": "2026-10-20"}, "<b>")["event"]["id"], "<b>")

    def test_the_calendar_has_a_size_limit(self):
        for i in range(MAX_EVENTS):
            self.add("Event %d" % i, "2026-10-20")
        with self.assertRaises(ValidationError):
            self.add("One too many", "2026-10-20")

    def test_adding_forgets_events_from_long_ago(self):
        self.add("Old news", "2026-04-01")
        self.add("Last week", "2026-09-25")
        self.add("Soon", "2026-10-20")
        self.assertEqual([title for _d, _t, title in self.events()], ["Last week", "Soon"])

    def test_remove_then_restore_puts_the_event_back(self):
        event_id = self.add("Dentist", "2026-10-20", time="15:00")["event"]["id"]
        self.add("Bin day", "2026-10-05")
        self.store.remove(event_id)
        self.assertEqual([title for _d, _t, title in self.events()], ["Bin day"])
        result = self.store.restore([event_id, "missing"])
        self.assertEqual(result["restored"], [event_id])
        self.assertEqual([title for _d, _t, title in self.events()], ["Bin day", "Dentist"])

    def test_removing_an_unknown_event_is_not_found(self):
        with self.assertRaises(NotFound):
            self.store.remove("nope")

    def test_survives_a_restart_and_drops_corrupt_entries(self):
        self.add("Dentist", "2026-10-20", time="15:00", location="Dr Patel")
        reopened = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")
        self.assertEqual(reopened.snapshot()["events"][0]["location"], "Dr Patel")

        with open(self.path, "w", encoding="utf-8") as f:
            f.write('{"version": 3, "events": [{"id": "x", "title": "No date"}]}')
        fresh = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")
        self.assertEqual(fresh.snapshot(), {"version": 0, "events": []})

    def test_reads_events_saved_before_end_times_and_notes_existed(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write('{"version": 2, "events": [{"id": "abc", "title": "Bin day", "date": "2026-10-20", "time": null}]}')
        store = CalendarStore(self.path, clock=lambda: "2026-10-02T12:00:00Z")
        event = store.snapshot()["events"][0]
        self.assertEqual((event["endDate"], event["endTime"], event["location"]), ("2026-10-20", None, None))


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


class CalendarSourcesTest(unittest.TestCase):
    def setUp(self):
        self.pages = {}
        self.fetched = []
        self.feed = ChangeFeed()

    def build(self, urls=(), account=None):
        def fetch(url):
            self.fetched.append(url)
            page = self.pages[url]
            if isinstance(page, Exception):
                raise page
            return page

        return CalendarSources(
            sources_from(list(urls)),
            account=account,
            zone=NEW_YORK,
            feed=self.feed,
            fetch=fetch,
            today=lambda: TODAY,
        )

    def test_nothing_connected_is_not_an_error(self):
        snapshot = self.build().refresh()
        self.assertFalse(snapshot["configured"])
        self.assertEqual(snapshot["events"], [])
        self.assertFalse(snapshot["account"]["linked"])

    def test_reads_a_google_account_and_an_ical_subscription_together(self):
        account = FakeAccount(events={
            "me@example.com": [timed("e1", "Dentist", "2026-10-20", "09:00", "09:45")],
            "holidays@group.v": [all_day("h1", "Columbus Day", "2026-10-12")],
        })
        self.pages["https://e.com/b.ics"] = ics("UID:b1\nSUMMARY:Sam's birthday\n"
                                                "DTSTART;VALUE=DATE:19911218\nRRULE:FREQ=YEARLY", name="Birthdays")
        sources = self.build(["https://e.com/b.ics"], account=account)
        snapshot = sources.refresh()

        self.assertTrue(snapshot["configured"])
        self.assertEqual([c["name"] for c in snapshot["calendars"]], ["Sheel", "Holidays", "Birthdays"])
        self.assertEqual([c["kind"] for c in snapshot["calendars"]], ["google", "google", "ical"])
        self.assertEqual([c["writable"] for c in snapshot["calendars"]], [True, False, False])
        self.assertEqual(
            [(e["date"], e["time"], e["title"], e["calendar"]) for e in snapshot["events"]],
            [("2026-10-12", None, "Columbus Day", "Holidays"),
             ("2026-10-20", "09:00", "Dentist", "Sheel"),
             ("2026-12-18", None, "Sam's birthday", "Birthdays")],
        )

    def test_google_event_ids_say_which_calendar_they_came_from(self):
        account = FakeAccount(events={"me@example.com": [all_day("e1", "Trip", "2026-10-10", last="2026-10-12")]})
        event = self.build(account=account).refresh()["events"][0]
        self.assertEqual(event["id"], "g:me@example.com:e1")
        self.assertEqual((event["days"], event["endDate"]), (3, "2026-10-12"))
        self.assertTrue(event["writable"])

    def test_one_broken_calendar_doesn_t_hide_the_others(self):
        account = FakeAccount(events={"me@example.com": [all_day("e1", "Dentist", "2026-10-20")]})
        account.fail_events["holidays@group.v"] = "Google turned the board away."
        self.pages["https://e.com/b.ics"] = OSError("no route to host")
        snapshot = self.build(["https://e.com/b.ics"], account=account).refresh()
        self.assertEqual([e["title"] for e in snapshot["events"]], ["Dentist"])
        self.assertEqual([c["ok"] for c in snapshot["calendars"]], [True, False, False])
        self.assertIn("turned the board away", snapshot["calendars"][1]["error"])
        self.assertIn("Couldn't read", snapshot["calendars"][2]["error"])

    def test_a_refresh_that_reaches_nothing_is_marked_stale(self):
        self.pages["https://e.com/b.ics"] = OSError("offline")
        snapshot = self.build(["https://e.com/b.ics"]).refresh()
        self.assertTrue(snapshot["stale"])
        self.assertIsNone(snapshot["updated"])

    def test_every_refresh_bumps_the_version_so_screens_are_told(self):
        self.pages["https://e.com/b.ics"] = ics("UID:1\nSUMMARY:X\nDTSTART;VALUE=DATE:20261020")
        sources = self.build(["https://e.com/b.ics"])
        first = sources.refresh()["version"]
        self.assertGreater(sources.refresh()["version"], first)

    def test_the_window_covers_the_months_ahead_but_not_the_past(self):
        account = FakeAccount(events={"me@example.com": [
            all_day("a", "Last month", "2026-09-01"),
            all_day("b", "In three months", (TODAY + timedelta(days=90)).isoformat()),
            all_day("c", "In a year", "2027-10-02"),
        ]})
        titles = [e["title"] for e in self.build(account=account).refresh()["events"]]
        self.assertEqual(titles, ["In three months"])

    # Writing

    def test_adding_sends_the_event_to_google_and_shows_it_at_once(self):
        account = FakeAccount()
        sources = self.build(account=account)
        sources.refresh()
        event = sources.add(None, {"title": "Landlord visit", "date": "2026-10-06", "time": "11:15",
                                   "endTime": "12:00", "location": "Flat 2", "description": "Boiler check"})

        calendar_id, body = account.inserted[0]
        self.assertEqual(calendar_id, "me@example.com")
        self.assertEqual(body["summary"], "Landlord visit")
        self.assertEqual(body["location"], "Flat 2")
        self.assertEqual(body["description"], "Boiler check")
        self.assertEqual(body["start"], {"dateTime": "2026-10-06T11:15:00", "timeZone": "America/New_York"})
        self.assertEqual(body["end"], {"dateTime": "2026-10-06T12:00:00", "timeZone": "America/New_York"})
        self.assertEqual(event["calendar"], "Sheel")
        self.assertIn(event["id"], [e["id"] for e in sources.snapshot()["events"]])

    def test_an_all_day_event_is_sent_with_google_s_exclusive_end(self):
        account = FakeAccount()
        sources = self.build(account=account)
        sources.refresh()
        sources.add(None, {"title": "Trip", "date": "2026-10-10", "endDate": "2026-10-12"})
        _calendar_id, body = account.inserted[0]
        self.assertEqual(body["start"], {"date": "2026-10-10"})
        self.assertEqual(body["end"], {"date": "2026-10-13"})

    def test_an_event_can_be_put_on_a_named_calendar(self):
        account = FakeAccount(calendars=[
            {"id": "me@example.com", "name": "Sheel", "color": "blue", "writable": True, "primary": True},
            {"id": "flat@example.com", "name": "Flat", "color": "teal", "writable": True, "primary": False},
        ])
        sources = self.build(account=account)
        sources.refresh()
        event = sources.add("flat@example.com", {"title": "Rent", "date": "2026-11-01"})
        self.assertEqual(account.inserted[0][0], "flat@example.com")
        self.assertEqual(event["calendar"], "Flat")

    def test_writing_without_a_linked_account_is_refused(self):
        with self.assertRaises(ValidationError):
            self.build().add(None, {"title": "Nope", "date": "2026-10-20"})

    def test_a_read_only_account_has_nothing_to_write_to(self):
        account = FakeAccount(calendars=[
            {"id": "holidays@group.v", "name": "Holidays", "color": "orange", "writable": False, "primary": False},
        ])
        sources = self.build(account=account)
        sources.refresh()
        self.assertEqual(sources.writable(), [])
        with self.assertRaises(ValidationError):
            sources.add(None, {"title": "Nope", "date": "2026-10-20"})

    def test_a_bad_event_is_refused_before_google_hears_about_it(self):
        account = FakeAccount()
        sources = self.build(account=account)
        sources.refresh()
        with self.assertRaises(ValidationError):
            sources.add(None, {"title": "   ", "date": "2026-10-20"})
        self.assertEqual(account.inserted, [])

    def test_removing_deletes_from_google_and_undo_puts_it_back(self):
        account = FakeAccount(events={"me@example.com": [timed("e1", "Dentist", "2026-10-20", "09:00", "09:45")]})
        sources = self.build(account=account)
        sources.refresh()

        was = sources.remove("g:me@example.com:e1")
        self.assertEqual(account.deleted, [("me@example.com", "e1")])
        self.assertEqual(was["title"], "Dentist")
        self.assertEqual(sources.snapshot()["events"], [])

        back = sources.restore(["g:me@example.com:e1"])
        self.assertEqual([e["title"] for e in back], ["Dentist"])
        self.assertEqual(account.inserted[0][1]["summary"], "Dentist")

    def test_removing_something_that_isn_t_a_google_event_is_not_found(self):
        with self.assertRaises(NotFound):
            self.build(account=FakeAccount()).remove("abc123")

    def test_restoring_an_id_it_never_deleted_is_quietly_ignored(self):
        self.assertEqual(self.build(account=FakeAccount()).restore(["g:me@example.com:gone"]), [])


if __name__ == "__main__":
    unittest.main()
