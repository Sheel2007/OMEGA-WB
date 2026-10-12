"""The grocery list: what to pick up at Lidl or Trader Joe's, who asked for it, and what it costs.

Items come from a phone scanning a product's barcode or QR code, from a product
search, or from a name typed in. Each one keeps its price in cents (so totals never
pick up floating-point pennies), how many to get, which store sells it and who's
asking for it.

Every product added is also remembered in a small catalog, keyed by its barcode
(or its name when it has none), with the price it was last added at and the photo
someone took of it, if any. Scanning the same thing again fills itself in from
there without going online, and searches find the household's usual things first.
Photo files themselves live in board/grocery_images.py; items only name them.

It also keeps who gets a text when something's added (name, US number, carrier;
board/grocery_texts.py sends them). Screens only ever get the numbers masked.
"""
import copy
import re
import uuid

from .grocery_texts import CARRIERS, US_NUMBER
from .notify import clean_phone, mask_phone
from .store import JsonStore, NotFound, ValidationError, tidy_text

__all__ = ["GroceryList", "NotFound", "ValidationError", "normalize_code", "STORES"]

STORES = ("traderjoes", "lidl")
MAX_NAME_LENGTH = 80
MAX_BRAND_LENGTH = 40
MAX_SIZE_LENGTH = 24
MAX_PERSON_LENGTH = 30
MAX_ITEMS = 200
MAX_QTY = 99
# $1,000.00: a typo guard, not a budget.
MAX_PRICE_CENTS = 100000
MAX_CATALOG = 300
CATALOG_SENT = 80
MAX_PEOPLE = 20
MAX_TEXTING = 12
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
PHOTO_NAME = re.compile(r"^[a-f0-9]{16}\.(?:jpg|png|webp)$")
DIGITS = re.compile(r"^\d+$")


# Barcodes


def check_digit(body):
    """The GTIN check digit for `body` (every digit but the last)."""
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return str((10 - total % 10) % 10)


def normalize_code(raw):
    """A product barcode as stored: EAN-8 as is, everything else as 13 digits.

    UPC-A (12 digits) and GTIN-14 with a leading zero become the EAN-13 that names
    the same product, and an EAN-8 padded with zeros goes back to its 8 digits, so
    one product never ends up under two codes. Returns None
    for anything that isn't a barcode with a valid check digit.
    """
    if not isinstance(raw, str):
        return None
    code = raw.strip()
    if not DIGITS.match(code) or len(code) not in (8, 12, 13, 14):
        return None
    if check_digit(code[:-1]) != code[-1]:
        return None
    if len(code) == 12:
        code = "0" + code
    elif len(code) == 14:
        if code[0] != "0":
            return None
        code = code[1:]
    # An EAN-8 padded out with zeros (as GS1 QR codes carry it) is still that EAN-8.
    if len(code) == 13 and code.startswith("00000"):
        code = code[5:]
    return code


# Cleaning what people send


def _text(raw, *, label, max_length, required=False):
    if raw is None or (isinstance(raw, str) and not raw.strip() and not required):
        return None
    if not isinstance(raw, str):
        raise ValidationError("%s must be text." % label)
    return tidy_text(raw, max_length=max_length, empty_message="Type %s first." % label.lower(),
                     too_long_message="Keep %s under %d characters." % (label.lower(), max_length))


def clean_name(raw):
    name = _text(raw, label="The item's name", max_length=MAX_NAME_LENGTH, required=True)
    return name[0].upper() + name[1:]


def clean_store(raw):
    if raw is None or raw == "":
        return None
    if raw not in STORES:
        raise ValidationError("The store must be Trader Joe's or Lidl.")
    return raw


def clean_price(raw):
    """Cents, or None for no price. Sent as a whole number of cents."""
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ValidationError("Send the price as a whole number of cents.")
    if not 0 <= raw <= MAX_PRICE_CENTS:
        raise ValidationError("That price doesn't look right.")
    return raw


def clean_qty(raw):
    if raw is None:
        return 1
    if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= MAX_QTY:
        raise ValidationError("Get between 1 and %d of something." % MAX_QTY)
    return raw


def clean_code(raw):
    if raw is None or raw == "":
        return None
    code = normalize_code(raw)
    if code is None:
        raise ValidationError("That barcode isn't valid.")
    return code


def clean_person(raw):
    return _text(raw, label="A name", max_length=MAX_PERSON_LENGTH)


def clean_texter_name(raw):
    name = clean_person(raw)
    if name is None:
        raise ValidationError("Type your name first.")
    return name


