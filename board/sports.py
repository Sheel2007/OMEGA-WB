"""Sports: fixtures, live scores, tables and match pages for the teams the board follows.

The board follows Arsenal, Tottenham and Chelsea (Premier League, FA Cup, League
Cup and Champions League), Maryland's soccer team in the Big Ten, and every Champions
League match. None of it needs an account:

- ESPN's public scoreboard API (site.api.espn.com) has the fixtures, live scores,
  line-ups, match stats and the Premier League and Champions League tables. It's
  unofficial and undocumented, so everything read from it is checked and shaped
  into the board's own small format here: if ESPN changes something, the widget
  shows less, never an error page.
- ESPN keeps no table for college soccer, so the Big Ten's is read from the
  standings page on bigten.org.

One background thread reads it all and pushes it over the event stream: the
schedules every hour and the tables every few hours (and again just after a
followed match ends), and while a followed match is on, its league's scoreboard
every 30 seconds. A match page (line-ups, timeline, stats) is ESPN's match
summary, fetched when a screen opens it and kept fresh by the same thread while
the match is on, so screens never ask ESPN anything themselves. For the English
competitions and the Champions League, the same read adds FotMob's extras to the
page (board/fotmob.py: the referee's record, predicted line-ups, injuries, player
ratings and stats, form and head-to-head). Crests come only from ESPN's image
server, only for teams the board has shown, and are kept in memory.

Only the standard library.
"""
import copy
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

from .fotmob import merge as add_fotmob

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover - every Python the board runs on has zoneinfo
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

log = logging.getLogger(__name__)

SITE_API = "https://site.api.espn.com/apis/site/v2/sports/soccer/"
STANDINGS_API = "https://site.api.espn.com/apis/v2/sports/soccer/"
BIG_TEN_URL = "https://bigten.org/sports/%s/standings"
# ESPN's image server, asked for a small copy of the 500px crest.
CREST_URL = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/%s/500/%s.png&w=%d&h=%d"
CREST_HREF = re.compile(r"^https://a\.espncdn\.com/i/teamlogos/(soccer|ncaa)/500(?:-dark)?/(\d{1,7})\.png$")
CREST_ID = re.compile(r"^(soccer|ncaa):(\d{1,7})$")
CREST_PIXELS = 160
MATCH_ID = re.compile(r"^\d{1,12}$")
HEX_COLOR = re.compile(r"^[0-9a-fA-F]{6}$")
# bigten.org turns away requests that don't look like a browser.
USER_AGENT = "Mozilla/5.0 (X11; Linux aarch64) WidgetBoard/1.0"

TIMEOUT_SECONDS = 20
# A match summary is about 450KB and the Big Ten page about 430KB.
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_CREST_BYTES = 256 * 1024
# Crests kept in memory (each 5-15KB), and crests the board will fetch on request.
MAX_CRESTS = 96
MAX_KNOWN_CRESTS = 400
# A screen asks for every crest on a page at once: fetch a few side by side.
CREST_FETCHES = 6
# Match pages kept (each 10-20KB once shaped).
MAX_DETAILS = 24
MAX_MATCHES = 150
MAX_EVENTS = 120
MAX_TABLE_ROWS = 60
MAX_TEXT = 120

# How often to read things.
SCHEDULE_SECONDS = 60 * 60
TABLE_SECONDS = 3 * 60 * 60
LIVE_POLL_SECONDS = 30
ERROR_POLL_SECONDS = 5 * 60
MIN_POLL_SECONDS = 10
# A match is "on" from shortly before kickoff until ESPN says it's over, or this
# long after kickoff in case it never does.
LIVE_LEAD_SECONDS = 15 * 60
MATCH_LONGEST_SECONDS = 4 * 60 * 60
# Line-ups come out about an hour before kickoff; a followed team's match page is
# read every few minutes from then on, so the line-up is there when it is.
LINEUP_LEAD_SECONDS = 75 * 60
# Tables change once a match ends; ESPN takes a few minutes to catch up.
TABLE_AFTER_FINAL_SECONDS = (3 * 60, 25 * 60)
# How old a match page may be before it's read again, by how the match stands.
DETAIL_LIVE_SECONDS = 60
DETAIL_SOON_SECONDS = 5 * 60
DETAIL_LATER_SECONDS = 60 * 60
DETAIL_JUST_FINISHED_SECONDS = 15 * 60
DETAIL_FINISHED_SECONDS = 7 * 24 * 60 * 60
JUST_FINISHED_SECONDS = 3 * 60 * 60
# A match page someone has opened is kept live this long after they last asked.
WATCH_SECONDS = 10 * 60
# Which matches are kept: a team's results for a month and fixtures for ten weeks;
# for a whole competition, the days around today.
KEEP_PAST_DAYS = 30
KEEP_AHEAD_DAYS = 70
COMPETITION_DAYS = range(-2, 8)

# ESPN files a match under the day it is in the US East (an 8pm Eastern kickoff is
# that day, not the next one in UTC), so the scoreboard is asked for that day.
try:
    ESPN_ZONE = ZoneInfo("America/New_York") if ZoneInfo else timezone(timedelta(hours=-5))
except (ZoneInfoNotFoundError, ValueError, OSError):
    ESPN_ZONE = timezone(timedelta(hours=-5))

