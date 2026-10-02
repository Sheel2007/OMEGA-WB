"""The household calendar: events added on the board, plus read-only Google Calendar feeds.

Two separate things, kept separate on purpose:

* ``CalendarStore`` holds the events people add on the board or from their phones,
  in ``data/calendar.json``, and is pushed to every screen like the shopping list.
* ``CalendarFeeds`` subscribes to iCalendar addresses (a Google Calendar's "secret
  address in iCal format") and expands them into the next few months of
  occurrences. It's read-only: writing back to Google would need an OAuth client
  and a Google Cloud project, which this board deliberately doesn't have.
"""
import copy
import logging
import os
import re
import threading
import time
import urllib.request
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import ical
from .store import JsonStore, NotFound, ValidationError, tidy_text, utc_now

log = logging.getLogger(__name__)

MAX_TITLE_LENGTH = 80
MAX_EVENTS = 200
# Past events stay on the list this long (so last week is still there), then go.
KEEP_PAST_DAYS = 120
# How far back and ahead an event may be put on the calendar.
MAX_YEARS_PAST = 2
MAX_YEARS_AHEAD = 5
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")

# Feeds
COLORS = ("blue", "purple", "teal", "pink", "orange", "green")
MAX_CALENDARS = 6
MAX_FEED_EVENTS = 400
# How far ahead feeds are expanded. Long enough for "whose birthday is coming up?".
WINDOW_DAYS = 120
FETCH_TIMEOUT_SECONDS = 15
MAX_FEED_BYTES = 4 * 1024 * 1024
CACHE_SECONDS = 15 * 60
# After every calendar fails, don't try again for a while (the Pi may be offline).
RETRY_SECONDS = 2 * 60
# An old copy of the calendar is better than none, up to a point.
STALE_LIMIT_SECONDS = 6 * 60 * 60

__all__ = [
    "CalendarFeeds",
    "CalendarStore",
    "COLORS",
    "MAX_EVENTS",
    "NotFound",
    "ValidationError",
    "local_zone",
    "sources_from",
]


def clean_title(raw):
    if not isinstance(raw, str):
        raise ValidationError("An event title must be text.")
    return tidy_text(
        raw,
        max_length=MAX_TITLE_LENGTH,
        empty_message="Give the event a name first.",
        too_long_message="Keep event names under %d characters." % MAX_TITLE_LENGTH,
    )


def clean_date(raw, today):
    if not isinstance(raw, str) or not DATE.match(raw.strip()):
        raise ValidationError("Pick a date for the event.")
    try:
        day = date.fromisoformat(raw.strip())
    except ValueError:
        raise ValidationError("That date doesn't exist.")
    if not today - timedelta(days=366 * MAX_YEARS_PAST) <= day <= today + timedelta(days=366 * MAX_YEARS_AHEAD):
        raise ValidationError("Pick a date within the next few years.")
    return day.isoformat()


def clean_time(raw):
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not TIME.match(raw.strip()):
        raise ValidationError("Use a time like 18:30, or leave the event as all day.")
    return raw.strip()


def _when(event):
    return (event["date"], event["time"] or "", event["title"].casefold())


class CalendarStore(JsonStore):
    """The events the household adds itself, kept in date order."""

    label = "calendar"

    # Writes

    def add(self, raw_title, raw_date, raw_time=None, event_id=None):
        title = clean_title(raw_title)
        when = clean_date(raw_date, self._today())
        clock = clean_time(raw_time)
        with self._changed:
            self._forget_old()
            if len(self._events) >= MAX_EVENTS:
                raise ValidationError("The calendar is full. Remove an event to make room.")
            event = {
                "id": self._new_id(event_id),
                "title": title,
                "date": when,
                "time": clock,
                "created": self._clock(),
            }
            self._events.append(event)
            self._events.sort(key=_when)
            self._commit()
            return {"state": self._state(), "event": copy.deepcopy(event)}

    def remove(self, event_id):
        with self._changed:
            event = next((e for e in self._events if e["id"] == event_id), None)
            if event is None:
                raise NotFound("That event is no longer on the calendar.")
            index = self._events.index(event)
            self._events.pop(index)
            self._discard(index, event)
            self._commit()
            return {"state": self._state(), "event": copy.deepcopy(event)}

    def restore(self, event_ids):
        with self._changed:
            present = {event["id"] for event in self._events}
            entries = self._take_from_trash(event_ids, present)
            for _index, event in entries:
                self._events.append(event)
            if entries:
                self._events.sort(key=_when)
                self._commit()
            return {"state": self._state(), "restored": [event["id"] for _index, event in entries]}

    # Internals

    def _today(self):
        return date.fromisoformat(self._clock()[:10])

    def _forget_old(self):
        cutoff = (self._today() - timedelta(days=KEEP_PAST_DAYS)).isoformat()
        self._events = [event for event in self._events if event["date"] >= cutoff]

    def _new_id(self, requested):
        taken = {event["id"] for event in self._events} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    # JsonStore hooks

    def _reset(self):
        self._events = []

    def _state(self):
        return {"version": self._version, "events": copy.deepcopy(self._events)}

    def _to_disk(self):
        return {"events": self._events}

    def _from_disk(self, data):
        self._events = sorted((_valid_event(e) for e in data.get("events", [])), key=_when)


def _valid_event(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["title"], str) and DATE.match(raw["date"])):
        raise ValueError("bad event")
    clock = raw.get("time")
    return {
        "id": raw["id"],
        "title": raw["title"],
        "date": raw["date"],
        "time": clock if isinstance(clock, str) and TIME.match(clock) else None,
        "created": raw.get("created"),
    }


