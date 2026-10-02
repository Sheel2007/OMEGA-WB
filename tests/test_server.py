import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from board.calendar import CalendarSources, CalendarStore
from board.google import GoogleAccount
from board.notes import NotesBoard
from board.server import BoardServer
from board.shopping import ShoppingList
from board.store import ChangeFeed
from board.weather import WeatherUnavailable


class FakeWeather:
    def __init__(self):
        self.error = None

    def forecast(self):
        if self.error:
            raise WeatherUnavailable(self.error)
        return {"unit": "F", "current": {"temperature": 70, "code": 0, "is_day": True}, "daily": [], "stale": False}


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
        cls.server = BoardServer(
            ("127.0.0.1", 0),
            shopping=ShoppingList(os.path.join(cls.tmp.name, "data", "shopping.json"), feed=feed),
            notes=NotesBoard(os.path.join(cls.tmp.name, "data", "notes.json"), feed=feed),
            calendar=CalendarStore(os.path.join(cls.tmp.name, "data", "calendar.json"), feed=feed),
            calendar_sources=cls.sources,
            google=cls.google,
            feed=feed,
            weather=cls.weather,
            kiosk=cls.kiosk,
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

    def test_add_check_remove_and_restore_round_trip(self):
        status, body = self.post("/api/shopping/add", {"name": "round trip"})
        self.assertEqual(status, 200)
        self.assertEqual(body["outcome"], "added")
        item_id = body["item"]["id"]

        status, body = self.post("/api/shopping/check", {"id": item_id, "done": True})
        self.assertEqual(status, 200)
        self.assertTrue(next(i for i in body["state"]["items"] if i["id"] == item_id)["done"])

        status, body = self.post("/api/shopping/remove", {"id": item_id})
        self.assertEqual(status, 200)
        self.assertNotIn(item_id, [i["id"] for i in body["state"]["items"]])

        status, body = self.post("/api/shopping/restore", {"ids": [item_id]})
        self.assertEqual(body["restored"], [item_id])

        status, _, raw = self.request("/api/shopping")
        self.assertIn(item_id, [i["id"] for i in json.loads(raw)["items"]])

    def test_clear_checked(self):
        _, body = self.post("/api/shopping/add", {"name": "clear me"})
        self.post("/api/shopping/check", {"id": body["item"]["id"], "done": True})
        status, body = self.post("/api/shopping/clear-checked", {})
        self.assertEqual(status, 200)
        self.assertFalse(any(i["done"] for i in body["state"]["items"]))

    def test_validation_errors_are_400_with_a_message(self):
        status, body = self.post("/api/shopping/add", {"name": "   "})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["message"], "Type an item name first.")

    def test_unknown_item_is_404(self):
        status, body = self.post("/api/shopping/check", {"id": "missing", "done": True})
        self.assertEqual(status, 404)
        self.assertIn("message", body["error"])

    def test_bad_json_is_400(self):
        req = urllib.request.Request(self.base + "/api/shopping/add", data=b"{nope", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(caught.exception.code, 400)

    def test_oversized_body_is_rejected(self):
        status, _ = self.post("/api/shopping/add", {"name": "x" * 20000})
        self.assertEqual(status, 413)

    def test_unknown_api_route_is_404(self):
        status, _, _ = self.request("/api/nope")
        self.assertEqual(status, 404)

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
        shopping = self.request("/api/qr.svg?app=shopping")[2]
        calendar = self.request("/api/qr.svg?app=calendar")[2]
        self.assertTrue(calendar.startswith(b"<svg"))
        self.assertNotEqual(shopping, calendar)
        self.assertEqual(self.request("/api/qr.svg?app=../secret")[0], 400)

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
            events = self._read_events(stream, 5)
            self.assertEqual(events[0][0], "hello")
            self.assertEqual(events[0][1]["boot"], self.server.boot_id)
            self.assertEqual({name for name, _ in events[1:]}, {"shopping", "notes", "calendar", "calendar-sources"})
            versions = {name: state["version"] for name, state in events[1:]}

            self.post("/api/shopping/add", {"name": "live update"})
            name, state = self._read_events(stream, 1)[0]
            self.assertEqual(name, "shopping")
            self.assertGreater(state["version"], versions["shopping"])
            self.assertIn("Live update", [i["name"] for i in state["items"]])

            self.post("/api/notes/add", {"text": "live note"})
            name, state = self._read_events(stream, 1)[0]
            self.assertEqual(name, "notes")
            self.assertIn("live note", [n["text"] for n in state["notes"]])
        finally:
            sock.close()

    def test_old_event_url_still_says_hello_so_old_pages_reload(self):
        sock = self._open_stream("/api/shopping/events")
        try:
            self.assertEqual(self._read_events(sock.makefile("rb"), 1)[0][0], "hello")
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
