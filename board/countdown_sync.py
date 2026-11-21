"""Keeps the countdowns and the calendar in step.

Every countdown still to come stands for an event on the calendar, so it shows up in
Google Calendar on everyone's phone too. After each calendar refresh (on the
calendar's own thread, see ``CalendarSources(after_refresh=...)``):

* a countdown with no event yet is linked to a Google event with the same day and
  name, or gets a new all-day event on the account's calendar (``made``, so removing
  the countdown can delete it again);
* a linked countdown whose event was moved or renamed elsewhere follows it.

Only Google events count: the board's own and iCal subscriptions never reach anyone's
phone. A countdown with no link gets an event only once every Google calendar was
read (one that wasn't may already have it), and always under the id it reserved
beforehand, so a retry after a lost reply finds the event instead of making another.
One further off than the calendar is read (whose event the board never sees) gets
exactly one. Nothing here changes an event: countdowns can't be edited on the board.
"""
import logging

from . import google
from .countdown import MAX_TITLE_LENGTH
from .store import NotFound, ValidationError

log = logging.getLogger(__name__)


def _fold(title):
    return " ".join(title.split()).lower() if isinstance(title, str) else ""


def countdown_title(title):
    """An event's name as a countdown's: tidied and cut to the countdown's length."""
    return " ".join(title.split())[:MAX_TITLE_LENGTH].strip() if isinstance(title, str) else ""


def same_thing(event, countdown):
    """The same rule as sameThing() in web/js/apps/calendar/countdowns.js."""
    return event.get("date") == countdown.get("date") and _fold(countdown_title(event.get("title"))) == _fold(
        countdown.get("title"))


class CountdownSync:
    def __init__(self, countdowns, sources):
        self._countdowns = countdowns
        self._sources = sources

    def sync(self):
        snapshot = self._sources.snapshot()
        if not (snapshot.get("account") or {}).get("linked") or not self._sources.writable():
            return
        # Linked countdowns follow whatever their event is; only Google's can be twins.
        events = [e for e in snapshot.get("events", []) if isinstance(e, dict) and isinstance(e.get("id"), str)]
        by_id = {e["id"]: e for e in events}
        google_events = [e for e in events if e["id"].startswith("g:")]
        read_all = not snapshot.get("stale") and all(
            c.get("ok") for c in snapshot.get("calendars", []) if c.get("kind") == "google" and c.get("shown", True))
        for countdown in self._countdowns.upcoming():
            if countdown.get("event"):
                event = by_id.get(countdown["event"])
                if event:
                    self._countdowns.follow(countdown["id"], countdown_title(event.get("title")), event.get("date"))
                continue
            twin = next((e for e in google_events if same_thing(e, countdown)), None)
            if twin:
                self._countdowns.link(countdown["id"], twin["id"], made=False)
                continue
            if not read_all:
                continue
            event_id = self._countdowns.reserve(countdown["id"])
            if event_id is None:
                continue
            try:
                made = self._sources.add(None, {"title": countdown["title"], "date": countdown["date"]}, event_id=event_id)
            except (google.GoogleError, ValidationError, NotFound, OSError):
                log.warning("Couldn't put the countdown %r on the calendar; trying again next sync", countdown["title"],
                            exc_info=True)
                continue
            if not (isinstance(made, dict) and made.get("id")):
                continue
            if not self._countdowns.link(countdown["id"], made["id"], made=True):
                # Removed while its event was being made: the event goes too.
                self._take_back(made["id"])
                continue
            # So a second countdown on the same day and name links to it, not a copy.
            google_events.append(made)
            by_id[made["id"]] = made

    def _take_back(self, event_id):
        try:
            self._sources.remove(event_id)
        except (google.GoogleError, ValidationError, NotFound, OSError):
            log.warning("Couldn't take a removed countdown's event off the calendar", exc_info=True)
