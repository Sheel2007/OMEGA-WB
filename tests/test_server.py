import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from board.server import BoardServer
from board.shopping import ShoppingList


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
        cls.store = ShoppingList(os.path.join(cls.tmp.name, "data", "shopping.json"))
        cls.server = BoardServer(("127.0.0.1", 0), cls.store, web_dir=web, location={"latitude": 1.5, "longitude": 2})
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def request(self, path, body=None, method=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method or ("POST" if data else "GET"))
        if data is not None:
            req.add_header("Content-Type", "application/json")
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
        self.assertTrue(info["url"].endswith("/#/app/shopping"))
        self.assertEqual(info["location"], {"latitude": 1.5, "longitude": 2})

    def test_qr_svg(self):
        status, headers, raw = self.request("/api/qr.svg")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/svg+xml")
        self.assertTrue(raw.startswith(b"<svg"))

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

    def test_event_stream_sends_hello_state_and_updates(self):
        sock = socket.create_connection(self.server.server_address[:2], timeout=5)
        try:
            sock.sendall(b"GET /api/shopping/events HTTP/1.1\r\nHost: test\r\n\r\n")
            stream = sock.makefile("rb")
            events = self._read_events(stream, 2)
            self.assertEqual(events[0][0], "hello")
            self.assertEqual(events[0][1]["boot"], self.server.boot_id)
            self.assertEqual(events[1][0], "state")
            version = events[1][1]["version"]

            self.post("/api/shopping/add", {"name": "live update"})
            name, state = self._read_events(stream, 1)[0]
            self.assertEqual(name, "state")
            self.assertGreater(state["version"], version)
            self.assertIn("Live update", [i["name"] for i in state["items"]])
        finally:
            sock.close()

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
