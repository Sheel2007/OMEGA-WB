"""FotMob: what a match page has that ESPN's summary doesn't.

ESPN (board/sports.py) stays the source of every fixture, score, line-up and
timeline. For the competitions FotMob is asked about (the Premier League, FA Cup,
League Cup and Champions League), a match page also gets, from FotMob's match
details:

- the referee and their record in their league: fouls and yellow cards a match
  against the league's average, red cards and penalties given;
- the predicted line-ups, until the real ones are out, and who's injured or
  suspended;
- each player's FotMob rating and match stats (a screen shows them when a player
  is tapped), and the player of the match;
- both teams' last five results, the head-to-head record, FotMob's insights about
  the match, and expected goals.

FotMob's API (www.fotmob.com/api/data/) is unofficial and undocumented, like
ESPN's, and needs no account. Everything read from it is checked and shaped into
the board's own small format here; if FotMob can't be reached, can't find the
match or changes its answers, the page simply has ESPN's half. It's only asked
when the Sports thread reads that match's page from ESPN, so never more often.
Nothing is written to the SD card.

Only the standard library.
"""
import difflib
import json
import logging
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone

log = logging.getLogger(__name__)

API = "https://www.fotmob.com/api/data/"
USER_AGENT = "Mozilla/5.0 (X11; Linux aarch64) WidgetBoard/1.0"
TIMEOUT_SECONDS = 20
# A day's match list is about 200KB; one match's details 50-800KB.
MAX_RESPONSE_BYTES = 4 * 1024 * 1024

# ESPN's league -> FotMob's league id, for the competitions FotMob is asked about.
LEAGUES = {"eng.1": 47, "eng.fa": 132, "eng.league_cup": 133, "uefa.champions": 42}

# A day's list of matches is kept this long (it's only needed to find a match).
DAY_SECONDS = 30 * 60
MAX_DAYS = 6
# ESPN match id -> FotMob match id, and how long to wait before looking again for one not found.
MAX_IDS = 200
NOT_FOUND_SECONDS = 60 * 60
# How far apart ESPN's and FotMob's kickoff times may be for the same match.
KICKOFF_WINDOW_SECONDS = 3 * 60 * 60
# The last good answer for each match, kept for when FotMob can't be reached.
MAX_KEPT = 24

MAX_TEXT = 120
MAX_SUBS = 23
MAX_OUT = 16
MAX_FORM = 5
MAX_MEETINGS = 5
MAX_INSIGHTS = 6
MAX_GROUPS = 6
MAX_GROUP_STATS = 16
MAX_PLAYERS = 60
MAX_TOP = 3
# Players whose layout heights are this close stand in the same line.
LINE_GAP = 0.04

# Extra team stats for the Stats tab: (FotMob's key, the board's key, label).
EXTRA_STATS = (
    ("expected_goals", "xg", "Expected goals (xG)"),
    ("big_chance", "bigChances", "Big chances"),
    ("big_chance_missed_title", "bigChancesMissed", "Big chances missed"),
)
# A player's stats that are already in the sheet's header, or aren't worth showing.
SKIPPED_PLAYER_STATS = {"rating_title", "minutes_played", "fantasy_points"}
SKIPPED_STAT_TYPES = {"boolean", "fantasyPoints"}

# Words that say nothing about which team it is ("Arsenal FC" is "Arsenal").
NAME_FILLER = {"fc", "afc", "cf", "sc", "ac", "as", "ss", "ssc", "sv", "fk", "sk", "the", "club", "de", "cd", "ud", "calcio"}


class FotMobUnavailable(Exception):
    """FotMob couldn't be reached or sent something unreadable."""


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as err:
        raise FotMobUnavailable("FotMob answered %d." % err.code) from err
    except OSError as err:
        raise FotMobUnavailable("Can't reach FotMob right now.") from err
    if len(data) > MAX_RESPONSE_BYTES:
        raise FotMobUnavailable("FotMob sent more than the board will read.")
    return data


