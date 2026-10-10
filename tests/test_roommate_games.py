import json
import os
import random
import tempfile
import unittest
from datetime import datetime

from board.roommate_games import (
    MAX_PLAYERS,
    RoommateGames,
    choose_games,
    clean_email,
    clean_phone,
    invitation,
    places,
    score,
    specialized_chance,
)
from board.store import NotFound, ValidationError


class FakeNotifier:
    def __init__(self, email=True, sms=True):
        self.channels = {"email": email, "sms": sms}
        self.batches = []

    def deliver(self, messages):
        self.batches.append(messages)
        return {"sent": len(messages), "failed": 0, "problem": None}


class Clock:
    """Friday 9 October 2026, 9:00 AM unless moved."""

    def __init__(self):
        self.now = datetime(2026, 10, 9, 9, 0)

    def __call__(self):
        return self.now


class RulesTest(unittest.TestCase):
    def test_a_point_for_everyone_you_finish_ahead_of(self):
        self.assertEqual(score([["a"], ["b"], ["c"]]), {"a": (2, 0), "b": (1, 0), "c": (0, 0)})

    def test_ties_share_a_place_and_its_points(self):
        self.assertEqual(score([["a"], ["b", "c"], ["d"]]), {"a": (3, 0), "b": (1, 0), "c": (1, 0), "d": (0, 0)})
        self.assertEqual(places([["a"], ["b", "c"], ["d"]]), {"a": 1, "b": 2, "c": 2, "d": 4})

    def test_beating_the_specialist_earns_the_bonus(self):
        points = score([["b"], ["a"], ["c"]], specialist="a")
        self.assertEqual(points, {"b": (2, 1), "a": (1, 0), "c": (0, 0)})

    def test_no_bonus_for_tying_with_the_specialist_or_when_they_win_or_sit_out(self):
        self.assertEqual(score([["a", "b"], ["c"]], specialist="a")["b"], (1, 0))
        self.assertEqual(score([["a"], ["b"], ["c"]], specialist="a")["b"], (1, 0))
        self.assertEqual(score([["b"], ["c"]], specialist="a")["b"], (1, 0))

    def test_specialized_chance_steers_towards_a_quarter(self):
        self.assertEqual(specialized_chance([]), 0.25)
        self.assertEqual(specialized_chance(["general"] * 3 + ["specialized"]), 0.25)
        self.assertEqual(specialized_chance(["general"] * 8), 1.0)
        self.assertEqual(specialized_chance(["specialized"]), 0.0)

    def test_three_general_for_every_specialized_over_time(self):
        games = [{"id": "g%d" % i, "kind": "general"} for i in range(6)] + [
            {"id": "s%d" % i, "kind": "specialized"} for i in range(3)]
        kinds = []
        rng = random.Random(7)
        for _ in range(400):
            kinds += [g["kind"] for g in choose_games(games, count=1, recent_kinds=kinds, avoid=set(), rng=rng)]
        share = kinds.count("specialized") / len(kinds)
        self.assertTrue(0.22 <= share <= 0.28, share)
        windows = [kinds[i:i + 12].count("specialized") for i in range(len(kinds) - 12)]
        self.assertLessEqual(max(windows), 4, "never more than 4 in any 12 picks")
        self.assertGreaterEqual(min(windows[12:]), 1)

    def test_an_empty_bucket_hands_the_pick_to_the_other(self):
        general = [{"id": "g", "kind": "general"}]
        picks = choose_games(general, count=1, recent_kinds=["general"] * 12, avoid=set(), rng=random.Random(1))
        self.assertEqual([g["id"] for g in picks], ["g"])

    def test_last_nights_games_wait_their_turn(self):
        games = [{"id": "a", "kind": "general"}, {"id": "b", "kind": "general"}]
        for seed in range(20):
            picks = choose_games(games, count=1, recent_kinds=[], avoid={"a"}, rng=random.Random(seed))
            self.assertEqual(picks[0]["id"], "b")

    def test_a_night_never_repeats_a_game(self):
        games = [{"id": "a", "kind": "general"}, {"id": "b", "kind": "general"}]
        picks = choose_games(games, count=3, recent_kinds=[], avoid=set(), rng=random.Random(3))
        self.assertEqual(sorted(g["id"] for g in picks), ["a", "b"])

    def test_contact_details_are_tidied(self):
        self.assertEqual(clean_phone("(555) 123-4567"), "+15551234567")
        self.assertEqual(clean_phone("1 555 123 4567"), "+15551234567")
        self.assertEqual(clean_phone("+44 7700 900123"), "+447700900123")
        self.assertEqual(clean_phone("0044 7700 900123"), "+447700900123")
        self.assertIsNone(clean_phone("  "))
        with self.assertRaises(ValidationError):
            clean_phone("12345")
        self.assertEqual(clean_email(" Sam@Example.COM "), "Sam@example.com")
        self.assertIsNone(clean_email(""))
        for bad in ("sam", "sam@", "a@b", "x@y.z\nBcc: evil@example.com"):
            with self.assertRaises(ValidationError):
                clean_email(bad)

    def test_the_invitation_names_the_specialist_and_links_to_the_results(self):
        week = {"id": "2026-10-09", "picks": [
            {"name": "Mario Kart", "kind": "general", "specialist": None},
            {"name": "Chess", "kind": "specialized", "specialist": "s"},
        ]}
        names = {"s": "Sam", "a": "Alex"}
        alex = invitation(week, time="19:00", recipient={"id": "a", "name": "Alex", "email": "a@x.io", "phone": None},
                          names=names, link="http://board/#/app/roommate-games/record")
        self.assertEqual(alex["subject"], "Roommate Cup: Friday, October 9 at 7:00 PM")
        self.assertIn("Chess (Specialized: Sam's game. Finish ahead of Sam for +1.)", alex["text"])
        self.assertIn("http://board/#/app/roommate-games/record", alex["text"])
        self.assertIn("Mario Kart, Chess (beat Sam for +1)", alex["short"])
        sam = invitation(week, time="19:00", recipient={"id": "s", "name": "Sam"}, names=names, link=None)
        self.assertIn("your game", sam["text"])
        self.assertNotIn("Record results", sam["short"])


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "roommate-games.json")
        self.clock = Clock()
        self.notifier = FakeNotifier()
        self.store = self.make()

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, notifier=None):
        store = RoommateGames(self.path, notifier=notifier or self.notifier, clock=self.clock,
                              rng=random.Random(5), run=lambda work: work())
        store.set_link(lambda: "http://board/#/app/roommate-games/record")
        return store

    def sign_up(self, name, **contact):
        contact = contact or {"email": "%s@example.com" % name.lower()}
        return self.store.add_player({"name": name, **contact})["player"]["id"]

    def test_signing_up_keeps_only_name_email_and_phone_and_masks_them(self):
        result = self.store.add_player({"name": "Sam", "email": "sam@example.com", "phone": "555 123 4567",
                                        "password": "nope"}, player_id="a1b2c3d4e5f6")
        self.assertEqual(result["player"], {"id": "a1b2c3d4e5f6", "name": "Sam", "email": "s•••@example.com",
                                            "phone": "•••• 4567"})
        state = self.store.snapshot()
        self.assertNotIn("sam@example.com", json.dumps(state))
        self.assertNotIn("5551234567", json.dumps(state))
        with open(self.path) as f:
            saved = json.load(f)["players"][0]
        self.assertEqual(set(saved), {"id", "name", "email", "phone", "joined", "left"})
        self.assertEqual(saved["phone"], "+15551234567")

    def test_signing_up_needs_a_way_to_reach_them_and_a_new_name(self):
        with self.assertRaises(ValidationError):
            self.store.add_player({"name": "Sam"})
        self.sign_up("Sam")
        with self.assertRaises(ValidationError):
            self.store.add_player({"name": "sam", "email": "other@example.com"})

    def test_the_board_holds_a_household_not_a_crowd(self):
        for i in range(MAX_PLAYERS):
            self.sign_up("P%d" % i)
        with self.assertRaises(ValidationError):
            self.sign_up("One more")

    def test_editing_changes_only_what_was_sent(self):
        sam = self.sign_up("Sam", email="sam@example.com", phone="5551234567")
        self.store.update_player(sam, {"name": "Samantha"})
        player = self.store.snapshot()["players"][0]
        self.assertEqual((player["name"], player["phone"]), ("Samantha", "•••• 4567"))
        self.store.update_player(sam, {"phone": ""})
        self.assertIsNone(self.store.snapshot()["players"][0]["phone"])
        with self.assertRaises(ValidationError):
            self.store.update_player(sam, {"email": ""})

    def test_removing_a_roommate_wipes_their_details_but_undo_brings_them_back(self):
        sam = self.sign_up("Sam", email="sam@example.com")
        self.store.remove_player(sam)
        self.assertEqual(self.store.snapshot()["players"], [])
        with open(self.path) as f:
            self.assertNotIn("sam@example.com", f.read())
        self.assertEqual(self.store.restore_players([sam])["restored"], [sam])
        self.assertEqual(self.store.snapshot()["players"][0]["email"], "s•••@example.com")

    def test_specialized_games_belong_to_a_roommate(self):
        sam = self.sign_up("Sam")
        with self.assertRaises(ValidationError):
            self.store.add_game({"name": "Chess", "kind": "specialized"})
        game = self.store.add_game({"name": "Chess", "kind": "specialized", "specialist": sam})["game"]
        self.assertEqual(game["specialist"], sam)
        general = self.store.add_game({"name": "Uno", "kind": "general", "specialist": sam})["game"]
        self.assertIsNone(general["specialist"])
        with self.assertRaises(ValidationError):
            self.store.add_game({"name": "uno", "kind": "general"})

    def test_a_specialists_games_sit_out_the_draw_while_they_are_gone(self):
        sam = self.sign_up("Sam")
        self.sign_up("Alex")
        self.store.add_game({"name": "Chess", "kind": "specialized", "specialist": sam})
        self.store.remove_player(sam)
        self.assertFalse(self.store.snapshot()["games"][0]["available"])
        with self.assertRaises(ValidationError):
            self.store.draw()

    def test_drawing_picks_the_next_game_night_and_pick_again_changes_it(self):
        self.sign_up("Sam")
        self.store.add_game({"name": "Uno", "kind": "general"})
        self.store.add_game({"name": "Darts", "kind": "general"})
        self.clock.now = datetime(2026, 10, 7, 12, 0)  # a Wednesday
        result = self.store.draw()
        self.assertEqual(result["week"], "2026-10-09")
        first = result["state"]["weeks"][0]["picks"][0]["name"]
        with self.assertRaises(ValidationError):
            self.store.draw()
        again = self.store.draw(again=True)["state"]["weeks"][0]["picks"][0]["name"]
        self.assertNotEqual(first, again)

    def test_results_score_and_crown_the_night(self):
        sam, alex, jo = self.sign_up("Sam"), self.sign_up("Alex"), self.sign_up("Jo")
        self.store.add_game({"name": "Chess", "kind": "specialized", "specialist": sam})
        week = self.store.draw()["week"]
        pick = self.store.snapshot()["weeks"][0]["picks"][0]["id"]
        state = self.store.record(week, pick, [[alex], [sam], [jo]])["state"]
        totals = {p["name"]: (p["points"], p["bonus"], p["crowns"], p["rank"]) for p in state["players"]}
        self.assertEqual(totals, {"Alex": (3, 1, 1, 1), "Sam": (1, 0, 0, 2), "Jo": (0, 0, 0, 3)})
        self.assertEqual(state["ledger"][alex][0], {"week": week, "pick": pick, "game": "Chess", "kind": "specialized",
                                                    "place": 1, "of": 3, "points": 2, "bonus": 1})
        cleared = self.store.record(week, pick, None)["state"]
        self.assertEqual([p["points"] for p in cleared["players"]], [0, 0, 0])

    def test_results_must_name_signed_up_roommates_once(self):
        sam, alex = self.sign_up("Sam"), self.sign_up("Alex")
        self.store.add_game({"name": "Uno", "kind": "general"})
        week = self.store.draw()["week"]
        pick = self.store.snapshot()["weeks"][0]["picks"][0]["id"]
        for bad in ([[sam]], [[sam], [sam]], [[sam], ["stranger"]], [[sam], []], "first"):
            with self.assertRaises(ValidationError):
                self.store.record(week, pick, bad)
        with self.assertRaises(NotFound):
            self.store.record("2020-01-03", pick, [[sam], [alex]])

    def test_the_schedule_is_checked(self):
        self.store.set_schedule({"day": 3, "time": "20:00", "announce": "12:00", "perNight": 2})
        self.assertEqual(self.store.snapshot()["schedule"],
                         {"on": True, "day": 3, "time": "20:00", "announce": "12:00", "perNight": 2})
        for bad in ({"day": 7}, {"time": "25:00"}, {"announce": "21:00"}, {"perNight": 4}, {"on": "yes"}):
            with self.assertRaises(ValidationError):
                self.store.set_schedule(bad)

    def test_game_day_draws_and_sends_once_when_the_picks_are_due(self):
        self.sign_up("Sam", email="sam@example.com", phone="5551234567")
        self.store.add_game({"name": "Uno", "kind": "general"})
        self.store.tick(datetime(2026, 10, 9, 9, 59))
        self.assertEqual(self.store.snapshot()["weeks"], [])
        self.store.tick(datetime(2026, 10, 9, 10, 0))
        self.store.tick(datetime(2026, 10, 9, 10, 1))
        self.assertEqual(len(self.notifier.batches), 1)
        message = self.notifier.batches[0][0]
        self.assertEqual((message["email"], message["phone"]), ("sam@example.com", "+15551234567"))
        self.assertIn("http://board/#/app/roommate-games/record", message["short"])
        week = self.store.snapshot()["weeks"][0]
        self.assertEqual(week["notified"]["sent"], 1)

    def test_a_board_switched_on_late_catches_up_but_not_after_game_time(self):
        self.sign_up("Sam")
        self.store.add_game({"name": "Uno", "kind": "general"})
        self.store.tick(datetime(2026, 10, 9, 19, 30))
        self.assertEqual(len(self.store.snapshot()["weeks"]), 1, "still drawn, so results can go in")
        self.assertEqual(self.notifier.batches, [])

    def test_nothing_happens_on_other_days_or_while_paused(self):
        self.sign_up("Sam")
        self.store.add_game({"name": "Uno", "kind": "general"})
        self.store.tick(datetime(2026, 10, 8, 12, 0))
        self.store.set_schedule({"on": False})
        self.store.tick(datetime(2026, 10, 9, 12, 0))
        self.assertEqual(self.store.snapshot()["weeks"], [])

    def test_sending_again_waits_a_few_minutes(self):
        self.sign_up("Sam")
        self.store.add_game({"name": "Uno", "kind": "general"})
        week = self.store.draw()["week"]
        self.store.notify(week)
        with self.assertRaises(ValidationError):
            self.store.notify(week)
        self.clock.now = datetime(2026, 10, 9, 9, 11)
        self.store.notify(week)
        self.assertEqual(len(self.notifier.batches), 2)

    def test_sending_needs_texts_or_email_set_up(self):
        self.store = self.make(FakeNotifier(email=False, sms=False))
        self.sign_up("Sam")
        self.store.add_game({"name": "Uno", "kind": "general"})
        week = self.store.draw()["week"]
        with self.assertRaises(ValidationError):
            self.store.notify(week)
        self.assertEqual(self.store.snapshot()["channels"], {"email": False, "sms": False})

    def test_everything_survives_a_restart(self):
        sam, alex = self.sign_up("Sam"), self.sign_up("Alex")
        self.store.add_game({"name": "Chess", "kind": "specialized", "specialist": sam})
        week = self.store.draw()["week"]
        pick = self.store.snapshot()["weeks"][0]["picks"][0]["id"]
        self.store.record(week, pick, [[alex], [sam]])
        self.store.set_schedule({"day": 2})
        before = self.store.snapshot()
        after = self.make().snapshot()
        self.assertEqual(after, before)

    def test_a_corrupt_file_is_moved_aside(self):
        with open(self.path, "w") as f:
            f.write('{"players": [{"name": 3}]}')
        self.assertEqual(self.make().snapshot()["players"], [])
        self.assertTrue(any(name.startswith("roommate-games.json.corrupt-") for name in os.listdir(self.tmp.name)))


if __name__ == "__main__":
    unittest.main()
