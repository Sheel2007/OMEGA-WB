import json
import os
import tempfile
import threading
import time
import unittest

from board.shopping import MAX_ITEMS, NotFound, ShoppingList, ValidationError


class FakeClock:
    def __init__(self):
        self.tick = 0

    def __call__(self):
        self.tick += 1
        return "2026-10-01T12:%02d:%02dZ" % divmod(self.tick, 60)


class ShoppingListTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "shopping.json")
        self.store = ShoppingList(self.path, clock=FakeClock())

    def tearDown(self):
        self.tmp.cleanup()

    def names(self, state=None):
        state = state or self.store.snapshot()
        return [item["name"] for item in state["items"]]

    def test_starts_empty(self):
        state = self.store.snapshot()
        self.assertEqual(state["items"], [])
        self.assertEqual(state["recent"], [])
        self.assertEqual(state["version"], 0)

    def test_add_puts_newest_first_and_tidies_the_name(self):
        self.store.add("eggs")
        result = self.store.add("  oat   milk ")
        self.assertEqual(result["outcome"], "added")
        self.assertEqual(self.names(result["state"]), ["Oat milk", "Eggs"])
        self.assertFalse(result["item"]["done"])
        self.assertIsNone(result["item"]["checked"])
        self.assertTrue(result["item"]["added"].endswith("Z"))

    def test_add_uses_client_id_when_valid(self):
        result = self.store.add("Eggs", item_id="a1b2c3d4e5f6")
        self.assertEqual(result["item"]["id"], "a1b2c3d4e5f6")

    def test_add_ignores_malformed_or_duplicate_client_ids(self):
        first = self.store.add("Eggs", item_id="a1b2c3d4e5f6")
        second = self.store.add("Milk", item_id="a1b2c3d4e5f6")
        third = self.store.add("Rice", item_id="<script>")
        ids = {first["item"]["id"], second["item"]["id"], third["item"]["id"]}
        self.assertEqual(len(ids), 3)
        self.assertNotIn("<script>", ids)

    def test_adding_an_item_already_on_the_list_changes_nothing(self):
        self.store.add("Eggs")
        version = self.store.snapshot()["version"]
        result = self.store.add("EGGS ")
        self.assertEqual(result["outcome"], "exists")
        self.assertEqual(result["state"]["version"], version)
        self.assertEqual(self.names(), ["Eggs"])

    def test_adding_a_bought_item_puts_it_back_on_top(self):
        eggs = self.store.add("Eggs")["item"]
        self.store.add("Milk")
        self.store.check(eggs["id"], True)
        result = self.store.add("eggs")
        self.assertEqual(result["outcome"], "readded")
        self.assertEqual(self.names(), ["Eggs", "Milk"])
        self.assertFalse(result["state"]["items"][0]["done"])
        self.assertIsNone(result["state"]["items"][0]["checked"])

    def test_rejects_blank_and_overlong_names(self):
        for bad in ["", "   ", None, 42, "x" * 81]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    self.store.add(bad)

    def test_list_has_a_size_limit(self):
        for n in range(MAX_ITEMS):
            self.store.add("Item %d" % n)
        with self.assertRaises(ValidationError):
            self.store.add("One too many")

    def test_check_and_uncheck(self):
        item = self.store.add("Eggs")["item"]
        checked = self.store.check(item["id"], True)["state"]["items"][0]
        self.assertTrue(checked["done"])
        self.assertIsNotNone(checked["checked"])
        unchecked = self.store.check(item["id"], False)["state"]["items"][0]
        self.assertFalse(unchecked["done"])
        self.assertIsNone(unchecked["checked"])

    def test_check_without_change_does_not_bump_version(self):
        item = self.store.add("Eggs")["item"]
        version = self.store.snapshot()["version"]
        self.store.check(item["id"], False)
        self.assertEqual(self.store.snapshot()["version"], version)

    def test_check_requires_a_boolean_and_a_known_item(self):
        item = self.store.add("Eggs")["item"]
        with self.assertRaises(ValidationError):
            self.store.check(item["id"], "yes")
        with self.assertRaises(NotFound):
            self.store.check("nope", True)

    def test_remove_then_restore_returns_item_to_its_old_spot(self):
        self.store.add("Eggs")
        milk = self.store.add("Milk")["item"]
        self.store.add("Rice")
        self.store.remove(milk["id"])
        self.assertEqual(self.names(), ["Rice", "Eggs"])
        result = self.store.restore([milk["id"]])
        self.assertEqual(result["restored"], [milk["id"]])
        self.assertEqual(self.names(), ["Rice", "Milk", "Eggs"])

    def test_restore_skips_unknown_ids_and_items_already_back(self):
        milk = self.store.add("Milk")["item"]
        self.store.remove(milk["id"])
        self.store.restore([milk["id"]])
        version = self.store.snapshot()["version"]
        result = self.store.restore([milk["id"], "unknown"])
        self.assertEqual(result["restored"], [])
        self.assertEqual(self.store.snapshot()["version"], version)
        self.assertEqual(self.names(), ["Milk"])

    def test_restore_requires_a_list_of_ids(self):
        with self.assertRaises(ValidationError):
            self.store.restore("abc")

    def test_remove_unknown_item(self):
        with self.assertRaises(NotFound):
            self.store.remove("nope")

    def test_clear_checked_removes_only_bought_items_and_can_be_undone(self):
        eggs = self.store.add("Eggs")["item"]
        self.store.add("Milk")
        rice = self.store.add("Rice")["item"]
        self.store.check(eggs["id"], True)
        self.store.check(rice["id"], True)
        result = self.store.clear_checked()
        self.assertEqual(sorted(result["removed"]), sorted([eggs["id"], rice["id"]]))
        self.assertEqual(self.names(), ["Milk"])
        self.store.restore(result["removed"])
        self.assertEqual(self.names(), ["Rice", "Milk", "Eggs"])

    def test_recent_counts_how_often_things_are_added(self):
        milk = self.store.add("Milk")["item"]
        self.store.add("Eggs")
        self.store.remove(milk["id"])
        self.store.add("milk")
        recent = {r["name"]: r["count"] for r in self.store.snapshot()["recent"]}
        self.assertEqual(recent, {"Milk": 2, "Eggs": 1})
        self.assertEqual(self.store.snapshot()["recent"][0]["name"], "Milk")

    def test_state_survives_a_restart(self):
        eggs = self.store.add("Eggs")["item"]
        self.store.check(eggs["id"], True)
        self.store.add("Milk")
        reloaded = ShoppingList(self.path)
        self.assertEqual(reloaded.snapshot(), self.store.snapshot())

    def test_corrupt_file_is_set_aside_and_list_starts_fresh(self):
        with open(self.path, "w") as f:
            f.write("{not json")
        store = ShoppingList(self.path)
        self.assertEqual(store.snapshot()["items"], [])
        backups = [n for n in os.listdir(self.tmp.name) if ".corrupt" in n]
        self.assertEqual(len(backups), 1)

    def test_saved_file_is_valid_json(self):
        self.store.add("Eggs")
        with open(self.path) as f:
            data = json.load(f)
        self.assertEqual(data["items"][0]["name"], "Eggs")

    def test_snapshot_is_a_copy(self):
        self.store.add("Eggs")
        state = self.store.snapshot()
        state["items"][0]["name"] = "Changed"
        self.assertEqual(self.names(), ["Eggs"])

    def test_wait_for_change_wakes_up_on_a_mutation(self):
        version = self.store.snapshot()["version"]
        timer = threading.Timer(0.05, lambda: self.store.add("Eggs"))
        timer.start()
        started = time.monotonic()
        state = self.store.wait_for_change(version, timeout=5)
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(state["version"], version + 1)

    def test_wait_for_change_times_out_with_current_state(self):
        version = self.store.snapshot()["version"]
        state = self.store.wait_for_change(version, timeout=0.05)
        self.assertEqual(state["version"], version)


if __name__ == "__main__":
    unittest.main()
