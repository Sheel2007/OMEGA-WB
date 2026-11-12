import json
import os
import tempfile
import unittest

from board.store import ChangeFeed, NotFound, ValidationError
from board.unspeakable import MAX_ENTRIES, UnspeakableLedger


class UnspeakableLedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "unspeakable.json")
        self.ledger = UnspeakableLedger(self.path, clock=lambda: "2026-10-01T12:00:00Z")

    def tearDown(self):
        self.tmp.cleanup()

    def texts(self, state=None):
        state = state or self.ledger.snapshot()
        return [entry["text"] for entry in state["entries"]]

    def test_starts_empty(self):
        self.assertEqual(self.ledger.snapshot(), {"version": 0, "entries": []})

    def test_add_puts_newest_first_and_tidies_spaces(self):
        self.ledger.add("the turkey incident")
        result = self.ledger.add("  nobody   mention the parking garage ")
        self.assertEqual(self.texts(result["state"]), ["nobody mention the parking garage", "the turkey incident"])
        self.assertEqual(result["entry"]["created"], "2026-10-01T12:00:00Z")

    def test_uses_client_id_when_valid(self):
        self.assertEqual(self.ledger.add("Hush", entry_id="a1b2c3d4e5f6")["entry"]["id"], "a1b2c3d4e5f6")
        self.assertNotEqual(self.ledger.add("Again", entry_id="a1b2c3d4e5f6")["entry"]["id"], "a1b2c3d4e5f6")
        self.assertNotEqual(self.ledger.add("Bad", entry_id="<b>")["entry"]["id"], "<b>")

    def test_rejects_blank_overlong_and_non_text(self):
        for bad in ["   ", "x" * 201, None, 5]:
            with self.assertRaises(ValidationError):
                self.ledger.add(bad)

    def test_the_ledger_has_a_size_limit(self):
        for i in range(MAX_ENTRIES):
            self.ledger.add("incident %d" % i)
        with self.assertRaises(ValidationError):
            self.ledger.add("one too many")

    def test_strike_then_restore_puts_it_back_in_place(self):
        ids = [self.ledger.add(t)["entry"]["id"] for t in ["a", "b", "c"]]
        self.ledger.remove(ids[1])
        self.assertEqual(self.texts(), ["c", "a"])
        result = self.ledger.restore([ids[1], "missing"])
        self.assertEqual(result["restored"], [ids[1]])
        self.assertEqual(self.texts(), ["c", "b", "a"])

    def test_remove_unknown_entry(self):
        with self.assertRaises(NotFound):
            self.ledger.remove("nope")

    def test_restore_requires_a_list_of_ids(self):
        with self.assertRaises(ValidationError):
            self.ledger.restore("abc")

    def test_survives_a_restart(self):
        self.ledger.add("Keep me")
        again = UnspeakableLedger(self.path)
        self.assertEqual(self.texts(again.snapshot()), ["Keep me"])
        self.assertEqual(again.snapshot()["version"], 1)
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["entries"][0]["text"], "Keep me")

    def test_corrupt_file_is_set_aside(self):
        with open(self.path, "w") as f:
            f.write("{oops")
        ledger = UnspeakableLedger(self.path)
        self.assertEqual(ledger.snapshot()["entries"], [])
        self.assertTrue(any(".corrupt" in n for n in os.listdir(self.tmp.name)))

    def test_changes_notify_the_feed(self):
        feed = ChangeFeed()
        ledger = UnspeakableLedger(None, feed=feed)
        before = feed.seq
        ledger.add("ping")
        self.assertEqual(feed.wait(before, timeout=0.05), before + 1)


if __name__ == "__main__":
    unittest.main()
