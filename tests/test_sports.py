import json
import unittest
from datetime import datetime, timezone

from board import sports
from board.store import ChangeFeed

SITE = sports.SITE_API
STANDINGS = sports.STANDINGS_API


def at(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def team(team_id, name, abbr, *, kind="soccer", short=None, color="e20520", logo=None):
    return {
        "id": team_id,
        "location": name,
        "displayName": name,
        "shortDisplayName": short or name,
        "abbreviation": abbr,
        "color": color,
        "logos": [{"href": "https://a.espncdn.com/i/teamlogos/%s/500/%s.png" % (kind, logo or team_id)}],
    }


ARSENAL = team("359", "Arsenal", "ARS")
SPURS = team("367", "Tottenham Hotspur", "TOT", short="Spurs", color="132257")
LEEDS = team("357", "Leeds United", "LEE", short="Leeds", color="ffffff")
LILLE = team("166", "Lille", "LIL")
LENS = team("175", "Lens", "RCL")
IPSWICH = team("373", "Ipswich Town", "IPS", short="Ipswich")
MARYLAND = team("5617", "Maryland", "MD", kind="ncaa", logo="120")
MICHIGAN = team("5682", "Michigan", "MICH", kind="ncaa", logo="130")
PITT = team("5700", "Pittsburgh", "PITT", kind="ncaa", logo="221")


def side(home_away, who, score, *, schedule, winner=False, shootout=None):
    competitor = {"id": who["id"], "homeAway": home_away, "team": who, "winner": winner}
    if score is not None:
        if schedule:
            competitor["score"] = {"value": float(score), "displayValue": str(score)}
            if shootout is not None:
                competitor["score"]["shootoutScore"] = float(shootout)
        else:
            competitor["score"] = str(score)
            if shootout is not None:
                competitor["shootoutScore"] = shootout
    return competitor


STATUSES = {
    "pre": ("STATUS_SCHEDULED", "Scheduled", False),
    "in": ("STATUS_SECOND_HALF", "2nd Half", False),
    "ht": ("STATUS_HALFTIME", "HT", False),
    "post": ("STATUS_FULL_TIME", "FT", True),
    "pens": ("STATUS_FINAL_PEN", "FT-Pens", True),
    "ppd": ("STATUS_POSTPONED", "Postponed", False),
}


def event(event_id, home, away, date, *, status="pre", score=(None, None), league="uefa.champions", schedule=False,
          clock="63'", shootout=(None, None), venue="Emirates Stadium", note=None):
    name, detail, completed = STATUSES[status]
    state = {"ht": "in", "pens": "post", "ppd": "post"}.get(status, status)
    home_score, away_score = score
    winner = None
    if completed and home_score is not None:
        if (home_score, shootout[0] or 0) > (away_score, shootout[1] or 0):
            winner = "home"
        elif (home_score, shootout[0] or 0) < (away_score, shootout[1] or 0):
            winner = "away"
    return {
        "id": event_id,
        "date": date,
        "name": "%s at %s" % (away["displayName"], home["displayName"]),
        "league": {"slug": league, "abbreviation": league},
        "competitions": [{
            "date": date,
            "venue": {"fullName": venue},
            "notes": [{"headline": note}] if note else [],
            "status": {"displayClock": clock, "period": 2,
                       "type": {"name": name, "state": state, "completed": completed, "shortDetail": detail}},
            "competitors": [
                side("home", home, home_score, schedule=schedule, winner=winner == "home", shootout=shootout[0]),
                side("away", away, away_score, schedule=schedule, winner=winner == "away", shootout=shootout[1]),
            ],
        }],
    }


def table_entry(rank, who, points, *, played=8, diff=0, note=None):
    stats = [
        {"name": "rank", "value": rank}, {"name": "gamesPlayed", "value": played}, {"name": "wins", "value": 4},
        {"name": "ties", "value": 3}, {"name": "losses", "value": 1}, {"name": "pointsFor", "value": 12},
        {"name": "pointsAgainst", "value": 7}, {"name": "pointDifferential", "value": diff, "displayValue": "%+d" % diff},
        {"name": "points", "value": points},
    ]
    entry = {"team": who, "stats": stats}
    if note:
        entry["note"] = {"description": note, "color": "#81D6AC"}
    return entry


BIG_TEN_PAGE = """
<html><body>
<table class="other"><tr><td>not this one</td></tr></table>
<table class="sidearm-table sidearm-standings-table">
 <thead><tr>
  <th class="hide-on-medium-down">TEAM</th><th class="hide-on-large" aria-hidden="true">School</th>
  <th class="hide-on-medium-down">PTS</th><th class="hide-on-large">Conf</th>
  <th class="hide-on-medium-down">CONF</th><th class="hide-on-medium-down">PCT</th>
  <th class="hide-on-medium-down">STRK</th><th class="hide-on-medium-down">OVR</th>
 </tr></thead>
 <tbody>
  <tr><td class="hide-on-medium-down"><div><img src="x.png" alt="Michigan"/><a href="#">Michigan</a></div></td>
      <td class="hide-on-large"><a>Michigan</a></td><td class="hide-on-medium-down">13</td><td class="hide-on-large">4-0-1</td>
      <td class="hide-on-medium-down">4-0-1</td><td class="hide-on-medium-down">.900</td>
      <td class="hide-on-medium-down">W2</td><td class="hide-on-medium-down">11-0-2</td></tr>
  <tr><td class="hide-on-medium-down"><a href="#">Maryland</a></td><td class="hide-on-large">Maryland</td>
      <td class="hide-on-medium-down">7</td><td class="hide-on-large">2-2-1</td>
      <td class="hide-on-medium-down">2-2-1</td><td class="hide-on-medium-down">.500</td>
      <td class="hide-on-medium-down">L1</td><td class="hide-on-medium-down">7-3-3</td></tr>
  <tr><td class="hide-on-medium-down">Broken row</td><td class="hide-on-medium-down">?</td></tr>
 </tbody>
</table>
</body></html>
"""


def roster(who, formation, starters, bench=()):
    entries = []
    for number, last, position, place, extra in starters:
        entries.append({"starter": True, "jersey": number, "formationPlace": str(place),
                        "position": {"abbreviation": position},
                        "athlete": {"id": "a%s%s" % (who["id"], number), "lastName": last, "displayName": "First %s" % last},
                        "stats": [{"name": key, "value": value} for key, value in extra.get("stats", {}).items()],
                        "plays": extra.get("plays", []), "subbedOut": extra.get("off", False)})
    for number, last, minute in bench:
        entries.append({"starter": False, "jersey": number, "formationPlace": "0", "position": {"abbreviation": "SUB"},
                        "athlete": {"id": "b%s%s" % (who["id"], number), "lastName": last, "displayName": "First %s" % last},
                        "subbedIn": minute is not None,
                        "plays": [{"substitution": True, "clock": {"displayValue": minute}}] if minute else []})
    return {"team": {"id": who["id"]}, "formation": formation, "roster": entries}


ARSENAL_XI = [
    ("1", "Raya", "G", 1, {}),
    ("4", "White", "RB", 2, {"stats": {"goalAssists": 1}, "off": True,
                             "plays": [{"substitution": True, "clock": {"displayValue": "63'"}}]}),
    ("33", "Calafiori", "LB", 3, {"stats": {"totalGoals": 1}}),
    ("49", "Lewis-Skelly", "LM", 4, {}),
    ("15", "Konsa", "CD-R", 5, {}),
    ("6", "Magalhaes", "CD-L", 6, {}),
    ("7", "Saka", "AM-R", 7, {}),
    ("41", "Rice", "RM", 8, {}),
    ("29", "Havertz", "F", 9, {}),
    ("8", "Odegaard", "AM", 10, {"plays": [{"yellowCard": True, "clock": {"displayValue": "84'"}}]}),
    ("20", "Madueke", "AM-L", 11, {}),
]
LEEDS_XI = [
    ("1", "Trafford", "G", 1, {}),
    ("2", "Bogle", "RM", 2, {}),
    ("3", "Gudmundsson", "LM", 3, {}),
    ("5", "Muharemovic", "CD-L", 4, {}),
    ("30", "Elvedi", "CD", 5, {}),
    ("24", "Justin", "CD-R", 6, {"stats": {"totalGoals": 1, "redCards": 1}}),
    ("4", "Ampadu", "CM-R", 7, {}),
    ("22", "Tanaka", "CM-L", 8, {}),
    ("9", "Calvert-Lewin", "F", 9, {}),
    ("18", "Stach", "CF-R", 10, {}),
    ("19", "Okafor", "CF-L", 11, {}),
]


def key_event(kind, minute, who=None, names=(), text="", **extra):
    found = {"type": {"type": kind}, "clock": {"displayValue": minute}, "text": text,
             "participants": [{"athlete": {"displayName": name}} for name in names], **extra}
    if who is not None:
        found["team"] = {"id": who["id"]}
    return found


def summary(home=ARSENAL, away=LEEDS, *, status="post", score=(2, 1), with_rosters=True):
    name, detail, completed = STATUSES[status]
    state = {"ht": "in", "pens": "post"}.get(status, status)
    return {
        "header": {"competitions": [{
            "status": {"displayClock": "90'+6'", "type": {"name": name, "state": state, "completed": completed,
                                                          "shortDetail": detail}},
            "competitors": [
                {"homeAway": "home", "score": str(score[0]), "winner": score[0] > score[1], "team": home},
                {"homeAway": "away", "score": str(score[1]), "winner": score[1] > score[0], "team": away},
            ],
        }]},
        "rosters": [roster(home, "4-2-3-1", ARSENAL_XI, [("12", "Timber", "63'"), ("22", "Eze", None)]),
                    roster(away, "3-4-2-1", LEEDS_XI)] if with_rosters else [],
        "keyEvents": [
            key_event("kickoff", ""),
            key_event("yellow-card", "36'", away, ["Ao Tanaka"]),
            key_event("halftime", "45'+3'"),
            key_event("goal", "55'", away, ["James Justin", "Gabriel Gudmundsson"],
                      "Goal! Arsenal 0, Leeds United 1. James Justin (Leeds United) right footed shot.", scoringPlay=True),
            key_event("goal---header", "62'", home, ["Riccardo Calafiori", "Ben White"],
                      "Goal! Arsenal 1, Leeds United 1. Riccardo Calafiori header.", scoringPlay=True),
            key_event("substitution", "63'", home, ["Jurrien Timber", "Ben White"]),
            key_event("own-goal", "70'", away, ["Jaka Bijol"], "Own Goal by Jaka Bijol, Leeds United.", scoringPlay=True),
            key_event("red-card", "88'", away, ["James Justin"]),
            key_event("goal", "", home, ["Saka"], "", scoringPlay=True, shootout=True),
            key_event("end-regular-time", "90'+6'"),
        ],
        "boxscore": {"teams": [
            {"team": {"id": home["id"]}, "statistics": [
                {"name": "possessionPct", "displayValue": "58.2"}, {"name": "totalShots", "displayValue": "13"},
                {"name": "accuratePasses", "displayValue": "436"}, {"name": "totalPasses", "displayValue": "513"},
                {"name": "passPct", "displayValue": "0.9"}, {"name": "yellowCards", "displayValue": "1"}]},
            {"team": {"id": away["id"]}, "statistics": [
                {"name": "possessionPct", "displayValue": "41.8"}, {"name": "totalShots", "displayValue": "11"},
                {"name": "accuratePasses", "displayValue": "277"}, {"name": "totalPasses", "displayValue": "354"},
                {"name": "passPct", "displayValue": "0.8"}]},
        ]},
        "gameInfo": {"venue": {"fullName": "Emirates Stadium"}, "attendance": 60315,
                     "officials": [{"displayName": "Anthony Taylor"}]},
    }


class FakeESPN:
    """Answers the board's ESPN and Big Ten requests from a table of URLs."""

    def __init__(self, pages=None):
        self.pages = dict(pages or {})
        self.calls = []
        self.down = False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise sports.SportsUnavailable("offline")
        found = self.pages.get(url)
        if found is None:
            # A scoreboard for a day with nothing on, a schedule with nothing in it.
            if "/scoreboard?" in url or "/schedule" in url:
                return json.dumps({"events": []}).encode()
            raise sports.SportsUnavailable("no page at %s" % url)
        return found.encode() if isinstance(found, str) else json.dumps(found).encode()

    def count(self, part):
        return sum(1 for url in self.calls if part in url)


# Monday 12 October 2026, noon in London: the day before Arsenal play Lille.
NOW = at("2026-10-12T11:00Z")


def espn_pages():
    """A week of the board's sources, as ESPN and the Big Ten would answer."""
    return {
        SITE + "all/teams/359/schedule": {"events": [
            event("1001", ARSENAL, LEEDS, "2026-10-10T11:30Z", status="post", score=(2, 1), league="eng.1", schedule=True),
            event("1002", IPSWICH, ARSENAL, "2026-09-15T19:00Z", status="pens", score=(1, 1), shootout=(3, 4),
                  league="eng.league_cup", schedule=True, note="Arsenal win 4-3 on penalties"),
            event("1003", ARSENAL, LILLE, "2026-08-01T18:00Z", status="post", score=(3, 0), league="club.friendly",
                  schedule=True),
        ]},
        SITE + "all/teams/359/schedule?fixture=true": {"events": [
            event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z", league="uefa.champions", schedule=True),
        ]},
        SITE + "all/teams/367/schedule?fixture=true": {"events": [
            event("2002", SPURS, LEEDS, "2026-10-19T19:00Z", league="eng.1", schedule=True),
        ]},
        SITE + "usa.ncaa.m.1/teams/5617/schedule": {"events": [
            event("3001", PITT, MARYLAND, "2026-08-20T23:00Z", status="post", score=(2, 1), league="usa.ncaa.m.1",
                  schedule=True),
            event("3002", MICHIGAN, MARYLAND, "2026-10-09T23:30Z", status="post", score=(1, 2), schedule=True,
                  league="usa.ncaa.m.1"),
        ]},
        SITE + "uefa.champions/scoreboard?dates=20261013": {"events": [
            event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z"),
            event("2003", LENS, LEEDS, "2026-10-13T16:45Z"),
        ]},
        STANDINGS + "eng.1/standings": {"children": [{"name": "2026-27 Premier League", "standings": {"entries": [
            table_entry(2, ARSENAL, 15, diff=8, note="Champions League"),
            table_entry(1, LEEDS, 16, diff=9, note="Champions League"),
            table_entry(3, SPURS, 13, diff=-2, note="Europa League"),
            table_entry(20, IPSWICH, 1, diff=-15, note="Relegation"),
        ]}}]},
        STANDINGS + "uefa.champions/standings": {"children": [{"name": "League Phase", "standings": {"entries": [
            table_entry(1, LILLE, 6, played=2, note="Qualifies for round of 16"),
            table_entry(2, ARSENAL, 4, played=2, note="Knockout phase playoffs - seeded"),
            table_entry(3, LENS, 0, played=2, note="Eliminated"),
        ]}}]},
        sports.BIG_TEN_URL % "msoc": BIG_TEN_PAGE,
        SITE + "eng.1/summary?event=1001": summary(),
        SITE + "uefa.champions/summary?event=2001": summary(ARSENAL, LILLE, status="pre", score=(0, 0),
                                                           with_rosters=False),
    }


def make(pages=None, now=NOW, **options):
    clock = [now]
    api = FakeESPN(espn_pages() if pages is None else pages)
    crests = []

    def fetch_crest(url):
        crests.append(url)
        return b"\x89PNG", "image/png"

    found = sports.Sports(fetch=api, fetch_crest=fetch_crest, clock=lambda: clock[0], **options)
    return found, api, clock, crests


def by_id(snapshot):
    return {m["id"]: m for m in snapshot["matches"]}


class FollowsTest(unittest.TestCase):
    def test_the_board_follows_arsenal_spurs_chelsea_maryland_men_and_the_champions_league(self):
        follows = sports.follows_from(None)
        self.assertEqual([t["id"] for t in follows.teams], ["arsenal", "tottenham", "chelsea", "maryland"])
        self.assertEqual(follows.teams[2]["espn"], "363")
        self.assertEqual(follows.teams[3]["leagues"], ("usa.ncaa.m.1",))
        self.assertEqual([c["id"] for c in follows.competitions], ["ucl"])
        self.assertEqual(follows.tables, ("eng.1", "uefa.champions", "big-ten"))
        self.assertEqual(set(follows.teams[0]["leagues"]), {"eng.1", "eng.fa", "eng.league_cup", "uefa.champions"})

    def test_the_womens_team_instead(self):
        follows = sports.follows_from({"maryland": "women"})
        self.assertEqual(follows.teams[3]["espn"], "20341")
        self.assertEqual(follows.big_ten, "wsoc")

    def test_a_typo_falls_back_to_the_mens_team_and_false_follows_nothing(self):
        with self.assertLogs("board.sports", level="WARNING"):
            self.assertEqual(sports.follows_from({"maryland": "both"}).teams[3]["espn"], "5617")
        off = sports.follows_from(False)
        self.assertEqual((off.teams, off.competitions, off.tables), ((), (), ()))


class ShapeTest(unittest.TestCase):
    def test_a_schedule_event_and_a_scoreboard_event_come_out_the_same(self):
        from_schedule = sports.shape_match(event("9", ARSENAL, LEEDS, "2026-10-10T11:30Z", status="post",
                                                 score=(2, 1), schedule=True), "eng.1")
        from_scoreboard = sports.shape_match(event("9", ARSENAL, LEEDS, "2026-10-10T11:30Z", status="post",
                                                   score=(2, 1)), "eng.1")
        self.assertEqual(from_schedule, from_scoreboard)
        self.assertEqual(from_schedule["kickoff"], int(at("2026-10-10T11:30Z") * 1000))
        self.assertEqual(from_schedule["competition"], "Premier League")
        self.assertEqual(from_schedule["table"], "eng.1")
        self.assertEqual((from_schedule["home"]["score"], from_schedule["away"]["score"]), (2, 1))
        self.assertTrue(from_schedule["home"]["winner"])
        self.assertEqual(from_schedule["home"]["crest"], "soccer:359")
        self.assertEqual(from_schedule["away"]["color"], "ffffff")
        self.assertEqual(from_schedule["status"], {"state": "post", "name": "STATUS_FULL_TIME", "detail": "FT",
                                                   "clock": None, "period": 2, "completed": True})

    def test_a_shootout_and_a_live_clock(self):
        pens = sports.shape_match(event("9", IPSWICH, ARSENAL, "2026-09-15T19:00Z", status="pens", score=(1, 1),
                                        shootout=(3, 4), schedule=True), "eng.league_cup")
        self.assertEqual((pens["home"]["shootout"], pens["away"]["shootout"]), (3, 4))
        self.assertTrue(pens["away"]["winner"])
        self.assertIsNone(pens["table"], "a cup tie has no table of its own")
        live = sports.shape_match(event("9", ARSENAL, LILLE, "2026-10-13T19:00Z", status="in", score=(1, 0)),
                                  "uefa.champions")
        self.assertEqual((live["status"]["state"], live["status"]["clock"]), ("in", "63'"))

    def test_an_upcoming_match_has_no_score_even_if_espn_sends_zeros(self):
        found = sports.shape_match(event("9", ARSENAL, LILLE, "2026-10-13T19:00Z", score=(0, 0)), "uefa.champions")
        self.assertIsNone(found["home"]["score"])

    def test_junk_is_skipped(self):
        self.assertIsNone(sports.shape_match({"id": "x"}, "eng.1"))
        self.assertIsNone(sports.shape_match({"id": "1", "competitions": [{"competitors": []}]}, "eng.1"))
        self.assertIsNone(sports.shape_match("nope", "eng.1"))
        self.assertIsNone(sports.crest_of({"logo": "https://evil.example/i/teamlogos/soccer/500/1.png"}))

    def test_espn_counts_days_in_the_us_east(self):
        # An 8pm Eastern kickoff is that day on ESPN's scoreboard, not the next one (as it is in UTC).
        self.assertEqual(sports.espn_day(at("2026-09-19T00:00Z")), "20260918")
        self.assertEqual(sports.espn_day(at("2026-10-13T19:00Z")), "20261013")


class LineupTest(unittest.TestCase):
    def lines(self, formation, eleven):
        starters = [sports.shape_player(entry) for entry in roster(ARSENAL, formation, eleven)["roster"]]
        return [[player["name"] for player in line] for line in sports.formation_lines(formation, starters)]

    def test_a_4_2_3_1_from_the_keeper_forward_and_from_the_teams_left(self):
        # ESPN calls the two holding midfielders LM and RM; the formation still puts them in a pair.
        self.assertEqual(self.lines("4-2-3-1", ARSENAL_XI), [
            ["Raya"],
            ["Calafiori", "Magalhaes", "Konsa", "White"],
            ["Lewis-Skelly", "Rice"],
            ["Madueke", "Odegaard", "Saka"],
            ["Havertz"],
        ])

    def test_a_3_4_2_1_puts_the_striker_alone_up_front(self):
        self.assertEqual(self.lines("3-4-2-1", LEEDS_XI), [
            ["Trafford"],
            ["Muharemovic", "Elvedi", "Justin"],
            ["Gudmundsson", "Tanaka", "Ampadu", "Bogle"],
            ["Okafor", "Stach"],
            ["Calvert-Lewin"],
        ])

    def test_a_formation_that_doesnt_add_up_falls_back_to_one_line_per_depth(self):
        lines = self.lines("4-4-2", ARSENAL_XI[:6])
        self.assertEqual(lines, [["Raya"], ["Calafiori", "Magalhaes", "Konsa", "White"], ["Lewis-Skelly"]])

    def test_players_carry_their_goals_cards_and_substitutions(self):
        players = {p["name"]: p for p in map(sports.shape_player, roster(ARSENAL, "4-2-3-1", ARSENAL_XI)["roster"])}
        self.assertEqual(players["Calafiori"]["goals"], 1)
        self.assertEqual((players["White"]["assists"], players["White"]["off"]), (1, "63'"))
        self.assertTrue(players["Odegaard"]["yellow"])
        self.assertEqual(players["Raya"]["number"], "1")


class DetailTest(unittest.TestCase):
    def setUp(self):
        match = sports.shape_match(event("1001", ARSENAL, LEEDS, "2026-10-10T11:30Z", status="post", score=(2, 1),
                                         league="eng.1"), "eng.1")
        self.detail = sports.shape_detail(summary(), match)

    def test_the_timeline_keeps_score_and_skips_the_shootout(self):
        events = [(e["minute"], e["type"], e["side"], e.get("score")) for e in self.detail["events"]]
        self.assertEqual(events, [
            ("36'", "yellow", "away", None),
            ("45'+3'", "break", None, [0, 0]),
            ("55'", "goal", "away", [0, 1]),
            ("62'", "goal", "home", [1, 1]),
            ("63'", "sub", "home", None),
            # No score in the text: an own goal by Leeds counts for Arsenal.
            ("70'", "own-goal", "away", [2, 1]),
            ("88'", "red", "away", None),
            ("90'+6'", "break", None, [2, 1]),
        ])
        goal = self.detail["events"][2]
        self.assertEqual((goal["player"], goal["assist"]), ("James Justin", "Gabriel Gudmundsson"))
        sub = self.detail["events"][4]
        self.assertEqual((sub["player"], sub["out"]), ("Jurrien Timber", "Ben White"))

    def test_stats_are_in_order_with_pass_accuracy_worked_out(self):
        self.assertEqual([(s["label"], s["home"], s["away"]) for s in self.detail["stats"]], [
            ("Possession", 58, 42), ("Total shots", 13, 11), ("Passes", 513, 354), ("Pass accuracy", 85, 78),
        ])

    def test_shirt_colours_come_from_the_summary(self):
        match = sports.shape_match(event("1001", {**ARSENAL, "color": None}, LEEDS, "2026-10-10T11:30Z"), "eng.1")
        self.assertIsNone(match["home"]["color"])
        self.assertEqual(sports.shape_detail(summary(), match)["home"]["color"], "e20520")

    def test_line_ups_bench_and_match_facts(self):
        home = self.detail["home"]
        self.assertEqual(home["formation"], "4-2-3-1")
        self.assertEqual(len(home["lines"]), 5)
        self.assertEqual([p["name"] for p in home["bench"]], ["Timber", "Eze"], "who came on first")
        self.assertEqual(home["bench"][0]["on"], "63'")
        self.assertEqual((self.detail["referee"], self.detail["attendance"]), ("Anthony Taylor", 60315))
        self.assertNotIn("follows", self.detail)


class TablesTest(unittest.TestCase):
    def test_espn_tables_are_in_rank_order_with_their_zones(self):
        table = sports.shape_espn_table(espn_pages()[STANDINGS + "eng.1/standings"], "eng.1")
        rows = table["groups"][0]["rows"]
        self.assertEqual([r["team"]["abbr"] for r in rows], ["LEE", "ARS", "TOT", "IPS"])
        self.assertEqual(rows[1]["diff"], 8)
        self.assertEqual([r["zone"]["level"] for r in rows], [1, 1, 2, "down"])
        self.assertEqual(table["name"], "Premier League")
        self.assertIsNone(sports.shape_espn_table({"children": []}, "eng.1"))

    def test_the_big_ten_page(self):
        rows = sports.parse_big_ten(BIG_TEN_PAGE)
        self.assertEqual([(r["rank"], r["team"]["name"], r["points"], r["won"], r["lost"], r["drawn"], r["played"])
                          for r in rows], [(1, "Michigan", 13, 4, 0, 1, 5), (2, "Maryland", 7, 2, 2, 1, 5)])
        self.assertEqual((rows[0]["overall"], rows[0]["streak"]), ("11-0-2", "W2"))
        self.assertIsNone(sports.parse_big_ten("<html>no table here</html>"))
        self.assertIsNone(sports.parse_big_ten("<table class='sidearm-standings-table'><tr><td>x"))


class SportsTest(unittest.TestCase):
    def test_one_pass_reads_every_schedule_and_table_and_pushes_them(self):
        feed = ChangeFeed()
        found, api, clock, _ = make(feed=feed)
        seq = feed.seq
        found.poll()
        self.assertGreater(feed.seq, seq)
        snap = found.snapshot()
        matches = by_id(snap)
        self.assertIsNone(snap["error"])
        self.assertNotIn("1003", matches, "friendlies aren't followed")
        self.assertNotIn("3001", matches, "too long ago to keep")
        self.assertEqual(matches["2001"]["follows"], ["arsenal", "ucl"])
        self.assertEqual(matches["2003"]["follows"], ["ucl"])
        self.assertEqual(matches["1002"]["table"], "eng.1", "a cup tie shows its team's league")
        self.assertEqual([m["kickoff"] for m in snap["matches"]], sorted(m["kickoff"] for m in snap["matches"]))
        self.assertEqual(set(snap["tables"]), {"eng.1", "uefa.champions", "big-ten"})
        self.assertEqual(api.count("/scoreboard?dates="), len(sports.COMPETITION_DAYS))
        follows = {f["id"]: f for f in snap["follows"]}
        self.assertEqual(follows["arsenal"]["crest"], "soccer:359")
        self.assertEqual(follows["maryland"]["crest"], "ncaa:120")

    def test_maryland_conference_games_and_the_big_ten_table_borrow_espns_names(self):
        found, *_ = make()
        found.poll()
        snap = found.snapshot()
        self.assertEqual(by_id(snap)["3002"]["competition"], "Big Ten")
        rows = snap["tables"]["big-ten"]["groups"][0]["rows"]
        self.assertEqual([(r["team"]["abbr"], r["team"]["crest"], r["team"]["id"]) for r in rows],
                         [("MICH", "ncaa:130", "5682"), ("MD", "ncaa:120", "5617")])

    def test_nothing_new_means_no_new_version(self):
        found, *_ = make()
        found.poll()
        version = found.snapshot()["version"]
        found.poll()
        self.assertEqual(found.snapshot()["version"], version)

    def test_it_sleeps_until_the_next_thing_worth_reading(self):
        found, api, clock, _ = make()
        delay = found.poll()
        self.assertLessEqual(delay, sports.SCHEDULE_SECONDS)
        # The Lens match kicks off at 16:45 the next day; the schedule comes round first.
        self.assertEqual(delay, sports.SCHEDULE_SECONDS)
        clock[0] = at("2026-10-13T16:20Z")
        found.poll()
        delay = found.poll()
        self.assertEqual(delay, at("2026-10-13T16:45Z") - sports.LIVE_LEAD_SECONDS - clock[0])

    def test_a_match_on_now_is_followed_on_its_scoreboard(self):
        pages = espn_pages()
        found, api, clock, _ = make(pages)
        found.poll()
        clock[0] = at("2026-10-13T19:40Z")
        board = SITE + "uefa.champions/scoreboard?dates=20261013"
        api.pages[board] = {"events": [event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z", status="in", score=(1, 0)),
                                       event("2003", LENS, LEEDS, "2026-10-13T16:45Z", status="post", score=(0, 2))]}
        version = found.snapshot()["version"]
        self.assertEqual(found.poll(), sports.LIVE_POLL_SECONDS)
        live = by_id(found.snapshot())["2001"]
        self.assertEqual((live["status"]["state"], live["home"]["score"], live["status"]["clock"]), ("in", 1, "63'"))
        self.assertGreater(found.snapshot()["version"], version)

        # Full time: the tables are read again a few minutes later, once ESPN has caught up.
        api.pages[board] = {"events": [event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z", status="post", score=(2, 0))]}
        found.poll()
        tables_read = api.count(STANDINGS)
        clock[0] += sports.TABLE_AFTER_FINAL_SECONDS[0] + 1
        found.poll()
        self.assertEqual(api.count(STANDINGS), tables_read + 2, "the Premier League's and the Champions League's")

    def test_the_hourly_schedule_never_steps_a_live_match_back(self):
        found, api, clock, _ = make()
        found.poll()
        clock[0] = at("2026-10-13T19:40Z")
        api.pages[SITE + "uefa.champions/scoreboard?dates=20261013"] = {"events": [
            event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z", status="in", score=(1, 0))]}
        found.poll()
        # The schedule comes round while ESPN's copy of it still says "not started".
        clock[0] += sports.SCHEDULE_SECONDS
        api.pages[SITE + "uefa.champions/scoreboard?dates=20261013"] = {"events": []}
        found.poll()
        self.assertEqual(by_id(found.snapshot())["2001"]["home"]["score"], 1)

    def test_when_espn_is_down_the_board_keeps_what_it_had(self):
        found, api, clock, _ = make()
        found.poll()
        before = by_id(found.snapshot())
        api.down = True
        clock[0] += sports.SCHEDULE_SECONDS + 1
        with self.assertLogs("board.sports", level="INFO"):
            delay = found.poll()
        snap = found.snapshot()
        self.assertEqual(set(by_id(snap)), set(before))
        self.assertEqual(set(snap["tables"]), {"eng.1", "uefa.champions", "big-ten"})
        self.assertEqual(snap["error"], "offline")
        self.assertLessEqual(delay, sports.ERROR_POLL_SECONDS)
        api.down = False
        clock[0] += sports.ERROR_POLL_SECONDS + 1
        found.poll()
        self.assertIsNone(found.snapshot()["error"])

    def test_following_nothing_never_goes_online(self):
        found, api, *_ = make(follows=sports.follows_from(False))
        found.poll()
        self.assertEqual(api.calls, [])
        self.assertEqual(found.snapshot()["matches"], [])


class MatchPageTest(unittest.TestCase):
    def test_a_match_page_is_read_once_then_kept(self):
        found, api, clock, _ = make()
        found.poll()
        page = found.match("1001")
        self.assertEqual(page["home"]["formation"], "4-2-3-1")
        self.assertEqual(page["status"]["detail"], "FT")
        found.match("1001")
        self.assertEqual(api.count("summary?event=1001"), 1)

    def test_only_matches_the_board_knows(self):
        found, *_ = make()
        found.poll()
        self.assertIsNone(found.match("424242"))
        with self.assertRaises(ValueError):
            found.match("../etc")

    def test_an_open_live_match_stays_fresh_and_tells_screens(self):
        found, api, clock, _ = make()
        found.poll()
        clock[0] = at("2026-10-13T19:40Z")
        board = SITE + "uefa.champions/scoreboard?dates=20261013"
        api.pages[board] = {"events": [event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z", status="in", score=(1, 0))]}
        found.poll()
        api.pages[SITE + "uefa.champions/summary?event=2001"] = summary(ARSENAL, LILLE, status="in", score=(1, 0))
        found.match("2001")
        reads = api.count("summary?event=2001")
        detail = by_id(found.snapshot())["2001"]["detail"]
        # A goal: the scoreboard moves, so the page is read again on the same pass.
        api.pages[board] = {"events": [event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z", status="in", score=(2, 0))]}
        api.pages[SITE + "uefa.champions/summary?event=2001"] = summary(ARSENAL, LILLE, status="in", score=(2, 0))
        clock[0] += 30
        found.poll()
        self.assertEqual(api.count("summary?event=2001"), reads + 1)
        self.assertGreater(by_id(found.snapshot())["2001"]["detail"], detail)

    def test_a_followed_teams_line_up_is_read_ahead_of_kickoff(self):
        found, api, clock, _ = make()
        found.poll()
        clock[0] = at("2026-10-13T18:00Z")
        found.poll()
        self.assertEqual(api.count("summary?event=2001"), 1)
        self.assertEqual(api.count("summary?event=2003"), 0, "nobody follows Lens")

    def test_if_espn_fails_the_last_page_is_kept(self):
        found, api, clock, _ = make()
        found.poll()
        found.match("1001")
        api.down = True
        clock[0] += sports.DETAIL_FINISHED_SECONDS + 1
        self.assertEqual(found.match("1001")["home"]["name"], "Arsenal")
        with self.assertRaises(sports.SportsUnavailable):
            found.match("1002")


class CrestTest(unittest.TestCase):
    def test_only_crests_the_board_has_shown_and_each_once(self):
        found, api, clock, crests = make()
        with self.assertRaises(ValueError):
            found.crest("soccer:../../x")
        self.assertIsNone(found.crest("soccer:359"), "nothing shown yet")
        found.poll()
        self.assertEqual(found.crest("soccer:359"), (b"\x89PNG", "image/png"))
        found.crest("soccer:359")
        self.assertEqual(crests, ["https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/359.png&w=160&h=160"])
        self.assertIsNone(found.crest("soccer:999"))

    def test_screens_asking_for_the_same_new_crest_share_one_fetch(self):
        import threading
        found, api, clock, crests = make()
        found.poll()
        started, release = threading.Event(), threading.Event()

        def slow(url):
            crests.append(url)
            started.set()
            release.wait(2)
            return b"\x89PNG", "image/png"

        found._fetch_crest = slow
        answers = []
        askers = [threading.Thread(target=lambda: answers.append(found.crest("soccer:166"))) for _ in range(3)]
        askers[0].start()
        started.wait(2)
        for asker in askers[1:]:
            asker.start()
        release.set()
        for asker in askers:
            asker.join(2)
        self.assertEqual(answers, [(b"\x89PNG", "image/png")] * 3)
        self.assertEqual(len(crests), 1)


if __name__ == "__main__":
    unittest.main()