# What the board follows.
ENGLISH_LEAGUES = ("eng.1", "eng.fa", "eng.league_cup", "uefa.champions")
TEAMS = (
    {"id": "arsenal", "name": "Arsenal", "espn": "359", "leagues": ENGLISH_LEAGUES, "table": "eng.1"},
    {"id": "tottenham", "name": "Tottenham", "espn": "367", "leagues": ENGLISH_LEAGUES, "table": "eng.1"},
    {"id": "chelsea", "name": "Chelsea", "espn": "363", "leagues": ENGLISH_LEAGUES, "table": "eng.1"},
)
# Maryland's men's or women's team ("maryland" in config.json; men's unless it says otherwise).
MARYLAND = {
    "men": {"id": "maryland", "name": "Maryland", "espn": "5617", "leagues": ("usa.ncaa.m.1",), "table": "big-ten"},
    "women": {"id": "maryland", "name": "Maryland", "espn": "20341", "leagues": ("usa.ncaa.w.1",), "table": "big-ten"},
}
BIG_TEN_SPORT = {"men": "msoc", "women": "wsoc"}
# Every match of these, not just the teams' own.
COMPETITIONS = ({"id": "ucl", "name": "Champions League", "league": "uefa.champions", "table": "uefa.champions"},)
LEAGUES = {
    "eng.1": {"name": "Premier League", "table": "eng.1"},
    "eng.fa": {"name": "FA Cup", "table": None},
    "eng.league_cup": {"name": "League Cup", "table": None},
    "uefa.champions": {"name": "Champions League", "table": "uefa.champions"},
    "usa.ncaa.m.1": {"name": "College Soccer", "table": "big-ten", "conference": "Big Ten"},
    "usa.ncaa.w.1": {"name": "College Soccer", "table": "big-ten", "conference": "Big Ten"},
}


STATE_ORDER = {"pre": 0, "in": 1, "post": 2}


class SportsUnavailable(Exception):
    """ESPN or the Big Ten couldn't be reached or sent something unreadable."""


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as err:
        raise SportsUnavailable("The sports service answered %d." % err.code) from err
    except OSError as err:
        raise SportsUnavailable("Can't reach the sports service right now.") from err
    if len(data) > MAX_RESPONSE_BYTES:
        raise SportsUnavailable("The sports service sent more than the board will read.")
    return data


def fetch_image(url):
    """A crest's bytes and content type, or None if it can't be had."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            content_type = response.headers.get_content_type()
            data = response.read(MAX_CREST_BYTES + 1)
    except OSError:
        log.info("Couldn't fetch the crest at %s", url)
        return None
    if not content_type.startswith("image/") or len(data) > MAX_CREST_BYTES:
        return None
    return data, content_type


def follows_from(config):
    """What to follow, from the "sports" setting in config.json.

    Left out, the board follows everything above with Maryland's men's team;
    {"maryland": "women"} follows the women's team instead, and false turns
    Sports off.
    """
    if config is False:
        return Follows(teams=(), competitions=(), big_ten=None)
    settings = config if isinstance(config, dict) else {}
    which = settings.get("maryland", "men")
    if which not in MARYLAND:
        log.warning("Ignoring sports maryland %r in config.json; following the men's team.", which)
        which = "men"
    return Follows(teams=TEAMS + (MARYLAND[which],), competitions=COMPETITIONS, big_ten=BIG_TEN_SPORT[which])


class Follows:
    """The teams and competitions the board follows, and the tables that go with them."""

    def __init__(self, teams=TEAMS + (MARYLAND["men"],), competitions=COMPETITIONS, big_ten="msoc"):
        self.teams = tuple(teams)
        self.competitions = tuple(competitions)
        self.big_ten = big_ten
        tables = OrderedDict()
        for follow in self.teams + self.competitions:
            leagues = follow.get("leagues") or (follow["league"],)
            for table in [follow.get("table")] + [LEAGUES.get(league, {}).get("table") for league in leagues]:
                if table and table not in tables and (table != "big-ten" or big_ten):
                    tables[table] = table
        self.tables = tuple(tables)

    def public(self):
        """What screens are told about each follow."""
        out = [{"id": t["id"], "name": t["name"], "kind": "team", "team": t["espn"], "table": t.get("table")}
               for t in self.teams]
        out += [{"id": c["id"], "name": c["name"], "kind": "competition", "team": None, "table": c.get("table")}
                for c in self.competitions]
        return out


TABLE_NAMES = {"eng.1": "Premier League", "uefa.champions": "Champions League", "big-ten": "Big Ten"}


# Reading ESPN's answers


def _text(value, limit=MAX_TEXT):
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text[:limit] or None


def _int(value):
    """A whole number from ESPN's 2, 2.0, "2", "+2" or "2.0", or None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    if isinstance(value, str):
        try:
            return int(round(float(value.strip())))
        except ValueError:
            return None
    return None


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().rstrip("%"))
        except ValueError:
            return None
    return None


