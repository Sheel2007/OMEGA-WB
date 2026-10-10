"""Product details for the grocery list, from Open Food Facts (free, no API key).

- A barcode becomes a name, brand and size (Open Food Facts) and, when someone has
  reported one, a recent shelf price (Open Prices, Open Food Facts' price database).
- A search finds products by name, optionally only Trader Joe's or Lidl's own.
- Each product's picture address is remembered, so grocery_images.py can fetch it.
  (Predicting what's being typed is store_products.py's job.)

Answers are cached on the Pi, so every screen shares one request and scanning the
same thing twice doesn't go online twice. Both services are run by volunteers:
a failure is reported as ProductsUnavailable and the app falls back to typing.
"""
import json
import logging
import re
import threading
import unicodedata
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from urllib.parse import quote, urlencode

from .grocery import STORES, normalize_code

log = logging.getLogger(__name__)

PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/%s.json"
PRICES_URL = "https://prices.openfoodfacts.org/api/v1/prices"
SEARCH_URL = "https://search.openfoodfacts.org/search"
USER_AGENT = "WidgetBoard/1.0 (home grocery list)"
FETCH_TIMEOUT_SECONDS = 8
FOUND_CACHE_SECONDS = 24 * 60 * 60
MISSING_CACHE_SECONDS = 60 * 60
SEARCH_CACHE_SECONDS = 60 * 60
# After a failed request, answer "unavailable" straight away for a while (the Pi may be offline).
RETRY_SECONDS = 60
MAX_CACHE = 200
SEARCH_RESULTS = 12
# Picture addresses remembered from lookups and searches.
MAX_IMAGE_URLS = 1000
IMAGE_FIELDS = "image_front_small_url,image_small_url"
MAX_QUERY_LENGTH = 60
PRICES_LOOKED_AT = 20

# How each store's own products are tagged in Open Food Facts.
BRAND_TAGS = {"traderjoes": "trader-joe-s", "lidl": "lidl"}
# Lidl's own brands, so a scanned yogurt from Milbona is known to be from Lidl.
LIDL_BRANDS = {"lidl", "milbona", "pilos", "cien", "freeway", "solevita", "crownfield", "deluxe", "fin carré",
               "snack day", "alesto", "chef select", "dulano", "favorina", "baresa", "combino", "vitasia",
               "italiamo", "sondey", "lupilu", "preferred selection", "j.d. gross", "w5", "formil",
               "envia", "harvest basket", "mcennedy", "bellarom", "trattoria alfredo"}
# GS1 company prefixes registered to Lidl.
LIDL_PREFIXES = ("4056489",)
# Characters the search service would read as query syntax rather than words.
QUERY_SYNTAX = re.compile(r"[+\-&|!(){}\[\]^\"~*?:\\/<>=]+")


class ProductsUnavailable(Exception):
    pass


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return json.load(response)


def store_for(code, brands):
    """Which store sells a product, judged by its brand (or Lidl's barcode prefix). None if unclear."""
    names = [b.strip().casefold() for b in brands]
    if any("trader joe" in b or b == "trader giotto's" or b == "trader josé" for b in names):
        return "traderjoes"
    if any(b in LIDL_BRANDS for b in names) or (code or "").startswith(LIDL_PREFIXES):
        return "lidl"
    return None


def brand_list(raw):
    """Open Food Facts gives brands as a comma-separated string or as a list."""
    if isinstance(raw, list):
        parts = raw
    elif isinstance(raw, str):
        parts = raw.split(",")
    else:
        return []
    seen, brands = set(), []
    for part in parts:
        if isinstance(part, str) and part.strip() and part.strip().casefold() not in seen:
            seen.add(part.strip().casefold())
            brands.append(" ".join(part.split()))
    return brands


def tidy_name(name, brands):
    """A product name fit for a list: "Spinach Dip - Trader Joe's - Trader Joe's" is "Spinach Dip"."""
    if not isinstance(name, str):
        return None
    folded = {b.casefold() for b in brands}
    parts = [" ".join(p.split()) for p in re.split(r"\s+[-–—]\s+", name)]
    kept = []
    for part in parts:
        if part and part.casefold() not in folded and part.casefold() not in (k.casefold() for k in kept):
            kept.append(part)
    text = " - ".join(kept)[:80].strip()
    if not text:
        return None
    return text[0].upper() + text[1:]