def fotmob_from(config):
    """A FotMob reader, unless "sports" in config.json is false or says {"fotmob": false}."""
    sports = config.get("sports") if isinstance(config, dict) else None
    if sports is False or (isinstance(sports, dict) and sports.get("fotmob") is False):
        return None
    return FotMob()


# Reading FotMob's answers


def _text(value, limit=MAX_TEXT):
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text[:limit] or None


def _int(value):
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
            return float(value.strip())
        except ValueError:
            return None
    return None


def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def _id(value):
    """FotMob's ids are numbers (or numbers in strings): as a string, or None."""
    number = _int(value)
    return str(number) if number is not None and number > 0 else None


def _ms(value):
    """FotMob's "2026-10-13T19:00:00.000Z" as ms since the epoch, or None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def _score(text):
    """'2 - 1' -> [2, 1], or None."""
    found = re.match(r"^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$", text) if isinstance(text, str) else None
    return [int(found.group(1)), int(found.group(2))] if found else None


def _rating(value):
    rating = _number(value)
    return round(rating, 1) if rating is not None and 0 < rating <= 10 else None


def _short(value):
    """6.70 -> '6.7', 0.01 -> '0.01', 3.0 -> '3'."""
    return ("%.2f" % value).rstrip("0").rstrip(".")


# Finding the match


# Letters that don't come apart into a plain letter and an accent.
LETTERS = str.maketrans({"ø": "o", "Ø": "O", "æ": "ae", "Æ": "AE", "ß": "ss", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ı": "i"})


def _words(name):
    text = unicodedata.normalize("NFKD", (name or "").translate(LETTERS))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    words = re.findall(r"[a-z0-9]+", text)
    return [word for word in words if word not in NAME_FILLER] or words


def name_similarity(a, b):
    """How sure it is that two names are the same team, from 0 to 1.

    The same words is 1. Every word of the shorter name starting (or being the
    start of) a word of the longer one is 0.9: "Tottenham Hotspur" and "Tottenham",
    "Manchester United" and "Man United", "Internazionale" and "Inter". Anything
    else is how alike the letters are ("Bayern Munich", "Bayern München").
    """
    first, second = _words(a), _words(b)
    if not first or not second:
        return 0.0
    if first == second:
        return 1.0
    shorter, longer = sorted((first, second), key=len)
    left = list(longer)
    for word in shorter:
        hit = next((other for other in left if other.startswith(word) or word.startswith(other)), None)
        if hit is None:
            break
        left.remove(hit)
    else:
        return 0.9
    return difflib.SequenceMatcher(None, " ".join(first), " ".join(second)).ratio()


def day_matches(raw):
    """FotMob's matches on one day, cut down to what finding a match needs."""
    out = []
    for league in _list(_dict(raw).get("leagues")):
        league = _dict(league)
        league_id = _int(league.get("primaryId")) or _int(league.get("id"))
        if league_id not in LEAGUES.values():
            continue
        for match in _list(league.get("matches")):
            match = _dict(match)
            match_id = _id(match.get("id"))
            kickoff = _ms(_dict(match.get("status")).get("utcTime"))
            if match_id is None or kickoff is None:
                continue
            names = {}
            for side in ("home", "away"):
                team = _dict(match.get(side))
                names[side] = [name for name in (_text(team.get("name")), _text(team.get("longName"))) if name]
            out.append({"id": match_id, "league": league_id, "kickoff": kickoff, **names})
    return out


