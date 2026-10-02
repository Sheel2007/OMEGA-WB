import json
import os
import tempfile
import unittest

from board.notes import COLORS, MAX_NOTES, NotesBoard
from board.store import ChangeFeed, NotFound, ValidationError


class NotesBoardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "notes.json")
        self.board = NotesBoard(self.path, clock=lambda: "2026-10-01T12:00:00Z")

    def tearDown(self):
        self.tmp.cleanup()

    def texts(self, state=None):
        state = state or self.board.snapshot()
        return [note["text"] for note in state["notes"]]

    def test_starts_empty(self):
        self.assertEqual(self.board.snapshot(), {"version": 0, "notes": []})

    def test_add_puts_newest_first_and_tidies_spaces(self):
        self.board.add("Rent due Friday")
        result = self.board.add("  Plumber   coming  at 10 ")
        self.assertEqual(self.texts(result["state"]), ["Plumber coming at 10", "Rent due Friday"])
        self.assertEqual(result["note"]["created"], "2026-10-01T12:00:00Z")

    def test_colors_rotate_so_neighbours_differ(self):
        colors = [self.board.add("note %d" % i)["note"]["color"] for i in range(len(COLORS) + 1)]
        self.assertEqual(colors[: len(COLORS)], list(COLORS))
        self.assertEqual(colors[-1], COLORS[0])

    def test_uses_client_id_when_valid(self):
        self.assertEqual(self.board.add("Hi", note_id="a1b2c3d4e5f6")["note"]["id"], "a1b2c3d4e5f6")
        self.assertNotEqual(self.board.add("Again", note_id="a1b2c3d4e5f6")["note"]["id"], "a1b2c3d4e5f6")
        self.assertNotEqual(self.board.add("Bad", note_id="<b>")["note"]["id"], "<b>")

    def test_rejects_blank_overlong_and_non_text(self):
        for bad in ["   ", "x" * 201, None, 5]:
            with self.assertRaises(ValidationError):
                self.board.add(bad)

    def test_board_has_a_size_limit(self):
        for i in range(MAX_NOTES):
            self.board.add("note %d" % i)
        with self.assertRaises(ValidationError):
            self.board.add("one too many")

    def test_remove_then_restore_puts_note_back_in_place(self):
        ids = [self.board.add(t)["note"]["id"] for t in ["a", "b", "c"]]
        self.board.remove(ids[1])
        self.assertEqual(self.texts(), ["c", "a"])
        result = self.board.restore([ids[1], "missing"])
        self.assertEqual(result["restored"], [ids[1]])
        self.assertEqual(self.texts(), ["c", "b", "a"])

    def test_remove_unknown_note(self):
        with self.assertRaises(NotFound):
            self.board.remove("nope")

    def test_restore_requires_a_list_of_ids(self):
        with self.assertRaises(ValidationError):
            self.board.restore("abc")

    def test_survives_a_restart(self):
        self.board.add("Keep me")
        again = NotesBoard(self.path)
        self.assertEqual(self.texts(again.snapshot()), ["Keep me"])
        self.assertEqual(again.snapshot()["version"], 1)
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["notes"][0]["text"], "Keep me")

    def test_corrupt_file_is_set_aside(self):
        with open(self.path, "w") as f:
            f.write("{oops")
        board = NotesBoard(self.path)
        self.assertEqual(board.snapshot()["notes"], [])
        self.assertTrue(any(".corrupt" in n for n in os.listdir(self.tmp.name)))

    def test_changes_notify_the_feed(self):
        feed = ChangeFeed()
        board = NotesBoard(None, feed=feed)
        before = feed.seq
        board.add("ping")
        self.assertEqual(feed.wait(before, timeout=0.05), before + 1)


if __name__ == "__main__":
    unittest.main()
