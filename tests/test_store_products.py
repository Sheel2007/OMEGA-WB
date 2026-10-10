import json
import os
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from board.store_products import REFRESH_SECONDS, StoreProducts

TJ = [
    {"code": "00016285", "product_name": "Marinara Sauce", "brands": "Trader Joe's", "quantity": "25 oz",
     "image_front_small_url": "https://images.openfoodfacts.org/m.jpg"},
    {"code": "95393094", "product_name": "Tomato Basil Marinara Sauce", "brands": "Trader Joe's"},
    {"code": "0036000291452", "product_name": "Mandarin Orange Chicken", "brands": "Trader Joe's"},
    {"code": "00016286", "product_name": "Bad check digit", "brands": "Trader Joe's"},
]
LIDL = [
    {"code": "4056489011293", "product_name": "Marinated olives", "brands": "Lidl"},
    {"code": "4056489308294", "product_name": "marinara sauce", "brands": "Lidl"},
]


class FakeOpenFoodFacts:
    """Two pages of Trader Joe's, one of Lidl."""

    def __init__(self):
        self.calls = []
        self.down = False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise OSError("offline")
        query = parse_qs(urlsplit(url).query)
        page = int(query["page"][0])
        if "trader-joe-s" in query["q"][0]:
            return {"page_count": 2, "hits": TJ[:2] if page == 1 else TJ[2:]}
        return {"page_count": 1, "hits": LIDL}


class Clock:
    now = 1_000_000.0

    def __call__(self):
        return self.now


class StoreProductsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "grocery-products.json")
        self.fetch = FakeOpenFoodFacts()
        self.products = StoreProducts(self.path, fetch=self.fetch, pause=0)

    def tearDown(self):
        self.tmp.cleanup()

    def names(self, words, store=None):
        return [p["name"] for p in self.products.suggest(words, store)]

    def test_downloads_every_page_of_both_stores_in_the_country(self):
        self.assertTrue(self.products.refresh())
        self.assertEqual(len(self.products), 5)
        self.assertEqual(len(self.fetch.calls), 3)
        self.assertIn('countries_tags%3A%22en%3Aunited-states%22', self.fetch.calls[0])

    def test_predicts_from_half_a_word_names_starting_with_it_first(self):
        self.products.refresh()
        self.assertEqual(self.names(["marin"]), ["Marinara Sauce", "Marinated olives", "Tomato Basil Marinara Sauce"])
        self.assertEqual(self.names(["marin"], "lidl"), ["Marinara sauce", "Marinated olives"])
        self.assertEqual(self.names(["chick"]), ["Mandarin Orange Chicken"])
        self.assertEqual(self.names(["orange", "chi"]), ["Mandarin Orange Chicken"])
        self.assertEqual(self.names([]), [])
        product = self.products.suggest(["marinara", "s"], "traderjoes")[0]
        self.assertEqual((product["image"], product["size"], "imageUrl" in product), (True, "25 oz", False))
        self.assertEqual(self.products.image_url("00016285"), "https://images.openfoodfacts.org/m.jpg")

    def test_saved_list_is_used_after_a_restart_and_refreshed_weekly(self):
        clock = Clock()
        StoreProducts(self.path, fetch=self.fetch, clock=clock, pause=0).refresh()
        again = StoreProducts(self.path, fetch=self.fetch, clock=clock, pause=0)
        self.assertEqual(len(again), 5)
        with open(self.path) as f:
            self.assertEqual(json.load(f)["country"], "united-states")
        other = StoreProducts(self.path, country="germany", fetch=self.fetch, pause=0)
        self.assertEqual(len(other), 0, "a list for another country isn't used")
        self.assertEqual(again._fetched_at + REFRESH_SECONDS > clock(), True)

    def test_a_failed_download_keeps_the_old_list(self):
        self.products.refresh()
        self.fetch.down = True
        self.assertFalse(self.products.refresh())
        self.assertEqual(len(self.products), 5)

    def test_country_is_checked(self):
        with self.assertRaises(ValueError):
            StoreProducts(country='us" OR x')