def find_match(candidates, match):
    """FotMob's id for an ESPN match (the board's shape), from day_matches() lists, or None.

    Only matches in the same competition, kicking off within a few hours, are
    considered; the one whose team names fit best is it, as long as one side's
    name is a near-certain fit and the other isn't far off.
    """
    league = LEAGUES.get(match.get("league"))
    kickoff = match.get("kickoff")
    if league is None or not isinstance(kickoff, (int, float)):
        return None
    espn = {side: [n for n in (match[side].get("name"), match[side].get("short")) if n] for side in ("home", "away")}
    scored = []
    for candidate in candidates:
        apart = abs(candidate["kickoff"] - kickoff) / 1000
        if candidate["league"] != league or apart > KICKOFF_WINDOW_SECONDS:
            continue
        fits = [max((name_similarity(ours, theirs) for ours in espn[side] for theirs in candidate[side]), default=0)
                for side in ("home", "away")]
        scored.append((sum(fits), max(fits), -apart, candidate["id"]))
    if not scored:
        return None
    scored.sort(reverse=True)
    total, best_side, _, found = scored[0]
    if best_side < 0.85 or total < 1.25:
        return None
    if len(scored) > 1 and scored[1][0] == total:
        return None
    return found


# Shaping a match's details


def _events(performance):
    counts = {"goals": 0, "ownGoals": 0, "assists": 0, "yellow": False, "red": False}
    for event in _list(_dict(performance).get("events")):
        kind = str(_dict(event).get("type") or "").lower()
        if "own" in kind:
            counts["ownGoals"] += 1
        elif kind in ("goal", "penaltygoal"):
            counts["goals"] += 1
        elif kind == "assist":
            counts["assists"] += 1
        elif "red" in kind:
            counts["red"] = True
        elif "yellow" in kind:
            counts["yellow"] = True
    return counts


def shape_lineup_player(entry, starter):
    """One player in FotMob's line-up, in the same shape as ESPN's (plus where they stand)."""
    entry = _dict(entry)
    player_id = _id(entry.get("id"))
    full = _text(entry.get("name"))
    if player_id is None or full is None:
        return None
    performance = _dict(entry.get("performance"))
    layout = _dict(entry.get("verticalLayout"))
    swaps = {}
    for swap in _list(performance.get("substitutionEvents")):
        swap = _dict(swap)
        minute = _int(swap.get("time"))
        if swap.get("type") in ("subIn", "subOut") and minute is not None:
            swaps.setdefault(swap["type"], "%d'" % minute)
    x, y = _number(layout.get("x")), _number(layout.get("y"))
    number = entry.get("shirtNumber")
    return {
        "fm": player_id,
        "name": _text(entry.get("lastName"), 40) or full,
        "full": full,
        "number": _text(str(number), 3) if number is not None else None,
        "pos": None,
        "place": None,
        "starter": starter,
        **_events(performance),
        "saves": 0,
        "on": swaps.get("subIn"),
        "off": swaps.get("subOut"),
        "rating": _rating(performance.get("rating")),
        "x": x if x is not None and 0 <= x <= 1 else None,
        "y": y if y is not None and 0 <= y <= 1 else None,
    }


def shape_out(entry):
    entry = _dict(entry)
    name = _text(entry.get("name"))
    if name is None:
        return None
    why = _dict(entry.get("unavailability"))
    return {"name": name, "reason": _text(why.get("type"), 24), "back": _text(why.get("expectedReturn"), 40)}


def _team_lineup(raw):
    raw = _dict(raw)
    starters = [p for p in (shape_lineup_player(e, True) for e in _list(raw.get("starters"))[:11]) if p]
    bench = [p for p in (shape_lineup_player(e, False) for e in _list(raw.get("subs"))[:MAX_SUBS]) if p]
    out = [p for p in (shape_out(e) for e in _list(raw.get("unavailable"))[:MAX_OUT]) if p]
    return {
        "id": _id(raw.get("id")),
        "formation": _text(raw.get("formation"), 16),
        "coach": _text(_dict(raw.get("coach")).get("name"), 60),
        "starters": starters,
        "bench": bench,
        "out": out,
    }


def _per_match(stat):
    value = _number(stat.get("value"))
    if value is None:
        return None
    average = _number(stat.get("average"))
    fill, mark = _number(stat.get("fillPercentage")), _number(stat.get("averagePercentage"))
    return {
        "perMatch": round(value, 2),
        "average": round(average, 2) if average is not None else None,
        "total": _int(stat.get("total")),
        # Where this referee and the league's average sit on FotMob's scale (0-100).
        "fill": round(min(100.0, max(0.0, fill)), 1) if fill is not None else None,
        "mark": round(min(100.0, max(0.0, mark)), 1) if mark is not None else None,
    }


