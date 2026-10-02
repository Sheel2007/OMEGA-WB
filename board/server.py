"""HTTP server for the board: static files, a small JSON API, and live updates."""
import html
import json
import logging
import os
import re
import socket
import socketserver
import threading
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import qr
from .google import GoogleError
from .kiosk import is_local_address
from .store import NotFound, ValidationError
from .weather import WeatherUnavailable

log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
MAX_BODY_BYTES = 16 * 1024
# Keeps idle event streams alive through routers and lets dead ones get noticed.
EVENT_PING_SECONDS = 15
# Lets the "Exit to desktop" response reach the browser before the browser closes.
KIOSK_CLOSE_DELAY_SECONDS = 0.5
# An app id in ?app=, for the QR code a phone scans to open that app.
APP_ID = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
# Where Google sends the browser back to after someone signs in, and the word that
# means "keep this event on the board rather than on a Google calendar".
GOOGLE_REDIRECT_PATH = "/api/calendar/google/done"
BOARD_CALENDAR = "board"
# One QR code per app, drawn once; the handful of apps that ask for one.
MAX_QR_CACHE = 8


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

    def __init__(self, address, *, shopping, notes, calendar, calendar_sources, google, feed, weather, kiosk,
                 web_dir=WEB_DIR, location=None):
        self.shopping = shopping
        self.notes = notes
        self.calendar = calendar
        self.calendar_sources = calendar_sources
        self.google = google
        self.feed = feed
        self.weather = weather
        self.kiosk = kiosk
        self.kiosk_close_delay = KIOSK_CLOSE_DELAY_SECONDS
        self.web_dir = web_dir
        self.location = location
        self.boot_id = uuid.uuid4().hex[:8]
        self.stopping = threading.Event()
        self._qr_cache = {}
        super().__init__(address, BoardHandler)

    def live_stores(self):
        """Stores whose state is pushed over /api/events, by event name."""
        return {"shopping": self.shopping, "notes": self.notes, "calendar": self.calendar,
                "calendar-sources": self.calendar_sources}

    def server_bind(self):
        # Skip HTTPServer's reverse-DNS lookup, which can stall startup on a Pi.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]

    def phone_url(self, app=None):
        """The board's address on the home Wi-Fi, opening straight into `app` if given."""
        base = "http://%s:%d/" % (lan_address(), self.server_address[1])
        return base + ("#/app/%s" % app if app else "")

    def qr_svg(self, app=None):
        url = self.phone_url(app)
        if url not in self._qr_cache:
            if len(self._qr_cache) >= MAX_QR_CACHE:
                self._qr_cache.clear()
            self._qr_cache[url] = qr.to_svg(url)
        return self._qr_cache[url]

    def wake_streams(self):
        self.stopping.set()
        self.feed.wake()

    def shutdown(self):
        self.wake_streams()
        self.calendar_sources.stop()
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
        "/api/events": "events",
        # Pages loaded before the update listen here; "hello" tells them to reload.
        "/api/shopping/events": "events",
        "/api/shopping": "shopping_state",
        "/api/notes": "notes_state",
        "/api/calendar": "calendar_state",
        "/api/calendar/sources": "calendar_sources",
        # Where Google sends people back to after they sign in.
        "/api/calendar/google/done": "google_done",
        "/api/weather": "weather_forecast",
    }
    POST_ROUTES = {
        "/api/shopping/add": "shopping_add",
        "/api/shopping/check": "shopping_check",
        "/api/shopping/remove": "shopping_remove",
        "/api/shopping/restore": "shopping_restore",
        "/api/shopping/clear-checked": "shopping_clear_checked",
        "/api/notes/add": "notes_add",
        "/api/notes/remove": "notes_remove",
        "/api/notes/restore": "notes_restore",
        "/api/calendar/add": "calendar_add",
        "/api/calendar/remove": "calendar_remove",
        "/api/calendar/restore": "calendar_restore",
        "/api/calendar/refresh": "calendar_refresh",
        "/api/calendar/google/link": "google_link",
        "/api/calendar/google/unlink": "google_unlink",
        "/api/calendar/google/target": "google_target",
        "/api/kiosk/exit": "kiosk_exit",
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
        except GoogleError as err:
            return self._send_error(HTTPStatus.BAD_GATEWAY, str(err))
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
        app = parse_qs(urlsplit(self.path).query).get("app", [None])[0]
        if app is not None and not APP_ID.match(app):
            return self._send_error(HTTPStatus.BAD_REQUEST, "That isn't an app on the board.")
        body = self.server.qr_svg(app).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def shopping_state(self):
        self._send_json(HTTPStatus.OK, self.server.shopping.snapshot())

    def notes_state(self):
        self._send_json(HTTPStatus.OK, self.server.notes.snapshot())

    def calendar_state(self):
        self._send_json(HTTPStatus.OK, self.server.calendar.snapshot())

    def calendar_sources(self):
        """The connected calendars. Never an error: problems are reported inside the payload."""
        self._send_json(HTTPStatus.OK, self.server.calendar_sources.snapshot())

    def google_done(self):
        """Where Google sends the browser back to once someone has signed in."""
        query = parse_qs(urlsplit(self.path).query)
        refused = query.get("error", [None])[0]
        if refused:
            return self._send_result_page("Google didn’t connect", "Google said: %s" % refused)
        try:
            self.server.google.finish_link(query.get("code", [None])[0], query.get("state", [None])[0])
        except GoogleError as err:
            return self._send_result_page("Google didn’t connect", str(err))
        self.server.calendar_sources.refresh_soon()
        self._send_result_page("Google Calendar connected", "Taking you back to the board…")

    def weather_forecast(self):
        try:
            forecast = self.server.weather.forecast()
        except WeatherUnavailable as err:
            return self._send_error(HTTPStatus.SERVICE_UNAVAILABLE, str(err))
        self._send_json(HTTPStatus.OK, forecast)

    def events(self):
        """One stream for every screen: the state of each store now, then again whenever it changes."""
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True
        feed = self.server.feed
        sent = {}
        try:
            self._send_event("hello", {"boot": self.server.boot_id})
            seq = feed.seq
            while not self.server.stopping.is_set():
                for name, store in self.server.live_stores().items():
                    state = store.snapshot()
                    if state["version"] != sent.get(name):
                        sent[name] = state["version"]
                        self._send_event(name, state)
                latest = feed.wait(seq, timeout=EVENT_PING_SECONDS)
                if latest == seq and not self.server.stopping.is_set():
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                seq = latest
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            pass

    # Write endpoints

    def shopping_add(self, body):
        return self.server.shopping.add(body.get("name"), item_id=body.get("id"))

    def shopping_check(self, body):
        return self.server.shopping.check(body.get("id"), body.get("done", True))

    def shopping_remove(self, body):
        return self.server.shopping.remove(body.get("id"))

    def shopping_restore(self, body):
        return self.server.shopping.restore(body.get("ids"))

    def shopping_clear_checked(self, body):
        return self.server.shopping.clear_checked()

    def notes_add(self, body):
        return self.server.notes.add(body.get("text"), note_id=body.get("id"))

    def notes_remove(self, body):
        return self.server.notes.remove(body.get("id"))

    def notes_restore(self, body):
        return self.server.notes.restore(body.get("ids"))

    def calendar_add(self, body):
        """Puts a new event on a connected Google calendar, or on the board's own list."""
        sources = self.server.calendar_sources
        wanted = body.get("calendar")
        writable = sources.writable()
        if wanted != BOARD_CALENDAR and writable and (not wanted or any(c["id"] == wanted for c in writable)):
            event = sources.add(wanted, body)
            return {"state": sources.snapshot(), "event": event, "where": "google"}
        if wanted and wanted != BOARD_CALENDAR:
            raise RequestError(HTTPStatus.BAD_REQUEST, "That calendar can't be written to.")
        return {**self.server.calendar.add(body, event_id=body.get("id")), "where": "board"}

    def calendar_remove(self, body):
        event_id = body.get("id")
        if isinstance(event_id, str) and event_id.startswith("g:"):
            event = self.server.calendar_sources.remove(event_id)
            return {"state": self.server.calendar_sources.snapshot(), "event": event, "where": "google"}
        return {**self.server.calendar.remove(event_id), "where": "board"}

    def calendar_restore(self, body):
        ids = body.get("ids")
        if not isinstance(ids, list):
            # Let the store raise the same message it always does for a bad list.
            return self.server.calendar.restore(ids)
        on_google = [i for i in ids if isinstance(i, str) and i.startswith("g:")]
        result = self.server.calendar.restore([i for i in ids if i not in on_google])
        # Google gives a re-created event a new id, so report the ids that came back.
        back = self.server.calendar_sources.restore(on_google)
        state = self.server.calendar_sources.snapshot() if on_google else result["state"]
        return {"state": state, "restored": result["restored"] + [event["id"] for event in back]}

    def calendar_refresh(self, body):
        return {"state": self.server.calendar_sources.refresh()}

    def google_link(self, body):
        """Starts the Google sign-in. Only from the board itself: the redirect comes back to it."""
        self._board_only("Connect Google Calendar from the board's own screen.")
        redirect = "http://127.0.0.1:%d%s" % (self.server.server_address[1], GOOGLE_REDIRECT_PATH)
        return {**self.server.google.begin_link(redirect), "redirect": redirect}

    def google_unlink(self, body):
        self._board_only("Disconnect Google Calendar from the board's own screen.")
        status = self.server.google.unlink()
        self.server.calendar_sources.refresh_soon()
        return status

    def google_target(self, body):
        self.server.google.set_target(body.get("id"))
        return {"state": self.server.calendar_sources.snapshot()}

    def kiosk_exit(self, body):
        self._board_only("Only the board's own screen can exit kiosk mode.")
        running = self.server.kiosk.is_running()
        if running:
            timer = threading.Timer(self.server.kiosk_close_delay, self.server.kiosk.close)
            timer.daemon = True
            timer.start()
        return {"closing": running}

    # Helpers

    def _board_only(self, message):
        if not is_local_address(self.client_address[0]):
            raise RequestError(HTTPStatus.FORBIDDEN, message)
        # A plain form on some other web page can't send JSON, so this can't be triggered cross-site.
        if self.headers.get_content_type() != "application/json":
            raise RequestError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Send this as JSON.")

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

    def _send_result_page(self, title, message):
        """A plain page for the browser Google just sent back, which then returns to the board."""
        body = (
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta http-equiv="refresh" content="3;url=/#/app/calendar"><title>%s</title>'
            '<style>body{font:500 20px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;'
            'min-height:100vh;background:#edf1f8;color:#0f1d3f;text-align:center;padding:2rem}'
            'a{color:#17703c}</style></head><body><div><h1>%s</h1><p>%s</p>'
            '<p><a href="/#/app/calendar">Back to the board</a></p></div></body></html>'
        ) % (html.escape(title), html.escape(title), html.escape(message))
        raw = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

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
