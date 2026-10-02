"""Reads iCalendar feeds (RFC 5545), the format a Google Calendar "secret address" serves.

Only what a home board needs: VEVENTs, when they happen, and the recurrence rules
Google writes for birthdays, anniversaries and holidays. Written against the spec
so the board needs no third-party packages.

Supported in RRULE: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, COUNT, UNTIL,
WKST, BYDAY (with an ordinal, as in "3SU"), BYMONTHDAY (negative counts back from
the end of the month) and BYMONTH. An event whose rule uses anything else
(BYSETPOS, BYWEEKNO, BYYEARDAY, or an hourly or finer frequency) is shown once, at
its start, rather than at guessed-wrong dates.
"""
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# A feed is expanded over a window of a few months, so these ceilings are generous
# but finite: a malformed or hostile rule can't spin the Pi or fill its memory.
MAX_STEPS = 10000
MAX_OCCURRENCES = 500
# The longest an all-day event is shown for (a year-long "event" would flood the agenda).
MAX_SPAN_DAYS = 30
# Holiday feeds put essays in DESCRIPTION; the board only ever shows a line or two.
MAX_DESCRIPTION = 500
# TZIDs seen in feeds; a handful in practice, cleared if a feed invents hundreds.
MAX_ZONE_CACHE = 64

WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
SUPPORTED_FREQUENCIES = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
UNSUPPORTED_RULE_PARTS = ("BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE", "BYSECOND")
NO_TITLE = "(No title)"

