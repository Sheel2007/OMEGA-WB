import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

from board.calendar import CalendarSources, CalendarStore
from board.google import GoogleAccount
from board.grocery import GroceryList
from board.grocery_images import Photos, ProductImages
from board.store_products import StoreProducts
from board.lights import Lights, settings_from
from board.notes import NotesBoard
from board.roommate_games import RoommateGames
from board.server import BoardHandler, BoardServer, phone_address
from board.spotify import NowPlaying, SpotifyAccount
from board.sports import Sports
from board.store import ChangeFeed
from board.products import ProductsUnavailable
from board.weather import WeatherUnavailable
from tests.test_lights import BEDROOM, DEVICES, FakeClient
from tests.test_spotify import FakeSpotify
from tests.test_sports import NOW, FakeESPN, espn_pages


class FakeWeather:
    def __init__(self):
        self.error = None

    def forecast(self):
        if self.error:
            raise WeatherUnavailable(self.error)
        return {"unit": "F", "current": {"temperature": 70, "code": 0, "is_day": True}, "daily": [], "stale": False}


class FakeProducts:
    def __init__(self):
        self.down = False
        self.looked_up = []

    def _check(self):
        if self.down:
            raise ProductsUnavailable("Can't reach the product database right now.")

    def lookup(self, code):
        if code != "00016285" and len(code) not in (12, 13):
            raise ValueError("That isn't a barcode.")
        self._check()
        self.looked_up.append(code)
        return {"code": code, "name": "Marinara Sauce", "brand": "Trader Joe's", "size": "25 oz",
                "store": "traderjoes", "price": 299, "found": True, "source": "online"}

    def image_url(self, code):
        return "https://images.openfoodfacts.org/images/products/%s/front_en.200.jpg" % code

    def search(self, query, store=None):
        self._check()
        return [{"code": "00090769", "name": "Organic marinara sauce", "brand": "Trader Joe's", "size": None,
                 "store": "traderjoes", "price": None, "source": "online"},
                {"code": "00016285", "name": "Marinara Sauce", "brand": "Trader Joe's", "size": None,
                 "store": "traderjoes", "price": None, "source": "online"}]


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60


