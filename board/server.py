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
from .grocery import STORES
from .grocery_images import MAX_PHOTO_BYTES
from .kiosk import is_local_address
from .lights import LightsUnavailable
from .products import ProductsUnavailable, fold, query_text
from .spotify import NowPlaying, SpotifyAccount, SpotifyError
from .sports import Sports, SportsUnavailable, follows_from
from .store import NotFound, ValidationError
from .weather import WeatherUnavailable

log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
MAX_BODY_BYTES = 16 * 1024
# Pictures don't change, so screens may keep them; one with no picture is asked about again later.
IMAGE_CACHE_SECONDS = 7 * 24 * 60 * 60
NO_IMAGE_CACHE_SECONDS = 60 * 60
# Keeps idle event streams alive through routers and lets dead ones get noticed.
EVENT_PING_SECONDS = 15
# Lets the "Exit to desktop" response reach the browser before the browser closes.
KIOSK_CLOSE_DELAY_SECONDS = 0.5
# An app id in ?app=, for the QR code a phone scans to open that app.
APP_ID = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
# Places other than the board a QR code may point at. Only these: a phone shouldn't
# be able to ask the board to print a QR code for any address it likes.
QR_TARGETS = {"google-calendar": "https://calendar.google.com/calendar/u/0/r/eventedit"}
# Where Google sends the browser back to after someone signs in, and the word that
# means "keep this event on the board rather than on a Google calendar".
GOOGLE_REDIRECT_PATH = "/api/calendar/google/done"
# The same for Spotify. Register http://127.0.0.1:<port> plus this in the Spotify app.
SPOTIFY_REDIRECT_PATH = "/api/spotify/done"
# Names the board's own browser can be at, which a Spotify sign-in may return to.
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")
BOARD_CALENDAR = "board"
# One QR code per app, drawn once; the handful of apps that ask for one.
MAX_QR_CACHE = 8


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# A hostname, optionally with a port: "widget-board.tailnet.ts.net", or with the
# scheme and port spelled out. Anything else is ignored, so a typo in config.json
# can't send every phone in the house somewhere unexpected.
PUBLIC_ADDRESS = re.compile(r"^(?:(?P<scheme>https?)://)?(?P<host>[A-Za-z0-9](?:[A-Za-z0-9.\-]{0,251}[A-Za-z0-9])?)"
                            r"(?::(?P<port>\d{1,5}))?/?$")


