"""The shared shopping list: in-memory state, persisted to a JSON file."""
import copy
import re
import uuid

from .store import JsonStore, NotFound, ValidationError, tidy_text, utc_now

__all__ = ["MAX_ITEMS", "NotFound", "ShoppingList", "ValidationError", "utc_now"]

MAX_NAME_LENGTH = 80
MAX_ITEMS = 250
MAX_RECENT = 200
RECENT_SENT = 60
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")


def clean_name(raw):
    if not isinstance(raw, str):
        raise ValidationError("Item name must be text.")
    name = tidy_text(
        raw,
        max_length=MAX_NAME_LENGTH,
        empty_message="Type an item name first.",
        too_long_message="Keep item names under %d characters." % MAX_NAME_LENGTH,
    )
    return name[0].upper() + name[1:]


def name_key(name):
    return " ".join(name.split()).casefold()


class ShoppingList(JsonStore):
    label = "shopping list"

    # Writes

    def add(self, raw_name, item_id=None):
        name = clean_name(raw_name)
        key = name_key(name)
        with self._changed:
            existing = next((i for i in self._items if name_key(i["name"]) == key), None)
            if existing is not None and not existing["done"]:
                return self._result("exists", existing)

            if existing is not None:
                self._items.remove(existing)
                existing.update(done=False, checked=None, added=self._clock())
                item, outcome = existing, "readded"
            else:
                if len(self._items) >= MAX_ITEMS:
                    raise ValidationError("The list is full. Clear bought items to make room.")
                item = {
                    "id": self._new_id(item_id),
                    "name": name,
                    "done": False,
                    "added": self._clock(),
                    "checked": None,
                }
                outcome = "added"

            self._items.insert(0, item)
            self._remember(name)
            self._commit()
            return self._result(outcome, item)

    def check(self, item_id, done):
        if not isinstance(done, bool):
            raise ValidationError("'done' must be true or false.")
        with self._changed:
            item = self._get(item_id)
            if item["done"] != done:
                item["done"] = done
                item["checked"] = self._clock() if done else None
                self._commit()
            return self._result("checked" if done else "unchecked", item)

    def remove(self, item_id):
        with self._changed:
            item = self._get(item_id)
            index = self._items.index(item)
            self._items.pop(index)
            self._discard(index, item)
            self._commit()
            return self._result("removed", item)

    def clear_checked(self):
        with self._changed:
            removed = [(i, item) for i, item in enumerate(self._items) if item["done"]]
            if removed:
                self._items = [item for item in self._items if not item["done"]]
                for index, item in removed:
                    self._discard(index, item)
                self._commit()
            return {"state": self._state(), "removed": [item["id"] for _, item in removed]}

    def restore(self, item_ids):
        with self._changed:
            present = {item["id"] for item in self._items}
            entries = self._take_from_trash(item_ids, present)
            for index, item in entries:
                self._items.insert(min(index, len(self._items)), item)
            if entries:
                self._commit()
            return {"state": self._state(), "restored": [item["id"] for _, item in entries]}

    # Internals

    def _get(self, item_id):
        item = next((i for i in self._items if i["id"] == item_id), None)
        if item is None:
            raise NotFound("That item isn't on the list anymore.")
        return item

    def _new_id(self, requested):
        taken = {item["id"] for item in self._items} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    def _remember(self, name):
        key = name_key(name)
        entry = next((r for r in self._recent if name_key(r["name"]) == key), None)
        if entry is None:
            entry = {"name": name, "count": 0}
        else:
            self._recent.remove(entry)
        entry["count"] += 1
        entry["last"] = self._clock()
        self._recent.insert(0, entry)
        del self._recent[MAX_RECENT:]

    def _result(self, outcome, item):
        return {"state": self._state(), "outcome": outcome, "item": copy.deepcopy(item)}

    # JsonStore hooks

    def _reset(self):
        self._items = []
        self._recent = []

    def _state(self):
        return {
            "version": self._version,
            "items": copy.deepcopy(self._items),
            "recent": copy.deepcopy(self._recent[:RECENT_SENT]),
        }

    def _to_disk(self):
        return {"items": self._items, "recent": self._recent}

    def _from_disk(self, data):
        self._items = [_valid_item(i) for i in data.get("items", [])]
        self._recent = [_valid_recent(r) for r in data.get("recent", [])]


def _valid_item(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["name"], str) and isinstance(raw["done"], bool)):
        raise ValueError("bad item")
    return {
        "id": raw["id"],
        "name": raw["name"],
        "done": raw["done"],
        "added": raw.get("added"),
        "checked": raw.get("checked"),
    }


def _valid_recent(raw):
    if not (isinstance(raw["name"], str) and isinstance(raw["count"], int)):
        raise ValueError("bad recent entry")
    return {"name": raw["name"], "count": raw["count"], "last": raw.get("last")}
