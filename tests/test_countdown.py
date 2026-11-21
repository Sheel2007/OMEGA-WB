import json
import os
import tempfile
import unittest
from datetime import date

from board.countdown import MAX_COUNTDOWNS, Countdowns
from board.store import NotFound, ValidationError

TODAY = date(2026, 11, 20)


def store(path=None):
    return Countdowns(path, today=lambda: TODAY, clock=lambda: "2026-11-20T23:00:00Z")


class CountdownTest(unittest.TestCase):
    def test_countdowns_are_kept_soonest_first(self):
        countdowns = store()
        countdowns.add("Next semester", "2027-01-27")
        countdowns.add("UMD finals", "2026-12-14")
        result = countdowns.add("  Winter   break ", "2026-12-22", countdown_id="abcdef12")
        self.assertEqual(result["countdown"], {"id": "abcdef12", "title": "Winter break", "date": "2026-12-22",
                                               "created": "2026-11-20T23:00:00Z"})
        state = countdowns.snapshot()
        self.assertEqual([c["title"] for c in state["countdowns"]], ["UMD finals", "Winter break", "Next semester"])
        self.assertEqual(state["version"], 3)

    def test_a_countdown_needs_a_name_and_a_real_day_in_range(self):
        countdowns = store()
        for title, day in [("", "2026-12-14"), ("x" * 41, "2026-12-14"), (None, "2026-12-14"),
                           ("Finals", "Dec 14"), ("Finals", "2026-02-30"), ("Finals", None),
                           ("Finals", "2025-11-01"), ("Finals", "2032-01-01")]:
            with self.subTest(title=title, day=day), self.assertRaises(ValidationError):
                countdowns.add(title, day)
        countdowns.add("Today", "2026-11-20")
        countdowns.add("Last month", "2026-10-20")
        countdowns.add("Far off", "2031-12-31")
        self.assertEqual(len(countdowns.snapshot()["countdowns"]), 3)

    def test_there_is_a_limit(self):
        countdowns = store()
        for n in range(MAX_COUNTDOWNS):
            countdowns.add("Day %d" % n, "2027-01-01")
        with self.assertRaises(ValidationError):
            countdowns.add("One more", "2027-01-01")

    def test_a_removed_countdown_can_be_put_back(self):
        countdowns = store()
        first = countdowns.add("UMD finals", "2026-12-14")["countdown"]["id"]
        countdowns.add("Next semester", "2027-01-27")
        countdowns.remove(first)
        with self.assertRaises(NotFound):
            countdowns.remove(first)
        result = countdowns.restore([first, "nope"])
        self.assertEqual(result["restored"], [first])
        self.assertEqual([c["title"] for c in result["state"]["countdowns"]], ["UMD finals", "Next semester"])
        with self.assertRaises(ValidationError):
            countdowns.restore("not a list")

    def test_they_survive_a_restart_and_a_bad_file_is_set_aside(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "countdowns.json")
            store(path).add("UMD finals", "2026-12-14")
            again = store(path).snapshot()
            self.assertEqual([c["title"] for c in again["countdowns"]], ["UMD finals"])
            self.assertEqual(again["version"], 1)
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"countdowns": [{"id": "a", "title": "x", "date": "not a day"}]}, f)
            self.assertEqual(store(path).snapshot()["countdowns"], [])
            self.assertTrue(any(name.startswith("countdowns.json.corrupt-") for name in os.listdir(folder)))



class CountdownLinkTest(unittest.TestCase):
    """A countdown can stand for a calendar event (board/countdown_sync.py keeps them in step)."""

    def test_without_a_link_a_countdown_keeps_its_shape(self):
        countdown = store().add("UMD finals", "2026-12-14")["countdown"]
        self.assertEqual(set(countdown), {"id", "title", "date", "created"})

    def test_the_hourglass_links_an_existing_event(self):
        countdowns = store()
        countdown = countdowns.add("Rent due", "2026-11-24", event="g:me@example.com:abc")["countdown"]
        self.assertEqual((countdown["event"], countdown["made"]), ("g:me@example.com:abc", False))
        with self.assertRaises(ValidationError):
            countdowns.add("Rent due", "2026-11-24", event="x" * 301)

    def test_link_follow_and_upcoming(self):
        countdowns = store()
        finals = countdowns.add("UMD finals", "2026-12-14")["countdown"]
        countdowns.add("Friendsgiving", "2026-11-15")
        countdowns.link(finals["id"], "g:cal:e1", made=True)
        version = countdowns.snapshot()["version"]
        countdowns.follow(finals["id"], "UMD finals", "2026-12-14")
        self.assertEqual(countdowns.snapshot()["version"], version, "nothing changed, nothing written")
        countdowns.follow(finals["id"], "Finals week", "2026-12-15")
        coming = countdowns.upcoming()
        self.assertEqual([(c["title"], c["date"], c["event"], c["made"]) for c in coming],
                         [("Finals week", "2026-12-15", "g:cal:e1", True)])

    def test_the_link_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "countdowns.json")
            first = store(path)
            made = first.add("Winter break", "2026-12-22")["countdown"]
            first.link(made["id"], "g:cal:w", made=True)
            again = store(path)
            self.assertEqual({(c["event"], c["made"]) for c in again.snapshot()["countdowns"]}, {("g:cal:w", True)})

    def test_forget_event_only_after_delete(self):
        countdowns = store()
        made = countdowns.add("Winter break", "2026-12-22")["countdown"]
        countdowns.link(made["id"], "g:cal:w", made=True)
        countdowns.remove(made["id"])
        countdowns.forget_event(made["id"])
        countdowns.restore([made["id"]])
        back = countdowns.snapshot()["countdowns"][0]
        self.assertNotIn("event", back)
        self.assertNotIn("made", back)
        kept = countdowns.add("Next semester", "2027-01-27")["countdown"]
        countdowns.link(kept["id"], "g:cal:n", made=True)
        countdowns.remove(kept["id"])
        countdowns.restore([kept["id"]])
        self.assertIn("g:cal:n", [c.get("event") for c in countdowns.snapshot()["countdowns"]])

    def test_a_countdown_keeps_the_id_its_event_will_have_until_it_is_linked(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "countdowns.json")
            countdowns = store(path)
            made = countdowns.add("Graduation", "2027-06-10")["countdown"]
            first = countdowns.reserve(made["id"])
            self.assertRegex(first, r"^[a-v0-9]{5,1024}$", "Google event ids are base32hex")
            self.assertEqual(store(path).reserve(made["id"]), first, "the same id after a restart, so a retry can't make a copy")
            self.assertTrue(countdowns.link(made["id"], "g:cal:%s" % first, made=True))
            self.assertNotIn("pending", countdowns.snapshot()["countdowns"][0])
            self.assertFalse(countdowns.link("gone", "g:cal:x", made=True), "nothing to link")


if __name__ == "__main__":
    unittest.main()
