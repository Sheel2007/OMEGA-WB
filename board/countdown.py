"""Countdowns: the days the house is waiting for (finals, a break, a trip), kept in
a JSON file and shown counting down on every screen.

The same kind of store as the Unspeakable ledger: one list, written atomically and
pushed over the event stream. A countdown is a name and a day; the screens work out
how many days are left in their own time zone, so the server never has to.
"""
import copy
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from .store import JsonStore, NotFound, ValidationError, tidy_text

MAX_TITLE_LENGTH = 40
MAX_COUNTDOWNS = 30
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# How far ahead a countdown can be set, and how long a finished one can be backdated.
YEARS_AHEAD = 5
DAYS_BEHIND = 366
# A calendar event id (board/calendar.py: "g:<calendar>:<event>" for Google, or the
# board's own); anything longer isn't one.
MAX_EVENT_ID_LENGTH = 300


def clean_title(raw):
    if not isinstance(raw, str):
        raise ValidationError("A countdown needs a name.")
    return tidy_text(
        raw,
        max_length=MAX_TITLE_LENGTH,
        empty_message="Name the day you're counting down to.",
        too_long_message="Keep the name under %d characters." % MAX_TITLE_LENGTH,
    )


def clean_day(raw, today):
    """A "YYYY-MM-DD" day that really exists, from a year ago to five years ahead."""
    if not isinstance(raw, str) or not DAY.match(raw):
        raise ValidationError("Pick the day it's counting down to.")
    try:
        day = date.fromisoformat(raw)
    except ValueError:
        raise ValidationError("That day doesn't exist.") from None
    if day < today - timedelta(days=DAYS_BEHIND):
        raise ValidationError("That day has long gone.")
    if day.year > today.year + YEARS_AHEAD:
        raise ValidationError("Pick a day within %d years." % YEARS_AHEAD)
    return raw


def _today():
    return datetime.now(timezone.utc).date()


class Countdowns(JsonStore):
    label = "countdowns"

    def __init__(self, path=None, today=_today, **kwargs):
        self._today = today
        super().__init__(path, **kwargs)

    def add(self, raw_title, raw_day, countdown_id=None, event=None):
        """`event` is the calendar event the countdown was made from (the hourglass)."""
        title = clean_title(raw_title)
        day = clean_day(raw_day, self._today())
        if event is not None and not _event_id(event):
            raise ValidationError("That isn't an event on the calendar.")
        with self._changed:
            if len(self._countdowns) >= MAX_COUNTDOWNS:
                raise ValidationError("That's a lot to wait for. Remove one first.")
            countdown = {"id": self._new_id(countdown_id), "title": title, "date": day, "created": self._clock()}
            if event is not None:
                countdown.update(event=event, made=False)
            self._countdowns.append(countdown)
            self._sort()
            self._commit()
            return {"state": self._state(), "countdown": copy.deepcopy(countdown)}

    def remove(self, countdown_id):
        with self._changed:
            found = next((c for c in self._countdowns if c["id"] == countdown_id), None)
            if found is None:
                raise NotFound("That countdown was already removed.")
            index = self._countdowns.index(found)
            self._countdowns.pop(index)
            self._discard(index, found)
            self._commit()
            return {"state": self._state(), "countdown": copy.deepcopy(found)}

    def restore(self, countdown_ids):
        with self._changed:
            present = {c["id"] for c in self._countdowns}
            restored = self._take_from_trash(countdown_ids, present)
            for _index, countdown in restored:
                self._countdowns.append(countdown)
            if restored:
                self._sort()
                self._commit()
            return {"state": self._state(), "restored": [c["id"] for _, c in restored]}

    # The link to a calendar event (kept in step by board/countdown_sync.py)

    def upcoming(self):
        """Copies of the countdowns still to come (today included)."""
        today = self._today().isoformat()
        with self._changed:
            return [copy.deepcopy(c) for c in self._countdowns if c["date"] >= today]

    def link(self, countdown_id, event_id, made):
        """Remembers the event a countdown stands for; `made` if the board created it."""
        with self._changed:
            found = self._find(countdown_id)
            if found is None or not _event_id(event_id):
                return
            found.update(event=event_id, made=bool(made))
            self._commit()

    def follow(self, countdown_id, raw_title, raw_day):
        """Moves or renames a countdown after its event was moved or renamed elsewhere."""
        try:
            title = clean_title(raw_title[:MAX_TITLE_LENGTH] if isinstance(raw_title, str) else raw_title)
            day = clean_day(raw_day, self._today())
        except ValidationError:
            return
        with self._changed:
            found = self._find(countdown_id)
            if found is None or (found["title"], found["date"]) == (title, day):
                return
            found.update(title=title, date=day)
            self._sort()
            self._commit()

    def forget_event(self, countdown_id):
        """After a removed countdown's own event was deleted, Undo brings it back unlinked."""
        with self._changed:
            kept = self._trash.get(countdown_id)
            if kept:
                kept[1].pop("event", None)
                kept[1].pop("made", None)

    # Internals

    def _find(self, countdown_id):
        return next((c for c in self._countdowns if c["id"] == countdown_id), None)

    def _sort(self):
        # Soonest first; two on the same day stay in the order they were added.
        self._countdowns.sort(key=lambda c: c["date"])

    def _new_id(self, requested):
        taken = {c["id"] for c in self._countdowns} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    # JsonStore hooks

    def _reset(self):
        self._countdowns = []

    def _state(self):
        return {"version": self._version, "countdowns": copy.deepcopy(self._countdowns)}

    def _to_disk(self):
        return {"countdowns": self._countdowns}

    def _from_disk(self, data):
        self._countdowns = [_valid_countdown(c) for c in data.get("countdowns", [])][:MAX_COUNTDOWNS]
        self._sort()


def _valid_countdown(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["title"], str) and isinstance(raw["date"], str)):
        raise ValueError("bad countdown")
    date.fromisoformat(raw["date"])
    countdown = {"id": raw["id"], "title": raw["title"], "date": raw["date"], "created": raw.get("created")}
    if _event_id(raw.get("event")):
        countdown.update(event=raw["event"], made=raw.get("made") is True)
    return countdown


def _event_id(value):
    return isinstance(value, str) and 0 < len(value) <= MAX_EVENT_ID_LENGTH