def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def kickoff_ms(value):
    """ESPN's "2026-10-10T11:30Z" as ms since the epoch, or None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def espn_day(seconds):
    """The scoreboard day (YYYYMMDD) a moment falls on, as ESPN counts days."""
    return datetime.fromtimestamp(seconds, ESPN_ZONE).strftime("%Y%m%d")


def crest_of(team):
    """The board's id for a team's crest ("soccer:359"), or None."""
    hrefs = [team.get("logo")] + [logo.get("href") for logo in _list(team.get("logos")) if isinstance(logo, dict)]
    for href in hrefs:
        found = CREST_HREF.match(href) if isinstance(href, str) else None
        if found:
            return "%s:%s" % found.groups()
    return None


def shape_team(team):
    team = _dict(team)
    name = _text(team.get("location")) or _text(team.get("displayName")) or _text(team.get("name")) or "TBD"
    color = team.get("color")
    return {
        "id": _text(str(team.get("id"))) if team.get("id") is not None else None,
        "name": name,
        "short": _text(team.get("shortDisplayName")) or name,
        "abbr": _text(team.get("abbreviation"), 6) or name[:3].upper(),
        "crest": crest_of(team),
        "color": color.lower() if isinstance(color, str) and HEX_COLOR.match(color) else None,
    }


def shape_status(status):
    status = _dict(status)
    kind = _dict(status.get("type"))
    state = kind.get("state") if kind.get("state") in ("pre", "in", "post") else "pre"
    return {
        "state": state,
        "name": _text(kind.get("name")) or "STATUS_SCHEDULED",
        "detail": _text(kind.get("shortDetail")) or _text(kind.get("detail")) or "",
        "clock": _text(status.get("displayClock"), 12) if state == "in" else None,
        "period": _int(status.get("period")) or 0,
        "completed": bool(kind.get("completed")),
    }


def _scores(competitor):
    """(score, penalty shootout score) for one side, either of which may be None."""
    score = competitor.get("score")
    shootout = competitor.get("shootoutScore")
    if isinstance(score, dict):
        shootout = score.get("shootoutScore", shootout)
        score = score.get("value", score.get("displayValue"))
    return _int(score), _int(shootout)


def _sides(competition):
    found = {}
    for competitor in _list(competition.get("competitors")):
        if isinstance(competitor, dict) and competitor.get("homeAway") in ("home", "away"):
            found[competitor["homeAway"]] = competitor
    return found.get("home"), found.get("away")


def shape_match(event, league):
    """One ESPN event (from a schedule or a scoreboard) as the board's match, or None."""
    if not isinstance(event, dict) or not MATCH_ID.match(str(event.get("id", ""))):
        return None
    competition = _dict((_list(event.get("competitions")) or [None])[0])
    home, away = _sides(competition)
    kickoff = kickoff_ms(event.get("date") or competition.get("date"))
    if home is None or away is None or kickoff is None:
        return None
    status = shape_status(competition.get("status") or event.get("status"))
    info = LEAGUES.get(league, {})
    name = info.get("name") or _text(_dict(event.get("league")).get("abbreviation")) or "Match"
    sides = {}
    for side, competitor in (("home", home), ("away", away)):
        team = shape_team(competitor.get("team"))
        score, shootout = _scores(competitor)
        team["score"] = None if status["state"] == "pre" else score
        team["shootout"] = shootout
        team["winner"] = bool(competitor.get("winner"))
        sides[side] = team
    notes = [_text(_dict(note).get("headline")) for note in _list(competition.get("notes"))]
    venue = _dict(competition.get("venue"))
    return {
        "id": str(event["id"]),
        "league": league,
        "competition": name,
        "table": info.get("table"),
        "kickoff": kickoff,
        "status": status,
        "home": sides["home"],
        "away": sides["away"],
        "note": next((note for note in notes if note), None),
        "venue": _text(venue.get("fullName")),
        "follows": [],
        "detail": 0,
    }


def _event_league(event, fallback):
    slug = _dict(event.get("league")).get("slug")
    return slug if isinstance(slug, str) and slug else fallback


# Tables


def _zone_level(label, levels):
    """Which colour a table note gets: 1, 2, 3 for the places worth reaching, "down" for the drop."""
    lowered = label.lower()
    if "relegat" in lowered or "eliminat" in lowered:
        return "down"
    if label not in levels:
        levels[label] = min(3, len(levels) + 1)
    return levels[label]


def shape_espn_table(raw, table_id):
    """ESPN's standings for one competition, or None if there are none."""
    raw = _dict(raw)
    children = _list(raw.get("children")) or ([raw] if raw.get("standings") else [])
    groups = []
    levels = {}
    for child in children[:16]:
        child = _dict(child)
        rows = []
        for index, entry in enumerate(_list(_dict(child.get("standings")).get("entries"))[:MAX_TABLE_ROWS]):
            entry = _dict(entry)
            stats = {s.get("name"): s for s in _list(entry.get("stats")) if isinstance(s, dict)}

            def stat(name):
                found = stats.get(name) or {}
                value = _int(found.get("value"))
                return value if value is not None else _int(found.get("displayValue"))

            note = _dict(entry.get("note"))
            label = _text(note.get("description"))
            rows.append({
                "rank": stat("rank") or index + 1,
                "team": shape_team(entry.get("team")),
                "played": stat("gamesPlayed"),
                "won": stat("wins"),
                "drawn": stat("ties"),
                "lost": stat("losses"),
                "for": stat("pointsFor"),
                "against": stat("pointsAgainst"),
                "diff": stat("pointDifferential"),
                "points": stat("points"),
                "zone": {"label": label, "level": _zone_level(label, levels)} if label else None,
            })
        if rows:
            rows.sort(key=lambda row: row["rank"])
            groups.append({"name": _text(child.get("name")) or "", "rows": rows})
    if not groups:
        return None
    return {"id": table_id, "name": TABLE_NAMES.get(table_id, _text(raw.get("name")) or table_id),
            "kind": "league", "groups": groups}


