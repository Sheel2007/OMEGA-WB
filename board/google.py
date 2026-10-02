"""Google Calendar over its REST API: reading, and writing events back.

Signing in uses the installed-app (loopback) flow, because Google's device flow
doesn't allow Calendar scopes. The board's own browser runs on the Pi, so Google
can send the user straight back to this server at 127.0.0.1; anyone signing in
from a phone pastes the address they land on instead.

Only the standard library: the OAuth dance and the API are plain HTTPS and JSON.
"""
import json
import logging
import os
import secrets
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

log = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API_URL = "https://www.googleapis.com/calendar/v3"
# Read everything on the account (so Birthdays and Holidays show up), write events.
SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events"

TIMEOUT_SECONDS = 20
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_EVENTS_PER_CALENDAR = 250
MAX_CALENDARS = 25
# An access token lasts an hour; refresh a little early rather than on a 401.
TOKEN_MARGIN_SECONDS = 120
# How long a half-finished sign-in stays valid.
LINK_TIMEOUT_SECONDS = 10 * 60
# Google colours its calendars; these are the board's own names for them.
PALETTE = ("blue", "purple", "teal", "pink", "orange", "green")


class GoogleError(Exception):
    """Something went wrong talking to Google, with a message that's fine to show people."""


def request_json(method, url, *, headers=None, form=None, body=None):
    data = None
    headers = dict(headers or {})
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as err:
        detail = err.read(MAX_RESPONSE_BYTES)
        raise GoogleError(_explain(err.code, detail)) from err
    except OSError as err:
        raise GoogleError("Can't reach Google right now.") from err
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError as err:
        raise GoogleError("Google sent something this board couldn't read.") from err


def _explain(status, detail):
    try:
        message = json.loads(detail.decode("utf-8")).get("error", {})
        message = message.get("message") if isinstance(message, dict) else str(message)
    except (ValueError, AttributeError):
        message = None
    if status in (401, 403):
        return message or "Google turned the board away. Try connecting the account again."
    if status == 404:
        return message or "That calendar or event is no longer on the account."
    if status == 429:
        return "Google is rate-limiting the board. It'll try again shortly."
    return message or "Google returned an error (%d)." % status


