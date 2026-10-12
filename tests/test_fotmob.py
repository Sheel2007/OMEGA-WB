import json
import unittest

from board import fotmob, sports
from tests.test_sports import ARSENAL, LILLE, NOW, SITE, at, espn_pages, event, make, summary

ARSENAL_ID, LILLE_ID, LEEDS_ID = 9825, 8639, 8463


def day(*matches, league=42):
    """FotMob's list of a day's matches."""
    return {"leagues": [
        {"id": 900000 + league, "primaryId": league, "name": "League", "matches": [
            {"id": int(match_id), "home": {"name": home, "longName": home}, "away": {"name": away, "longName": away},
             "status": {"utcTime": when}}
            for match_id, home, away, when in matches]},
        {"id": 555, "primaryId": 9806, "name": "Nations League", "matches": [
            {"id": 1, "home": {"name": "Arsenal"}, "away": {"name": "Lille"}, "status": {"utcTime": "2026-10-13T19:00:00.000Z"}}]},
    ]}


def lineup_player(player_id, name, number, x, y, *, last=None, rating=None, events=(), swaps=()):
    performance = {"events": [{"type": kind} for kind in events],
                   "substitutionEvents": [{"time": minute, "type": kind} for kind, minute in swaps]}
    if rating is not None:
        performance["rating"] = rating
    found = {"id": player_id, "name": name, "lastName": last or name.split()[-1], "shirtNumber": number,
             "performance": performance}
    if x is not None:
        found["verticalLayout"] = {"x": x, "y": y}
    return found


# Arsenal's 4-2-3-1 as FotMob lays it out: own goal at the top, x from the team's right.
ARSENAL_XI = [
    lineup_player(1, "David Raya", "1", 0.5, 0.1, rating=7.8),
    lineup_player(4, "Ben White", "4", 0.125, 0.292, rating=7.8, events=["assist"], swaps=[("subOut", 63)]),
    lineup_player(15, "Ezri Konsa", "15", 0.375, 0.292),
    lineup_player(6, "Gabriel", "6", 0.625, 0.292, last=""),
    lineup_player(33, "Riccardo Calafiori", "33", 0.875, 0.292, rating=8.0, events=["goal"]),
    lineup_player(41, "Declan Rice", "41", 0.3, 0.485, rating=8.3),
    lineup_player(49, "Myles Lewis-Skelly", "49", 0.7, 0.485),
    lineup_player(7, "Bukayo Saka", "7", 0.162, 0.678, events=["yellowCard"]),
    lineup_player(8, "Martin Ødegaard", "8", 0.5, 0.678),
    lineup_player(20, "Noni Madueke", "20", 0.837, 0.678),
    lineup_player(29, "Kai Havertz", "29", 0.5, 0.87),
]
ARSENAL_SUBS = [
    lineup_player(5, "Piero Hincapié", "5", None, None, swaps=[("subIn", 82)]),
    lineup_player(12, "Jurriën Timber", "12", None, None, rating=6.3, swaps=[("subIn", 63)]),
]


def referee_stats():
    return [
        {"type": "matches", "value": 34, "valueType": "total"},
        {"type": "yellowCards", "value": 4.15, "valueType": "perMatch", "average": 3.8, "total": 141,
         "fillPercentage": 63.83, "averagePercentage": 50},
        {"type": "redCards", "value": 3, "valueType": "total"},
        {"type": "penalties", "value": 11, "valueType": "total"},
        {"type": "fouls", "value": 20.27, "valueType": "perMatch", "average": 21.16, "total": 608,
         "fillPercentage": 37.33, "averagePercentage": 50},
    ]


def form_game(result, score, home, away, ours_home):
    return {"resultString": result, "score": score, "date": {"utcTime": "2026-09-06T15:30:00.000Z"},
            "home": {"name": home, "isOurTeam": ours_home}, "away": {"name": away, "isOurTeam": not ours_home}}