def tidy_size(raw):
    if not isinstance(raw, str) or not raw.strip():
        return None
    return " ".join(raw.split())[:24]


def query_text(raw):
    """What someone typed, with anything the search service treats as syntax taken out."""
    if not isinstance(raw, str):
        return ""
    return " ".join(QUERY_SYNTAX.sub(" ", raw).split())[:MAX_QUERY_LENGTH]


def fold(text):
    """Lower case without accents, for matching what someone typed against a name."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).casefold()


def matches_typed(name, words):
    """True when every typed word starts a word of `name` ("oat mi" matches "Oat milk")."""
    name_words = re.findall(r"\w+", fold(name))
    return all(any(w.startswith(typed) for w in name_words) for typed in words)


def image_of(product):
    for key in ("image_front_small_url", "image_small_url"):
        url = product.get(key)
        if isinstance(url, str) and url.startswith("https://"):
            return url
    return None


def pick_price(prices, *, currency, store):
    """The most recent regular shelf price in `currency`, preferring `store`'s. Cents and where, or None."""
    best = None
    for entry in prices:
        if not isinstance(entry, dict) or entry.get("currency") != currency:
            continue
        # Prices by weight (bananas per kilo) don't fit a list of things to pick up.
        if entry.get("price_per") not in (None, "UNIT"):
            continue
        amount = entry.get("price")
        if entry.get("price_is_discounted") and isinstance(entry.get("price_without_discount"), (int, float)):
            amount = entry["price_without_discount"]
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not 0 < amount < 1000:
            continue
        location = entry.get("location") if isinstance(entry.get("location"), dict) else {}
        where = " ".join(str(location.get(k) or "") for k in ("osm_brand", "osm_name", "website_url")).casefold()
        seller = "traderjoes" if "trader joe" in where else "lidl" if "lidl" in where else None
        candidate = {"price": int(round(amount * 100)), "store": seller, "date": entry.get("date")}
        if store is not None and seller == store:
            return candidate
        if best is None:
            best = candidate
    return best


