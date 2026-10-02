"""HTTP server for the board: static files, a small JSON API, and live updates."""
import json
import logging
import os
import socket
import socketserver
import threading
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from . import qr
from .shopping import NotFound, ValidationError

log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
MAX_BODY_BYTES = 16 * 1024
# Keeps idle event streams alive through routers and lets dead ones get noticed.
EVENT_PING_SECONDS = 15


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def lan_address():
    """The address phones on the same Wi-Fi can reach this machine at."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packets are sent; this just asks the OS which interface it would route through.
        probe.connect(("10.254.254.254", 1))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


class BoardServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    allow_reuse_address = True

    def __init__(self, address, store, web_dir=WEB_DIR, location=None):
        self.store = store
        self.web_dir = web_dir
        self.location = location
        self.boot_id = uuid.uuid4().hex[:8]
        self.stopping = threading.Event()
        self._qr_cache = (None, None)
        super().__init__(address, BoardHandler)

    def server_bind(self):
        # Skip HTTPServer's reverse-DNS lookup, which can stall startup on a Pi.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]

    def phone_url(self):
        return "http://%s:%d/#/app/shopping" % (lan_address(), self.server_address[1])

    def qr_svg(self):
        url = self.phone_url()
        if self._qr_cache[0] != url:
            self._qr_cache = (url, qr.to_svg(url))
        return self._qr_cache[1]

    def shutdown(self):
        self.stopping.set()
        self.store.wake_waiters()
        super().shutdown()


class BoardHandler(SimpleHTTPRequestHandler):
    server_version = "WidgetBoard"
    sys_version = ""
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
    }

    GET_ROUTES = {
        "/api/health": "health",
        "/api/info": "info",
        "/api/qr.svg": "qr_code",
        "/api/shopping": "shopping_state",
        "/api/shopping/events": "shopping_events",
    }
    POST_ROUTES = {
        "/api/shopping/add": "shopping_add",
        "/api/shopping/check": "shopping_check",
        "/api/shopping/remove": "shopping_remove",
        "/api/shopping/restore": "shopping_restore",
        "/api/shopping/clear-checked": "shopping_clear_checked",
    }

    def __init__(self, request, client_address, server):
        self._is_api = False
        super().__init__(request, client_address, server, directory=server.web_dir)

    # Routing

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        self._is_api = True
        handler = self.GET_ROUTES.get(path)
        if handler is None:
            return self._send_error(HTTPStatus.NOT_FOUND, "Not found.")
        return getattr(self, handler)()

    def do_POST(self):
        self._is_api = True
        handler = self.POST_ROUTES.get(urlsplit(self.path).path)
        if handler is None:
            return self._send_error(HTTPStatus.NOT_FOUND, "Not found.")
        try:
            result = getattr(self, handler)(self._read_json())
        except RequestError as err:
            return self._send_error(err.status, str(err))
        except ValidationError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        except NotFound as err:
            return self._send_error(HTTPStatus.NOT_FOUND, str(err))
        self._send_json(HTTPStatus.OK, result)

    # Read endpoints

    def health(self):
        self._send_json(HTTPStatus.OK, {"ok": True, "boot": self.server.boot_id})

    def info(self):
        self._send_json(HTTPStatus.OK, {
            "url": self.server.phone_url(),
            "boot": self.server.boot_id,
            "location": self.server.location,
        })

    def qr_code(self):
        body = self.server.qr_svg().encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def shopping_state(self):
        self._send_json(HTTPStatus.OK, self.server.store.snapshot())

    def shopping_events(self):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True
        version = None
        try:
            self._send_event("hello", {"boot": self.server.boot_id})
            while not self.server.stopping.is_set():
                state = self.server.store.wait_for_change(version, timeout=EVENT_PING_SECONDS)
                if self.server.stopping.is_set():
                    break
                if state["version"] != version:
                    version = state["version"]
                    self._send_event("state", state)
                else:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            pass

    # Write endpoints

    def shopping_add(self, body):
        return self.server.store.add(body.get("name"), item_id=body.get("id"))

    def shopping_check(self, body):
        return self.server.store.check(body.get("id"), body.get("done", True))

    def shopping_remove(self, body):
        return self.server.store.remove(body.get("id"))

    def shopping_restore(self, body):
        return self.server.store.restore(body.get("ids"))

    def shopping_clear_checked(self, body):
        return self.server.store.clear_checked()

    # Helpers

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise RequestError(HTTPStatus.BAD_REQUEST, "Invalid Content-Length.")
        if length > MAX_BODY_BYTES:
            raise RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request is too large.")
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, ValueError):
            raise RequestError(HTTPStatus.BAD_REQUEST, "Request body must be JSON.")
        if not isinstance(data, dict):
            raise RequestError(HTTPStatus.BAD_REQUEST, "Request body must be a JSON object.")
        return data

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        status = HTTPStatus(status)
        self._send_json(status, {"error": {"code": status.phrase, "message": message, "status": status.value}})

    def _send_event(self, name, data):
        payload = json.dumps(data, ensure_ascii=False)
        self.wfile.write(("event: %s\ndata: %s\n\n" % (name, payload)).encode("utf-8"))
        self.wfile.flush()

    def end_headers(self):
        if not self._is_api:
            # The board runs for weeks; always revalidate so updated files are picked up.
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")
        return None

    def log_request(self, code="-", size="-"):
        if isinstance(code, HTTPStatus):
            code = code.value
        if isinstance(code, int) and code >= 400:
            super().log_request(code, size)

    def log_message(self, format, *args):
        log.info("%s %s", self.address_string(), format % args)
