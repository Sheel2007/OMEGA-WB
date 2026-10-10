import unittest
import urllib.error

from board.products import (RETRY_SECONDS, ProductLookup, ProductsUnavailable, matches_typed, pick_price, query_text,
                            store_for, tidy_name)

MARINARA = {"status": 1, "product": {"code": "00016285", "product_name": "Marinara Sauce - Trader Joe's",
                                     "brands": "Trader Joe's", "quantity": "25 oz",
                                     "image_front_small_url": "https://images.openfoodfacts.org/m.200.jpg"}}
PRICES = {"items": [
    {"price": 3.49, "currency": "EUR", "location": {"osm_brand": "Lidl"}, "date": "2026-09-01"},
    {"price": 2.5, "currency": "USD", "price_is_discounted": True, "price_without_discount": 2.99,
     "location": {"osm_brand": None, "website_url": "https://www.shoprite.com"}, "date": "2026-09-02"},
    {"price": 3.29, "currency": "USD", "location": {"osm_name": "Trader Joe's"}, "date": "2026-08-30"},
]}


class FakeFetch:
    def __init__(self, routes):
        self.routes = routes
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        for part, answer in self.routes.items():
            if part in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class HelpersTest(unittest.TestCase):
    def test_tidy_name_drops_repeated_brands(self):
        self.assertEqual(tidy_name("Spinach Dip - Trader Joe's - Trader Joe's", ["Trader Joe's"]), "Spinach Dip")
        self.assertEqual(tidy_name("organic  marinara", []), "Organic marinara")
        self.assertIsNone(tidy_name("Trader Joe's", ["Trader Joe's"]))
        self.assertIsNone(tidy_name(None, []))

    def test_store_for_knows_each_store_by_brand_or_prefix(self):
        self.assertEqual(store_for("00016285", ["Trader Joe's"]), "traderjoes")
        self.assertEqual(store_for("4056489308294", ["Coconut"]), "lidl")
        self.assertEqual(store_for("1234", ["Milbona"]), "lidl")
        self.assertIsNone(store_for("0049000028911", ["Coke"]))

    def test_query_text_removes_search_syntax(self):
        self.assertEqual(query_text('  trader "joe\'s" (marinara) brands:x  '), "trader joe's marinara brands x")
        self.assertEqual(query_text(None), "")

    def test_pick_price_prefers_the_store_then_the_latest_regular_price(self):
        self.assertEqual(pick_price(PRICES["items"], currency="USD", store="traderjoes")["price"], 329)
        self.assertEqual(pick_price(PRICES["items"], currency="USD", store=None)["price"], 299)
        self.assertEqual(pick_price(PRICES["items"], currency="EUR", store=None)["store"], "lidl")
        self.assertIsNone(pick_price([{"price": 1, "currency": "USD", "price_per": "KILOGRAM"}], currency="USD", store=None))


class ProductLookupTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def test_lookup_names_prices_and_guesses_the_store(self):
        fetch = FakeFetch({"/product/00016285": MARINARA, "prices?": PRICES})
        product = ProductLookup(fetch=fetch, now=self.clock).lookup("00016285")
        self.assertEqual(product, {"code": "00016285", "name": "Marinara Sauce", "brand": "Trader Joe's",
                                   "size": "25 oz", "store": "traderjoes", "price": 329, "priceDate": "2026-08-30",
                                   "image": True, "found": True, "source": "online"})

    def test_lookup_tries_the_12_digit_upc_and_caches(self):
        fetch = FakeFetch({"/product/036000291452": MARINARA, "prices?": {"items": []}})
        lookup = ProductLookup(fetch=fetch, now=self.clock)
        self.assertTrue(lookup.lookup("036000291452")["found"])
        count = len(fetch.urls)
        lookup.lookup("0036000291452")
        self.assertEqual(len(fetch.urls), count)

    def test_an_unknown_product_says_so(self):
        fetch = FakeFetch({"prices?": {"items": []}})
        product = ProductLookup(fetch=fetch, now=self.clock).lookup("4056489011293")
        self.assertFalse(product["found"])
        self.assertEqual(product["store"], "lidl")

    def test_a_bad_barcode_is_a_value_error(self):
        with self.assertRaises(ValueError):
            ProductLookup(fetch=FakeFetch({}), now=self.clock).lookup("12345")

    def test_failures_wait_before_trying_again(self):
        fetch = FakeFetch({"/product/": OSError("offline")})
        lookup = ProductLookup(fetch=fetch, now=self.clock)
        with self.assertRaises(ProductsUnavailable):
            lookup.lookup("00016285")
        count = len(fetch.urls)
        with self.assertRaises(ProductsUnavailable):
            lookup.lookup("00016285")
        self.assertEqual(len(fetch.urls), count)
        self.clock.now += RETRY_SECONDS
        fetch.routes = {"/product/00016285": MARINARA, "prices?": OSError("prices down")}
        self.assertEqual(lookup.lookup("00016285")["price"], None)

    def test_image_urls_are_remembered_from_lookups_and_searches(self):
        fetch = FakeFetch({"/product/00016285": MARINARA, "prices?": {"items": []},
                           "search?": {"hits": [{"code": "4056489011293", "product_name": "Yogurt", "brands": "Lidl",
                                                 "image_front_small_url": "https://images.openfoodfacts.org/y.jpg"}]}})
        lookup = ProductLookup(fetch=fetch, now=self.clock)
        self.assertEqual(lookup.image_url("00016285"), "https://images.openfoodfacts.org/m.200.jpg")
        lookup.search("yogurt")
        count = len(fetch.urls)
        self.assertEqual(lookup.image_url("4056489011293"), "https://images.openfoodfacts.org/y.jpg")
        self.assertEqual(len(fetch.urls), count, "known from the search, so no lookup")

    def test_matches_typed_needs_each_word_to_start_a_word(self):
        self.assertTrue(matches_typed("Oat Milk Barista", ["oat", "mi"]))
        self.assertTrue(matches_typed("Crème fraîche", ["creme", "fr"]))
        self.assertFalse(matches_typed("Oat bars", ["oat", "mi"]))

    def test_search_filters_by_store_and_tidies_results(self):
        hits = {"hits": [
            {"code": "00016285", "product_name": "Marinara Sauce", "brands": ["Trader Joe's"]},
            {"code": "00016285", "product_name": "Duplicate", "brands": []},
            {"code": "123", "product_name": "Bad code"},
            {"code": "00090769", "product_name": "", "brands": []},
        ]}
        fetch = FakeFetch({"search?": hits})
        results = ProductLookup(fetch=fetch, now=self.clock).search("marinara", "traderjoes")
        self.assertEqual([r["code"] for r in results], ["00016285"])
        self.assertIn("brands_tags%3A%22trader-joe-s%22", fetch.urls[0])
        with self.assertRaises(ValueError):
            ProductLookup(fetch=fetch, now=self.clock).search("x", "aldi")
        self.assertEqual(ProductLookup(fetch=fetch, now=self.clock).search("   "), [])