def clean_texter_phone(raw):
    phone = clean_phone(raw, "1")
    if phone is None:
        raise ValidationError("Type the phone number first.")
    if not US_NUMBER.match(phone):
        raise ValidationError("Texts only reach US numbers.")
    return phone


def clean_carrier(raw):
    if raw not in CARRIERS:
        raise ValidationError("Pick the phone's carrier.")
    return raw


def name_key(name):
    return " ".join(name.split()).casefold()


class GroceryList(JsonStore):
    label = "grocery list"

    def __init__(self, path=None, *, currency="USD", photo_exists=None, texts=False, on_add=None, on_join=None,
                 **kwargs):
        self._currency = currency
        # Whether a photo name refers to a saved photo (grocery_images.Photos.exists).
        self._photo_exists = photo_exists or (lambda name: True)
        # Whether the board can send texts (an email account is set up), for the app to say so.
        self._texts = texts
        # Told about each item put on the list and each person signing up for texts, once
        # saved (grocery_texts.GroceryTexts.added and .joined).
        self._on_add = on_add
        self._on_join = on_join
        # Removed people, for Undo: in memory only, so a number taken off is gone from the file.
        self._texting_trash = {}
        super().__init__(path, **kwargs)

    def _clean_photo(self, raw):
        if raw is None or raw == "":
            return None
        if not isinstance(raw, str) or not PHOTO_NAME.match(raw) or not self._photo_exists(raw):
            raise ValidationError("That photo didn't save. Take it again.")
        return raw

    # Reads

    def known(self, code):
        """What the board remembers about a barcode, shaped like a product lookup, or None."""
        code = normalize_code(code)
        if code is None:
            return None
        with self._changed:
            entry = next((e for e in self._catalog if e["code"] == code), None)
            return self._as_product(entry) if entry else None

    def texting_book(self):
        """Everyone signed up for texts, numbers unmasked: for sending from the Pi only."""
        with self._changed:
            return [{"name": t["name"], "phone": t["phone"], "carrier": t["carrier"]} for t in self._texting]

    def open_ids(self, item_ids):
        """Which of `item_ids` are still on the list and not bought yet."""
        with self._changed:
            return {i["id"] for i in self._items if i["id"] in item_ids and not i["done"]}

    def photos_in_use(self):
        """Every photo the list, the catalog or Undo could still show."""
        with self._changed:
            entries = self._items + self._catalog + [item for _, item in self._trash.values()]
            return {e["photo"] for e in entries if e.get("photo")}

    def search_known(self, query, store=None, limit=8):
        """Remembered products whose name or brand has every word of `query`, most used first."""
        words = name_key(query or "").split()
        if not words:
            return []
        with self._changed:
            found = []
            for entry in sorted(self._catalog, key=lambda e: (-e["count"], e["name"].casefold())):
                text = name_key("%s %s" % (entry["name"], entry.get("brand") or ""))
                if all(word in text for word in words) and (store is None or entry.get("store") in (None, store)):
                    found.append(self._as_product(entry))
                if len(found) >= limit:
                    break
            return found

    # Writes

    def add(self, raw, item_id=None):
        if not isinstance(raw, dict):
            raise ValidationError("Send the item as a JSON object.")
        name = clean_name(raw.get("name"))
        code = clean_code(raw.get("code"))
        fields = {
            "brand": _text(raw.get("brand"), label="The brand", max_length=MAX_BRAND_LENGTH),
            "size": _text(raw.get("size"), label="The size", max_length=MAX_SIZE_LENGTH),
            "store": clean_store(raw.get("store")),
            "price": clean_price(raw.get("price")),
            "by": clean_person(raw.get("by")),
            "photo": self._clean_photo(raw.get("photo")),
        }
        qty = clean_qty(raw.get("qty"))
        with self._changed:
            if fields["photo"] is None:
                fields["photo"] = self._known_photo(code, name)
            existing = self._find_same(code, name)
            if existing is not None and not existing["done"]:
                # Scanned again, or asked for again: get more of it.
                existing["qty"] = min(MAX_QTY, existing["qty"] + qty)
                for key in ("store", "price", "by", "photo"):
                    if fields[key] is not None:
                        existing[key] = fields[key]
                item, outcome = existing, "more"
                self._items.remove(item)
            elif existing is not None:
                self._items.remove(existing)
                existing.update(done=False, checked=None, added=self._clock(), qty=qty,
                                **{k: v for k, v in fields.items() if v is not None or k == "by"})
                item, outcome = existing, "readded"
            else:
                if len(self._items) >= MAX_ITEMS:
                    raise ValidationError("The list is full. Clear bought items to make room.")
                item = {
                    "id": self._new_id(item_id),
                    "name": name,
                    "code": code,
                    **fields,
                    "qty": qty,
                    "done": False,
                    "added": self._clock(),
                    "checked": None,
                }
                outcome = "added"
            self._items.insert(0, item)
            self._remember(item)
            self._commit()
            result = self._result(outcome, item)
        if self._on_add is not None:
            self._on_add(result["item"])
        return result

    def update(self, item_id, raw):
        """Changes only the fields given: name, brand, size, store, price, qty, by, photo."""
        if not isinstance(raw, dict):
            raise ValidationError("Send the changes as a JSON object.")
        changes = {}
        if "name" in raw:
            changes["name"] = clean_name(raw["name"])
        if "brand" in raw:
            changes["brand"] = _text(raw["brand"], label="The brand", max_length=MAX_BRAND_LENGTH)
        if "size" in raw:
            changes["size"] = _text(raw["size"], label="The size", max_length=MAX_SIZE_LENGTH)
        if "store" in raw:
            changes["store"] = clean_store(raw["store"])
        if "price" in raw:
            changes["price"] = clean_price(raw["price"])
        if "qty" in raw:
            changes["qty"] = clean_qty(raw["qty"])
        if "by" in raw:
            changes["by"] = clean_person(raw["by"])
        if "photo" in raw:
            changes["photo"] = self._clean_photo(raw["photo"])
        with self._changed:
            item = self._get(item_id)
            if any(item.get(k) != v for k, v in changes.items()):
                item.update(changes)
                # Taking a photo off means it was wrong: don't bring it back next time either.
                self._remember(item, counted=False, clear={"photo"} & set(changes))
                self._commit()
            return self._result("updated", item)

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

    # Texts

    def add_texter(self, raw, texter_id=None):
        """Signs someone up for texts. Their number again changes its name and carrier."""
        if not isinstance(raw, dict):
            raise ValidationError("Send the person as a JSON object.")
        name = clean_texter_name(raw.get("name"))
        phone = clean_texter_phone(raw.get("phone"))
        carrier = clean_carrier(raw.get("carrier"))
        with self._changed:
            texter = next((t for t in self._texting if t["phone"] == phone), None)
            if texter is None:
                if len(self._texting) >= MAX_TEXTING:
                    raise ValidationError("That's as many people as get texts (%d)." % MAX_TEXTING)
                texter = {"id": self._new_texter_id(texter_id), "phone": phone}
                self._texting.append(texter)
            texter.update(name=name, carrier=carrier)
            self._commit()
            result = {"state": self._state(), "texter": _public_texter(texter)}
            joined = dict(texter)
        if self._on_join is not None:
            self._on_join(joined)
        return result

    def remove_texter(self, texter_id):
        with self._changed:
            texter = next((t for t in self._texting if t["id"] == texter_id), None)
            if texter is None:
                raise NotFound("They aren't getting texts anymore.")
            index = self._texting.index(texter)
            self._texting.pop(index)
            self._texting_trash[texter["id"]] = (index, texter)
            while len(self._texting_trash) > MAX_TEXTING:
                self._texting_trash.pop(next(iter(self._texting_trash)))
            self._commit()
            return {"state": self._state(), "texter": _public_texter(texter)}

    def restore_texters(self, texter_ids):
        if not isinstance(texter_ids, list) or not all(isinstance(i, str) for i in texter_ids):
            raise ValidationError("'ids' must be a list of ids.")
        with self._changed:
            phones = {t["phone"] for t in self._texting}
            back = sorted((self._texting_trash.pop(i) for i in texter_ids if i in self._texting_trash),
                          key=lambda pair: pair[0])
            back = [(index, t) for index, t in back if t["phone"] not in phones][:MAX_TEXTING - len(self._texting)]
            for index, texter in back:
                self._texting.insert(min(index, len(self._texting)), texter)
            if back:
                self._commit()
            return {"state": self._state(), "restored": [t["id"] for _, t in back]}

    # Internals

    def _new_texter_id(self, requested):
        taken = {t["id"] for t in self._texting} | set(self._texting_trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    def _known_photo(self, code, name):
        """The photo the catalog has for this product, so it comes back when it's added again."""
        key = name_key(name)
        entry = next((e for e in self._catalog if (e["code"] == code if code else
                                                   e["code"] is None and name_key(e["name"]) == key)), None)
        return entry.get("photo") if entry else None

    def _find_same(self, code, name):
        if code is not None:
            return next((i for i in self._items if i["code"] == code), None)
        key = name_key(name)
        return next((i for i in self._items if i["code"] is None and name_key(i["name"]) == key), None)

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

    def _remember(self, item, counted=True, clear=frozenset()):
        """Keeps the catalog entry for `item` up to date, newest first."""
        if item["code"] is not None:
            entry = next((e for e in self._catalog if e["code"] == item["code"]), None)
        else:
            key = name_key(item["name"])
            entry = next((e for e in self._catalog if e["code"] is None and name_key(e["name"]) == key), None)
        if entry is None:
            entry = {"code": item["code"], "count": 0}
        else:
            self._catalog.remove(entry)
        entry.update(name=item["name"], brand=item["brand"], size=item["size"], last=self._clock())
        # A price or store someone has since cleared shouldn't wipe what was known.
        for key in ("store", "price", "photo"):
            if item.get(key) is not None or key not in entry or key in clear:
                entry[key] = item.get(key)
        if counted:
            entry["count"] += 1
        self._catalog.insert(0, entry)
        del self._catalog[MAX_CATALOG:]
        if item["by"]:
            key = name_key(item["by"])
            self._people = [item["by"]] + [p for p in self._people if name_key(p) != key]
            del self._people[MAX_PEOPLE:]

    @staticmethod
    def _as_product(entry):
        return {
            "code": entry["code"],
            "name": entry["name"],
            "brand": entry.get("brand"),
            "size": entry.get("size"),
            "store": entry.get("store"),
            "price": entry.get("price"),
            "photo": entry.get("photo"),
            "source": "board",
        }

    def _result(self, outcome, item):
        return {"state": self._state(), "outcome": outcome, "item": copy.deepcopy(item)}

    # JsonStore hooks

    def _reset(self):
        self._items = []
        self._catalog = []
        self._people = []
        self._texting = []

    def _state(self):
        return {
            "version": self._version,
            "currency": self._currency,
            "items": copy.deepcopy(self._items),
            "catalog": [self._as_product(e) | {"count": e["count"]} for e in self._catalog[:CATALOG_SENT]],
            "people": list(self._people),
            "texting": [_public_texter(t) for t in self._texting],
            "texts": self._texts,
        }

    def _to_disk(self):
        return {"items": self._items, "catalog": self._catalog, "people": self._people, "texting": self._texting}

    def _from_disk(self, data):
        self._items = [_valid_item(i) for i in data.get("items", [])]
        self._catalog = [_valid_entry(e) for e in data.get("catalog", [])]
        self._people = [p for p in data.get("people", []) if isinstance(p, str)][:MAX_PEOPLE]
        self._texting = [_valid_texter(t) for t in data.get("texting", [])][:MAX_TEXTING]


def _public_texter(texter):
    return {"id": texter["id"], "name": texter["name"], "carrier": texter["carrier"],
            "phone": mask_phone(texter["phone"])}


def _valid_texter(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["name"], str) and isinstance(raw["phone"], str)
            and US_NUMBER.match(raw["phone"]) and raw["carrier"] in CARRIERS):
        raise ValueError("bad texter")
    return {"id": raw["id"], "name": raw["name"], "phone": raw["phone"], "carrier": raw["carrier"]}