def details(match_id=6106260, *, kind="predicted", home_xi=ARSENAL_XI, with_stats=False):
    """FotMob's match details, cut down to what the board reads."""
    content = {
        "matchFacts": {
            "infoBox": {"Referee": {"text": "Felix Zwayer", "country": "Germany", "leagueName": "Bundesliga",
                                    "stats": referee_stats()}},
            "teamForm": [
                [form_game("W", "2 - 1", "Arsenal", "Chelsea", True), form_game("L", "1 - 0", "Napoli", "Arsenal", False)],
                [form_game("D", "1 - 1", "Lille", "Lens", True)],
            ],
            "insights": [{"type": "team", "teamId": ARSENAL_ID, "text": "Have scored 9 goals in their last 5 matches"},
                         {"type": "team", "teamId": LILLE_ID, "text": "Have scored 9 goals in their last 5 matches"},
                         {"type": "team", "teamId": LILLE_ID, "text": "Have scored 9 goals in their last 5 matches"},
                         {"type": "team", "teamId": ARSENAL_ID, "text": "Arsenal haven't lost to Lille"},
                         {"type": "player", "teamId": LILLE_ID, "text": "Jonathan David has scored 5"},
                         {"text": None}],
            "playerOfTheMatch": {},
            "topPlayers": {"homeTopPlayers": [], "awayTopPlayers": []},
        },
        "lineup": {
            "lineupType": kind,
            "homeTeam": {"id": ARSENAL_ID, "formation": "4-2-3-1", "coach": {"name": "Mikel Arteta"},
                         "starters": home_xi, "subs": ARSENAL_SUBS,
                         "unavailable": [{"name": "William Saliba", "unavailability": {"type": "injury",
                                                                                      "expectedReturn": "Doubtful"}}]},
            "awayTeam": {"id": LILLE_ID, "formation": "4-3-3", "starters": [], "subs": []},
        },
        "h2h": {"summary": [3, 1, 0], "matches": [
            {"status": {"utcTime": "2027-05-08T14:00:00.000Z", "finished": False}, "home": {"name": "Lille"},
             "away": {"name": "Arsenal"}},
            {"status": {"utcTime": "2023-04-01T14:00:00.000Z", "finished": True, "scoreStr": "4 - 1"},
             "home": {"name": "Arsenal"}, "away": {"name": "Lille"}, "league": {"name": "Champions League"}},
        ]},
    }
    if with_stats:
        content["stats"] = {"Periods": {"All": {"stats": [{"key": "top_stats", "stats": [
            {"key": "BallPossesion", "rawStats": [{"value": 58}, {"value": 42}]},
            {"key": "expected_goals", "rawStats": [{"value": 2.33}, {"value": 0.62}]},
            {"key": "big_chance", "rawStats": [{"value": 4}, {"value": 2}]},
        ]}]}}}
        content["playerStats"] = {"41": {
            "name": "Declan Rice", "teamId": ARSENAL_ID, "shirtNumber": "41", "isGoalkeeper": False,
            "stats": [{"title": "Top stats", "stats": {
                "FotMob rating": {"key": "rating_title", "stat": {"value": 8.28, "type": "double"}},
                "Minutes played": {"key": "minutes_played", "stat": {"value": 90, "type": "integer"}},
                "Expected assists (xA)": {"key": "expected_assists", "stat": {"value": 0.08, "type": "double"}},
                "Accurate passes": {"key": "accurate_passes", "stat": {"value": 47, "total": 58,
                                                                       "type": "fractionWithPercentage"}},
                "Top speed": {"key": "physical_metrics_topspeed", "stat": {"value": 28, "type": "speed"}},
                "Distance covered": {"key": "physical_metrics_distance_covered",
                                     "stat": {"value": 11106, "type": "distance"}},
                "Shotmap": {"key": None, "stat": {"value": 0, "type": "boolean"}},
                "Duels won": {"key": "duel_won", "stat": {"value": 3, "type": "integer"}, "hideInPopupCard": True},
            }}],
        }, "999": {"name": "Unused Sub", "teamId": LILLE_ID, "stats": []}}
        content["matchFacts"]["playerOfTheMatch"] = {
            "id": 41, "name": {"fullName": "Declan Rice"}, "teamName": "Arsenal",
            "rating": {"num": "8.3", "isTop": {"isMatchFinished": True}}}
        content["matchFacts"]["topPlayers"] = {"homeTopPlayers": [
            {"playerId": 41, "name": {"fullName": "Declan Rice"}, "playerRating": 8.28}], "awayTopPlayers": []}
    return {"general": {"matchId": str(match_id), "homeTeam": {"id": ARSENAL_ID, "name": "Arsenal"},
                        "awayTeam": {"id": LILLE_ID, "name": "Lille"}},
            "content": content}


ESPN_MATCH = {"id": "2001", "league": "uefa.champions", "kickoff": int(at("2026-10-13T19:00Z") * 1000),
              "home": {"name": "Arsenal", "short": "Arsenal"}, "away": {"name": "Lille", "short": "Lille"}}
