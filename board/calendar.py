"""The household calendar.

Three places an event can live, and the board shows them as one agenda:

* ``CalendarStore`` — events kept on the Pi in ``data/calendar.json`` and pushed to
  every screen. This is where new events go when no Google account is connected.
* A connected Google account (``board.google``) — read *and* written: events added
  on the board go straight into the chosen Google calendar.
* Subscribed iCalendar addresses (``board.ical``) — read-only, and need no account.

``CalendarSources`` pulls the last two together on one background thread and keeps
the result in a snapshot that's pushed over the event stream like any other store.
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

from . import google, ical
from .store import JsonStore, NotFound, ValidationError, tidy_text, utc_now

log = logging.getLogger(__name__)

MAX_TITLE_LENGTH = 80
MAX_LOCATION_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 500
MAX_EVENTS = 200
# How many days one event may cover, so a year-long "event" can't flood the agenda.
MAX_SPAN_DAYS = 30
# Past events stay on the board's own list this long (so last week is still there), then go.
KEEP_PAST_DAYS = 120
MAX_YEARS_PAST = 2
MAX_YEARS_AHEAD = 5
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")

COLORS = ("blue", "purple", "teal", "pink", "orange", "green")
MAX_CALENDARS = 6
MAX_FEED_EVENTS = 400
# How far ahead calendars are read. Long enough for "whose birthday is coming up?".
WINDOW_DAYS = 120
FETCH_TIMEOUT_SECONDS = 15
MAX_FEED_BYTES = 4 * 1024 * 1024
REFRESH_SECONDS = 15 * 60
# After a refresh that reached nothing, try again sooner (the Pi may have been offline).
RETRY_SECONDS = 2 * 60
# Deleted Google events kept in memory so "Undo" can put them back.
MAX_TRASH = 50

__all__ = [
    "CalendarSources",
    "CalendarStore",
    "COLORS",
    "MAX_EVENTS",
    "NotFound",
    "ValidationError",
    "local_zone",
    "sources_from",
    "zone_name",
]


# Validation, shared by the board's own list and by what's sent to Google


def clean_title(raw):
    if not isinstance(raw, str):
        raise ValidationError("An event title must be text.")
    return tidy_text(
        raw,
        max_length=MAX_TITLE_LENGTH,
        empty_message="Give the event a name first.",
        too_long_message="Keep event names under %d characters." % MAX_TITLE_LENGTH,
    )


def clean_date(raw, today, *, what="the event"):
    if not isinstance(raw, str) or not DATE.match(raw.strip()):
        raise ValidationError("Pick a date for %s." % what)
    try:
        day = date.fromisoformat(raw.strip())
    except ValueError:
        raise ValidationError("That date doesn't exist.")
    if not today - timedelta(days=366 * MAX_YEARS_PAST) <= day <= today + timedelta(days=366 * MAX_YEARS_AHEAD):
        raise ValidationError("Pick a date within the next few years.")
    return day.isoformat()


def clean_time(raw, *, what="the event"):
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not TIME.match(raw.strip()):
        raise ValidationError("Use a time like 18:30 for %s, or leave it as all day." % what)
    return raw.strip()


def clean_note(raw, *, max_length, label):
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str):
        raise ValidationError("%s must be text." % label)
    text = " ".join(raw.split())
    if not text:
        return None
    if len(text) > max_length:
        raise ValidationError("Keep %s under %d characters." % (label.lower(), max_length))
    return text


def clean_event(raw, today):
    """Validates everything about one new event, whoever ends up storing it."""
    if not isinstance(raw, dict):
        raise ValidationError("Send the event as a JSON object.")
    title = clean_title(raw.get("title"))
    day = clean_date(raw.get("date"), today)
    start = clean_time(raw.get("time"))
    finish = clean_time(raw.get("endTime"), what="the end time")
    last = clean_date(raw.get("endDate"), today, what="the last day") if raw.get("endDate") else day

    if start is None:
        finish = None
        if last < day:
            raise ValidationError("The last day can't be before the first.")
        span = (date.fromisoformat(last) - date.fromisoformat(day)).days + 1
        if span > MAX_SPAN_DAYS:
            raise ValidationError("Keep events to %d days or fewer." % MAX_SPAN_DAYS)
    else:
        # A timed event runs within its day; an end before the start is simply left off.
        last = day
        if finish is not None and finish <= start:
            finish = None
    return {
        "title": title,
        "date": day,
        "time": start,
        "endDate": last,
        "endTime": finish,
        "location": clean_note(raw.get("location"), max_length=MAX_LOCATION_LENGTH, label="Location"),
        "description": clean_note(raw.get("description"), max_length=MAX_DESCRIPTION_LENGTH, label="Notes"),
    }


def _when(event):
    return (event["date"], event["time"] or "", event["title"].casefold())


class CalendarStore(JsonStore):
    """The events the board keeps itself, in date order."""

    label = "calendar"

    # Writes

    def add(self, raw, event_id=None):
        fields = clean_event(raw, self._today())
        with self._changed:
            self._forget_old()
            if len(self._events) >= MAX_EVENTS:
                raise ValidationError("The calendar is full. Remove an event to make room.")
            event = {"id": self._new_id(event_id), **fields, "created": self._clock()}
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
        self._events = [event for event in self._events if (event["endDate"] or event["date"]) >= cutoff]

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
    finish = raw.get("endTime")
    last = raw.get("endDate")
    return {
        "id": raw["id"],
        "title": raw["title"],
        "date": raw["date"],
        "time": clock if isinstance(clock, str) and TIME.match(clock) else None,
        "endDate": last if isinstance(last, str) and DATE.match(last) and last >= raw["date"] else raw["date"],
        "endTime": finish if isinstance(finish, str) and TIME.match(finish) else None,
        "location": raw.get("location") if isinstance(raw.get("location"), str) else None,
        "description": raw.get("description") if isinstance(raw.get("description"), str) else None,
        "created": raw.get("created"),
    }


# The time zone the board is in


def local_zone(name=None):
    """The board's time zone, so calendar times read the same as the clock on the wall."""
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