class _StandingsPage(HTMLParser):
    """The first standings table on a Sidearm (bigten.org) page: its desktop columns only.

    Each cell is there twice, once for wide screens (hide-on-medium-down) and once
    for phones (hide-on-large); the wide one has every column.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.headers = []
        self.rows = []
        self._depth = 0
        self._in_table = False
        self._done = False
        self._section = None
        self._cell = None
        self._row = None

    @staticmethod
    def _classes(attrs):
        return (dict(attrs).get("class") or "").split()

    def handle_starttag(self, tag, attrs):
        if self._done:
            return
        if tag == "table" and not self._in_table and "sidearm-standings-table" in self._classes(attrs):
            self._in_table = True
            self._depth = 1
            return
        if not self._in_table:
            return
        if tag == "table":
            self._depth += 1
        elif tag in ("thead", "tbody"):
            self._section = tag
        elif tag == "tr" and self._section == "tbody":
            self._row = []
        elif tag in ("th", "td") and "hide-on-medium-down" in self._classes(attrs):
            self._cell = []

    def handle_endtag(self, tag):
        if not self._in_table or self._done:
            return
        if tag == "table":
            self._depth -= 1
            if self._depth == 0:
                self._done = True
        elif tag in ("th", "td") and self._cell is not None:
            text = " ".join("".join(self._cell).split())
            if tag == "th" and self._section == "thead":
                self.headers.append(text.upper())
            elif self._row is not None:
                self._row.append(text)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


RECORD = re.compile(r"^(\d+)-(\d+)(?:-(\d+))?$")


def parse_big_ten(page):
    """The Big Ten standings on bigten.org, as table rows (no crests yet), or None."""
    parser = _StandingsPage()
    try:
        parser.feed(page)
        parser.close()
    except Exception:  # A page that's changed beyond reading is "no table", not a crash.
        log.info("Couldn't read the Big Ten standings page", exc_info=True)
        return None

    def column(name):
        return parser.headers.index(name) if name in parser.headers else None

    team_at, points_at, conf_at = column("TEAM"), column("PTS"), column("CONF")
    overall_at, streak_at = column("OVR"), column("STRK")
    if team_at is None or conf_at is None:
        return None
    rows = []
    for cells in parser.rows[:MAX_TABLE_ROWS]:
        def cell(at):
            return cells[at] if at is not None and at < len(cells) else ""

        record = RECORD.match(cell(conf_at))
        name = _text(cell(team_at), 60)
        if not name or not record:
            continue
        won, lost, drawn = (int(part) if part else 0 for part in record.groups())
        points = _int(cell(points_at))
        rows.append({
            "rank": len(rows) + 1,
            "team": {"id": None, "name": name, "short": name, "abbr": name[:3].upper(), "crest": None, "color": None},
            "played": won + lost + drawn,
            "won": won,
            "drawn": drawn,
            "lost": lost,
            "for": None,
            "against": None,
            "diff": None,
            "points": points if points is not None else won * 3 + drawn,
            "overall": _text(cell(overall_at), 12),
            "streak": _text(cell(streak_at), 6),
            "zone": None,
        })
    return rows or None


# Match pages


DEPTHS = (
    (("G", "GK"), 0),
    (("LWB", "RWB", "WB"), 1.5),
    (("CD", "CB", "D", "SW", "LB", "RB"), 1),
    (("DM", "CDM"), 2),
    (("AM", "CAM"), 3),
    (("LW", "RW", "W"), 3.5),
    (("CF", "F", "ST", "S", "FW", "LF", "RF"), 4),
    (("CM", "M", "LM", "RM"), 2.5),
)


def _base_position(position):
    return (position or "").upper().split("-")[0]


def _depth(player):
    base = _base_position(player["pos"])
    depth = next((value for names, value in DEPTHS if base in names), 2.5)
    # Opta's 9 is the main striker: the furthest forward of the forwards.
    return depth + (0.3 if player.get("place") == 9 else 0)


def _side(player):
    """Where across the pitch a position plays, from the team's left (-2) to its right (2).

    A wide position (LB, RW) is outside the left or right one of a central pair
    (CD-L, CM-R), which is outside the middle.
    """
    position = (player["pos"] or "").upper()
    if position.endswith("-L"):
        return -1
    if position.endswith("-R"):
        return 1
    if position[:1] == "L" and len(position) > 1:
        return -2
    if position[:1] == "R" and len(position) > 1:
        return 2
    return 0


def formation_lines(formation, starters):
    """The starters as lines from the goalkeeper forward, each from the team's left to its right.

    The formation string ("4-2-3-1") says how many are in each line; who goes in
    which comes from how far forward each position plays. ESPN's position names
    are rough (a holding midfielder can be "LM"), so they only decide the order:
    the counts come from the formation.
    """
    players = [p for p in starters if p.get("pos")]
    keepers = [p for p in players if _depth(p) == 0][:1]
    outfield = [p for p in players if p not in keepers]
    outfield.sort(key=lambda p: (_depth(p), p.get("place") or 99))
    counts = [int(part) for part in str(formation or "").split("-") if part.isdigit() and int(part) > 0]
    if sum(counts) != len(outfield):
        # No formation, or one that doesn't add up: one line per depth instead.
        counts, last = [], None
        for player in outfield:
            depth = round(_depth(player))
            if depth != last:
                counts.append(0)
                last = depth
            counts[-1] += 1
    lines, start = [], 0
    for count in counts:
        line = outfield[start:start + count]
        line.sort(key=lambda p: (_side(p), p.get("place") or 99))
        lines.append(line)
        start += count
    return ([keepers] if keepers else []) + lines


def _minute(play):
    return _text(_dict(_dict(play).get("clock")).get("displayValue"), 12)


def shape_player(entry):
    entry = _dict(entry)
    athlete = _dict(entry.get("athlete"))
    stats = {}
    for stat in _list(entry.get("stats")):
        if isinstance(stat, dict) and isinstance(stat.get("name"), str):
            value = _int(stat.get("value"))
            stats[stat["name"]] = value if value is not None else _int(stat.get("displayValue"))
    plays = [play for play in _list(entry.get("plays")) if isinstance(play, dict)]
    swapped = next((_minute(play) for play in plays if play.get("substitution")), None)
    full = _text(athlete.get("displayName")) or _text(athlete.get("fullName")) or "Unknown"
    yellow = (stats.get("yellowCards") or 0) > 0 or any(play.get("yellowCard") for play in plays)
    red = (stats.get("redCards") or 0) > 0 or any(play.get("redCard") for play in plays)
    return {
        "id": _text(str(athlete.get("id"))) if athlete.get("id") is not None else None,
        "name": _text(athlete.get("lastName"), 40) or _text(athlete.get("shortName"), 40) or full,
        "full": full,
        "number": _text(str(entry.get("jersey")), 3) if entry.get("jersey") is not None else None,
        "pos": _text(_dict(entry.get("position")).get("abbreviation"), 8),
        "place": _int(entry.get("formationPlace")) or None,
        "starter": bool(entry.get("starter")),
        "goals": stats.get("totalGoals") or 0,
        "assists": stats.get("goalAssists") or 0,
        "ownGoals": stats.get("ownGoals") or 0,
        "saves": stats.get("saves") or 0,
        "yellow": bool(yellow),
        "red": bool(red),
        "on": swapped if entry.get("subbedIn") else None,
        "off": swapped if entry.get("subbedOut") else None,
    }


def _minute_order(minute):
    """'90'+3'' -> 93.0, so the timeline sorts by when things happened."""
    found = re.findall(r"\d+", minute or "")
    return sum(int(part) for part in found[:2]) if found else 0


SCORE_IN_TEXT = re.compile(r"\s(\d{1,2}),\s[^,.!]*?\s(\d{1,2})\.")


def shape_events(raw_events, home_id, away_id):
    """The match's goals, cards and substitutions, plus half-time and full-time, in order."""
    out = []
    running = {"home": 0, "away": 0}
    for raw in _list(raw_events)[:MAX_EVENTS * 2]:
        raw = _dict(raw)
        if raw.get("shootout"):
            continue
        kind = str(_dict(raw.get("type")).get("type") or "").lower()
        team_id = str(_dict(raw.get("team")).get("id") or "")
        side = "home" if team_id == home_id else "away" if team_id == away_id else None
        names = [_text(_dict(_dict(p).get("athlete")).get("displayName"))
                 for p in _list(raw.get("participants"))]
        names = [name for name in names if name]
        minute = _text(_dict(raw.get("clock")).get("displayValue"), 12)
        text = raw.get("text") if isinstance(raw.get("text"), str) else ""
        event = None
        if raw.get("scoringPlay") or kind.startswith("goal") or kind in ("penalty---scored", "own-goal"):
            if "own" in kind:
                what = "own-goal"
            elif "penalty" in kind:
                what = "penalty"
            else:
                what = "goal"
            found = SCORE_IN_TEXT.findall(text)
            if found:
                running = {"home": int(found[-1][0]), "away": int(found[-1][1])}
            elif side:
                scored_for = side if what != "own-goal" else ("away" if side == "home" else "home")
                running[scored_for] += 1
            event = {"type": what, "player": names[0] if names else None,
                     "assist": names[1] if what == "goal" and len(names) > 1 else None,
                     "score": [running["home"], running["away"]]}
        elif kind in ("yellow-card", "red-card", "yellow-red-card"):
            event = {"type": "yellow" if kind == "yellow-card" else "red", "player": names[0] if names else None}
        elif kind == "substitution":
            event = {"type": "sub", "player": names[0] if names else None, "out": names[1] if len(names) > 1 else None}
        elif "penalty" in kind and ("miss" in kind or "save" in kind):
            event = {"type": "missed-penalty", "player": names[0] if names else None}
        elif kind == "halftime":
            event = {"type": "break", "label": "HT", "score": [running["home"], running["away"]]}
            side = None
        elif kind in ("end-regular-time", "end-extra-time"):
            event = {"type": "break", "label": "FT" if kind == "end-regular-time" else "AET",
                     "score": [running["home"], running["away"]]}
            side = None
        if event is None or (event["type"] != "break" and side is None):
            continue
        event.update({"side": side, "minute": minute, "order": _minute_order(minute)})
        out.append(event)
        if len(out) >= MAX_EVENTS:
            break
    return out