def shape_referee(raw):
    raw = _dict(raw)
    name = _text(raw.get("text"), 60)
    if name is None:
        return None
    stats = {s.get("type"): s for s in _list(raw.get("stats")) if isinstance(s, dict)}

    def per_match(kind):
        stat = stats.get(kind)
        return _per_match(stat) if stat and stat.get("valueType") == "perMatch" else None

    def total(kind):
        stat = stats.get(kind)
        return _int(stat.get("value")) if stat and stat.get("valueType") == "total" else None

    return {
        "name": name,
        "country": _text(raw.get("country"), 40),
        "league": _text(raw.get("leagueName"), 60),
        "matches": total("matches"),
        "fouls": per_match("fouls"),
        "yellows": per_match("yellowCards"),
        "reds": total("redCards"),
        "penalties": total("penalties"),
    }


def shape_form(games):
    out = []
    for game in _list(games)[-MAX_FORM:]:
        game = _dict(game)
        result = game.get("resultString")
        score = _score(game.get("score"))
        home, away = _dict(game.get("home")), _dict(game.get("away"))
        if result not in ("W", "D", "L") or score is None:
            continue
        at_home = bool(home.get("isOurTeam"))
        opponent = _text((away if at_home else home).get("name"), 40)
        out.append({
            "result": result,
            "for": score[0] if at_home else score[1],
            "against": score[1] if at_home else score[0],
            "opponent": opponent or "?",
            "home": at_home,
            "date": _ms(_dict(game.get("date")).get("utcTime")),
        })
    return out


def shape_h2h(raw):
    raw = _dict(raw)
    summary = [_int(n) for n in _list(raw.get("summary"))[:3]]
    if len(summary) != 3 or None in summary:
        return None
    meetings = []
    for meeting in _list(raw.get("matches")):
        meeting = _dict(meeting)
        status = _dict(meeting.get("status"))
        score = _score(status.get("scoreStr"))
        if not status.get("finished") or score is None:
            continue
        meetings.append({
            "date": _ms(status.get("utcTime") or _dict(meeting.get("time")).get("utcTime")),
            "home": _text(_dict(meeting.get("home")).get("name"), 40) or "?",
            "away": _text(_dict(meeting.get("away")).get("name"), 40) or "?",
            "score": score,
            "competition": _text(_dict(meeting.get("league")).get("name"), 40),
        })
        if len(meetings) >= MAX_MEETINGS:
            break
    return {"home": summary[0], "draws": summary[1], "away": summary[2], "meetings": meetings}


def shape_extra_stats(raw):
    """Expected goals and big chances, in the board's team stat shape."""
    periods = _dict(_dict(raw).get("Periods"))
    found = {}
    for group in _list(_dict(periods.get("All")).get("stats")):
        for stat in _list(_dict(group).get("stats")):
            stat = _dict(stat)
            values = _list(stat.get("rawStats"))
            if stat.get("key") in found or len(values) != 2:
                continue
            home, away = (_number(_dict(v).get("value")) for v in values)
            if home is not None and away is not None:
                found[stat.get("key")] = (home, away)
    out = []
    for theirs, ours, label in EXTRA_STATS:
        if theirs in found:
            home, away = found[theirs]
            out.append({"key": ours, "label": label, "unit": None, "home": _whole(home), "away": _whole(away)})
    return out


def _whole(value):
    """4.0 -> 4, 2.333 -> 2.33."""
    return int(value) if float(value).is_integer() else round(value, 2)


def _distance(metres):
    return "%.1f km" % (metres / 1000) if metres >= 1000 else "%d m" % metres


