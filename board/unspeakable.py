"""The ledger of unspeakable things: what happened in this house that nobody is
to mention again, kept in a JSON file and shown blacked out on every screen.

It replaced the old sticky-notes board, so it is the same kind of store: one list,
newest first, written atomically and pushed over the event stream.
"""
import copy
import re
import uuid

from .store import JsonStore, NotFound, ValidationError, tidy_text

MAX_TEXT_LENGTH = 200
MAX_ENTRIES = 40
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")


def clean_text(raw):
    if not isinstance(raw, str):
        raise ValidationError("An unspeakable thing has to be written down.")
    return tidy_text(
        raw,
        max_length=MAX_TEXT_LENGTH,
        empty_message="Write what happened first.",
        too_long_message="Keep it under %d characters." % MAX_TEXT_LENGTH,
    )


class UnspeakableLedger(JsonStore):
    label = "ledger"

    def add(self, raw_text, entry_id=None):
        text = clean_text(raw_text)
        with self._changed:
            if len(self._entries) >= MAX_ENTRIES:
                raise ValidationError("The ledger is full. Strike an old one from the record first.")
            entry = {
                "id": self._new_id(entry_id),
                "text": text,
                "created": self._clock(),
            }
            self._entries.insert(0, entry)
            self._commit()
            return {"state": self._state(), "entry": copy.deepcopy(entry)}

    def remove(self, entry_id):
        with self._changed:
            entry = next((e for e in self._entries if e["id"] == entry_id), None)
            if entry is None:
                raise NotFound("That one was already struck from the record.")
            index = self._entries.index(entry)
            self._entries.pop(index)
            self._discard(index, entry)
            self._commit()
            return {"state": self._state(), "entry": copy.deepcopy(entry)}

    def restore(self, entry_ids):
        with self._changed:
            present = {entry["id"] for entry in self._entries}
            entries = self._take_from_trash(entry_ids, present)
            for index, entry in entries:
                self._entries.insert(min(index, len(self._entries)), entry)
            if entries:
                self._commit()
            return {"state": self._state(), "restored": [entry["id"] for _, entry in entries]}

    # Internals

    def _new_id(self, requested):
        taken = {entry["id"] for entry in self._entries} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    # JsonStore hooks

    def _reset(self):
        self._entries = []

    def _state(self):
        return {"version": self._version, "entries": copy.deepcopy(self._entries)}

    def _to_disk(self):
        return {"entries": self._entries}

    def _from_disk(self, data):
        self._entries = [_valid_entry(e) for e in data.get("entries", [])]


def _valid_entry(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["text"], str)):
        raise ValueError("bad entry")
    return {"id": raw["id"], "text": raw["text"], "created": raw.get("created")}