# The team stats a match page shows, in order: (ESPN's name, label, unit).
STATS = (
    ("possessionPct", "Possession", "%"),
    ("totalShots", "Total shots", None),
    ("shotsOnTarget", "Shots on target", None),
    ("blockedShots", "Blocked shots", None),
    ("wonCorners", "Corners", None),
    ("totalPasses", "Passes", None),
    ("passAccuracy", "Pass accuracy", "%"),
    ("totalCrosses", "Crosses", None),
    ("totalTackles", "Tackles", None),
    ("interceptions", "Interceptions", None),
    ("totalClearance", "Clearances", None),
    ("saves", "Saves", None),
    ("foulsCommitted", "Fouls", None),
    ("offsides", "Offsides", None),
    ("yellowCards", "Yellow cards", None),
    ("redCards", "Red cards", None),
)


def _team_stats(team):
    values = {}
    for stat in _list(_dict(team).get("statistics")):
        if isinstance(stat, dict) and isinstance(stat.get("name"), str):
            value = _number(stat.get("displayValue"))
            values[stat["name"]] = value if value is not None else _number(stat.get("value"))
    # ESPN rounds pass completion to one place ("0.9"); work it out from the counts instead.
    if values.get("totalPasses"):
        values["passAccuracy"] = 100 * (values.get("accuratePasses") or 0) / values["totalPasses"]
    return values


def shape_stats(boxscore_teams, home_id, away_id):
    by_team = {str(_dict(_dict(t).get("team")).get("id")): _team_stats(t) for t in _list(boxscore_teams)}
    home, away = by_team.get(home_id), by_team.get(away_id)
    if not home or not away:
        return []
    out = []
    for key, label, unit in STATS:
        if home.get(key) is None or away.get(key) is None:
            continue
        out.append({"key": key, "label": label, "unit": unit,
                    "home": int(round(home[key])), "away": int(round(away[key]))})
    return out


def _side_detail(roster, team):
    roster = _dict(roster)
    players = [shape_player(entry) for entry in _list(roster.get("roster"))[:40]]
    starters = [p for p in players if p["starter"]]
    bench = [p for p in players if not p["starter"]]
    # Who came on first, then the rest by shirt number.
    bench.sort(key=lambda p: (p["on"] is None, _minute_order(p["on"]), _int(p["number"]) or 99))
    formation = _text(roster.get("formation"), 16)
    return {
        **team,
        "formation": formation,
        "lines": formation_lines(formation, starters) if starters else [],
        "bench": bench,
    }


def shape_detail(raw, match):
    """ESPN's match summary as the board's match page (built on the match it belongs to)."""
    raw = _dict(raw)
    header = _dict((_list(_dict(raw.get("header")).get("competitions")) or [None])[0])
    detail = copy.deepcopy(match)
    detail.pop("follows", None)
    if header:
        status = shape_status(header.get("status"))
        detail["status"] = status
        home, away = _sides(header)
        for side, competitor in (("home", home), ("away", away)):
            if competitor:
                score, shootout = _scores(competitor)
                detail[side]["score"] = None if status["state"] == "pre" else score
                detail[side]["shootout"] = shootout
                detail[side]["winner"] = bool(competitor.get("winner"))
                # Schedules leave the teams' colours out; the summary has them (for the shirts).
                detail[side]["color"] = shape_team(competitor.get("team"))["color"] or detail[side]["color"]
    home_id, away_id = match["home"]["id"], match["away"]["id"]
    rosters = {str(_dict(_dict(r).get("team")).get("id")): r for r in _list(raw.get("rosters"))}
    detail["home"] = _side_detail(rosters.get(home_id), detail["home"])
    detail["away"] = _side_detail(rosters.get(away_id), detail["away"])
    detail["events"] = shape_events(raw.get("keyEvents"), home_id, away_id)
    detail["stats"] = shape_stats(_dict(raw.get("boxscore")).get("teams"), home_id, away_id)
    info = _dict(raw.get("gameInfo"))
    officials = [_text(_dict(o).get("displayName") or _dict(o).get("fullName")) for o in _list(info.get("officials"))]
    detail["venue"] = _text(_dict(info.get("venue")).get("fullName")) or match.get("venue")
    detail["attendance"] = _int(info.get("attendance")) or None
    detail["referee"] = next((name for name in officials if name), None)
    return detail