def stat_text(stat):
    """One of a player's stats as it reads on screen, or None to leave it out."""
    stat = _dict(stat)
    kind = stat.get("type")
    value = _number(stat.get("value"))
    total = _number(stat.get("total"))
    if value is None or kind in SKIPPED_STAT_TYPES:
        return None
    if kind == "fractionWithPercentage":
        if not total:
            return "%d" % value
        return "%d/%d (%d%%)" % (value, total, round(100 * value / total))
    if kind == "speed":
        return "%.1f km/h" % value
    if kind == "distance":
        return _distance(value)
    if kind == "distanceWithPercentage":
        return "%s (%d%%)" % (_distance(value), round(100 * value / total)) if total else _distance(value)
    if kind == "integer":
        return "%d" % value
    return _short(value)


def shape_player_stats(raw, sides):
    """Each player's match stats, by FotMob player id: the groups FotMob shows, as label and text."""
    out = {}
    for player_id, player in list(_dict(raw).items())[:MAX_PLAYERS]:
        player = _dict(player)
        fm = _id(player_id)
        name = _text(player.get("name"))
        groups, rating, minutes = [], None, None
        for group in _list(player.get("stats"))[:MAX_GROUPS]:
            group = _dict(group)
            rows = []
            for label, entry in list(_dict(group.get("stats")).items()):
                entry = _dict(entry)
                stat = _dict(entry.get("stat"))
                if entry.get("key") == "rating_title":
                    rating = _rating(stat.get("value"))
                elif entry.get("key") == "minutes_played":
                    minutes = _int(stat.get("value"))
                if entry.get("key") in SKIPPED_PLAYER_STATS or not entry.get("key") or entry.get("hideInPopupCard"):
                    continue
                text = stat_text(stat)
                if text is not None and len(rows) < MAX_GROUP_STATS:
                    rows.append({"label": _text(label, 40) or "", "value": text})
            title = _text(group.get("title"), 40)
            if rows and title:
                groups.append({"title": title, "stats": rows})
        if fm is None or name is None or not groups:
            continue
        number = player.get("shirtNumber")
        out[fm] = {
            "name": name,
            "side": sides.get(_id(player.get("teamId"))),
            "number": _text(str(number), 3) if number is not None else None,
            "keeper": bool(player.get("isGoalkeeper")),
            "rating": rating,
            "minutes": minutes,
            "groups": groups,
        }
    return out


def shape_best(facts, players):
    """The player of the match (once it's over) and each side's best rated."""
    facts = _dict(facts)
    potm = _dict(facts.get("playerOfTheMatch"))
    finished = _dict(_dict(potm.get("rating")).get("isTop")).get("isMatchFinished")
    best = None
    fm = _id(potm.get("id"))
    if fm and finished:
        best = {"fm": fm, "name": _text(_dict(potm.get("name")).get("fullName")) or "?",
                "team": _text(potm.get("teamName"), 40), "rating": _rating(_dict(potm.get("rating")).get("num"))}
    top = {}
    tops = _dict(facts.get("topPlayers"))
    for side, key in (("home", "homeTopPlayers"), ("away", "awayTopPlayers")):
        rows = []
        for entry in _list(tops.get(key))[:MAX_TOP]:
            entry = _dict(entry)
            fm = _id(entry.get("playerId"))
            rating = _rating(entry.get("playerRating"))
            if fm and rating is not None:
                rows.append({"fm": fm, "name": _text(_dict(entry.get("name")).get("fullName")) or "?", "rating": rating,
                             "stats": fm in players})
        top[side] = rows
    return {"potm": best, "top": top}


def insight_text(insight, names):
    """One of FotMob's insights. A team's often leaves the team out ("Have scored 9 goals..."):
    it's put back in ("Arsenal have scored 9 goals...")."""
    insight = _dict(insight)
    text = _text(insight.get("text"), 160)
    team = names.get(_id(insight.get("teamId")))
    if text and team and insight.get("type") == "team" and team.lower() not in text.lower():
        text = "%s %s%s" % (team, text[0].lower(), text[1:])
    return text


