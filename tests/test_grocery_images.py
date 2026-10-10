import os
import tempfile
import unittest

from board.grocery_images import MAX_CACHED, MAX_PHOTOS, Photos, ProductImages, allowed_url, sniff
from board.products import ProductsUnavailable

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40


class FakeProducts:
    def __init__(self, urls):
        self.urls = urls
        self.down = False
        self.asked = []

    def image_url(self, code):
        self.asked.append(code)
        if self.down:
            raise ProductsUnavailable("offline")
        return self.urls.get(code)


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


class ProductImagesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fetched = []

    def tearDown(self):
        self.tmp.cleanup()

    def fetch(self, url):
        self.fetched.append(url)
        return JPEG

    def test_fetches_once_then_serves_from_the_pi(self):
        products = FakeProducts({"00016285": "https://images.openfoodfacts.org/a.jpg"})
        images = ProductImages(self.tmp.name, products, fetch=self.fetch)
        self.assertEqual(images.get("00016285"), (JPEG, "image/jpeg"))
        self.assertEqual(images.get("00016285"), (JPEG, "image/jpeg"))
        self.assertEqual(len(self.fetched), 1)

    def test_only_open_food_facts_pictures_are_fetched(self):
        products = FakeProducts({"00016285": "https://evil.example/a.jpg", "4056489011293": "http://images.openfoodfacts.org/a.jpg"})
        images = ProductImages(self.tmp.name, products, fetch=self.fetch)
        self.assertIsNone(images.get("00016285"))
        self.assertIsNone(images.get("4056489011293"))
        self.assertEqual(self.fetched, [])
        self.assertTrue(allowed_url("https://images.openfoodfacts.org/x.jpg"))

    def test_no_picture_is_remembered_for_a_while_but_offline_is_not(self):
        clock = Clock()
        products = FakeProducts({})
        images = ProductImages(self.tmp.name, products, fetch=self.fetch, now=clock)
        images.get("00016285")
        images.get("00016285")
        self.assertEqual(products.asked, ["00016285"])
        products.down = True
        images.get("4056489011293")
        products.down = False
        products.urls["4056489011293"] = "https://images.openfoodfacts.org/y.jpg"
        self.assertIsNotNone(images.get("4056489011293"))

    def test_bad_barcodes_and_non_pictures(self):
        images = ProductImages(self.tmp.name, FakeProducts({"00016285": "https://images.openfoodfacts.org/a"}),
                               fetch=lambda url: b"<html>")
        with self.assertRaises(ValueError):
            images.get("../../etc")
        self.assertIsNone(images.get("00016285"))
        self.assertEqual((sniff(JPEG), sniff(PNG), sniff(b"RIFF1234WEBPVP8 "), sniff(b"GIF89a")), ("jpg", "png", "webp", None))

    def test_the_cache_is_bounded(self):
        for i in range(MAX_CACHED + 5):
            path = os.path.join(self.tmp.name, "%08d.img" % i)
            with open(path, "wb") as f:
                f.write(JPEG)
            os.utime(path, (i, i))
        products = FakeProducts({"00016285": "https://images.openfoodfacts.org/a.jpg"})
        ProductImages(self.tmp.name, products, fetch=self.fetch).get("00016285")
        names = os.listdir(self.tmp.name)
        self.assertEqual(len(names), MAX_CACHED)
        self.assertIn("00016285.img", names)
        self.assertNotIn("00000000.img", names)


class PhotosTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.in_use = set()
        self.photos = Photos(self.tmp.name, in_use=lambda: self.in_use)

    def tearDown(self):
        self.tmp.cleanup()

    def test_save_read_and_refuse(self):
        name = self.photos.save(PNG)
        self.assertTrue(name.endswith(".png"))
        self.assertTrue(self.photos.exists(name))
        self.assertEqual(self.photos.read(name), (PNG, "image/png"))
        self.assertIsNone(self.photos.read("../x.png"))
        self.assertFalse(self.photos.exists("../x.png"))
        for bad in (b"", b"hello", JPEG * 20000):
            with self.assertRaises(ValueError):
                self.photos.save(bad)

    def test_pruning_keeps_photos_still_in_use(self):
        names = []
        for i in range(MAX_PHOTOS):
            names.append(self.photos.save(JPEG))
            os.utime(os.path.join(self.tmp.name, names[-1]), (i, i))
        self.in_use = {names[0]}
        newest = self.photos.save(JPEG)
        kept = set(os.listdir(self.tmp.name))
        self.assertEqual(len(kept), MAX_PHOTOS)
        self.assertIn(names[0], kept, "in use, though oldest")
        self.assertNotIn(names[1], kept)
        self.assertIn(newest, kept)