class FakeKiosk:
    def __init__(self):
        self.running = True
        self.closed = threading.Event()

    def is_running(self):
        return self.running

    def close(self):
        self.closed.set()


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        web = os.path.join(cls.tmp.name, "web")
        os.makedirs(os.path.join(web, "js"))
        with open(os.path.join(web, "index.html"), "w") as f:
            f.write("<!doctype html><title>Board</title>")
        with open(os.path.join(web, "js", "main.js"), "w") as f:
            f.write("export {};")
        with open(os.path.join(cls.tmp.name, "secret.txt"), "w") as f:
            f.write("do not serve")
        feed = ChangeFeed()
        cls.google = GoogleAccount(token_path=os.path.join(cls.tmp.name, "data", "google.json"))
        cls.sources = CalendarSources(account=cls.google, feed=feed)
        cls.weather = FakeWeather()
        cls.kiosk = FakeKiosk()
        cls.products = FakeProducts()
        cls.store_products = StoreProducts(fetch=lambda url: {"page_count": 1, "hits": [
            {"code": "00016285", "product_name": "Marinara Sauce", "brands": "Trader Joe's"}]}, pause=0)
        cls.store_products.refresh()
        cls.photos = Photos(os.path.join(cls.tmp.name, "data", "grocery-photos"), in_use=lambda: cls.grocery.photos_in_use())
        cls.grocery = GroceryList(os.path.join(cls.tmp.name, "data", "grocery.json"), photo_exists=cls.photos.exists,
                                  feed=feed)
        cls.lights = Lights(os.path.join(cls.tmp.name, "data", "lights.json"), mqtt=settings_from(True), feed=feed,
                            client_factory=FakeClient)
        cls.lights.handle_connect()
        cls.lights.handle_message("zigbee2mqtt/bridge/state", b'{"state":"online"}')
        cls.lights.handle_message("zigbee2mqtt/bridge/devices", json.dumps(DEVICES).encode())
        cls.spotify_api = FakeSpotify()
        cls.spotify = NowPlaying(SpotifyAccount("client-1", transport=cls.spotify_api))
        cls.sports = Sports(fetch=FakeESPN(espn_pages()), fetch_crest=lambda url: (b"\x89PNG", "image/png"),
                            clock=lambda: NOW, feed=feed)
        cls.sports.poll()
        cls.server = BoardServer(
            ("127.0.0.1", 0),
            notes=NotesBoard(os.path.join(cls.tmp.name, "data", "notes.json"), feed=feed),
            calendar=CalendarStore(os.path.join(cls.tmp.name, "data", "calendar.json"), feed=feed),
            calendar_sources=cls.sources,
            google=cls.google,
            feed=feed,
            weather=cls.weather,
            kiosk=cls.kiosk,
            lights=cls.lights,
            roommate_games=RoommateGames(os.path.join(cls.tmp.name, "data", "roommate-games.json"), feed=feed),
            grocery=cls.grocery,
            products=cls.products,
            store_products=cls.store_products,
            product_images=ProductImages(os.path.join(cls.tmp.name, "data", "grocery-images"), cls.products,
                                         fetch=lambda url: JPEG),
            photos=cls.photos,
            spotify=cls.spotify,
            sports=cls.sports,
            web_dir=web,
            location={"latitude": 1.5, "longitude": 2},
        )
        cls.server.kiosk_close_delay = 0
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def request(self, path, body=None, method=None, content_type="application/json"):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method or ("POST" if data else "GET"))
        if data is not None:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, res.headers, res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()

    def post(self, path, body):
        status, _, raw = self.request(path, body, method="POST")
        return status, json.loads(raw)

    def test_health(self):
        status, _, raw = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["ok"])

    def test_validation_errors_are_400_with_a_message(self):
        status, body = self.post("/api/notes/add", {"text": "   "})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["message"], "Write something first.")

    def test_unknown_item_is_404(self):
        status, body = self.post("/api/notes/remove", {"id": "missing"})
        self.assertEqual(status, 404)
        self.assertIn("message", body["error"])

    def test_bad_json_is_400(self):
        req = urllib.request.Request(self.base + "/api/notes/add", data=b"{nope", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(caught.exception.code, 400)

    def test_oversized_body_is_rejected(self):
        status, _ = self.post("/api/notes/add", {"text": "x" * 20000})
        self.assertEqual(status, 413)

    def test_unknown_api_route_is_404(self):
        status, _, _ = self.request("/api/nope")
        self.assertEqual(status, 404)

    def test_a_hostname_in_the_config_is_what_phones_are_told_to_use(self):
        self.assertEqual(phone_address("widget-board.tailnet.ts.net", 8080),
                         "http://widget-board.tailnet.ts.net:8080/")
        self.assertEqual(phone_address("pi.local:9000", 8080), "http://pi.local:9000/")
        self.assertEqual(phone_address("http://pi.local:8080/", 8080), "http://pi.local:8080/")
        # Something in front is doing TLS on 443, so no port is spelled out.
        self.assertEqual(phone_address("https://board.example.com", 8080), "https://board.example.com/")

    def test_a_hostname_the_board_can_t_use_falls_back_to_the_wi_fi_address(self):
        for bad in [None, "", "   ", 5, "not a host!", "javascript:alert(1)", "ftp://pi.local", "a" * 300]:
            self.assertIsNone(phone_address(bad, 8080))

    def test_info_reports_phone_url_and_location(self):
        status, _, raw = self.request("/api/info")
        info = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertTrue(info["url"].startswith("http://"))
        self.assertTrue(info["url"].endswith("/"))
        self.assertEqual(info["location"], {"latitude": 1.5, "longitude": 2})

    def test_qr_svg(self):
        status, headers, raw = self.request("/api/qr.svg")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/svg+xml")
        self.assertTrue(raw.startswith(b"<svg"))

    def test_qr_svg_can_point_at_one_app(self):
        grocery = self.request("/api/qr.svg?app=grocery")[2]
        calendar = self.request("/api/qr.svg?app=calendar")[2]
        self.assertTrue(calendar.startswith(b"<svg"))
        self.assertNotEqual(grocery, calendar)
        self.assertEqual(self.request("/api/qr.svg?app=../secret")[0], 400)

    def test_qr_svg_can_point_at_google_calendar_but_nowhere_else(self):
        status, _, raw = self.request("/api/qr.svg?target=google-calendar")
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b"<svg"))
        self.assertNotEqual(raw, self.request("/api/qr.svg?app=calendar")[2])
        # A phone can't ask the board to print a QR code for an address of its choosing.
        self.assertEqual(self.request("/api/qr.svg?target=https://evil.example.com")[0], 400)
        self.assertEqual(self.request("/api/qr.svg?target=nope")[0], 400)

    def test_serves_static_files_with_module_friendly_types(self):
        status, headers, raw = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>Board</title>", raw)
        self.assertEqual(headers["Cache-Control"], "no-cache")
        status, headers, _ = self.request("/js/main.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/javascript"))

    def test_no_directory_listings_or_escaping_the_web_folder(self):
        self.assertEqual(self.request("/js/")[0], 404)
        self.assertEqual(self.request("/../secret.txt")[0], 404)
        self.assertEqual(self.request("/%2e%2e/secret.txt")[0], 404)

    def test_event_stream_sends_hello_then_each_store_then_updates(self):
        sock = self._open_stream("/api/events")
        try:
            stream = sock.makefile("rb")
            events = self._read_events(stream, 9)
            self.assertEqual(events[0][0], "hello")
            self.assertEqual(events[0][1]["boot"], self.server.boot_id)
            self.assertEqual({name for name, _ in events[1:]},
                             {"notes", "calendar", "calendar-sources", "lights", "roommate-games", "grocery", "spotify",
                              "sports"})
            versions = {name: state["version"] for name, state in events[1:]}

            self.post("/api/notes/add", {"text": "live note"})
            name, state = self._read_events(stream, 1)[0]
            self.assertEqual(name, "notes")
            self.assertGreater(state["version"], versions["notes"])
            self.assertIn("live note", [n["text"] for n in state["notes"]])
        finally:
            sock.close()

    def test_notes_add_remove_and_restore(self):
        status, body = self.post("/api/notes/add", {"text": "Rent is due"})
        self.assertEqual(status, 200)
        note_id = body["note"]["id"]
        status, body = self.post("/api/notes/remove", {"id": note_id})
        self.assertNotIn(note_id, [n["id"] for n in body["state"]["notes"]])
        status, body = self.post("/api/notes/restore", {"ids": [note_id]})
        self.assertEqual(body["restored"], [note_id])
        status, _, raw = self.request("/api/notes")
        self.assertIn(note_id, [n["id"] for n in json.loads(raw)["notes"]])

    def test_roommate_games_sign_up_catalog_draw_and_record(self):
        status, body = self.post("/api/roommate-games/players/add", {"name": "Sam", "email": "sam@example.com"})
        self.assertEqual(status, 200)
        sam = body["player"]["id"]
        self.assertEqual(body["player"]["email"], "s•••@example.com")
        alex = self.post("/api/roommate-games/players/add", {"name": "Alex", "phone": "555 123 4567"})[1]["player"]["id"]
        status, body = self.post("/api/roommate-games/games/add", {"name": "Chess", "kind": "specialized", "specialist": sam})
        self.assertEqual(status, 200)
        status, body = self.post("/api/roommate-games/draw", {})
        self.assertEqual(status, 200)
        week = body["state"]["weeks"][-1]
        status, body = self.post("/api/roommate-games/record",
                                 {"week": week["id"], "pick": week["picks"][0]["id"], "order": [[alex], [sam]]})
        self.assertEqual(status, 200)
        self.assertEqual(body["state"]["players"][0]["name"], "Alex")
        self.assertEqual(body["state"]["players"][0]["points"], 2)
        status, _, raw = self.request("/api/roommate-games")
        self.assertNotIn("sam@example.com", raw.decode())

    def test_roommate_games_mistakes_are_400_and_sending_needs_setting_up(self):
        status, body = self.post("/api/roommate-games/players/add", {"name": "Jo"})
        self.assertEqual(status, 400)
        self.assertIn("email or a phone", body["error"]["message"])
        status, body = self.post("/api/roommate-games/players/remove", {"id": "nobody"})
        self.assertEqual(status, 404)
        status, body = self.post("/api/roommate-games/schedule", {"day": 9})
        self.assertEqual(status, 400)

    def test_grocery_add_update_check_and_clear(self):
        status, body = self.post("/api/grocery/add", {"name": "Marinara Sauce", "code": "00016285", "store": "traderjoes",
                                                       "price": 299, "by": "Sam", "qty": 2})
        self.assertEqual(status, 200)
        item = body["item"]
        self.assertEqual((item["price"], item["qty"], item["by"]), (299, 2, "Sam"))
        status, body = self.post("/api/grocery/update", {"id": item["id"], "price": 349})
        self.assertEqual(body["item"]["price"], 349)
        status, body = self.post("/api/grocery/check", {"id": item["id"], "done": True})
        self.assertTrue(body["item"]["done"])
        status, body = self.post("/api/grocery/clear-checked", {})
        self.assertEqual(body["removed"], [item["id"]])
        status, body = self.post("/api/grocery/restore", {"ids": [item["id"]]})
        self.assertEqual(body["restored"], [item["id"]])
        status, body = self.post("/api/grocery/remove", {"id": item["id"]})
        self.assertEqual(status, 200)
        status, body = self.post("/api/grocery/add", {"name": "Eggs", "price": 1.5})
        self.assertEqual(status, 400)

    def test_grocery_lookup_uses_what_the_board_remembers_before_going_online(self):
        self.post("/api/grocery/add", {"name": "Our usual bread", "code": "4056489011293", "price": 189})
        status, _, raw = self.request("/api/grocery/lookup?code=4056489011293")
        self.assertEqual(status, 200)
        product = json.loads(raw)["product"]
        self.assertEqual((product["name"], product["price"], product["source"]), ("Our usual bread", 189, "board"))
        self.assertNotIn("4056489011293", self.products.looked_up)

        status, _, raw = self.request("/api/grocery/lookup?code=036000291452")
        self.assertEqual(json.loads(raw)["product"]["source"], "online")
        status, _, raw = self.request("/api/grocery/lookup?code=123")
        self.assertEqual(status, 400)
        self.products.down = True
        try:
            status, _, raw = self.request("/api/grocery/lookup?code=036000291452")
            self.assertEqual(status, 503)
        finally:
            self.products.down = False

    def test_grocery_search_puts_remembered_things_first_and_works_offline(self):
        self.post("/api/grocery/add", {"name": "Marinara Sauce", "code": "00016285", "store": "traderjoes"})
        status, _, raw = self.request("/api/grocery/search?q=marinara&store=traderjoes")
        body = json.loads(raw)
        self.assertEqual([p["code"] for p in body["known"]], ["00016285"])
        self.assertEqual([p["code"] for p in body["online"]], ["00090769"])
        self.assertFalse(body["offline"])
        self.products.down = True
        try:
            body = json.loads(self.request("/api/grocery/search?q=marinara")[2])
            self.assertTrue(body["offline"])
            self.assertEqual(len(body["known"]), 1)
        finally:
            self.products.down = False
        status, _, _ = self.request("/api/grocery/search?q=x&store=aldi")
        self.assertEqual(status, 400)

    def test_grocery_suggest_and_product_pictures(self):
        status, _, raw = self.request("/api/grocery/suggest?q=marin")
        body = json.loads(raw)
        self.assertEqual((body["online"][0]["name"], body["ready"]), ("Marinara Sauce", True))
        status, headers, raw = self.request("/api/grocery/image?code=00016285")
        self.assertEqual((status, headers["Content-Type"], raw), (200, "image/jpeg", JPEG))
        self.assertIn("max-age", headers["Cache-Control"])
        status, _, _ = self.request("/api/grocery/image?code=nope")
        self.assertEqual(status, 400)

    def test_grocery_photos_upload_and_belong_to_items(self):
        req = urllib.request.Request(self.base + "/api/grocery/photo", data=JPEG, method="POST",
                                     headers={"Content-Type": "image/jpeg"})
        with urllib.request.urlopen(req, timeout=5) as res:
            photo = json.loads(res.read())["photo"]
        status, body = self.post("/api/grocery/add", {"name": "Homemade jam", "photo": photo})
        self.assertEqual((status, body["item"]["photo"]), (200, photo))
        status, headers, raw = self.request("/api/grocery/photo?name=" + photo)
        self.assertEqual((status, raw), (200, JPEG))
        status, body = self.post("/api/grocery/add", {"name": "Toast", "photo": "0123456789abcdef.jpg"})
        self.assertEqual(status, 400)
        status, _, _ = self.request("/api/grocery/photo?name=../secret.txt")
        self.assertEqual(status, 404)
        bad = urllib.request.Request(self.base + "/api/grocery/photo", data=b"not a picture", method="POST",
                                     headers={"Content-Type": "image/jpeg"})
        try:
            urllib.request.urlopen(bad, timeout=5)
            self.fail("a non-picture was accepted")
        except urllib.error.HTTPError as err:
            self.assertEqual(err.code, 400)
            err.close()

    def test_notes_validation_is_400(self):
        status, body = self.post("/api/notes/add", {"text": " "})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["message"], "Write something first.")

    def test_calendar_add_remove_and_restore(self):
        status, body = self.post("/api/calendar/add", {
            "title": "Dentist", "date": "2026-10-20", "time": "15:00", "endTime": "16:00",
            "location": "Dr Patel", "description": "Bring the letter",
        })
        self.assertEqual(status, 200)
        event_id = body["event"]["id"]
        self.assertEqual(body["where"], "board")
        self.assertEqual(body["event"]["time"], "15:00")
        self.assertEqual(body["event"]["endTime"], "16:00")
        self.assertEqual(body["event"]["location"], "Dr Patel")
        status, body = self.post("/api/calendar/remove", {"id": event_id})
        self.assertNotIn(event_id, [e["id"] for e in body["state"]["events"]])
        status, body = self.post("/api/calendar/restore", {"ids": [event_id]})
        self.assertEqual(body["restored"], [event_id])
        status, _, raw = self.request("/api/calendar")
        self.assertIn(event_id, [e["id"] for e in json.loads(raw)["events"]])

    def test_calendar_validation_is_400(self):
        status, body = self.post("/api/calendar/add", {"title": " ", "date": "2026-10-20"})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["message"], "Give the event a name first.")
        status, body = self.post("/api/calendar/add", {"title": "Dentist", "date": "soon"})
        self.assertEqual(status, 400)

    def test_calendar_sources_says_when_nothing_is_connected(self):
        status, _, raw = self.request("/api/calendar/sources")
        self.assertEqual(status, 200)
        sources = json.loads(raw)
        self.assertFalse(sources["configured"])
        self.assertEqual(sources["events"], [])
        self.assertEqual(sources["account"], {"configured": False, "linked": False, "account": None,
                                              "target": None, "pending": None})

    def test_an_unwritable_calendar_is_refused(self):
        status, body = self.post("/api/calendar/add", {"title": "X", "date": "2026-10-20", "calendar": "nope@example.com"})
        self.assertEqual(status, 400)
        self.assertIn("can\u2019t be written to", body["error"]["message"].replace("'", "\u2019"))

    def test_connecting_google_needs_a_client_in_the_config(self):
        status, body = self.post("/api/calendar/google/link", {})
        self.assertEqual(status, 502)
        self.assertIn("client ID", body["error"]["message"])

    def test_the_google_return_page_is_html_and_sends_you_back_to_the_board(self):
        status, headers, raw = self.request("/api/calendar/google/done?error=access_denied")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        self.assertIn(b"access_denied", raw)
        self.assertIn(b"/#/app/calendar", raw)

    def test_the_google_return_page_escapes_what_google_sent(self):
        _status, _headers, raw = self.request("/api/calendar/google/done?error=%3Cscript%3Ealert(1)%3C/script%3E")
        self.assertNotIn(b"<script>", raw)
        self.assertIn(b"&lt;script&gt;", raw)

    def test_spotify_signs_in_on_the_board_and_comes_back_where_it_started(self):
        status, body = self.post("/api/spotify/link", {"back": "http://localhost:%d/?kiosk=1" % self.server.server_address[1]})
        self.assertEqual(status, 200)
        self.assertEqual(body["redirect"], "http://127.0.0.1:%d/api/spotify/done" % self.server.server_address[1])
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(body["url"]).query)["state"][0]
        status, _headers, raw = self.request("/api/spotify/done?code=c&state=%s" % urllib.parse.quote(state))
        self.assertIn(b"Spotify connected", raw)
        self.assertIn(b"/?kiosk=1", raw)
        status, _headers, raw = self.request("/api/spotify")
        self.assertEqual(json.loads(raw)["account"], "Sam")
        status, body = self.post("/api/spotify/unlink", {})
        self.assertEqual((status, body["linked"]), (200, False))

    def test_spotify_only_returns_to_the_board_itself(self):
        port = self.server.server_address[1]
        page = BoardHandler._loopback_page
        self.assertEqual(page("http://127.0.0.1:%d/#/app/x" % port, port), "http://127.0.0.1:%d/#/app/x" % port)
        self.assertEqual(page("http://evil.example:%d/" % port, port), "/")
        self.assertEqual(page("http://localhost:1/", port), "/")
        self.assertEqual(page("javascript:alert(1)", port), "/")
        self.assertEqual(page(None, port), "/")

    def test_spotify_covers_are_only_ones_the_board_has_shown(self):
        status, _headers, _raw = self.request("/api/spotify/art?id=nope")
        self.assertEqual(status, 400)
        status, _headers, _raw = self.request("/api/spotify/art?id=" + "c" * 40)
        self.assertEqual(status, 404)

    def test_sports_scores_tables_and_a_match_page(self):
        status, _headers, raw = self.request("/api/sports")
        state = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertIn("2001", [m["id"] for m in state["matches"]])
        self.assertEqual(set(state["tables"]), {"eng.1", "uefa.champions", "big-ten"})
        status, _headers, raw = self.request("/api/sports/match?id=1001")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["home"]["formation"], "4-2-3-1")
        self.assertEqual(self.request("/api/sports/match?id=424242")[0], 404)
        self.assertEqual(self.request("/api/sports/match?id=x/../1")[0], 400)

    def test_sports_crests_are_only_ones_the_board_has_shown(self):
        status, headers, raw = self.request("/api/sports/crest?id=soccer:359")
        self.assertEqual((status, headers["Content-Type"], raw), (200, "image/png", b"\x89PNG"))
        self.assertEqual(self.request("/api/sports/crest?id=soccer:1")[0], 404)
        self.assertEqual(self.request("/api/sports/crest?id=https://evil.example/x.png")[0], 400)

    def test_weather_forecast(self):
        status, _, raw = self.request("/api/weather")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["current"]["temperature"], 70)

    def test_weather_problems_are_503_with_a_message(self):
        self.weather.error = "Add your latitude and longitude to config.json to see the weather."
        try:
            status, _, raw = self.request("/api/weather")
        finally:
            self.weather.error = None
        self.assertEqual(status, 503)
        self.assertIn("config.json", json.loads(raw)["error"]["message"])

    def test_lights_state_and_switching(self):
        status, _, raw = self.request("/api/lights")
        self.assertEqual(status, 200)
        state = json.loads(raw)
        self.assertTrue(state["configured"])
        self.assertIn(BEDROOM, [light["id"] for light in state["lights"]])

        status, body = self.post("/api/lights/set", {"id": BEDROOM, "on": True})
        self.assertEqual(status, 200)
        self.assertTrue(next(light for light in body["state"]["lights"] if light["id"] == BEDROOM)["on"])
        self.assertEqual(self.lights._client.published[-1], ("zigbee2mqtt/bedroom_light/set", {"state": "ON"}))

        status, body = self.post("/api/lights/swap", {"id": BEDROOM, "swapped": True})
        self.assertFalse(next(light for light in body["state"]["lights"] if light["id"] == BEDROOM)["on"])
        self.post("/api/lights/swap", {"id": BEDROOM, "swapped": False})

    def test_renaming_a_light(self):
        status, body = self.post("/api/lights/rename", {"id": BEDROOM, "name": "Reading Lamp"})
        self.assertEqual(status, 200)
        self.assertEqual(next(light for light in body["state"]["lights"] if light["id"] == BEDROOM)["name"], "Reading Lamp")
        status, body = self.post("/api/lights/rename", {"id": BEDROOM, "name": ""})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["message"], "Give the light a name.")

    def test_lights_pairing(self):
        status, body = self.post("/api/lights/pair", {"open": True})
        self.assertEqual(status, 200)
        self.assertTrue(body["state"]["pairing"]["open"])
        self.assertEqual(self.lights._client.published[-1], ("zigbee2mqtt/bridge/request/permit_join", {"time": 254}))
        status, body = self.post("/api/lights/pair", {"open": False})
        self.assertFalse(body["state"]["pairing"]["open"])
        self.assertEqual(self.post("/api/lights/pair", {"open": "please"})[0], 400)

    def test_lights_problems_have_a_message(self):
        status, body = self.post("/api/lights/set", {"id": BEDROOM, "on": "please"})
        self.assertEqual(status, 400)
        status, body = self.post("/api/lights/set", {"id": "0x0000000000000009", "on": True})
        self.assertEqual(status, 404)
        self.lights.handle_disconnect()
        try:
            status, body = self.post("/api/lights/set", {"id": BEDROOM, "on": True})
            self.assertEqual(status, 503)
            self.assertIn("Mosquitto", body["error"]["message"])
        finally:
            self.lights.handle_connect()

    def test_light_schedules_add_update_remove_and_restore(self):
        status, body = self.post("/api/lights/schedules/add", {"time": "22:30", "on": False, "days": [0, 6], "id": "5c4ed01e"})
        self.assertEqual(status, 200)
        self.assertEqual(body["schedule"]["id"], "5c4ed01e")
        status, body = self.post("/api/lights/schedules/update", {"id": "5c4ed01e", "enabled": False})
        self.assertFalse(body["schedule"]["enabled"])
        status, body = self.post("/api/lights/schedules/remove", {"id": "5c4ed01e"})
        self.assertNotIn("5c4ed01e", [s["id"] for s in body["state"]["schedules"]])
        status, body = self.post("/api/lights/schedules/restore", {"ids": ["5c4ed01e"]})
        self.assertEqual(body["restored"], ["5c4ed01e"])
        status, body = self.post("/api/lights/schedules/add", {"time": "25:00", "on": True})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["message"], "Pick a time for the schedule.")
        self.post("/api/lights/schedules/remove", {"id": "5c4ed01e"})

    def test_kiosk_exit_from_the_pi_closes_the_browser(self):
        self.kiosk.closed.clear()
        status, body = self.post("/api/kiosk/exit", {})
        self.assertEqual(status, 200)
        self.assertEqual(body, {"closing": True})
        self.assertTrue(self.kiosk.closed.wait(2))

    def test_kiosk_exit_reports_when_no_kiosk_is_running(self):
        self.kiosk.running = False
        try:
            status, body = self.post("/api/kiosk/exit", {})
        finally:
            self.kiosk.running = True
        self.assertEqual(body, {"closing": False})

    def test_kiosk_exit_only_accepts_json(self):
        status, _, _ = self.request("/api/kiosk/exit", {}, method="POST", content_type="text/plain")
        self.assertEqual(status, 415)

    def _open_stream(self, path):
        sock = socket.create_connection(self.server.server_address[:2], timeout=5)
        sock.sendall(("GET %s HTTP/1.1\r\nHost: test\r\n\r\n" % path).encode())
        return sock

    @staticmethod
    def _read_events(stream, count):
        events, name, data = [], None, None
        while len(events) < count:
            line = stream.readline().decode().rstrip("\r\n")
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
            elif line == "" and name:
                events.append((name, data))
                name, data = None, None
        return events


if __name__ == "__main__":
    unittest.main()