# Subscribed calendars


def local_zone(name=None):
    """The time zone the board is in, so feed times read the same as the clock on the wall."""
    for candidate in (name, os.environ.get("TZ"), _zone_file(), _localtime_link()):
        if not candidate:
            continue
        try:
            return ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            continue
    log.warning("Couldn't work out this machine's time zone; using its current UTC offset.")
    # A fixed offset: right now, and wrong by an hour across a daylight-saving change.
    return datetime.now().astimezone().tzinfo


def _zone_file():
    try:
        with open("/etc/timezone", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def _localtime_link():
    try:
        target = os.path.realpath("/etc/localtime")
    except OSError:
        return None
    marker = "/zoneinfo/"
    return target.split(marker, 1)[1] if marker in target else None


def sources_from(raw):
    """Reads the `calendars` setting: a list of iCalendar URLs, or of {url, name, color}."""
    sources = []
    for index, entry in enumerate(raw or []):
        if isinstance(entry, str):
            entry = {"url": entry}
        url = entry.get("url") if isinstance(entry, dict) else None
        if not isinstance(url, str) or not url.strip().lower().startswith(("http://", "https://")):
            log.warning("Ignoring calendar %d in config.json: 'url' must be an http(s) iCalendar address.", index + 1)
            continue
        name = entry.get("name")
        color = entry.get("color")
        sources.append({
            "url": url.strip(),
            "name": name.strip() if isinstance(name, str) and name.strip() else None,
            "color": color if color in COLORS else COLORS[len(sources) % len(COLORS)],
        })
        if len(sources) == MAX_CALENDARS:
            log.warning("Only the first %d calendars in config.json are used.", MAX_CALENDARS)
            break
    return sources


def fetch_text(url):
    request = urllib.request.Request(url, headers={"User-Agent": "WidgetBoard/1.0"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        raw = response.read(MAX_FEED_BYTES + 1)
    if len(raw) > MAX_FEED_BYTES:
        raise ValueError("calendar feed is larger than %d MB" % (MAX_FEED_BYTES // (1024 * 1024)))
    return raw.decode("utf-8", "replace")


class CalendarFeeds:
    """Subscribed iCalendar feeds, fetched at most every 15 minutes and shared by every screen."""

    def __init__(self, sources, *, zone=None, fetch=fetch_text, now=time.monotonic, today=date.today):
        self._sources = list(sources or [])
        self._zone = zone or local_zone()
        self._fetch = fetch
        self._now = now
        self._today = today
        self._lock = threading.Lock()
        self._cached = None
        self._cached_at = None
        self._failed_at = None

    def upcoming(self):
        """What's on the subscribed calendars, from the cache unless it's time to refresh."""
        if not self._sources:
            return {"configured": False, "calendars": [], "events": [], "updated": None, "stale": False}
        with self._lock:
            now = self._now()
            fresh = self._cached is not None and now - self._cached_at < CACHE_SECONDS
            retry_due = self._failed_at is None or now - self._failed_at >= RETRY_SECONDS
            if not fresh and retry_due:
                result = self._load()
                reached_any = any(entry["ok"] for entry in result["calendars"])
                self._failed_at = None if reached_any else now
                if reached_any or self._cached is None:
                    self._cached, self._cached_at = result, now
            if self._cached is None or now - self._cached_at >= STALE_LIMIT_SECONDS:
                return {"configured": True, "calendars": self._unreachable(), "events": [], "updated": None, "stale": True}
            return dict(self._cached, stale=now - self._cached_at >= CACHE_SECONDS)

    def _load(self):
        today = self._today()
        window_end = today + timedelta(days=WINDOW_DAYS)
        calendars = []
        events = []
        for index, source in enumerate(self._sources):
            entry = {"name": source["name"] or "Calendar %d" % (index + 1), "color": source["color"], "ok": False, "error": None}
            try:
                feed = ical.read_calendar(self._fetch(source["url"]))
                found = ical.occurrences(feed, window_start=today, window_end=window_end, local=self._zone)
            except (OSError, ValueError, TypeError, KeyError, IndexError):
                log.warning("Couldn't read the calendar at %s", source["url"], exc_info=True)
                entry["error"] = "Couldn't read this calendar."
            else:
                entry.update(name=source["name"] or feed["name"] or entry["name"], ok=True)
                events.extend(self._shape(occurrence, index, entry) for occurrence in found)
            calendars.append(entry)
        events.sort(key=lambda event: (event["date"], event["time"] or "", event["title"].casefold()))
        return {"configured": True, "calendars": calendars, "events": events[:MAX_FEED_EVENTS], "updated": utc_now()}

    @staticmethod
    def _shape(occurrence, index, entry):
        # Unique per occurrence, so a yearly birthday and next year's don't collide.
        key = "%s@%s" % (occurrence["uid"][:48], occurrence["date"])
        return {
            "id": "feed%d:%s" % (index, key),
            "title": occurrence["title"],
            "date": occurrence["date"],
            "time": occurrence["time"],
            "endTime": occurrence["end_time"],
            "days": occurrence["days"],
            "location": occurrence["location"],
            "calendar": entry["name"],
            "color": entry["color"],
        }

    def _unreachable(self):
        return [
            {"name": source["name"] or "Calendar %d" % (index + 1), "color": source["color"], "ok": False,
             "error": "Can't reach this calendar right now."}
            for index, source in enumerate(self._sources)
        ]
