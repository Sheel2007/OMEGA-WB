"""Every Trader Joe's and Lidl product Open Food Facts knows of, kept on the Pi.

It's what the grocery search predicts from while someone is still typing: "marin"
finds Trader Joe's Marinara Sauce without asking anyone, because Open Food Facts'
own search can't finish half a word. The list (a few thousand names, under a
megabyte) is downloaded on its own thread a page at a time, saved in
data/grocery-products.json, and refreshed once a week. Until the first download
finishes, predictions come only from the household's own things and the app's
built-in words.
"""
import json
import logging
import os
import re
import tempfile
import threading
import time
from urllib.parse import urlencode

from .grocery import normalize_code
from .products import SEARCH_URL, brand_list, fetch_json, fold, image_of, store_for, tidy_name, tidy_size

log = logging.getLogger(__name__)

# Each store's own products in Open Food Facts, in one country.
BRAND_QUERIES = {"traderjoes": 'brands_tags:"trader-joe-s"', "lidl": 'brands_tags:"lidl"'}
FIELDS = "code,product_name,product_name_en,brands,quantity,image_front_small_url,image_small_url"
PAGE_SIZE = 100
# Trader Joe's has about 47 pages in the US; this only stops a runaway download.
MAX_PAGES = 80
# Between pages, so the download is gentle on a volunteer-run service.
PAGE_PAUSE_SECONDS = 1.5
REFRESH_SECONDS = 7 * 24 * 60 * 60
RETRY_SECONDS = 60 * 60
SUGGESTIONS = 6
COUNTRY = re.compile(r"^[a-z][a-z-]{1,40}$")
WORD = re.compile(r"\w+")


class StoreProducts:
    def __init__(self, path=None, *, country="united-states", fetch=fetch_json, clock=time.time,
                 pause=PAGE_PAUSE_SECONDS):
        if not COUNTRY.match(country):
            raise ValueError("The grocery country must look like 'united-states', not %r." % country)
        self._path = path
        self._country = country
        self._fetch = fetch
        self._clock = clock
        self._pause = pause
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._fetched_at = 0
        self._products = []
        self._index = []
        self._images = {}
        self._load()

    # Reads

    def __len__(self):
        with self._lock:
            return len(self._products)

    def suggest(self, words, store=None, limit=SUGGESTIONS):
        """Products whose name has a word starting with each of `words` (folded), best first."""
        if not words:
            return []
        typed = " ".join(words)
        with self._lock:
            index = self._index
        scored = []
        for name_words, folded, product in index:
            if store is not None and product["store"] != store:
                continue
            score = 0
            for word in words:
                at = next((i for i, w in enumerate(name_words) if w.startswith(word)), -1)
                if at < 0:
                    break
                score += at
            else:
                if folded.startswith(typed):
                    score -= 10
                scored.append((score, len(folded), folded, product))
        scored.sort(key=lambda s: s[:3])
        results, seen = [], set()
        for _, _, folded, product in scored:
            if folded in seen:
                continue
            seen.add(folded)
            results.append(dict(product))
            if len(results) >= limit:
                break
        return results

    def image_url(self, code):
        with self._lock:
            return self._images.get(code)

    # The download thread

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="store-products", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        while not self._stop.is_set():
            wait = self._fetched_at + REFRESH_SECONDS - self._clock()
            if wait <= 0:
                wait = REFRESH_SECONDS if self.refresh() else RETRY_SECONDS
            self._stop.wait(min(wait, RETRY_SECONDS))

    def refresh(self):
        """Downloads both stores' products. True if it worked (the old list stays if not)."""
        found = {}
        try:
            for store, brand in BRAND_QUERIES.items():
                query = '%s AND countries_tags:"en:%s"' % (brand, self._country)
                for page in range(1, MAX_PAGES + 1):
                    if self._stop.is_set():
                        return False
                    data = self._fetch("%s?%s" % (SEARCH_URL, urlencode({
                        "q": query, "page": page, "page_size": PAGE_SIZE, "fields": FIELDS, "langs": "en",
                    })))
                    hits = data.get("hits") if isinstance(data, dict) else None
                    if not isinstance(hits, list):
                        raise ValueError("search answered without hits")
                    for hit in hits:
                        product = _product(hit, store)
                        if product and product["code"] not in found:
                            found[product["code"]] = product
                    if page >= int(data.get("page_count") or 0) or not hits:
                        break
                    self._stop.wait(self._pause)
        except (OSError, ValueError, KeyError, TypeError):
            log.warning("Couldn't download the stores' products; trying again later", exc_info=True)
            return False
        products = list(found.values())
        self._fetched_at = self._clock()
        self._use(products)
        self._save(products)
        log.info("Downloaded %d Trader Joe's and Lidl products for the grocery search", len(products))
        return True

    # Internals

    def _use(self, products):
        index = [(WORD.findall(fold(p["name"])), fold(p["name"]), _public(p)) for p in products]
        images = {p["code"]: p["imageUrl"] for p in products if p.get("imageUrl")}
        with self._lock:
            self._products = products
            self._index = index
            self._images = images

    def _save(self, products):
        if not self._path:
            return
        folder = os.path.dirname(os.path.abspath(self._path))
        try:
            os.makedirs(folder, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=folder, prefix=".grocery-products-", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"fetched": self._fetched_at, "country": self._country, "products": products}, f,
                          ensure_ascii=False)
            os.replace(tmp, self._path)
        except OSError:
            log.exception("Couldn't save the stores' products to %s", self._path)

    def _load(self):
        if not self._path or not os.path.exists(self._path):
            return
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("country") != self._country:
                return
            products = [p for p in data["products"] if isinstance(p, dict) and isinstance(p.get("name"), str)
                        and isinstance(p.get("code"), str) and p.get("store") in BRAND_QUERIES]
            self._fetched_at = float(data.get("fetched") or 0)
            self._use(products)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            log.warning("The saved list of the stores' products was unreadable; downloading it again")


def _product(hit, store):
    if not isinstance(hit, dict):
        return None
    code = normalize_code(str(hit.get("code") or ""))
    brands = brand_list(hit.get("brands"))
    name = tidy_name(hit.get("product_name_en"), brands) or tidy_name(hit.get("product_name"), brands)
    if not code or not name:
        return None
    return {
        "code": code,
        "name": name,
        "brand": brands[0][:40] if brands else None,
        "size": tidy_size(hit.get("quantity")),
        "store": store_for(code, brands) or store,
        "imageUrl": image_of(hit),
    }


def _public(product):
    """What a screen is sent: everything but where the picture comes from (the Pi serves it)."""
    return {
        "code": product["code"],
        "name": product["name"],
        "brand": product.get("brand"),
        "size": product.get("size"),
        "store": product["store"],
        "price": None,
        "image": bool(product.get("imageUrl")),
        "source": "online",
    }