def shape(raw):
    """FotMob's match details as the extras a match page gets, or None if they aren't readable."""
    raw = _dict(raw)
    general = _dict(raw.get("general"))
    content = _dict(raw.get("content"))
    match_id = _id(general.get("matchId"))
    if match_id is None or not content:
        return None
    facts = _dict(content.get("matchFacts"))
    lineup = _dict(content.get("lineup"))
    home, away = _team_lineup(lineup.get("homeTeam")), _team_lineup(lineup.get("awayTeam"))
    has_lineup = bool(home["starters"] or away["starters"])
    sides = {_id(_dict(general.get("homeTeam")).get("id")): "home", _id(_dict(general.get("awayTeam")).get("id")): "away"}
    players = shape_player_stats(content.get("playerStats"), sides)
    form = _list(facts.get("teamForm"))
    names = {_id(_dict(general.get(key)).get("id")): _text(_dict(general.get(key)).get("name"), 40)
             for key in ("homeTeam", "awayTeam")}
    insights = []
    for insight in _list(facts.get("insights")):
        text = insight_text(insight, names)
        if text and text not in insights:
            insights.append(text)
    return {
        "id": match_id,
        "lineup": ("predicted" if lineup.get("lineupType") == "predicted" else "confirmed") if has_lineup else None,
        "home": home,
        "away": away,
        "referee": shape_referee(_dict(facts.get("infoBox")).get("Referee")),
        "form": {"home": shape_form(form[0] if len(form) > 0 else []),
                 "away": shape_form(form[1] if len(form) > 1 else [])},
        "h2h": shape_h2h(content.get("h2h")),
        "insights": insights[:MAX_INSIGHTS],
        "stats": shape_extra_stats(content.get("stats")),
        "players": players,
        "best": shape_best(facts, players),
    }


# Adding it to ESPN's match page


def _same_player(player, theirs):
    """ESPN's player among FotMob's: the same shirt number with a name that fits, or else a name that fits well."""
    full = player.get("full") or ""
    for other in theirs:
        if other["number"] and other["number"] == player.get("number") and (
                name_similarity(full, other["full"]) >= 0.5 or name_similarity(player.get("name"), other["name"]) >= 0.85):
            return other
    scored = [(name_similarity(full, other["full"]), index) for index, other in enumerate(theirs)]
    best = max(scored, default=(0, None))
    return theirs[best[1]] if best[0] >= 0.85 else None


def layout_lines(starters):
    """FotMob's starters as lines from the keeper forward, each from the team's left to its right.

    FotMob places each player on a pitch with their own goal at the top: the
    height (y) says which line they're in, and across (x) runs from the team's
    right (0) to its left (1).
    """
    if not starters or any(p["x"] is None or p["y"] is None for p in starters):
        return []
    lines = []
    for player in sorted(starters, key=lambda p: p["y"]):
        if lines and player["y"] - lines[-1][0]["y"] < LINE_GAP:
            lines[-1].append(player)
        else:
            lines.append([player])
    return [[_board_player(p) for p in sorted(line, key=lambda p: -p["x"])] for line in lines]


def _board_player(player):
    return {key: value for key, value in player.items() if key not in ("x", "y")}


def _minute_order(minute):
    found = re.findall(r"\d+", minute or "")
    return sum(int(part) for part in found[:2]) if found else 0