class ProductLookup:
    def __init__(self, currency="USD", fetch=fetch_json, now=time.monotonic, catalog=None):
        self._currency = currency
        # store_products.StoreProducts, which knows most of the two stores' pictures already.
        self._catalog = catalog
        self._fetch = fetch
        self._now = now
        self._lock = threading.Lock()
        self._cache = OrderedDict()
        self._failed_at = None
        self._images = OrderedDict()

    def lookup(self, raw_code):
        """{code, name, brand, size, store, price, found}. Raises ValueError for a bad barcode."""
        code = normalize_code(raw_code)
        if code is None:
            raise ValueError("That isn't a barcode.")
        return self._cached(("code", code), lambda: self._lookup(code))

    def search(self, raw_query, store=None):
        """Products whose name matches, best first. Store-only when `store` is given."""
        query = query_text(raw_query)
        if not query:
            return []
        if store not in (None,) + STORES:
            raise ValueError("The store must be Trader Joe's or Lidl.")
        return self._cached(("search", query.casefold(), store), lambda: self._search(query, store))

    def image_url(self, code):
        """The address of a product's picture, or None. May look the product up to find it."""
        known = self._catalog.image_url(code) if self._catalog is not None else None
        if known:
            return known
        with self._lock:
            if code in self._images:
                return self._images[code]
        self.lookup(code)
        with self._lock:
            return self._images.get(code)

    # Internals

    def _remember_image(self, code, url):
        with self._lock:
            self._images[code] = url
            self._images.move_to_end(code)
            while len(self._images) > MAX_IMAGE_URLS:
                self._images.popitem(last=False)

    def _cached(self, key, load):
        with self._lock:
            now = self._now()
            hit = self._cache.get(key)
            if hit is not None and now < hit[0]:
                self._cache.move_to_end(key)
                return hit[1]
            if self._failed_at is not None and now - self._failed_at < RETRY_SECONDS:
                raise ProductsUnavailable("Can't reach the product database right now. Type the item in instead.")
        try:
            value, ttl = load()
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
            log.warning("Product lookup failed", exc_info=True)
            with self._lock:
                self._failed_at = self._now()
            raise ProductsUnavailable("Can't reach the product database right now. Type the item in instead.")
        with self._lock:
            self._failed_at = None
            self._cache[key] = (self._now() + ttl, value)
            self._cache.move_to_end(key)
            while len(self._cache) > MAX_CACHE:
                self._cache.popitem(last=False)
        return value

    def _product(self, code):
        """Open Food Facts' record for `code`, trying the 12-digit UPC too. None if it has none."""
        fields = "code,product_name,product_name_en,generic_name,brands,quantity," + IMAGE_FIELDS
        tries = [code] + ([code[1:]] if len(code) == 13 and code.startswith("0") else [])
        for attempt in tries:
            try:
                data = self._fetch("%s?%s" % (PRODUCT_URL % quote(attempt), urlencode({"fields": fields})))
            except urllib.error.HTTPError as err:
                # Open Food Facts answers 404 for a product it doesn't know.
                if err.code == 404:
                    continue
                raise
            if isinstance(data, dict) and data.get("status") == 1 and isinstance(data.get("product"), dict):
                return data["product"]
        return None

    def _prices(self, code):
        query = urlencode({"product_code": code, "order_by": "-date", "size": PRICES_LOOKED_AT})
        try:
            data = self._fetch("%s?%s" % (PRICES_URL, query))
        except (OSError, ValueError, urllib.error.URLError):
            # A price is a nice extra; the product is still worth showing without one.
            log.info("No prices for %s", code, exc_info=True)
            return []
        items = data.get("items") if isinstance(data, dict) else None
        return items if isinstance(items, list) else []

    def _lookup(self, code):
        product = self._product(code)
        prices = self._prices(code)
        if product is None:
            named = next((p["product"] for p in prices if isinstance(p.get("product"), dict)
                          and isinstance(p["product"].get("product_name"), str)), None)
            product = named
        brands = brand_list(product.get("brands")) if product else []
        name = None
        if product:
            name = (tidy_name(product.get("product_name_en"), brands) or tidy_name(product.get("product_name"), brands)
                    or tidy_name(product.get("generic_name"), brands))
        store = store_for(code, brands)
        image = image_of(product) if product else None
        self._remember_image(code, image)
        price = pick_price(prices, currency=self._currency, store=store)
        if store is None and price is not None:
            store = price["store"]
        result = {
            "code": code,
            "name": name,
            "brand": brands[0][:40] if brands else None,
            "size": tidy_size(product.get("quantity")) if product else None,
            "store": store,
            "price": price["price"] if price else None,
            "priceDate": price["date"] if price else None,
            "image": image is not None,
            "found": name is not None,
            "source": "online",
        }
        return result, FOUND_CACHE_SECONDS if result["found"] else MISSING_CACHE_SECONDS

    def _search(self, query, store):
        q = query if store is None else '%s brands_tags:"%s"' % (query, BRAND_TAGS[store])
        data = self._fetch("%s?%s" % (SEARCH_URL, urlencode({
            "q": q,
            "page_size": SEARCH_RESULTS * 2,
            "fields": "code,product_name,product_name_en,brands,quantity," + IMAGE_FIELDS,
            "langs": "en",
        })))
        return self._products_from(data, store, limit=SEARCH_RESULTS), SEARCH_CACHE_SECONDS

    def _products_from(self, data, store, *, limit):
        hits = data.get("hits") if isinstance(data, dict) else None
        if not isinstance(hits, list):
            raise ValueError("search answered without hits")
        results, seen = [], set()
        for hit in hits:
            if not isinstance(hit, dict):
                continue
            code = normalize_code(str(hit.get("code") or ""))
            brands = brand_list(hit.get("brands"))
            name = tidy_name(hit.get("product_name_en"), brands) or tidy_name(hit.get("product_name"), brands)
            if not code or not name or code in seen:
                continue
            seen.add(code)
            image = image_of(hit)
            if image:
                self._remember_image(code, image)
            results.append({
                "code": code,
                "name": name,
                "brand": brands[0][:40] if brands else None,
                "size": tidy_size(hit.get("quantity")),
                "store": store_for(code, brands) or store,
                "price": None,
                "image": image is not None,
                "source": "online",
            })
            if len(results) >= limit:
                break
        return results