def zone_name(zone):
    """The IANA name Google needs, or None when all we have is a fixed offset."""
    return getattr(zone, "key", None)


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


# Subscribed iCalendar addresses


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


class CalendarSources:
    """Everything the board reads from elsewhere: a Google account and iCalendar subscriptions.

    One background thread refreshes them; every screen gets the result over the event
    stream, the same way the shopping list arrives.
    """

    label = "calendars"

    def __init__(self, ical_sources=(), *, account=None, zone=None, feed=None,
                 fetch=fetch_text, now=time.monotonic, today=date.today):
        self._ical = list(ical_sources or [])
        self._account = account
        self._zone = zone or local_zone()
        self._feed = feed
        self._fetch = fetch
        self._now = now
        self._today = today
        self._lock = threading.Lock()
        # Held while reading the calendars, so "Sync now" can't race the background thread.
        self._refreshing = threading.Lock()
        self._version = 0
        self._calendars = []
        self._events = []
        self._updated = None
        self._reached = False
        self._trash = {}
        self._wake = threading.Event()
        self._stopped = False
        self._thread = None

    # Reads

    def snapshot(self):
        with self._lock:
            return {
                "version": self._version,
                "configured": bool(self._ical) or bool(self._account and self._account.configured),
                "account": self._account.status() if self._account else
                           {"configured": False, "linked": False, "account": None, "target": None, "pending": None},
                "calendars": copy.deepcopy(self._calendars),
                "events": copy.deepcopy(self._events),
                "updated": self._updated,
                "stale": bool(self._calendars) and not self._reached,
            }

    def writable(self):
        with self._lock:
            return [dict(c) for c in self._calendars if c.get("writable")]

    # The refresher

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="calendar-sync", daemon=True)
            self._thread.start()

    def stop(self):
        self._stopped = True
        self._wake.set()

    def refresh_soon(self):
        self._wake.set()

    def _loop(self):
        while not self._stopped:
            try:
                self.refresh()
            except Exception:  # A sync must never take the board's server down with it.
                log.exception("The calendar refresh failed")
            self._wake.wait(REFRESH_SECONDS if self._reached else RETRY_SECONDS)
            self._wake.clear()

    def refresh(self):
        """Reads every calendar once and replaces the snapshot. Safe to call from anywhere."""
        with self._refreshing:
            return self._refresh()

    def _refresh(self):
        today = self._today()
        window_end = today + timedelta(days=WINDOW_DAYS)
        calendars = []
        events = []
        self._read_google(today, window_end, calendars, events)
        self._read_ical(today, window_end, calendars, events)
        events.sort(key=lambda event: (event["date"], event["time"] or "", event["title"].casefold()))
        with self._lock:
            self._calendars = calendars
            self._events = events[:MAX_FEED_EVENTS]
            self._reached = any(entry["ok"] for entry in calendars) or not calendars
            if self._reached:
                self._updated = utc_now()
            self._version += 1
        if self._feed is not None:
            self._feed.notify()
        return self.snapshot()

    def _read_google(self, today, window_end, calendars, events):
        if not (self._account and self._account.linked):
            return
        try:
            found = self._account.calendars()
        except google.GoogleError as err:
            calendars.append({"id": None, "name": "Google Calendar", "color": COLORS[0], "kind": "google",
                              "writable": False, "ok": False, "error": str(err)})
            return
        for calendar in found:
            entry = {**calendar, "kind": "google", "ok": False, "error": None}
            try:
                raw_events = self._account.events(calendar["id"], today, window_end)
            except google.GoogleError as err:
                entry["error"] = str(err)
            else:
                entry["ok"] = True
                for raw in raw_events:
                    shaped = google.shape_event(raw, self._zone)
                    if shaped and _within(shaped, today, window_end):
                        events.append(self._as_event(shaped, "g:%s:%s" % (calendar["id"], shaped["uid"]), entry))
            calendars.append(entry)

    def _read_ical(self, today, window_end, calendars, events):
        for index, source in enumerate(self._ical):
            entry = {"id": "ical%d" % index, "name": source["name"] or "Calendar %d" % (index + 1),
                     "color": source["color"], "kind": "ical", "writable": False, "ok": False, "error": None}
            try:
                feed = ical.read_calendar(self._fetch(source["url"]))
                found = ical.occurrences(feed, window_start=today, window_end=window_end, local=self._zone)
            except (OSError, ValueError, TypeError, KeyError, IndexError):
                log.warning("Couldn't read the calendar at %s", source["url"], exc_info=True)
                entry["error"] = "Couldn't read this calendar."
            else:
                entry.update(name=source["name"] or feed["name"] or entry["name"], ok=True)
                for occurrence in found:
                    events.append(self._as_event(occurrence, "%s:%s@%s" % (entry["id"], occurrence["uid"][:48],
                                                                           occurrence["date"]), entry))
            calendars.append(entry)

    @staticmethod
    def _as_event(occurrence, event_id, entry):
        last = date.fromisoformat(occurrence["date"]) + timedelta(days=max(1, occurrence["days"]) - 1)
        return {
            "id": event_id,
            "title": occurrence["title"],
            "date": occurrence["date"],
            "time": occurrence["time"],
            "endDate": last.isoformat(),
            "endTime": occurrence["end_time"],
            "days": occurrence["days"],
            "location": occurrence.get("location"),
            "description": occurrence.get("description"),
            "calendar": entry["name"],
            "calendarId": entry["id"],
            "color": entry["color"],
            "writable": bool(entry.get("writable")),
        }

    # Writes, for the calendars that take them

    def add(self, calendar_id, raw):
        """Creates an event on a Google calendar. Returns it in the board's own shape."""
        if not (self._account and self._account.linked):
            raise ValidationError("Connect a Google account to add events to it.")
        entry = self._writable_entry(calendar_id)
        fields = clean_event(raw, self._today())
        created = self._account.insert(entry["id"], google.event_body(fields, zone_name(self._zone) or "UTC"))
        shaped = google.shape_event(created, self._zone)
        if shaped is None:
            raise ValidationError("Google saved the event but sent back something odd. It'll appear on the next sync.")
        event = self._as_event(shaped, "g:%s:%s" % (entry["id"], shaped["uid"]), entry)
        self._remember(event)
        return event

    def remove(self, event_id):
        """Deletes a Google event. Returns what it was, so it can be put back."""
        calendar_id, google_id = _split_google_id(event_id)
        if calendar_id is None:
            raise NotFound("That event isn't one the board can remove.")
        if not (self._account and self._account.linked):
            raise ValidationError("Connect a Google account to change events on it.")
        entry = self._writable_entry(calendar_id)
        with self._lock:
            was = next((copy.deepcopy(e) for e in self._events if e["id"] == event_id), None)
        self._account.delete(entry["id"], google_id)
        if was is not None:
            self._keep_for_undo(event_id, was)
        self._forget(event_id)
        return was or {"id": event_id, "title": "the event", "calendar": entry["name"]}

    def restore(self, event_ids):
        """Puts deleted Google events back. They come back with new ids, as Google gives them one."""
        restored = []
        for event_id in event_ids if isinstance(event_ids, list) else []:
            was = self._trash.pop(event_id, None)
            if was is None:
                continue
            calendar_id, _ = _split_google_id(event_id)
            try:
                restored.append(self.add(calendar_id, was))
            except (ValidationError, NotFound, google.GoogleError):
                log.warning("Couldn't put %s back on Google Calendar", event_id, exc_info=True)
        return restored

    def _writable_entry(self, calendar_id):
        with self._lock:
            writable = [c for c in self._calendars if c.get("writable")]
        if not writable:
            raise ValidationError("None of the connected calendars can be written to.")
        wanted = calendar_id or (self._account.target if self._account else None)
        return next((c for c in writable if c["id"] == wanted), writable[0])

    # Keeping the snapshot honest between refreshes, so a new event shows at once

    def _remember(self, event):
        with self._lock:
            self._events = sorted(
                [e for e in self._events if e["id"] != event["id"]] + [event],
                key=lambda e: (e["date"], e["time"] or "", e["title"].casefold()),
            )[:MAX_FEED_EVENTS]
            self._version += 1
        if self._feed is not None:
            self._feed.notify()

    def _forget(self, event_id):
        with self._lock:
            self._events = [e for e in self._events if e["id"] != event_id]
            self._version += 1
        if self._feed is not None:
            self._feed.notify()

    def _keep_for_undo(self, event_id, event):
        self._trash[event_id] = event
        while len(self._trash) > MAX_TRASH:
            self._trash.pop(next(iter(self._trash)))


def _within(occurrence, window_start, window_end):
    first = date.fromisoformat(occurrence["date"])
    return first <= window_end and first + timedelta(days=max(1, occurrence["days"]) - 1) >= window_start


def _split_google_id(event_id):
    if not isinstance(event_id, str) or not event_id.startswith("g:"):
        return None, None
    calendar_id, _, google_id = event_id[2:].partition(":")
    return (calendar_id, google_id) if calendar_id and google_id else (None, None)