def merge(detail, extra):
    """Adds FotMob's extras to an ESPN match page (board/sports.py's shape), in place.

    ESPN's line-ups win when there are any: FotMob only adds each player's rating
    (matched by shirt number, or by name). Without them, FotMob's (often the
    predicted ones) are used instead.
    """
    if not extra:
        return detail
    for side in ("home", "away"):
        team, theirs = detail[side], extra[side]
        everyone = theirs["starters"] + theirs["bench"]
        if team["lines"]:
            for player in [p for line in team["lines"] for p in line] + team["bench"]:
                found = _same_player(player, everyone)
                if found:
                    player["rating"], player["fm"] = found["rating"], found["fm"]
        else:
            lines = layout_lines(theirs["starters"])
            if lines:
                team["lines"] = lines
                bench = [_board_player(p) for p in theirs["bench"]]
                bench.sort(key=lambda p: (p["on"] is None, _minute_order(p["on"]), _int(p["number"]) or 99))
                team["bench"] = bench
                team["formation"] = team.get("formation") or theirs["formation"]
                team["predicted"] = extra["lineup"] == "predicted"
        team["coach"] = theirs["coach"]
        team["out"] = theirs["out"]
    known = {stat["key"] for stat in detail["stats"]}
    extra_stats = [stat for stat in extra["stats"] if stat["key"] not in known]
    if extra_stats and detail["stats"]:
        # Straight after possession, where FotMob puts them.
        at = 1 if detail["stats"][0]["key"] == "possessionPct" else 0
        detail["stats"][at:at] = extra_stats
    elif extra_stats and not detail["stats"]:
        detail["stats"] = extra_stats
    detail["fotmob"] = {key: extra[key] for key in ("referee", "form", "h2h", "insights", "players", "best")}
    return detail


# The reader


class FotMob:
    """Finds the FotMob match for an ESPN one and reads its details. Never raises."""

    def __init__(self, fetch=fetch_bytes, clock=time.time):
        self._fetch = fetch
        self._clock = clock
        self._lock = threading.Lock()
        # UTC day (YYYYMMDD) -> (when it was read, day_matches()).
        self._days = OrderedDict()
        # ESPN match id -> (FotMob match id or None, when to look again if None).
        self._ids = OrderedDict()
        # FotMob match id -> the last shape() that worked.
        self._kept = OrderedDict()

    def _get_json(self, url):
        raw = self._fetch(url)
        try:
            return json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except (UnicodeDecodeError, ValueError) as err:
            raise FotMobUnavailable("FotMob sent something the board couldn't read.") from err

    def extra(self, match):
        """The extras for one ESPN match (the board's shape), or None if FotMob hasn't any."""
        if match.get("league") not in LEAGUES:
            return None
        try:
            found = self._match_id(match)
            if found is None:
                return None
            shaped = shape(self._get_json(API + "matchDetails?matchId=%s" % found))
        except FotMobUnavailable as err:
            log.info("Couldn't read FotMob for match %s: %s", match.get("id"), err)
            with self._lock:
                kept = self._kept.get(self._ids.get(match.get("id"), (None,))[0])
            return kept
        except Exception:  # A changed answer is "nothing from FotMob", never a broken match page.
            log.exception("Couldn't make sense of FotMob's answer for match %s", match.get("id"))
            return None
        if shaped is None or shaped["id"] != found:
            return None
        with self._lock:
            self._kept[found] = shaped
            self._kept.move_to_end(found)
            while len(self._kept) > MAX_KEPT:
                self._kept.popitem(last=False)
        return shaped

    def _match_id(self, match):
        now = self._clock()
        with self._lock:
            known = self._ids.get(match["id"])
        if known is not None and (known[0] is not None or now < known[1]):
            return known[0]
        kickoff = match["kickoff"] / 1000
        # Its UTC day, and the day either side if the window runs over midnight.
        days = sorted({datetime.fromtimestamp(kickoff + shift, timezone.utc).strftime("%Y%m%d")
                       for shift in (-KICKOFF_WINDOW_SECONDS, 0, KICKOFF_WINDOW_SECONDS)})
        candidates = []
        for day in days:
            candidates += self._day(day, now)
        found = find_match(candidates, match)
        with self._lock:
            self._ids[match["id"]] = (found, now + NOT_FOUND_SECONDS)
            self._ids.move_to_end(match["id"])
            while len(self._ids) > MAX_IDS:
                self._ids.popitem(last=False)
        return found

    def _day(self, day, now):
        with self._lock:
            cached = self._days.get(day)
        if cached is not None and now - cached[0] < DAY_SECONDS:
            return cached[1]
        found = day_matches(self._get_json(API + "matches?date=%s" % day))
        with self._lock:
            self._days[day] = (now, found)
            self._days.move_to_end(day)
            while len(self._days) > MAX_DAYS:
                self._days.popitem(last=False)
        return found
