import json
import os
import tempfile
import unittest

from board.grocery import MAX_QTY, GroceryList, NotFound, ValidationError, normalize_code


class FakeClock:
    def __init__(self):
        self.tick = 0

    def __call__(self):
        self.tick += 1
        return "2026-10-01T12:%02d:%02dZ" % divmod(self.tick, 60)


class NormalizeCodeTest(unittest.TestCase):
    def test_keeps_ean_8_and_ean_13(self):
        self.assertEqual(normalize_code("00016285"), "00016285")
        self.assertEqual(normalize_code("4056489011293"), "4056489011293")

    def test_upc_a_and_gtin_14_become_the_matching_ean_13(self):
        self.assertEqual(normalize_code("036000291452"), "0036000291452")
        self.assertEqual(normalize_code("00036000291452"), "0036000291452")

    def test_a_zero_padded_ean_8_is_that_ean_8(self):
        self.assertEqual(normalize_code("00000000016285"), "00016285")

    def test_refuses_bad_check_digits_and_non_barcodes(self):
        for raw in ("00016286", "12345", "abcdefgh", "", None, 16285, "10036000291459"):
            self.assertIsNone(normalize_code(raw), raw)


class GroceryListTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "grocery.json")
        self.store = GroceryList(self.path, clock=FakeClock())

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, **fields):
        return self.store.add(fields)

    def test_starts_empty_with_its_currency(self):
        state = self.store.snapshot()
        self.assertEqual((state["items"], state["catalog"], state["people"]), ([], [], []))
        self.assertEqual(state["currency"], "USD")

    def test_add_keeps_price_store_quantity_and_who_asked(self):
        result = self.add(name="  marinara   sauce ", code="00016285", brand="Trader Joe's", store="traderjoes",
                          price=299, qty=2, by="Sam")
        item = result["item"]
        self.assertEqual(result["outcome"], "added")
        self.assertEqual(item["name"], "Marinara sauce")
        self.assertEqual((item["code"], item["store"], item["price"], item["qty"], item["by"]),
                         ("00016285", "traderjoes", 299, 2, "Sam"))
        self.assertEqual(result["state"]["people"], ["Sam"])

    def test_scanning_something_already_on_the_list_asks_for_more(self):
        first = self.add(name="Marinara", code="00016285", by="Sam")["item"]
        self.add(name="Eggs")
        again = self.add(name="Marinara sauce", code="00016285", by="Alex")
        self.assertEqual(again["outcome"], "more")
        self.assertEqual(again["item"]["id"], first["id"])
        self.assertEqual((again["item"]["qty"], again["item"]["by"]), (2, "Alex"))
        self.assertEqual([i["name"] for i in again["state"]["items"]], ["Marinara", "Eggs"])

    def test_quantity_never_passes_the_cap(self):
        self.add(name="Limes", qty=MAX_QTY)
        self.assertEqual(self.add(name="limes", qty=5)["item"]["qty"], MAX_QTY)

    def test_adding_a_bought_item_again_puts_it_back_fresh(self):
        item = self.add(name="Eggs", qty=3, by="Sam")["item"]
        self.store.check(item["id"], True)
        again = self.add(name="eggs", by="Alex")
        self.assertEqual(again["outcome"], "readded")
        self.assertEqual((again["item"]["done"], again["item"]["qty"], again["item"]["by"]), (False, 1, "Alex"))

    def test_validation(self):
        bad = [
            {"name": " "},
            {"name": "Eggs", "price": 1.99},
            {"name": "Eggs", "price": -1},
            {"name": "Eggs", "price": True},
            {"name": "Eggs", "qty": 0},
            {"name": "Eggs", "qty": MAX_QTY + 1},
            {"name": "Eggs", "store": "aldi"},
            {"name": "Eggs", "code": "00016286"},
            {"name": "Eggs", "by": "x" * 31},
            {"name": "x" * 81},
        ]
        for fields in bad:
            with self.assertRaises(ValidationError, msg=fields):
                self.store.add(fields)
        with self.assertRaises(ValidationError):
            self.store.add("Eggs")

    def test_update_changes_only_what_was_sent(self):
        item = self.add(name="Eggs", price=399, by="Sam")["item"]
        result = self.store.update(item["id"], {"price": 449, "qty": 2})
        self.assertEqual((result["item"]["price"], result["item"]["qty"], result["item"]["by"]), (449, 2, "Sam"))
        result = self.store.update(item["id"], {"by": "", "price": None})
        self.assertEqual((result["item"]["by"], result["item"]["price"]), (None, None))
        with self.assertRaises(NotFound):
            self.store.update("nope", {"qty": 2})

    def test_the_catalog_remembers_the_last_price_and_store(self):
        item = self.add(name="Marinara", code="00016285", store="traderjoes", price=299)["item"]
        self.store.update(item["id"], {"price": 329})
        self.store.update(item["id"], {"price": None})
        known = self.store.known("00016285")
        self.assertEqual((known["name"], known["store"], known["price"], known["source"]),
                         ("Marinara", "traderjoes", 329, "board"))
        self.assertIsNone(self.store.known("4056489011293"))
        self.assertIsNone(self.store.known("junk"))

    def test_search_known_matches_every_word_most_used_first(self):
        self.add(name="Tomato basil marinara", brand="Trader Joe's", store="traderjoes")
        self.add(name="Marinara", code="00016285", store="traderjoes")
        self.add(name="Marinara", code="00016285")
        self.add(name="Lidl marinara", store="lidl")
        names = [p["name"] for p in self.store.search_known("marinara")]
        self.assertEqual(names[0], "Marinara")
        self.assertEqual(len(names), 3)
        self.assertEqual([p["name"] for p in self.store.search_known("joe marinara")], ["Tomato basil marinara"])
        self.assertNotIn("Lidl marinara", [p["name"] for p in self.store.search_known("marinara", "traderjoes")])
        self.assertEqual(self.store.search_known("  "), [])

    def test_clear_restore_and_remove(self):
        eggs = self.add(name="Eggs")["item"]
        milk = self.add(name="Milk")["item"]
        self.store.check(eggs["id"], True)
        cleared = self.store.clear_checked()
        self.assertEqual(cleared["removed"], [eggs["id"]])
        self.store.remove(milk["id"])
        restored = self.store.restore([eggs["id"], milk["id"]])
        self.assertEqual(sorted(restored["restored"]), sorted([eggs["id"], milk["id"]]))

    def test_photos_are_checked_remembered_and_cleared(self):
        store = GroceryList(clock=FakeClock(), photo_exists=lambda name: name == "0123456789abcdef.jpg")
        with self.assertRaises(ValidationError):
            store.add({"name": "Jam", "photo": "fedcba9876543210.jpg"})
        with self.assertRaises(ValidationError):
            store.add({"name": "Jam", "photo": "../../etc/passwd"})
        item = store.add({"name": "Jam", "code": "00016285", "photo": "0123456789abcdef.jpg"})["item"]
        store.check(item["id"], True)
        store.clear_checked()
        again = store.add({"name": "Jam", "code": "00016285"})["item"]
        self.assertEqual(again["photo"], "0123456789abcdef.jpg", "the catalog brings the photo back")
        self.assertEqual(store.photos_in_use(), {"0123456789abcdef.jpg"})
        store.update(again["id"], {"photo": None})
        store.remove(again["id"])
        self.assertIsNone(store.add({"name": "Jam", "code": "00016285"})["item"]["photo"])

    def test_saves_and_loads(self):
        self.add(name="Marinara", code="00016285", price=299, by="Sam")
        again = GroceryList(self.path)
        state = again.snapshot()
        self.assertEqual(state["items"][0]["price"], 299)
        self.assertEqual(state["catalog"][0]["code"], "00016285")
        self.assertEqual(state["people"], ["Sam"])

    def test_an_unreadable_file_is_set_aside(self):
        with open(self.path, "w") as f:
            json.dump({"items": [{"id": "a", "name": "Eggs", "done": False, "qty": "lots"}]}, f)
        self.assertEqual(GroceryList(self.path).snapshot()["items"], [])
        self.assertTrue(any(name.startswith("grocery.json.corrupt") for name in os.listdir(self.tmp.name)))
