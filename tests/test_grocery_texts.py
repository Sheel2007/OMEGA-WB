import json
import os
import tempfile
import threading
import unittest

from board.grocery import MAX_TEXTING, GroceryList, NotFound, ValidationError
from board.grocery_texts import (LONGEST_WAIT_SECONDS, MAX_TEXT, QUIET_SECONDS, WELCOME, GroceryTexts,
                                 gateway_address, summary)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FakeNotifier:
    def __init__(self):
        self.batches = []

    def deliver(self, messages):
        self.batches.append(messages)
        return {"sent": len(messages), "failed": 0, "problem": None}


def entry(name, by=None):
    return {"name": name, "by": by}


class GatewayTest(unittest.TestCase):
    def test_each_carrier_has_its_own_address_for_the_ten_digit_number(self):
        self.assertEqual(gateway_address("+15551234567", "tmobile"), "5551234567@tmomail.net")
        self.assertEqual(gateway_address("+15551234567", "verizon"), "5551234567@vtext.com")
        self.assertEqual(gateway_address("+15551234567", "googlefi"), "5551234567@msg.fi.google.com")

    def test_only_us_numbers_on_a_known_carrier(self):
        self.assertIsNone(gateway_address("+447700900123", "tmobile"))
        self.assertIsNone(gateway_address("+15551234567", "att"))
        self.assertIsNone(gateway_address(None, "tmobile"))


class SummaryTest(unittest.TestCase):
    def test_who_added_what(self):
        self.assertEqual(summary([entry("Oat milk", "Noah")]), "Noah added Oat milk to the grocery list.")
        self.assertEqual(summary([entry("Oat milk", "Noah"), entry("Eggs", "Noah"), entry("Bread", "Noah")]),
                         "Noah added Oat milk, Eggs and Bread to the grocery list.")

    def test_nobody_named(self):
        self.assertEqual(summary([entry("Eggs"), entry("Bread")]), "Added to the grocery list: Eggs and Bread.")

    def test_several_people_and_no_repeats(self):
        text = summary([entry("Eggs", "Noah"), entry("Bread", "Sam"), entry("eggs", "noah")])
        self.assertEqual(text, "Noah added Eggs to the grocery list. Sam added Bread to the grocery list.")

    def test_a_long_batch_still_fits_in_one_text(self):
        entries = [entry("Very tasty product number %d" % i, "Noah") for i in range(20)]
        text = summary(entries)
        self.assertLessEqual(len(text), MAX_TEXT)
        self.assertTrue(text.startswith("Noah added Very tasty product number 0"))
        self.assertIn("more to the grocery list.", text)

    def test_nothing_to_say(self):
        self.assertIsNone(summary([]))


class TextingListTest(unittest.TestCase):
    def setUp(self):
        self.joined = []
        self.grocery = GroceryList(on_join=self.joined.append, texts=True)

    def test_signing_up_keeps_the_number_but_shows_screens_only_its_last_digits(self):
        result = self.grocery.add_texter({"name": "Noah", "phone": "(555) 111-0001", "carrier": "tmobile"})
        self.assertEqual(result["texter"]["phone"], "•••• 0001")
        state = self.grocery.snapshot()
        self.assertTrue(state["texts"])
        self.assertEqual([(t["name"], t["carrier"], t["phone"]) for t in state["texting"]],
                         [("Noah", "tmobile", "•••• 0001")])
        self.assertNotIn("5551110001", json.dumps(state))
        self.assertEqual(self.grocery.texting_book(), [{"name": "Noah", "phone": "+15551110001", "carrier": "tmobile"}])
        self.assertEqual(self.joined[0]["phone"], "+15551110001")

    def test_the_same_number_again_changes_its_name_and_carrier(self):
        self.grocery.add_texter({"name": "Noah", "phone": "5551110001", "carrier": "tmobile"})
        self.grocery.add_texter({"name": "Noah L", "phone": "+1 555 111 0001", "carrier": "verizon"})
        self.assertEqual(self.grocery.texting_book(), [{"name": "Noah L", "phone": "+15551110001", "carrier": "verizon"}])

    def test_validation(self):
        good = {"name": "Noah", "phone": "5551110001", "carrier": "tmobile"}
        for changes, message in [
            ({"name": " "}, "name"),
            ({"phone": ""}, "phone number"),
            ({"phone": "+44 7700 900123"}, "US numbers"),
            ({"phone": "12345"}, "area code"),
            ({"carrier": "att"}, "carrier"),
        ]:
            with self.assertRaisesRegex(ValidationError, message):
                self.grocery.add_texter({**good, **changes})
        for i in range(MAX_TEXTING):
            self.grocery.add_texter({**good, "phone": "55511100%02d" % i})
        with self.assertRaisesRegex(ValidationError, "as many people"):
            self.grocery.add_texter({**good, "phone": "5559990000"})

    def test_remove_and_undo(self):
        noah = self.grocery.add_texter({"name": "Noah", "phone": "5551110001", "carrier": "tmobile"})["texter"]
        self.grocery.remove_texter(noah["id"])
        self.assertEqual(self.grocery.texting_book(), [])
        with self.assertRaises(NotFound):
            self.grocery.remove_texter(noah["id"])
        self.assertEqual(self.grocery.restore_texters([noah["id"]])["restored"], [noah["id"]])
        self.assertEqual(len(self.grocery.texting_book()), 1)

    def test_saved_on_disk_and_a_removed_number_is_gone_from_the_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "grocery.json")
            grocery = GroceryList(path)
            grocery.add_texter({"name": "Noah", "phone": "5551110001", "carrier": "tmobile"})
            sam = grocery.add_texter({"name": "Sam", "phone": "5551110002", "carrier": "googlefi"})["texter"]
            self.assertEqual(GroceryList(path).texting_book(), grocery.texting_book())
            grocery.remove_texter(sam["id"])
            with open(path, encoding="utf-8") as f:
                self.assertNotIn("5551110002", f.read())


class GroceryTextsTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.notifier = FakeNotifier()
        self.grocery = GroceryList(clock=lambda: "2026-10-11T10:00:00Z", texts=True)
        self.texts = GroceryTexts(self.notifier, recipients=self.grocery.texting_book,
                                  still_wanted=self.grocery.open_ids, clock=self.clock)
        self.grocery._on_add = self.texts.added
        self.grocery._on_join = self.texts.joined
        self.grocery.add_texter({"name": "Noah", "phone": "5551110001", "carrier": "tmobile"})
        self.grocery.add_texter({"name": "Sam", "phone": "5551110002", "carrier": "verizon"})
        self.welcomes = self.texts.send_due()

    def test_signing_up_sends_a_welcome_text_straight_away(self):
        self.assertEqual([(m["email"], m["text"]) for m in self.welcomes],
                         [("5551110001@tmomail.net", WELCOME), ("5551110002@vtext.com", WELCOME)])
        self.assertEqual(self.welcomes[0]["subject"], "")

    def test_waits_for_the_list_to_go_quiet_then_texts_everyone_else_once(self):
        self.grocery.add({"name": "Oat milk", "by": "Noah"})
        self.clock.now += 30
        self.grocery.add({"name": "Eggs", "by": "noah"})
        self.clock.now += QUIET_SECONDS - 1
        self.assertEqual(self.texts.send_due(), [])
        self.clock.now += 1
        sent = self.texts.send_due()
        self.assertEqual([(m["email"], m["text"]) for m in sent],
                         [("5551110002@vtext.com", "Noah added Oat milk and Eggs to the grocery list.")])
        self.assertEqual(self.texts.send_due(), [])

    def test_a_steady_stream_of_adds_still_sends_after_the_longest_wait(self):
        for i in range(LONGEST_WAIT_SECONDS // 30):
            self.grocery.add({"name": "Thing %d" % i, "by": "Sam"})
            self.assertEqual(self.texts.send_due(), [])
            self.clock.now += 30
        self.assertEqual(len(self.texts.send_due()), 1)

    def test_items_taken_off_or_bought_before_sending_are_left_out(self):
        milk = self.grocery.add({"name": "Oat milk", "by": "Sam"})["item"]
        eggs = self.grocery.add({"name": "Eggs", "by": "Sam"})["item"]
        self.grocery.add({"name": "Bread", "by": "Sam"})
        self.grocery.remove(milk["id"])
        self.grocery.check(eggs["id"], True)
        self.clock.now += QUIET_SECONDS
        self.assertEqual([m["text"] for m in self.texts.send_due()], ["Sam added Bread to the grocery list."])

    def test_nothing_left_sends_nothing(self):
        milk = self.grocery.add({"name": "Oat milk", "by": "Sam"})["item"]
        self.grocery.remove(milk["id"])
        self.clock.now += QUIET_SECONDS
        self.assertEqual(self.texts.send_due(), [])

    def test_nobody_named_texts_everyone(self):
        self.grocery.add({"name": "Eggs"})
        self.clock.now += QUIET_SECONDS
        self.assertEqual(len(self.texts.send_due()), 2)

    def test_undo_doesnt_text(self):
        milk = self.grocery.add({"name": "Oat milk", "by": "Sam"})["item"]
        self.clock.now += QUIET_SECONDS
        self.texts.send_due()
        self.grocery.remove(milk["id"])
        self.grocery.restore([milk["id"]])
        self.clock.now += QUIET_SECONDS
        self.assertEqual(self.texts.send_due(), [])

    def test_the_thread_sends_once_due_and_stops(self):
        sent = threading.Event()
        self.notifier.deliver = lambda messages: sent.set() or {"sent": 2, "failed": 0, "problem": None}
        self.texts.start()
        self.grocery.add({"name": "Eggs"})
        self.assertFalse(sent.wait(0.2))
        self.clock.now += QUIET_SECONDS
        with self.texts._cond:
            self.texts._cond.notify_all()
        self.assertTrue(sent.wait(5))
        self.texts.stop()
        self.texts._thread.join(5)
        self.assertFalse(self.texts._thread.is_alive())


if __name__ == "__main__":
    unittest.main()
