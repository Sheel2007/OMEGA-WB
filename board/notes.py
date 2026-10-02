"""Shared notes for the household (sticky notes on the board), persisted to a JSON file."""
import copy
import re
import uuid

from .store import JsonStore, NotFound, ValidationError, tidy_text

MAX_NOTE_LENGTH = 200
MAX_NOTES = 40
COLORS = ("yellow", "pink", "blue", "green")
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")


def clean_text(raw):
    if not isinstance(raw, str):
        raise ValidationError("A note must be text.")
    return tidy_text(
        raw,
        max_length=MAX_NOTE_LENGTH,
        empty_message="Write something first.",
        too_long_message="Keep notes under %d characters." % MAX_NOTE_LENGTH,
    )


class NotesBoard(JsonStore):
    label = "notes"

    def add(self, raw_text, note_id=None):
        text = clean_text(raw_text)
        with self._changed:
            if len(self._notes) >= MAX_NOTES:
                raise ValidationError("The board is full. Remove an old note to make room.")
            note = {
                "id": self._new_id(note_id),
                "text": text,
                "color": self._next_color(),
                "created": self._clock(),
            }
            self._notes.insert(0, note)
            self._commit()
            return {"state": self._state(), "note": copy.deepcopy(note)}

    def remove(self, note_id):
        with self._changed:
            note = next((n for n in self._notes if n["id"] == note_id), None)
            if note is None:
                raise NotFound("That note was already taken down.")
            index = self._notes.index(note)
            self._notes.pop(index)
            self._discard(index, note)
            self._commit()
            return {"state": self._state(), "note": copy.deepcopy(note)}

    def restore(self, note_ids):
        with self._changed:
            present = {note["id"] for note in self._notes}
            entries = self._take_from_trash(note_ids, present)
            for index, note in entries:
                self._notes.insert(min(index, len(self._notes)), note)
            if entries:
                self._commit()
            return {"state": self._state(), "restored": [note["id"] for _, note in entries]}

    # Internals

    def _next_color(self):
        if not self._notes or self._notes[0]["color"] not in COLORS:
            return COLORS[0]
        return COLORS[(COLORS.index(self._notes[0]["color"]) + 1) % len(COLORS)]

    def _new_id(self, requested):
        taken = {note["id"] for note in self._notes} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    # JsonStore hooks

    def _reset(self):
        self._notes = []

    def _state(self):
        return {"version": self._version, "notes": copy.deepcopy(self._notes)}

    def _to_disk(self):
        return {"notes": self._notes}

    def _from_disk(self, data):
        self._notes = [_valid_note(n) for n in data.get("notes", [])]


def _valid_note(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["text"], str)):
        raise ValueError("bad note")
    color = raw.get("color")
    return {
        "id": raw["id"],
        "text": raw["text"],
        "color": color if color in COLORS else COLORS[0],
        "created": raw.get("created"),
    }