def phone_address(value, port):
    """The base URL to hand phones, from the `hostname` setting. None if it's unusable.

    This is how the board is reached from outside the house: point it at the name a
    VPN such as Tailscale gives the Pi, and the QR code and "On your phone" address
    use that instead of the Wi-Fi address, which only works at home.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    match = PUBLIC_ADDRESS.match(value.strip())
    if not match:
        log.warning("Ignoring 'hostname' in config.json: %r isn't a hostname the board can hand out.", value)
        return None
    scheme = match.group("scheme") or "http"
    found = match.group("port")
    # https is served on 443 by whatever is in front; otherwise the board's own port.
    shown = found or ("" if scheme == "https" else str(port))
    return "%s://%s%s/" % (scheme, match.group("host"), ":" + shown if shown else "")


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

    def __init__(self, address, *, notes, calendar, calendar_sources, google, feed, weather, kiosk,
                 lights, roommate_games, grocery, products, store_products, product_images, photos, spotify=None,
                 sports=None, web_dir=WEB_DIR, location=None, public_url=None):
        self.grocery = grocery
        self.products = products
        self.store_products = store_products
        self.product_images = product_images
        self.photos = photos
        self.lights = lights
        # Left out, the widget just says Spotify isn't set up.
        self.spotify = spotify or NowPlaying(SpotifyAccount())
        # Left out, the board follows nothing (and never goes online for it).
        self.sports = sports or Sports(follows_from(False))
        self.roommate_games = roommate_games
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
        # Set when the board is reachable by a name that works away from home too.
        self.public_url = public_url
        self.boot_id = uuid.uuid4().hex[:8]
        self.stopping = threading.Event()
        self._qr_cache = {}
        super().__init__(address, BoardHandler)

    def live_stores(self):
        """Stores whose state is pushed over /api/events, by event name."""
        return {"notes": self.notes, "calendar": self.calendar,
                "calendar-sources": self.calendar_sources, "lights": self.lights,
                "roommate-games": self.roommate_games, "grocery": self.grocery, "spotify": self.spotify,
                "sports": self.sports}

    def server_bind(self):
        # Skip HTTPServer's reverse-DNS lookup, which can stall startup on a Pi.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]

    def phone_url(self, app=None):
        """The address to give a phone, opening straight into `app` if given.

        The name from config.json when there is one, so the link keeps working off the
        home Wi-Fi; otherwise this machine's address on the Wi-Fi.
        """
        base = self.public_url or "http://%s:%d/" % (lan_address(), self.server_address[1])
        return base + ("#/app/%s" % app if app else "")

    def qr_svg(self, url=None, *, app=None):
        """A QR code for `url`, or for this board's own address (optionally one app)."""
        url = url or self.phone_url(app)
        if url not in self._qr_cache:
            if len(self._qr_cache) >= MAX_QR_CACHE:
                self._qr_cache.clear()
            self._qr_cache[url] = self._draw_qr(url, app)
        return self._qr_cache[url]

    def _draw_qr(self, url, app):
        """A long hostname can outgrow a small QR code; the address alone still fits."""
        try:
            return qr.to_svg(url)
        except ValueError:
            if app is None:
                raise
            log.info("The link to %s is too long for a QR code; using the board's address instead.", app)
            return qr.to_svg(self.phone_url())

    def wake_streams(self):
        self.stopping.set()
        self.feed.wake()

    def shutdown(self):
        self.wake_streams()
        self.calendar_sources.stop()
        self.lights.stop()
        self.roommate_games.stop()
        self.store_products.stop()
        self.spotify.stop()
        self.sports.stop()
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
        ".woff2": "font/woff2",
    }

    GET_ROUTES = {
        "/api/health": "health",
        "/api/info": "info",
        "/api/qr.svg": "qr_code",
        "/api/events": "events",
        "/api/notes": "notes_state",
        "/api/calendar": "calendar_state",
        "/api/calendar/sources": "calendar_sources",
        # Where Google sends people back to after they sign in.
        "/api/calendar/google/done": "google_done",
        "/api/weather": "weather_forecast",
        "/api/lights": "lights_state",
        "/api/roommate-games": "roommate_games_state",
        "/api/grocery": "grocery_state",
        "/api/grocery/lookup": "grocery_lookup",
        "/api/grocery/search": "grocery_search",
        "/api/grocery/suggest": "grocery_suggest",
        "/api/grocery/image": "grocery_image",
        "/api/grocery/photo": "grocery_photo",
        "/api/spotify": "spotify_state",
        # Where Spotify sends people back to after they sign in.
        "/api/spotify/done": "spotify_done",
        "/api/spotify/art": "spotify_art",
        "/api/sports": "sports_state",
        "/api/sports/match": "sports_match",
        "/api/sports/crest": "sports_crest",
    }
    # Bodies that aren't JSON: a photo taken on a phone.
    UPLOAD_ROUTES = {
        "/api/grocery/photo": "grocery_photo_upload",
    }
    POST_ROUTES = {
        "/api/notes/add": "notes_add",
        "/api/notes/remove": "notes_remove",
        "/api/notes/restore": "notes_restore",
        "/api/calendar/add": "calendar_add",
        "/api/calendar/remove": "calendar_remove",
        "/api/calendar/restore": "calendar_restore",
        "/api/calendar/refresh": "calendar_refresh",
        "/api/calendar/show": "calendar_show",
        "/api/calendar/google/link": "google_link",
        "/api/calendar/google/unlink": "google_unlink",
        "/api/calendar/google/target": "google_target",
        "/api/lights/set": "lights_set",
        "/api/lights/swap": "lights_swap",
        "/api/lights/pair": "lights_pair",
        "/api/lights/rename": "lights_rename",
        "/api/lights/dark": "lights_dark",
        "/api/lights/schedules/add": "lights_schedule_add",
        "/api/lights/schedules/update": "lights_schedule_update",
        "/api/lights/schedules/remove": "lights_schedule_remove",
        "/api/lights/schedules/restore": "lights_schedule_restore",
        "/api/roommate-games/players/add": "roommate_player_add",
        "/api/roommate-games/players/update": "roommate_player_update",
        "/api/roommate-games/players/remove": "roommate_player_remove",
        "/api/roommate-games/players/restore": "roommate_player_restore",
        "/api/roommate-games/games/add": "roommate_game_add",
        "/api/roommate-games/games/update": "roommate_game_update",
        "/api/roommate-games/games/remove": "roommate_game_remove",
        "/api/roommate-games/games/restore": "roommate_game_restore",
        "/api/roommate-games/schedule": "roommate_schedule",
        "/api/roommate-games/draw": "roommate_draw",
        "/api/roommate-games/record": "roommate_record",
        "/api/roommate-games/notify": "roommate_notify",
        "/api/grocery/add": "grocery_add",
        "/api/grocery/update": "grocery_update",
        "/api/grocery/check": "grocery_check",
        "/api/grocery/remove": "grocery_remove",
        "/api/grocery/restore": "grocery_restore",
        "/api/grocery/clear-checked": "grocery_clear_checked",
        "/api/grocery/texting/add": "grocery_texting_add",
        "/api/grocery/texting/remove": "grocery_texting_remove",
        "/api/grocery/texting/restore": "grocery_texting_restore",
        "/api/spotify/link": "spotify_link",
        "/api/spotify/unlink": "spotify_unlink",
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
        upload = self.UPLOAD_ROUTES.get(urlsplit(self.path).path)
        if upload is not None:
            return getattr(self, upload)()
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
        except (GoogleError, SpotifyError) as err:
            return self._send_error(HTTPStatus.BAD_GATEWAY, str(err))
        except LightsUnavailable as err:
            return self._send_error(HTTPStatus.SERVICE_UNAVAILABLE, str(err))
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
        query = parse_qs(urlsplit(self.path).query)
        target = query.get("target", [None])[0]
        if target is not None and target not in QR_TARGETS:
            return self._send_error(HTTPStatus.BAD_REQUEST, "The board has no QR code for that.")
        app = query.get("app", [None])[0]
        if app is not None and not APP_ID.match(app):
            return self._send_error(HTTPStatus.BAD_REQUEST, "That isn't an app on the board.")
        body = self.server.qr_svg(QR_TARGETS[target] if target else None, app=app).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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

    def lights_state(self):
        self._send_json(HTTPStatus.OK, self.server.lights.snapshot())

    def roommate_games_state(self):
        self._send_json(HTTPStatus.OK, self.server.roommate_games.snapshot())

    def grocery_state(self):
        self._send_json(HTTPStatus.OK, self.server.grocery.snapshot())

    def grocery_lookup(self):
        """A scanned barcode: what the board remembers about it, otherwise what's online."""
        code = parse_qs(urlsplit(self.path).query).get("code", [""])[0]
        known = self.server.grocery.known(code)
        if known is not None:
            return self._send_json(HTTPStatus.OK, {"product": known})
        try:
            product = self.server.products.lookup(code)
        except ValueError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        except ProductsUnavailable as err:
            return self._send_error(HTTPStatus.SERVICE_UNAVAILABLE, str(err))
        self._send_json(HTTPStatus.OK, {"product": product})

    def grocery_search(self):
        """Things the household has bought before first, then products online.

        If the product database can't be reached, the remembered ones still come
        back, with `offline` set so the app can say why there aren't more.
        """
        query = parse_qs(urlsplit(self.path).query)
        text = query.get("q", [""])[0]
        store = query.get("store", [None])[0] or None
        if store is not None and store not in STORES:
            return self._send_error(HTTPStatus.BAD_REQUEST, "The store must be Trader Joe's or Lidl.")
        known = self.server.grocery.search_known(text, store)
        try:
            online = self.server.products.search(text, store)
            offline = False
        except ProductsUnavailable:
            online, offline = [], True
        codes = {p["code"] for p in known if p["code"]}
        self._send_json(HTTPStatus.OK, {
            "known": known,
            "online": [p for p in online if p["code"] not in codes],
            "offline": offline,
        })

    def grocery_suggest(self):
        """Trader Joe's and Lidl products that could be what's being typed, from the Pi's own list.

        `ready` is false until that list has been downloaded the first time.
        """
        query = parse_qs(urlsplit(self.path).query)
        store = query.get("store", [None])[0] or None
        if store is not None and store not in STORES:
            return self._send_error(HTTPStatus.BAD_REQUEST, "The store must be Trader Joe's or Lidl.")
        words = fold(query_text(query.get("q", [""])[0])).replace("'", " ").split()
        found = self.server.store_products.suggest(words, store)
        self._send_json(HTTPStatus.OK, {"online": found, "ready": len(self.server.store_products) > 0})

    def grocery_image(self):
        """A product's picture, by barcode, from the Pi's copy of Open Food Facts' photo."""
        code = parse_qs(urlsplit(self.path).query).get("code", [""])[0]
        try:
            image = self.server.product_images.get(code)
        except ValueError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        self._send_image(image)

    def grocery_photo(self):
        name = parse_qs(urlsplit(self.path).query).get("name", [""])[0]
        self._send_image(self.server.photos.read(name))

    def grocery_photo_upload(self):
        """A photo of something, taken on a phone. Answers with the name to give the item."""
        if self.headers.get_content_type() not in ("image/jpeg", "image/png", "image/webp"):
            return self._send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Send the photo as a JPEG, PNG or WebP picture.")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length.")
        if length > MAX_PHOTO_BYTES:
            return self._send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "That photo is too big.")
        try:
            name = self.server.photos.save(self.rfile.read(length))
        except ValueError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        self._send_json(HTTPStatus.OK, {"photo": name})

    def spotify_state(self):
        self._send_json(HTTPStatus.OK, self.server.spotify.snapshot())

    def spotify_done(self):
        """Where Spotify sends the browser back to once someone has signed in."""
        query = parse_qs(urlsplit(self.path).query)
        spotify = self.server.spotify
        back = spotify.return_address()
        refused = query.get("error", [None])[0]
        if refused:
            return self._send_result_page("Spotify didn’t connect", "Spotify said: %s" % refused, back=back)
        try:
            spotify.finish_link(query.get("code", [None])[0], query.get("state", [None])[0])
        except SpotifyError as err:
            return self._send_result_page("Spotify didn’t connect", str(err), back=back)
        self._send_result_page("Spotify connected", "Taking you back to the board…", back=back)

    def spotify_art(self):
        """The cover of something the board has shown playing, from the Pi's copy."""
        image_id = parse_qs(urlsplit(self.path).query).get("id", [""])[0]
        try:
            image = self.server.spotify.art(image_id)
        except ValueError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        self._send_image(image)

    def sports_state(self):
        self._send_json(HTTPStatus.OK, self.server.sports.snapshot())

    def sports_match(self):
        """One match's page: line-ups, what's happened and the team stats, from the Pi's copy."""
        match_id = parse_qs(urlsplit(self.path).query).get("id", [""])[0]
        try:
            detail = self.server.sports.match(match_id)
        except ValueError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        except SportsUnavailable as err:
            return self._send_error(HTTPStatus.SERVICE_UNAVAILABLE, str(err))
        if detail is None:
            return self._send_error(HTTPStatus.NOT_FOUND, "The board doesn't know that match.")
        self._send_json(HTTPStatus.OK, detail)

    def sports_crest(self):
        """A team's crest, for a team the board has shown, from the Pi's copy."""
        crest_id = parse_qs(urlsplit(self.path).query).get("id", [""])[0]
        try:
            image = self.server.sports.crest(crest_id)
        except ValueError as err:
            return self._send_error(HTTPStatus.BAD_REQUEST, str(err))
        self._send_image(image)

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

    def calendar_show(self, body):
        """Shows or hides one connected calendar on this board."""
        self.server.calendar_sources.show(body.get("id"), body.get("shown", True))
        return {"state": self.server.calendar_sources.snapshot()}

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

    def lights_set(self, body):
        return self.server.lights.set(body.get("id"), body.get("on"))

    def lights_swap(self, body):
        return self.server.lights.swap(body.get("id"), body.get("swapped"))

    def lights_rename(self, body):
        return self.server.lights.rename(body.get("id"), body.get("name"))

    def lights_dark(self, body):
        return self.server.lights.set_dark(body)

    def lights_pair(self, body):
        return self.server.lights.pair(body.get("open"))

    def lights_schedule_add(self, body):
        return self.server.lights.add_schedule(body, schedule_id=body.get("id"))

    def lights_schedule_update(self, body):
        return self.server.lights.update_schedule(body.get("id"), body)

    def lights_schedule_remove(self, body):
        return self.server.lights.remove_schedule(body.get("id"))

    def lights_schedule_restore(self, body):
        return self.server.lights.restore_schedules(body.get("ids"))

    def roommate_player_add(self, body):
        return self.server.roommate_games.add_player(body, player_id=body.get("id"))

    def roommate_player_update(self, body):
        return self.server.roommate_games.update_player(body.get("id"), body)

    def roommate_player_remove(self, body):
        return self.server.roommate_games.remove_player(body.get("id"))

    def roommate_player_restore(self, body):
        return self.server.roommate_games.restore_players(body.get("ids"))

    def roommate_game_add(self, body):
        return self.server.roommate_games.add_game(body, game_id=body.get("id"))

    def roommate_game_update(self, body):
        return self.server.roommate_games.update_game(body.get("id"), body)

    def roommate_game_remove(self, body):
        return self.server.roommate_games.remove_game(body.get("id"))

    def roommate_game_restore(self, body):
        return self.server.roommate_games.restore_games(body.get("ids"))

    def roommate_schedule(self, body):
        return self.server.roommate_games.set_schedule(body)

    def roommate_draw(self, body):
        return self.server.roommate_games.draw(body.get("again", False))

    def roommate_record(self, body):
        return self.server.roommate_games.record(body.get("week"), body.get("pick"), body.get("order"))

    def roommate_notify(self, body):
        return self.server.roommate_games.notify(body.get("week"))

    def grocery_add(self, body):
        return self.server.grocery.add(body, item_id=body.get("id"))

    def grocery_update(self, body):
        return self.server.grocery.update(body.get("id"), body)

    def grocery_check(self, body):
        return self.server.grocery.check(body.get("id"), body.get("done", True))

    def grocery_remove(self, body):
        return self.server.grocery.remove(body.get("id"))

    def grocery_restore(self, body):
        return self.server.grocery.restore(body.get("ids"))

    def grocery_clear_checked(self, body):
        return self.server.grocery.clear_checked()

    def grocery_texting_add(self, body):
        return self.server.grocery.add_texter(body, texter_id=body.get("id"))

    def grocery_texting_remove(self, body):
        return self.server.grocery.remove_texter(body.get("id"))

    def grocery_texting_restore(self, body):
        return self.server.grocery.restore_texters(body.get("ids"))

    def spotify_link(self, body):
        """Starts the Spotify sign-in. Only from the board itself: the redirect comes back to it."""
        self._board_only("Connect Spotify from the board's own screen.")
        port = self.server.server_address[1]
        redirect = "http://127.0.0.1:%d%s" % (port, SPOTIFY_REDIRECT_PATH)
        return {**self.server.spotify.begin_link(redirect, self._loopback_page(body.get("back"), port)),
                "redirect": redirect}

    def spotify_unlink(self, body):
        self._board_only("Disconnect Spotify from the board's own screen.")
        return self.server.spotify.unlink()

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

    @staticmethod
    def _loopback_page(address, port):
        """`address` if it's a page of this board on the Pi itself, else the home screen.

        The kiosk opens the board at localhost, and Spotify returns to 127.0.0.1; going
        back to the address it started from keeps its saved layout and ?kiosk=1.
        """
        if not isinstance(address, str) or len(address) > 2000:
            return "/"
        try:
            parts = urlsplit(address)
            same = parts.scheme == "http" and parts.hostname in LOOPBACK_HOSTS and parts.port == port
        except ValueError:
            return "/"
        return address if same else "/"

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

    def _send_image(self, image):
        if image is None:
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "max-age=%d" % NO_IMAGE_CACHE_SECONDS)
            self.end_headers()
            return
        data, content_type = image
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=%d" % IMAGE_CACHE_SECONDS)
        self.end_headers()
        self.wfile.write(data)

    def _send_result_page(self, title, message, back="/#/app/calendar"):
        """A plain page for the browser Google or Spotify just sent back, which then returns to the board."""
        back = html.escape(back)
        body = (
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta http-equiv="refresh" content="3;url=%s"><title>%s</title>'
            '<style>body{font:500 20px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;'
            'min-height:100vh;background:#edf1f8;color:#0f1d3f;text-align:center;padding:2rem}'
            'a{color:#17703c}</style></head><body><div><h1>%s</h1><p>%s</p>'
            '<p><a href="%s">Back to the board</a></p></div></body></html>'
        ) % (back, html.escape(title), html.escape(title), html.escape(message), back)
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