CL_DAY = day(("6106414", "Lens", "Sporting CP", "2026-10-13T16:45:00.000Z"),
             ("6106260", "Arsenal", "Lille", "2026-10-13T19:00:00.000Z"),
             ("6106261", "Bayern München", "Inter", "2026-10-13T19:00:00.000Z"))


class FakeFotMob:
    def __init__(self, pages):
        self.pages = dict(pages)
        self.calls = []
        self.down = False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise fotmob.FotMobUnavailable("offline")
        found = self.pages.get(url)
        if found is None:
            raise fotmob.FotMobUnavailable("no page at %s" % url)
        return json.dumps(found).encode()

    def count(self, part):
        return sum(1 for url in self.calls if part in url)


def fotmob_pages():
    return {fotmob.API + "matches?date=20261013": CL_DAY,
            fotmob.API + "matchDetails?matchId=6106260": details()}


class NamesTest(unittest.TestCase):
    def test_the_same_team_by_another_name(self):
        for ours, theirs in [("Tottenham Hotspur", "Tottenham"), ("Manchester United", "Man United"),
                             ("Internazionale", "Inter"), ("Arsenal FC", "Arsenal"), ("Martin Odegaard", "Martin Ødegaard")]:
            self.assertGreaterEqual(fotmob.name_similarity(ours, theirs), 0.9, (ours, theirs))
        self.assertGreaterEqual(fotmob.name_similarity("Bayern Munich", "Bayern München"), 0.85)

    def test_different_teams(self):
        self.assertLess(fotmob.name_similarity("Arsenal", "Lille"), 0.5)
        self.assertLess(fotmob.name_similarity("Manchester City", "Manchester United"), 0.85)
        self.assertEqual(fotmob.name_similarity("", "Arsenal"), 0)


class FindTest(unittest.TestCase):
    def candidates(self):
        return fotmob.day_matches(CL_DAY)

    def test_only_the_followed_competitions_are_kept(self):
        self.assertEqual([c["id"] for c in self.candidates()], ["6106414", "6106260", "6106261"])

    def test_the_match_with_the_same_teams_at_the_same_time(self):
        self.assertEqual(fotmob.find_match(self.candidates(), ESPN_MATCH), "6106260")
        bayern = dict(ESPN_MATCH, home={"name": "Bayern Munich", "short": "Bayern"},
                      away={"name": "Internazionale", "short": "Inter"})
        self.assertEqual(fotmob.find_match(self.candidates(), bayern), "6106261")

    def test_nothing_when_the_teams_or_the_time_or_the_competition_are_wrong(self):
        self.assertIsNone(fotmob.find_match(self.candidates(), dict(ESPN_MATCH, away={"name": "Leeds United"},
                                                                    home={"name": "Ipswich Town"})))
        later = dict(ESPN_MATCH, kickoff=ESPN_MATCH["kickoff"] + 5 * 60 * 60 * 1000)
        self.assertIsNone(fotmob.find_match(self.candidates(), later))
        self.assertIsNone(fotmob.find_match(self.candidates(), dict(ESPN_MATCH, league="eng.1")))
        self.assertIsNone(fotmob.find_match(self.candidates(), dict(ESPN_MATCH, league="usa.ncaa.m.1")))