DURATION = re.compile(
    r"^(?P<sign>[+-])?P(?:(?P<weeks>\d+)W)?(?:(?P<days>\d+)D)?"
    r"(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)
BY_DAY = re.compile(r"^(?P<ordinal>[+-]?\d{1,2})?(?P<day>MO|TU|WE|TH|FR|SA|SU)$")
ESCAPES = {"n": "\n", "N": "\n", ",": ",", ";": ";", "\\": "\\"}

_zones = {}


def zone(name):
    """The named IANA time zone, or None if this machine doesn't have it."""
    if name not in _zones:
        if len(_zones) >= MAX_ZONE_CACHE:
            _zones.clear()
        try:
            _zones[name] = ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            _zones[name] = None
    return _zones[name]


# Text


def unfold(text):
    """Splits a feed into logical lines; a line starting with a space or tab continues the one before."""
    flat = text.replace("\r\n", "\n").replace("\r", "\n")
    return flat.replace("\n ", "").replace("\n\t", "").split("\n")


def unescape(value):
    """Turns the escapes iCalendar uses in text values (\\n, \\, \\; \\,) back into characters."""
    out = []
    index = 0
    while index < len(value):
        char = value[index]
        if char == "\\" and index + 1 < len(value):
            out.append(ESCAPES.get(value[index + 1], value[index + 1]))
            index += 2
        else:
            out.append(char)
            index += 1
    return "".join(out)


def _split_unquoted(text, separator):
    parts = [""]
    quoted = False
    for char in text:
        if char == '"':
            quoted = not quoted
        if char == separator and not quoted:
            parts.append("")
        else:
            parts[-1] += char
    return [part for part in parts if part]


def split_line(line):
    """'DTSTART;TZID=Europe/Paris:20261002T090000' -> ('DTSTART', {'TZID': 'Europe/Paris'}, '20261002T090000')."""
    quoted = False
    head = value = None
    for index, char in enumerate(line):
        if char == '"':
            quoted = not quoted
        elif char == ":" and not quoted:
            head, value = line[:index], line[index + 1:]
            break
    if head is None:
        return None
    name, _, raw = head.partition(";")
    params = {}
    for part in _split_unquoted(raw, ";"):
        key, _, setting = part.partition("=")
        if key.strip():
            params[key.strip().upper()] = setting.strip().strip('"')
    return name.strip().upper(), params, value


def read_calendar(text):
    """Parses a feed into {"name": <calendar name or None>, "events": [properties]}.

    Each event maps an upper-case property name to the list of (parameters, value)
    pairs it appeared with, so repeated properties such as EXDATE all survive.
    """
    name = None
    events = []
    event = None
    nested = 0
    for line in unfold(text):
        parsed = split_line(line)
        if parsed is None:
            continue
        key, params, value = parsed
        if key == "BEGIN":
            if value.strip().upper() == "VEVENT" and event is None:
                event = {}
            elif event is not None:
                nested += 1  # A VALARM inside this event; its properties aren't the event's.
            continue
        if key == "END":
            if event is not None and nested:
                nested -= 1
            elif event is not None and value.strip().upper() == "VEVENT":
                events.append(event)
                event = None
            continue
        if event is not None:
            if not nested:
                event.setdefault(key, []).append((params, value))
        elif key == "X-WR-CALNAME":
            name = unescape(value).strip()
    return {"name": name or None, "events": events}


def first(props, name, default=None):
    entries = props.get(name)
    return entries[0][1] if entries else default


# Moments


def parse_moment(value, params, local):
    """A DTSTART/DTEND/EXDATE value as a date (all-day) or as a datetime with a time zone."""
    text = value.strip()
    if params.get("VALUE", "").upper() == "DATE" or (len(text) == 8 and "T" not in text):
        return date(int(text[:4]), int(text[4:6]), int(text[6:8]))
    naive = datetime.strptime(text[:15], "%Y%m%dT%H%M%S")
    if text.endswith("Z"):
        return naive.replace(tzinfo=timezone.utc)
    # No TZID and no Z is a "floating" time: whatever the clock says where it's read.
    return naive.replace(tzinfo=zone(params.get("TZID", "")) or local)


def parse_moments(value, params, local):
    return [parse_moment(part, params, local) for part in value.split(",") if part.strip()]


def parse_duration(value):
    match = DURATION.match(value.strip())
    if not match:
        raise ValueError("not a duration: %r" % value)
    fields = {key: int(found) for key, found in match.groupdict().items() if key != "sign" and found}
    length = timedelta(
        weeks=fields.get("weeks", 0),
        days=fields.get("days", 0),
        hours=fields.get("hours", 0),
        minutes=fields.get("minutes", 0),
        seconds=fields.get("seconds", 0),
    )
    return -length if match.group("sign") == "-" else length


def moment_key(moment):
    """A comparable key for a moment, so EXDATE and RECURRENCE-ID match their occurrence."""
    if isinstance(moment, datetime):
        return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return moment.isoformat()


def event_times(props, local):
    """(start, end, all_day) for one VEVENT. `end` may be None; all-day ends are exclusive."""
    starts = props.get("DTSTART")
    if not starts:
        raise ValueError("event has no start")
    params, value = starts[0]
    start = parse_moment(value, params, local)
    all_day = not isinstance(start, datetime)
    end = None
    if props.get("DTEND"):
        end_params, end_value = props["DTEND"][0]
        end = parse_moment(end_value, end_params, local)
    elif props.get("DURATION"):
        end = start + parse_duration(first(props, "DURATION"))
    return start, end, all_day


# Recurrence


def parse_rule(value):
    parts = {}
    for chunk in value.split(";"):
        key, _, setting = chunk.partition("=")
        if key.strip():
            parts[key.strip().upper()] = setting.strip()
    return parts


def _number(value, fallback=None):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return fallback


def _values(raw):
    return [part for part in (raw or "").split(",") if part.strip()]


def _days_in_month(year, month):
    following = date(year + month // 12, month % 12 + 1, 1)
    return (following - date(year, month, 1)).days


def _month_day(year, month, day):
    """Day `day` of a month, counting back from the end if negative; None if there's no such day."""
    length = _days_in_month(year, month)
    number = day if day > 0 else length + day + 1
    return date(year, month, number) if 1 <= number <= length else None


def _weekdays_in_month(year, month, weekday):
    first_day = date(year, month, 1)
    start = 1 + (weekday - first_day.weekday()) % 7
    return [date(year, month, day) for day in range(start, _days_in_month(year, month) + 1, 7)]


def _nth_weekday(year, month, weekday, ordinal):
    found = _weekdays_in_month(year, month, weekday)
    index = ordinal - 1 if ordinal > 0 else len(found) + ordinal
    return found[index] if 0 <= index < len(found) else None


def _week_start(day, wkst):
    return day - timedelta(days=(day.weekday() - wkst) % 7)


def _first_period(freq, start, wkst):
    if freq == "WEEKLY":
        return _week_start(start, wkst)
    if freq == "MONTHLY":
        return date(start.year, start.month, 1)
    if freq == "YEARLY":
        return date(start.year, 1, 1)
    return start


def _advance(freq, period, steps):
    if freq == "DAILY":
        return period + timedelta(days=steps)
    if freq == "WEEKLY":
        return period + timedelta(weeks=steps)
    if freq == "MONTHLY":
        months = period.year * 12 + period.month - 1 + steps
        return date(months // 12, months % 12 + 1, 1)
    return date(period.year + steps, 1, 1)


def _periods_to_skip(freq, period, window_start, interval):
    """How many whole intervals can be jumped over before the window, to keep long series cheap."""
    if window_start <= period:
        return 0
    if freq == "DAILY":
        gap = (window_start - period).days
    elif freq == "WEEKLY":
        gap = (window_start - period).days // 7
    elif freq == "MONTHLY":
        gap = (window_start.year - period.year) * 12 + window_start.month - period.month
    else:
        gap = window_start.year - period.year
    # One interval of slack, so an event that started just before the window still shows.
    return max(0, gap // interval - 1)


def _month_dates(year, month, start, by_day, by_month_day):
    if by_month_day:
        days = [_month_day(year, month, day) for day in by_month_day]
    elif by_day:
        days = []
        for ordinal, weekday in by_day:
            if ordinal:
                days.append(_nth_weekday(year, month, weekday, ordinal))
            else:
                days.extend(_weekdays_in_month(year, month, weekday))
    else:
        days = [_month_day(year, month, start.day)]
    return sorted({day for day in days if day})


def _period_dates(freq, period, start, by_day, by_month_day, by_month, wkst):
    if freq == "DAILY":
        return [period]
    if freq == "WEEKLY":
        weekdays = [weekday for _ordinal, weekday in by_day] or [start.weekday()]
        return sorted(period + timedelta(days=(weekday - wkst) % 7) for weekday in set(weekdays))
    if freq == "MONTHLY":
        return _month_dates(period.year, period.month, start, by_day, by_month_day)
    dates = []
    for month in sorted(set(by_month or [start.month])):
        dates.extend(_month_dates(period.year, month, start, by_day, by_month_day))
    return sorted(dates)


def rule_dates(parts, start, window_start, window_end):
    """The dates an RRULE lands on, in order, from `start` (its DTSTART) up to `window_end`.

    Dates before `window_start` are skipped where that's safe: a rule with COUNT has
    to be walked from the beginning, because the count includes occurrences that are
    already past.
    """
    freq = parts.get("FREQ", "").upper()
    if freq not in SUPPORTED_FREQUENCIES or any(part in parts for part in UNSUPPORTED_RULE_PARTS):
        return [start]
    interval = max(1, _number(parts.get("INTERVAL"), 1) or 1)
    count = _number(parts.get("COUNT"))
    until = _until(parts.get("UNTIL"))
    wkst = WEEKDAYS.index(parts["WKST"].upper()) if parts.get("WKST", "").upper() in WEEKDAYS else 0
    by_day = []
    for value in _values(parts.get("BYDAY")):
        match = BY_DAY.match(value.strip().upper())
        if match:
            by_day.append((_number(match.group("ordinal"), 0) or 0, WEEKDAYS.index(match.group("day"))))
    by_month_day = [day for day in (_number(value) for value in _values(parts.get("BYMONTHDAY"))) if day]
    by_month = [m for m in (_number(value) for value in _values(parts.get("BYMONTH"))) if m and 1 <= m <= 12]

    period = _first_period(freq, start, wkst)
    skipped = 0 if count else _periods_to_skip(freq, period, window_start, interval)
    period = _advance(freq, period, skipped * interval)

    dates = []
    seen = 0
    for _ in range(MAX_STEPS):
        done = False
        for day in _period_dates(freq, period, start, by_day, by_month_day, by_month, wkst):
            if day < start:
                continue
            seen += 1
            if (until and day > until) or (count is not None and seen > count) or day > window_end:
                done = True
                break
            if day >= window_start:
                dates.append(day)
        if done or len(dates) >= MAX_OCCURRENCES:
            break
        period = _advance(freq, period, interval)
        # Every later date is on or after the period's first day, so nothing is lost.
        if period > window_end:
            break
    return dates


def _until(value):
    """UNTIL as a date. Comparing whole days can keep one last occurrence on the final day."""
    if not value:
        return None
    text = value.strip()
    if len(text) < 8:
        return None
    try:
        return date(int(text[:4]), int(text[4:6]), int(text[6:8]))
    except ValueError:
        return None


# Occurrences


def _length(start, end, all_day):
    """(days, minutes): how many days an all-day event covers, or how long a timed one runs."""
    if all_day:
        days = (end - start).days if isinstance(end, date) and not isinstance(end, datetime) else 1
        return max(1, min(days, MAX_SPAN_DAYS)), 0
    if isinstance(end, datetime) and end > start:
        return 1, int((end - start).total_seconds() // 60)
    return 1, 0


def _at(day, start, all_day):
    """The same event on another day, keeping its wall-clock time and time zone."""
    return day if all_day else datetime.combine(day, start.timetz())


def _describe(uid, title, location, description, moment, days, minutes, all_day, local):
    if all_day:
        day, clock, finish = moment, None, None
    else:
        here = moment.astimezone(local)
        day = here.date()
        clock = here.strftime("%H:%M")
        ends = here + timedelta(minutes=minutes) if minutes else None
        # An end time is only worth showing when it's on the same day as the start.
        finish = ends.strftime("%H:%M") if ends and ends.date() == day else None
    return {
        "uid": uid,
        "title": title,
        "date": day.isoformat(),
        "time": clock,
        "end_time": finish,
        "days": days,
        "location": location,
        "description": description,
    }


def _in_window(occurrence, days, window_start, window_end):
    first_day = date.fromisoformat(occurrence["date"])
    return first_day <= window_end and first_day + timedelta(days=days - 1) >= window_start


def _exceptions(props, local):
    keys = set()
    for params, value in props.get("EXDATE", []):
        try:
            keys.update(moment_key(moment) for moment in parse_moments(value, params, local))
        except (ValueError, TypeError):
            continue
    return keys


def _event_occurrences(uid, props, overrides, window_start, window_end, local, recurring=True):
    if (first(props, "STATUS", "") or "").strip().upper() == "CANCELLED":
        return []
    try:
        start, end, all_day = event_times(props, local)
    except (ValueError, TypeError, KeyError, IndexError):
        return []
    days, minutes = _length(start, end, all_day)
    title = unescape(first(props, "SUMMARY", "") or "").strip() or NO_TITLE
    location = unescape(first(props, "LOCATION", "") or "").strip() or None
    description = unescape(first(props, "DESCRIPTION", "") or "").strip()[:MAX_DESCRIPTION] or None

    first_day = start if all_day else start.date()
    moments = [start]
    rule = first(props, "RRULE") if recurring else None
    if rule:
        # A multi-day event that began before the window is still happening during it.
        from_day = window_start - timedelta(days=days - 1)
        try:
            moments = [_at(day, start, all_day) for day in rule_dates(parse_rule(rule), first_day, from_day, window_end)]
        except (ValueError, TypeError, OverflowError):
            moments = [start]
    if recurring:
        for params, value in props.get("RDATE", []):
            if params.get("VALUE", "").upper() == "PERIOD":
                continue  # A start/end pair rather than a start; rare, and not worth guessing at.
            try:
                moments.extend(parse_moments(value, params, local))
            except (ValueError, TypeError):
                continue

    skip = _exceptions(props, local)
    found = []
    for moment in moments:
        key = moment_key(moment)
        if key in skip or (recurring and (uid, key) in overrides):
            continue
        occurrence = _describe(uid, title, location, description, moment, days, minutes, all_day, local)
        if _in_window(occurrence, days, window_start, window_end):
            found.append(occurrence)
    return found


def occurrences(calendar, *, window_start, window_end, local, limit=MAX_OCCURRENCES):
    """Every time an event in a parsed feed happens between two dates, in order.

    `local` is the time zone the board is in: timed events come back as local
    wall-clock values, so the board and the phones in the house agree on them.
    Each occurrence is {"uid", "title", "date", "time", "end_time", "days", "location"},
    where "time" is None for an all-day event.
    """
    masters = []
    overrides = {}
    for props in calendar["events"]:
        uid = (first(props, "UID", "") or "").strip()
        recurrence_id = props.get("RECURRENCE-ID")
        if not recurrence_id:
            masters.append((uid, props))
            continue
        # A single moved or edited instance of a series: it replaces that one date.
        params, value = recurrence_id[0]
        try:
            overrides[(uid, moment_key(parse_moment(value, params, local)))] = props
        except (ValueError, TypeError):
            continue

    found = []
    for uid, props in masters:
        found.extend(_event_occurrences(uid, props, overrides, window_start, window_end, local))
    for (uid, _key), props in overrides.items():
        found.extend(_event_occurrences(uid, props, overrides, window_start, window_end, local, recurring=False))
    found.sort(key=lambda occurrence: (occurrence["date"], occurrence["time"] or "", occurrence["title"]))
    return found[:limit]
