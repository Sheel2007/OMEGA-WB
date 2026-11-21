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


if __name__ == "__main__":
    unittest.main()