class GoogleAccount:
    """The linked Google account: its tokens, which calendars it has, and its events."""

    def __init__(self, client_id=None, client_secret=None, token_path=None, *,
                 transport=request_json, now=time.monotonic, clock=None):
        self._client_id = client_id or None
        self._client_secret = client_secret or None
        self._token_path = token_path
        self._transport = transport
        self._now = now
        self._clock = clock or (lambda: datetime.now().isoformat(timespec="seconds"))
        self._access = None
        self._access_until = 0
        self._pending = None
        self._saved = self._load()

    # State

    @property
    def configured(self):
        return bool(self._client_id and self._client_secret)

    @property
    def linked(self):
        return bool(self._saved.get("refresh_token"))

    @property
    def target(self):
        return self._saved.get("target") or "primary"

    def status(self):
        pending = None
        if self._pending and self._now() < self._pending["expires"]:
            pending = {"url": self._pending["url"], "waiting": True}
        return {
            "configured": self.configured,
            "linked": self.linked,
            "account": self._saved.get("account"),
            "target": self.target if self.linked else None,
            "pending": pending,
        }

    # Signing in

    def begin_link(self, redirect_uri):
        if not self.configured:
            raise GoogleError("Add your Google client ID and secret to config.json first.")
        state = secrets.token_urlsafe(16)
        url = "%s?%s" % (AUTH_URL, urllib.parse.urlencode({
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPES,
            # offline + consent is what makes Google hand over a refresh token.
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }))
        self._pending = {"state": state, "redirect_uri": redirect_uri, "url": url,
                         "expires": self._now() + LINK_TIMEOUT_SECONDS}
        return {"url": url, "state": state}

    def finish_link(self, code, state):
        if not isinstance(code, str) or not code.strip():
            raise GoogleError("That sign-in didn't come back with a code. Start again.")
        if not self._pending or self._now() >= self._pending["expires"]:
            raise GoogleError("That sign-in took too long. Start again.")
        if not secrets.compare_digest(str(state or ""), self._pending["state"]):
            raise GoogleError("That sign-in didn't come from this board. Start again.")
        tokens = self._transport("POST", TOKEN_URL, form={
            "code": code.strip(),
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "redirect_uri": self._pending["redirect_uri"],
            "grant_type": "authorization_code",
        })
        refresh = tokens.get("refresh_token")
        if not refresh:
            raise GoogleError("Google didn't give the board a lasting sign-in. Remove the board from your "
                              "Google account's third-party apps, then connect again.")
        self._hold(tokens)
        self._pending = None
        self._save({"refresh_token": refresh, "target": self._saved.get("target"), "linked": self._clock()})
        try:
            primary = next((c for c in self.calendars() if c["primary"]), None)
        except GoogleError:
            primary = None
        if primary:
            self._save({**self._saved, "account": primary["name"], "target": self._saved.get("target") or primary["id"]})
        return self.status()

    def unlink(self):
        self._access = None
        self._access_until = 0
        self._pending = None
        self._save({})
        if self._token_path and os.path.exists(self._token_path):
            try:
                os.remove(self._token_path)
            except OSError:
                log.warning("Couldn't delete %s", self._token_path, exc_info=True)
        return self.status()

    def set_target(self, calendar_id):
        if not self.linked:
            raise GoogleError("Connect a Google account first.")
        if not isinstance(calendar_id, str) or not calendar_id.strip():
            raise GoogleError("Pick a calendar for new events.")
        self._save({**self._saved, "target": calendar_id.strip()})
        return self.status()

    # Calendars and events

    def calendars(self):
        found = self._api("GET", "/users/me/calendarList", params={"maxResults": MAX_CALENDARS,
                                                                   "minAccessRole": "reader"})
        calendars = []
        for index, raw in enumerate(found.get("items", [])[:MAX_CALENDARS]):
            if raw.get("deleted") or raw.get("hidden"):
                continue
            calendars.append({
                "id": raw.get("id"),
                "name": raw.get("summaryOverride") or raw.get("summary") or "Calendar",
                "color": PALETTE[index % len(PALETTE)],
                "writable": raw.get("accessRole") in ("owner", "writer"),
                "primary": bool(raw.get("primary")),
            })
        return [c for c in calendars if c["id"]]

    def events(self, calendar_id, window_start, window_end):
        found = self._api("GET", "/calendars/%s/events" % urllib.parse.quote(calendar_id, safe=""), params={
            # Google expands repeating events itself, so birthdays arrive on the right dates.
            "singleEvents": "true",
            "orderBy": "startTime",
            "showDeleted": "false",
            "maxResults": MAX_EVENTS_PER_CALENDAR,
            "timeMin": _rfc3339(window_start),
            "timeMax": _rfc3339(window_end + timedelta(days=1)),
        })
        return found.get("items", [])

    def insert(self, calendar_id, body):
        return self._api("POST", "/calendars/%s/events" % urllib.parse.quote(calendar_id, safe=""), body=body)

    def delete(self, calendar_id, event_id):
        self._api("DELETE", "/calendars/%s/events/%s" % (
            urllib.parse.quote(calendar_id, safe=""), urllib.parse.quote(event_id, safe="")))

    # Internals

    def _api(self, method, path, *, params=None, body=None, retry=True):
        url = API_URL + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        try:
            return self._transport(method, url, headers={"Authorization": "Bearer %s" % self._token()}, body=body)
        except GoogleError:
            if not retry:
                raise
            # The token may have been revoked or expired early; get a fresh one and try once more.
            self._access = None
            self._access_until = 0
            return self._api(method, path, params=params, body=body, retry=False)

    def _token(self):
        if not self.linked:
            raise GoogleError("Connect a Google account first.")
        if self._access and self._now() < self._access_until:
            return self._access
        tokens = self._transport("POST", TOKEN_URL, form={
            "refresh_token": self._saved["refresh_token"],
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "grant_type": "refresh_token",
        })
        if not tokens.get("access_token"):
            raise GoogleError("Google wouldn't renew the board's sign-in. Connect the account again.")
        self._hold(tokens)
        return self._access

    def _hold(self, tokens):
        self._access = tokens.get("access_token")
        lifetime = tokens.get("expires_in")
        lifetime = int(lifetime) if isinstance(lifetime, (int, float, str)) and str(lifetime).isdigit() else 3600
        self._access_until = self._now() + max(60, lifetime - TOKEN_MARGIN_SECONDS)

    def _load(self):
        if not self._token_path or not os.path.exists(self._token_path):
            return {}
        try:
            with open(self._token_path, encoding="utf-8") as f:
                saved = json.load(f)
            return saved if isinstance(saved, dict) else {}
        except (OSError, ValueError):
            log.warning("Couldn't read %s; the Google account will need connecting again.", self._token_path)
            return {}

    def _save(self, saved):
        self._saved = saved
        if not self._token_path:
            return
        folder = os.path.dirname(os.path.abspath(self._token_path))
        try:
            os.makedirs(folder, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=folder, prefix=".google-", suffix=".tmp")
            # The refresh token is a key to the account: nobody else on the Pi gets to read it.
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(saved, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._token_path)
        except OSError:
            log.exception("Couldn't save the Google sign-in to %s", self._token_path)


