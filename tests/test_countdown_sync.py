import unittest
from datetime import date

from board import google
from board.countdown import Countdowns
from board.countdown_sync import CountdownSync, same_thing

TODAY = date(2026, 11, 21)


class FakeSources:
    """The bits of CalendarSources the sync uses, with a Google calendar behind them.

    Like CalendarSources.add, inserting an id Google already has gives that event back.
    """

    def __init__(self, events=(), linked=True, writable=True, fail=False):
        self.events = list(events)
        self.linked = linked
        self.can_write = writable
        self.fail = fail
        self.read_ok = True
        self.lose_replies = 0
        self.on_add = None
        self.google = {}
        self.added = []
        self.removed = []

    def snapshot(self):
        return {"account": {"linked": self.linked}, "stale": False,
                "calendars": [{"kind": "google", "shown": True, "ok": self.read_ok}],
                "events": [dict(e) for e in self.events]}

    def writable(self):
        return [{"id": "me@example.com"}] if self.can_write else []

    def add(self, calendar_id, raw, event_id=None):
        if self.fail:
            raise google.GoogleError("Google is down.")
        if self.on_add:
            self.on_add()
        # Without an id of our own, Google picks a new one every time.
        event_id = event_id or "auto%d" % len(self.google)
        full = "g:me@example.com:%s" % event_id
        if event_id not in self.google:
            self.google[event_id] = {"id": full, "title": raw["title"], "date": raw["date"]}
            self.added.append((calendar_id, raw))
        if self.lose_replies:
            self.lose_replies -= 1
            raise google.GoogleError("Can't reach Google right now.")
        return dict(self.google[event_id])

    def remove(self, event_id):
        self.removed.append(event_id)


def setup(events=(), **kwargs):
    countdowns = Countdowns(today=lambda: TODAY, clock=lambda: "2026-11-21T12:00:00Z")
    sources = FakeSources(events, **kwargs)
    return countdowns, sources, CountdownSync(countdowns, sources)


def links(countdowns):
    return {c["title"]: (c.get("event"), c.get("made")) for c in countdowns.snapshot()["countdowns"]}


class CountdownSyncTest(unittest.TestCase):
    def test_links_an_event_that_is_already_there(self):
        countdowns, sources, sync = setup([{"id": "g:me@example.com:wb", "title": "  winter BREAK", "date": "2026-12-22"}])
        countdowns.add("Winter break", "2026-12-22")
        sync.sync()
        self.assertEqual(links(countdowns), {"Winter break": ("g:me@example.com:wb", False)})
        self.assertEqual(sources.added, [])

    def test_makes_an_all_day_event_when_there_is_none(self):
        countdowns, sources, sync = setup()
        countdowns.add("UMD finals", "2026-12-14")
        sync.sync()
        self.assertEqual(sources.added, [(None, {"title": "UMD finals", "date": "2026-12-14"})])
        [event_id] = sources.google
        self.assertEqual(links(countdowns), {"UMD finals": ("g:me@example.com:%s" % event_id, True)})

    def test_a_far_off_countdown_gets_one_event_only(self):
        # Beyond the 120 days the board reads, its event never shows up in the feed.
        countdowns, sources, sync = setup()
        countdowns.add("Graduation", "2027-06-10")
        sync.sync()
        sync.sync()
        self.assertEqual(len(sources.added), 1)

    def test_follows_a_moved_or_renamed_event(self):
        countdowns, sources, sync = setup([{"id": "g:me@example.com:f", "title": "UMD finals", "date": "2026-12-14"}])
        countdowns.add("UMD finals", "2026-12-14")
        sync.sync()
        sources.events = [{"id": "g:me@example.com:f", "title": "Finals week (all of it, every exam, the library)", "date": "2026-12-15"}]
        sync.sync()
        [countdown] = countdowns.snapshot()["countdowns"]
        self.assertEqual((countdown["title"], countdown["date"]), ("Finals week (all of it, every exam, the", "2026-12-15"))

    def test_finished_countdowns_are_left_alone(self):
        countdowns, sources, sync = setup()
        countdowns.add("Friendsgiving", "2026-11-15")
        sync.sync()
        self.assertEqual(sources.added, [])

    def test_a_google_error_leaves_it_unlinked_until_the_next_sync(self):
        countdowns, sources, sync = setup(fail=True)
        countdowns.add("UMD finals", "2026-12-14")
        sync.sync()
        self.assertEqual(links(countdowns), {"UMD finals": (None, None)})
        sources.fail = False
        sync.sync()
        [event_id] = sources.google
        self.assertEqual(links(countdowns), {"UMD finals": ("g:me@example.com:%s" % event_id, True)})

    def test_does_nothing_without_a_writable_account(self):
        for kwargs in ({"linked": False}, {"writable": False}):
            with self.subTest(**kwargs):
                countdowns, sources, sync = setup(**kwargs)
                countdowns.add("UMD finals", "2026-12-14")
                sync.sync()
                self.assertEqual(sources.added, [])
                self.assertEqual(links(countdowns), {"UMD finals": (None, None)})

    def test_only_a_google_event_counts_as_already_there(self):
        # The board's own events and iCal subscriptions never reach anyone's phone.
        countdowns, sources, sync = setup([{"id": "ical0:rent@2026-11-24", "title": "Rent due", "date": "2026-11-24"}])
        countdowns.add("Rent due", "2026-11-24")
        sync.sync()
        self.assertEqual(len(sources.added), 1)
        self.assertTrue(links(countdowns)["Rent due"][0].startswith("g:"))

    def test_a_lost_reply_never_makes_a_second_event(self):
        countdowns, sources, sync = setup()
        countdowns.add("Graduation", "2027-06-10")
        sources.lose_replies = 1
        sync.sync()
        self.assertEqual(links(countdowns), {"Graduation": (None, None)})
        sync.sync()
        self.assertEqual(len(sources.added), 1, "the retry sends the same id, and Google already has it")
        [event_id] = sources.google
        self.assertEqual(links(countdowns), {"Graduation": ("g:me@example.com:%s" % event_id, True)})

    def test_waits_for_every_calendar_to_be_read_before_making_events(self):
        countdowns, sources, sync = setup()
        countdowns.add("UMD finals", "2026-12-14")
        sources.read_ok = False
        sync.sync()
        self.assertEqual(sources.added, [], "a calendar that couldn't be read may already have it")
        sources.read_ok = True
        sync.sync()
        self.assertEqual(len(sources.added), 1)

    def test_a_countdown_removed_while_its_event_is_made_takes_the_event_with_it(self):
        countdowns, sources, sync = setup()
        typo = countdowns.add("Typo nmae", "2026-12-14")["countdown"]
        sources.on_add = lambda: countdowns.remove(typo["id"])
        sync.sync()
        [event_id] = sources.google
        self.assertEqual(sources.removed, ["g:me@example.com:%s" % event_id])

    def test_same_thing_cuts_the_event_name_like_a_countdown(self):
        long = "Department of Computer Science end-of-semester showcase"
        self.assertTrue(same_thing({"title": long, "date": "2026-12-11"}, {"title": long[:40].strip(), "date": "2026-12-11"}))
        self.assertFalse(same_thing({"title": "Pack", "date": "2026-12-14"}, {"title": "UMD finals", "date": "2026-12-14"}))


if __name__ == "__main__":
    unittest.main()