# The service


class Sports:
    """Everything the board follows, read on one background thread.

    snapshot() is pushed to every screen over the event stream; its version only
    changes when something on it does. match() is a match page, for the screen
    that opens one.
    """

    label = "sports"

    def __init__(self, follows=None, *, feed=None, fetch=fetch_bytes, fetch_crest=fetch_image, clock=time.time,
                 fotmob=None):
        self._follows = follows if follows is not None else Follows()
        # board.fotmob.FotMob, or None to leave FotMob out.
        self._fotmob = fotmob
        self._feed = feed
        self._fetch = fetch
        self._fetch_crest = fetch_crest
        self._clock = clock
        self._lock = threading.Lock()
        self._fetch_lock = threading.Lock()
        self._crest_lock = threading.Lock()
        self._crest_slots = threading.BoundedSemaphore(CREST_FETCHES)
        # Crests on their way, so each is fetched once however many screens ask.
        self._crest_fetching = {}
        self._version = 0
        self._matches = {}
        self._tables = {}
        self._error = None
        self._published = None
        # When each thing is next due, in clock() seconds.
        self._schedule_due = 0
        self._tables_due = 0
        self._tables_soon = []
        # id -> (when it was read, the page); and matches someone has open, until when.
        self._details = OrderedDict()
        self._watched = {}
        self._known_crests = OrderedDict()
        self._crests = OrderedDict()
        self._wake = threading.Event()
        self._stopped = False
        self._thread = None

    # Reads

    def snapshot(self):
        with self._lock:
            return {
                "version": self._version,
                "follows": copy.deepcopy(self._published["follows"]) if self._published else self._follows.public(),
                "matches": copy.deepcopy(self._published["matches"]) if self._published else [],
                "tables": copy.deepcopy(self._published["tables"]) if self._published else {},
                "error": self._published["error"] if self._published else None,
            }

    def match(self, match_id):
        """The page for one match the board knows about, or None. Raises SportsUnavailable."""
        if not isinstance(match_id, str) or not MATCH_ID.match(match_id):
            raise ValueError("That isn't a match.")
        now = self._clock()
        with self._lock:
            match = self._matches.get(match_id)
            if match is None:
                return None
            was_watched = self._watched.get(match_id, 0) > now
            self._watched[match_id] = now + WATCH_SECONDS
            cached = self._details.get(match_id)
            fresh = cached is not None and now - cached[0] < self._detail_age(match, now)
            match = copy.deepcopy(match)
        if not was_watched and self._is_on(match, now):
            # Keep it fresh from now on, at the live pace.
            self._wake.set()
        if fresh:
            return copy.deepcopy(cached[1])
        try:
            return copy.deepcopy(self._read_detail(match, now))
        except SportsUnavailable:
            if cached is not None:
                return copy.deepcopy(cached[1])
            raise

    def crest(self, crest_id):
        """A crest the board has shown, as (bytes, content type), or None."""
        found = CREST_ID.match(crest_id) if isinstance(crest_id, str) else None
        if not found:
            raise ValueError("That isn't a crest.")
        with self._lock:
            if crest_id not in self._known_crests:
                return None
        with self._crest_lock:
            if crest_id in self._crests:
                self._crests.move_to_end(crest_id)
                return self._crests[crest_id]
            arriving = self._crest_fetching.get(crest_id)
            if arriving is None:
                arriving = self._crest_fetching[crest_id] = threading.Event()
                mine = True
            else:
                mine = False
        if not mine:
            # Someone else is already fetching it: wait for theirs.
            arriving.wait(TIMEOUT_SECONDS + 5)
            with self._crest_lock:
                return self._crests.get(crest_id)
        image = None
        try:
            with self._crest_slots:
                image = self._fetch_crest(CREST_URL % (found.group(1), found.group(2), CREST_PIXELS, CREST_PIXELS))
        finally:
            with self._crest_lock:
                if image is not None:
                    self._crests[crest_id] = image
                    while len(self._crests) > MAX_CRESTS:
                        self._crests.popitem(last=False)
                del self._crest_fetching[crest_id]
            arriving.set()
        return image

    # The thread

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="sports", daemon=True)
            self._thread.start()

    def stop(self):
        self._stopped = True
        self._wake.set()

    def refresh_soon(self):
        self._wake.set()

    def _loop(self):
        while not self._stopped:
            try:
                delay = self.poll()
            except Exception:  # A failed read must never take the board's server down with it.
                log.exception("Reading the sports scores failed")
                delay = ERROR_POLL_SECONDS
            self._wake.wait(delay)
            self._wake.clear()

    def poll(self):
        """Reads whatever is due. Returns how long to wait before the next look."""
        if not self._follows.teams and not self._follows.competitions:
            self._publish()
            return SCHEDULE_SECONDS
        now = self._clock()
        failed = False
        if now >= self._schedule_due:
            ok = self._read_schedules(now)
            self._schedule_due = now + (SCHEDULE_SECONDS if ok else ERROR_POLL_SECONDS)
            failed |= not ok
        due_tables = now >= self._tables_due or any(when <= now for when in self._tables_soon)
        if due_tables:
            ok = self._read_tables()
            self._tables_soon = [when for when in self._tables_soon if when > now]
            self._tables_due = now + (TABLE_SECONDS if ok else ERROR_POLL_SECONDS)
            failed |= not ok
        failed |= self._read_live(now)
        self._refresh_details(now)
        if not failed:
            with self._lock:
                self._error = None
        self._publish()
        return self._next_delay(self._clock())

    # Reading

    def _get_json(self, url):
        raw = self._fetch(url)
        try:
            return json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except (UnicodeDecodeError, ValueError) as err:
            raise SportsUnavailable("The sports service sent something the board couldn't read.") from err

    def _fail(self, message, err):
        log.info("%s: %s", message, err)
        with self._lock:
            self._error = str(err)

    def _read_schedules(self, now):
        found = {}
        ok = True
        for team in self._follows.teams:
            leagues = team["leagues"]
            # One league: ask it directly (college soccer); otherwise every competition at once.
            path = leagues[0] if len(leagues) == 1 else "all"
            for upcoming in (False, True):
                url = SITE_API + "%s/teams/%s/schedule%s" % (path, team["espn"], "?fixture=true" if upcoming else "")
                try:
                    raw = self._get_json(url)
                except SportsUnavailable as err:
                    self._fail("Couldn't read %s's schedule" % team["name"], err)
                    ok = False
                    continue
                for event in _list(_dict(raw).get("events")):
                    league = _event_league(_dict(event), leagues[0])
                    if league in leagues:
                        self._add(found, shape_match(event, league), team["id"], team.get("table"))
        for competition in self._follows.competitions:
            for offset in COMPETITION_DAYS:
                day = espn_day(now + offset * 24 * 60 * 60)
                try:
                    raw = self._get_json(SITE_API + "%s/scoreboard?dates=%s" % (competition["league"], day))
                except SportsUnavailable as err:
                    self._fail("Couldn't read the %s scoreboard" % competition["name"], err)
                    ok = False
                    continue
                for event in _list(_dict(raw).get("events")):
                    self._add(found, shape_match(event, competition["league"]), competition["id"])
        earliest = (now - KEEP_PAST_DAYS * 24 * 60 * 60) * 1000
        latest = (now + KEEP_AHEAD_DAYS * 24 * 60 * 60) * 1000
        with self._lock:
            # A source that couldn't be read keeps what it had.
            merged = dict(self._matches) if not ok else {}
            for match_id, match in found.items():
                old = self._matches.get(match_id)
                if old is not None:
                    match["detail"] = old["detail"]
                    # The live scoreboard is fresher than a schedule: never step a match back.
                    was, now_is = STATE_ORDER[old["status"]["state"]], STATE_ORDER[match["status"]["state"]]
                    if was > now_is or was == now_is == STATE_ORDER["in"]:
                        for key in ("status", "home", "away"):
                            match[key] = old[key]
                    if old["follows"] and not ok:
                        match["follows"] = sorted(set(match["follows"]) | set(old["follows"]))
                merged[match_id] = match
            kept = {k: m for k, m in merged.items() if earliest <= m["kickoff"] <= latest}
            if len(kept) > MAX_MATCHES:
                middle = now * 1000
                ordered = sorted(kept.values(), key=lambda m: abs(m["kickoff"] - middle))[:MAX_MATCHES]
                kept = {m["id"]: m for m in ordered}
            self._matches = kept
            for gone in [k for k in self._details if k not in kept]:
                del self._details[gone]
        return ok

    @staticmethod
    def _add(found, match, follow, table=None):
        if match is None:
            return
        existing = found.get(match["id"])
        if existing is not None:
            match = existing
        else:
            found[match["id"]] = match
        if follow not in match["follows"]:
            match["follows"] = sorted(match["follows"] + [follow])
        # A cup tie has no table of its own: show the team's league instead.
        if match["table"] is None and table:
            match["table"] = table

    def _read_tables(self):
        tables = {}
        ok = True
        for table_id in self._follows.tables:
            try:
                if table_id == "big-ten":
                    page = self._fetch(BIG_TEN_URL % self._follows.big_ten)
                    rows = parse_big_ten(page.decode("utf-8", "replace") if isinstance(page, bytes) else page)
                    table = {"id": table_id, "name": TABLE_NAMES[table_id], "kind": "college",
                             "groups": [{"name": "", "rows": rows}]} if rows else None
                else:
                    table = shape_espn_table(self._get_json(STANDINGS_API + "%s/standings" % table_id), table_id)
            except SportsUnavailable as err:
                self._fail("Couldn't read the %s table" % TABLE_NAMES.get(table_id, table_id), err)
                ok = False
                table = None
            if table is None:
                with self._lock:
                    if table_id in self._tables:
                        tables[table_id] = self._tables[table_id]
                continue
            tables[table_id] = table
        with self._lock:
            self._tables = tables
        return ok

    def _read_live(self, now):
        """Each league with a match on: its scoreboard for that day. Returns whether any read failed."""
        with self._lock:
            on = [m for m in self._matches.values() if self._is_on(m, now)]
            competitions = {c["league"]: c["id"] for c in self._follows.competitions}
        wanted = sorted({(m["league"], espn_day(m["kickoff"] / 1000)) for m in on})
        failed = False
        for league, day in wanted:
            try:
                raw = self._get_json(SITE_API + "%s/scoreboard?dates=%s" % (league, day))
            except SportsUnavailable as err:
                self._fail("Couldn't read the live scores", err)
                failed = True
                continue
            for event in _list(_dict(raw).get("events")):
                fresh = shape_match(event, league)
                if fresh is not None:
                    self._update(fresh, competitions.get(league), now)
        return failed

    def _update(self, fresh, competition, now):
        with self._lock:
            old = self._matches.get(fresh["id"])
            if old is None:
                if competition is None:
                    return
                fresh["follows"] = [competition]
                self._matches[fresh["id"]] = fresh
                return
            changed = any(old[key] != fresh[key] for key in ("status", "home", "away", "kickoff"))
            if not changed:
                return
            ended = fresh["status"]["completed"] and not old["status"]["completed"]
            for key in ("status", "home", "away", "kickoff", "note", "competition"):
                old[key] = fresh[key]
            # The match page is out of date too: read it again on this pass.
            if fresh["id"] in self._details:
                self._details[fresh["id"]] = (0, self._details[fresh["id"]][1])
            if ended and old["table"]:
                self._tables_soon += [now + delay for delay in TABLE_AFTER_FINAL_SECONDS]

    def _refresh_details(self, now):
        """Keeps open match pages, and every followed team's match on now, up to date."""
        with self._lock:
            self._watched = {k: until for k, until in self._watched.items() if until > now and k in self._matches}
            teams = {t["id"] for t in self._follows.teams}
            due = []
            for match in self._matches.values():
                ours = bool(teams.intersection(match["follows"]))
                soon = match["status"]["state"] == "pre" and 0 <= match["kickoff"] / 1000 - now <= LINEUP_LEAD_SECONDS
                wanted = match["id"] in self._watched or (ours and (soon or self._is_on(match, now)))
                cached = self._details.get(match["id"])
                if wanted and (cached is None or now - cached[0] >= self._detail_age(match, now)):
                    due.append(copy.deepcopy(match))
        for match in due:
            try:
                self._read_detail(match, now)
            except SportsUnavailable as err:
                self._fail("Couldn't read the match page", err)

    def _read_detail(self, match, now):
        with self._fetch_lock:
            with self._lock:
                cached = self._details.get(match["id"])
                if cached is not None and now - cached[0] < self._detail_age(match, now):
                    return cached[1]
            raw = self._get_json(SITE_API + "%s/summary?event=%s" % (match["league"], match["id"]))
            detail = shape_detail(raw, match)
            if self._fotmob is not None:
                add_fotmob(detail, self._fotmob.extra(match))
            with self._lock:
                old = self._details.get(match["id"])
                self._details[match["id"]] = (now, detail)
                self._details.move_to_end(match["id"])
                while len(self._details) > MAX_DETAILS:
                    self._details.popitem(last=False)
                stored = self._matches.get(match["id"])
                if stored is not None and (old is None or old[1] != detail):
                    # Tells screens showing this page that there's more to see.
                    stored["detail"] += 1
            self._remember_crests([detail["home"]["crest"], detail["away"]["crest"]])
            return detail

    # Timing

    @staticmethod
    def _is_on(match, now):
        status = match["status"]
        if status["completed"]:
            return False
        if status["state"] == "in":
            return True
        start = match["kickoff"] / 1000
        # Not started (or not yet marked started) and around kickoff. A postponed
        # match ("post" but not completed) isn't on.
        return status["state"] == "pre" and start - LIVE_LEAD_SECONDS <= now <= start + MATCH_LONGEST_SECONDS

    def _detail_age(self, match, now):
        status = match["status"]
        if self._is_on(match, now):
            return DETAIL_LIVE_SECONDS
        start = match["kickoff"] / 1000
        if status["state"] == "pre":
            return DETAIL_SOON_SECONDS if start - now <= LINEUP_LEAD_SECONDS else DETAIL_LATER_SECONDS
        if now - start <= JUST_FINISHED_SECONDS + MATCH_LONGEST_SECONDS:
            return DETAIL_JUST_FINISHED_SECONDS
        return DETAIL_FINISHED_SECONDS

    def _next_delay(self, now):
        with self._lock:
            matches = list(self._matches.values())
            watched = set(self._watched)
            teams = {t["id"] for t in self._follows.teams}
        if any(self._is_on(m, now) for m in matches):
            return LIVE_POLL_SECONDS
        wake = [self._schedule_due, self._tables_due] + self._tables_soon
        for match in matches:
            if match["status"]["state"] != "pre":
                continue
            start = match["kickoff"] / 1000
            wake.append(start - LIVE_LEAD_SECONDS)
            if teams.intersection(match["follows"]) or match["id"] in watched:
                lineups = start - LINEUP_LEAD_SECONDS
                # Inside the line-up window, look again every few minutes.
                wake.append(lineups if lineups > now else now + DETAIL_SOON_SECONDS)
        upcoming = [when for when in wake if when > now]
        delay = min(upcoming) - now if upcoming else SCHEDULE_SECONDS
        return max(MIN_POLL_SECONDS, min(SCHEDULE_SECONDS, delay))

    # Publishing

    def _remember_crests(self, crests):
        with self._lock:
            for crest in crests:
                if crest:
                    self._known_crests[crest] = None
                    self._known_crests.move_to_end(crest)
            while len(self._known_crests) > MAX_KNOWN_CRESTS:
                self._known_crests.popitem(last=False)

    def _publish(self):
        with self._lock:
            matches = copy.deepcopy(sorted(self._matches.values(), key=lambda m: (m["kickoff"], m["id"])))
            tables = copy.deepcopy(self._tables)
            # The Big Ten's page has names but no crests: borrow ESPN's for the same schools.
            schools = {}
            for match in matches:
                if match["league"].startswith("usa.ncaa"):
                    for side in ("home", "away"):
                        schools.setdefault(match[side]["name"].lower(), match[side])
            conference = set()
            for table in tables.values():
                if table["kind"] == "college":
                    for row in table["groups"][0]["rows"]:
                        name = row["team"]["name"].lower()
                        conference.add(name)
                        espn = schools.get(name)
                        if espn:
                            row["team"].update(id=espn["id"], abbr=espn["abbr"], crest=espn["crest"])
            # ESPN doesn't say which college games are conference games: both teams in the table are.
            for match in matches:
                info = LEAGUES.get(match["league"], {})
                if info.get("conference") and {match["home"]["name"].lower(), match["away"]["name"].lower()} <= conference:
                    match["competition"] = info["conference"]
            follows = self._follows.public()
            for follow in follows:
                if follow["team"]:
                    follow["crest"] = next((m[side]["crest"] for m in matches for side in ("home", "away")
                                            if m[side]["id"] == follow["team"]), None)
                else:
                    follow["crest"] = None
            published = {"follows": follows, "matches": matches, "tables": tables, "error": self._error}
            if published == self._published:
                return
            self._published = published
            self._version += 1
        shown = [m[side]["crest"] for m in matches for side in ("home", "away")]
        shown += [row["team"]["crest"] for t in tables.values() for g in t["groups"] for row in g["rows"]]
        self._remember_crests(shown)
        if self._feed is not None:
            self._feed.notify()