class ShapeTest(unittest.TestCase):
    def test_the_referees_record(self):
        referee = fotmob.shape(details())["referee"]
        self.assertEqual(referee["name"], "Felix Zwayer")
        self.assertEqual((referee["matches"], referee["reds"], referee["penalties"]), (34, 3, 11))
        self.assertEqual(referee["fouls"], {"perMatch": 20.27, "average": 21.16, "total": 608, "fill": 37.3, "mark": 50.0})
        self.assertEqual(referee["yellows"]["perMatch"], 4.15)

    def test_predicted_line_up_and_whos_out(self):
        shaped = fotmob.shape(details())
        self.assertEqual(shaped["lineup"], "predicted")
        home = shaped["home"]
        self.assertEqual((home["formation"], home["coach"]), ("4-2-3-1", "Mikel Arteta"))
        self.assertEqual(home["out"], [{"name": "William Saliba", "reason": "injury", "back": "Doubtful"}])
        white = home["starters"][1]
        self.assertEqual((white["name"], white["number"], white["assists"], white["off"]), ("White", "4", 1, "63'"))
        self.assertEqual(home["starters"][3]["name"], "Gabriel", "no last name: the whole name")
        self.assertTrue(home["starters"][7]["yellow"])
        self.assertEqual(home["bench"][1]["on"], "63'")
        self.assertEqual(shaped["away"]["starters"], [])

    def test_lines_from_the_keeper_forward_and_from_the_teams_left(self):
        lines = fotmob.layout_lines(fotmob.shape(details())["home"]["starters"])
        self.assertEqual([[p["name"] for p in line] for line in lines],
                         [["Raya"], ["Calafiori", "Gabriel", "Konsa", "White"], ["Lewis-Skelly", "Rice"],
                          ["Madueke", "Ødegaard", "Saka"], ["Havertz"]])
        self.assertNotIn("x", lines[0][0])
        self.assertEqual(fotmob.layout_lines([dict(lines[0][0], x=None, y=None)]), [])

    def test_form_and_head_to_head(self):
        shaped = fotmob.shape(details())
        self.assertEqual(shaped["form"]["home"][1], {"result": "L", "for": 0, "against": 1, "opponent": "Napoli",
                                                     "home": False, "date": shaped["form"]["home"][1]["date"]})
        self.assertEqual(shaped["form"]["away"][0]["opponent"], "Lens")
        h2h = shaped["h2h"]
        self.assertEqual((h2h["home"], h2h["draws"], h2h["away"]), (3, 1, 0))
        self.assertEqual([(m["home"], m["score"]) for m in h2h["meetings"]], [("Arsenal", [4, 1])])
        self.assertEqual(shaped["insights"], ["Arsenal have scored 9 goals in their last 5 matches",
                                              "Lille have scored 9 goals in their last 5 matches",
                                              "Arsenal haven't lost to Lille", "Jonathan David has scored 5"])

    def test_ratings_player_stats_and_expected_goals(self):
        shaped = fotmob.shape(details(kind="standard", with_stats=True))
        self.assertEqual(shaped["lineup"], "confirmed")
        self.assertEqual(shaped["stats"], [
            {"key": "xg", "label": "Expected goals (xG)", "unit": None, "home": 2.33, "away": 0.62},
            {"key": "bigChances", "label": "Big chances", "unit": None, "home": 4, "away": 2},
        ])
        rice = shaped["players"]["41"]
        self.assertEqual((rice["side"], rice["rating"], rice["minutes"]), ("home", 8.3, 90))
        self.assertEqual(rice["groups"], [{"title": "Top stats", "stats": [
            {"label": "Expected assists (xA)", "value": "0.08"},
            {"label": "Accurate passes", "value": "47/58 (81%)"},
            {"label": "Top speed", "value": "28.0 km/h"},
            {"label": "Distance covered", "value": "11.1 km"},
        ]}])
        self.assertNotIn("999", shaped["players"], "a sub who didn't play has no stats")
        self.assertEqual(shaped["best"]["potm"], {"fm": "41", "name": "Declan Rice", "team": "Arsenal", "rating": 8.3})
        self.assertEqual(shaped["best"]["top"]["home"], [{"fm": "41", "name": "Declan Rice", "rating": 8.3, "stats": True}])

    def test_junk_is_nothing(self):
        self.assertIsNone(fotmob.shape(None))
        self.assertIsNone(fotmob.shape({"general": {}, "content": {}}))
        shaped = fotmob.shape({"general": {"matchId": "5"}, "content": {"lineup": "nope", "matchFacts": []}})
        self.assertIsNone(shaped["lineup"])
        self.assertIsNone(shaped["referee"])


class MergeTest(unittest.TestCase):
    def espn_detail(self, with_rosters):
        match = sports.shape_match(event("2001", ARSENAL, LILLE, "2026-10-13T19:00Z"), "uefa.champions")
        return sports.shape_detail(summary(ARSENAL, LILLE, with_rosters=with_rosters), match)

    def test_espns_line_ups_get_fotmobs_ratings(self):
        detail = self.espn_detail(True)
        fotmob.merge(detail, fotmob.shape(details(kind="standard", with_stats=True)))
        players = {p["number"]: p for line in detail["home"]["lines"] for p in line}
        self.assertEqual((players["41"]["rating"], players["41"]["fm"]), (8.3, "41"))
        self.assertEqual(players["33"]["rating"], 8.0)
        self.assertNotIn("predicted", detail["home"])
        self.assertEqual(detail["home"]["formation"], "4-2-3-1")
        self.assertEqual(detail["home"]["coach"], "Mikel Arteta")
        self.assertEqual(detail["home"]["out"][0]["name"], "William Saliba")
        self.assertEqual([s["key"] for s in detail["stats"]][:3], ["possessionPct", "xg", "bigChances"])
        self.assertEqual(detail["fotmob"]["referee"]["name"], "Felix Zwayer")
        self.assertIn("41", detail["fotmob"]["players"])

    def test_without_espns_line_ups_fotmobs_predicted_ones_stand_in(self):
        detail = self.espn_detail(False)
        fotmob.merge(detail, fotmob.shape(details()))
        home = detail["home"]
        self.assertTrue(home["predicted"])
        self.assertEqual([len(line) for line in home["lines"]], [1, 4, 2, 3, 1])
        self.assertEqual([p["number"] for p in home["bench"]], ["12", "5"], "who came on first")
        self.assertEqual(detail["away"]["lines"], [], "FotMob has nothing for Lille either")

    def test_nothing_from_fotmob_leaves_the_page_alone(self):
        detail = self.espn_detail(True)
        before = json.dumps(detail, sort_keys=True)
        fotmob.merge(detail, None)
        self.assertEqual(json.dumps(detail, sort_keys=True), before)