def _rfc3339(day):
    return datetime(day.year, day.month, day.day).isoformat() + "Z"


# Turning Google's events into the board's own shape, and back


def _moment(part, local):
    """A Google start/end as (date, 'HH:MM' or None)."""
    if not isinstance(part, dict):
        return None, None
    if part.get("date"):
        return date.fromisoformat(part["date"]), None
    stamp = part.get("dateTime")
    if not stamp:
        return None, None
    moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if moment.tzinfo is not None:
        moment = moment.astimezone(local)
    return moment.date(), moment.strftime("%H:%M")


def shape_event(raw, local):
    """One Google event as the board's {title, date, time, end_time, days, location, description}."""
    start_day, start_time = _moment(raw.get("start"), local)
    if start_day is None:
        return None
    end_day, end_time = _moment(raw.get("end"), local)
    if start_time is None:
        # All-day ends are exclusive in both Google's API and iCalendar.
        days = max(1, (end_day - start_day).days) if end_day else 1
    else:
        days = 1
        if end_day != start_day:
            end_time = None
    return {
        "uid": raw.get("id") or "",
        "title": (raw.get("summary") or "").strip() or "(No title)",
        "date": start_day.isoformat(),
        "time": start_time,
        "end_time": end_time if end_time != start_time else None,
        "days": days,
        "location": (raw.get("location") or "").strip() or None,
        "description": (raw.get("description") or "").strip() or None,
    }


def event_body(event, time_zone):
    """The board's own event as the JSON Google's events.insert wants."""
    body = {"summary": event["title"]}
    if event.get("location"):
        body["location"] = event["location"]
    if event.get("description"):
        body["description"] = event["description"]
    if event.get("time"):
        finish = event.get("endTime") or _plus_hour(event["time"])
        body["start"] = {"dateTime": "%sT%s:00" % (event["date"], event["time"]), "timeZone": time_zone}
        body["end"] = {"dateTime": "%sT%s:00" % (event["date"], finish), "timeZone": time_zone}
    else:
        last = date.fromisoformat(event.get("endDate") or event["date"])
        body["start"] = {"date": event["date"]}
        # Google's all-day end is the morning after the last day.
        body["end"] = {"date": (last + timedelta(days=1)).isoformat()}
    return body


def _plus_hour(clock):
    hours, minutes = (int(part) for part in clock.split(":"))
    return "%02d:%02d" % ((hours + 1) % 24, minutes) if hours < 23 else "23:59"