def _optional(raw, key, kind):
    value = raw.get(key)
    if value is not None and (not isinstance(value, kind) or isinstance(value, bool)):
        raise ValueError("bad %s" % key)
    return value


def _valid_item(raw):
    if not (isinstance(raw["id"], str) and isinstance(raw["name"], str) and isinstance(raw["done"], bool)):
        raise ValueError("bad item")
    if raw.get("store") not in (None,) + STORES:
        raise ValueError("bad store")
    qty = raw.get("qty", 1)
    if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= MAX_QTY:
        raise ValueError("bad qty")
    return {
        "id": raw["id"],
        "name": raw["name"],
        "code": _optional(raw, "code", str),
        "brand": _optional(raw, "brand", str),
        "size": _optional(raw, "size", str),
        "store": raw.get("store"),
        "price": _optional(raw, "price", int),
        "by": _optional(raw, "by", str),
        "photo": _optional(raw, "photo", str),
        "qty": qty,
        "done": raw["done"],
        "added": raw.get("added"),
        "checked": raw.get("checked"),
    }


def _valid_entry(raw):
    if not (isinstance(raw["name"], str) and isinstance(raw["count"], int)):
        raise ValueError("bad catalog entry")
    if raw.get("store") not in (None,) + STORES:
        raise ValueError("bad store")
    return {
        "code": _optional(raw, "code", str),
        "name": raw["name"],
        "brand": _optional(raw, "brand", str),
        "size": _optional(raw, "size", str),
        "store": raw.get("store"),
        "price": _optional(raw, "price", int),
        "photo": _optional(raw, "photo", str),
        "count": raw["count"],
        "last": raw.get("last"),
    }