class ReaderTest(unittest.TestCase):
    def make(self, pages=None):
        clock = [NOW]
        api = FakeFotMob(fotmob_pages() if pages is None else pages)
        return fotmob.FotMob(fetch=api, clock=lambda: clock[0]), api, clock

    def test_finds_the_match_once_and_reads_its_details(self):
        reader, api, clock = self.make()
        self.assertEqual(reader.extra(ESPN_MATCH)["referee"]["name"], "Felix Zwayer")
        reader.extra(ESPN_MATCH)
        self.assertEqual(api.count("matches?date="), 1)
        self.assertEqual(api.count("matchDetails"), 2)

    def test_a_match_fotmob_doesnt_have_is_looked_for_again_an_hour_later(self):
        reader, api, clock = self.make()
        missing = dict(ESPN_MATCH, id="2003", home={"name": "Leeds United"}, away={"name": "Ipswich Town"})
        self.assertIsNone(reader.extra(missing))
        self.assertIsNone(reader.extra(missing))
        self.assertEqual(api.count("matches?date="), 1)
        clock[0] += fotmob.NOT_FOUND_SECONDS + 1
        reader.extra(missing)
        self.assertEqual(api.count("matches?date="), 2)

    def test_other_competitions_never_ask(self):
        reader, api, _ = self.make()
        self.assertIsNone(reader.extra(dict(ESPN_MATCH, league="usa.ncaa.m.1")))
        self.assertEqual(api.calls, [])

    def test_when_fotmob_is_down_the_last_answer_is_kept(self):
        reader, api, _ = self.make()
        first = reader.extra(ESPN_MATCH)
        api.down = True
        self.assertEqual(reader.extra(ESPN_MATCH), first)
        two_days_later = ESPN_MATCH["kickoff"] + 2 * 24 * 60 * 60 * 1000
        self.assertIsNone(reader.extra(dict(ESPN_MATCH, id="2009", kickoff=two_days_later)), "never read")

    def test_an_answer_it_cant_read_is_nothing(self):
        pages = fotmob_pages()
        pages[fotmob.API + "matchDetails?matchId=6106260"] = {"general": {"matchId": "1"}, "content": {"x": 1}}
        reader, *_ = self.make(pages)
        self.assertIsNone(reader.extra(ESPN_MATCH), "the details of some other match")

    def test_config(self):
        self.assertIsInstance(fotmob.fotmob_from({}), fotmob.FotMob)
        self.assertIsInstance(fotmob.fotmob_from({"sports": {"maryland": "women"}}), fotmob.FotMob)
        self.assertIsNone(fotmob.fotmob_from({"sports": {"fotmob": False}}))
        self.assertIsNone(fotmob.fotmob_from({"sports": False}))


class SportsTest(unittest.TestCase):
    def test_a_match_page_carries_fotmobs_extras(self):
        api = FakeFotMob(fotmob_pages())
        found, espn, clock, _ = make(fotmob=fotmob.FotMob(fetch=api, clock=lambda: clock[0]))
        clock[0] = NOW
        found.poll()
        page = found.match("2001")
        self.assertEqual(page["fotmob"]["referee"]["name"], "Felix Zwayer")
        self.assertTrue(page["home"]["predicted"])
        self.assertEqual(espn.count("summary?event=2001"), 1)

    def test_college_soccer_and_a_fotmob_outage_still_have_espns_page(self):
        api = FakeFotMob({})
        api.down = True
        found, espn, clock, _ = make(fotmob=fotmob.FotMob(fetch=api, clock=lambda: clock[0]))
        found.poll()
        page = found.match("1001")
        self.assertEqual(page["home"]["formation"], "4-2-3-1")
        self.assertNotIn("fotmob", page)


if __name__ == "__main__":
    unittest.main()
