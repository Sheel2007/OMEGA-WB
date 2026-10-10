"""Spotify: what's playing on the linked account, for the Spotify widget.

Signing in is Spotify's authorization-code flow with PKCE, so the board only needs
a client ID (no secret). Spotify only allows plain-http redirects to a loopback
address, so, like Google, it's started from the board's own screen and Spotify
sends the browser straight back to this server at 127.0.0.1.

Spotify doesn't push playback changes, so one background thread asks what's
playing every few seconds (less often when nothing is) and every screen gets the
answer over the event stream. Album art is fetched by the Pi and kept in memory,
so screens only ever load pictures from the Pi.

Only the standard library: the OAuth dance and the API are plain HTTPS and JSON.
"""
import base64
import copy
import hashlib
import json
import logging
import os
import re
import secrets
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

log = logging.getLogger(__name__)

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_URL = "https://api.spotify.com/v1"
# Read-only: the board shows what's playing and never controls it.
SCOPES = "user-read-currently-playing user-read-playback-state"
# Where Spotify keeps album art. The only place the Pi fetches pictures from for this.
ART_URL = "https://i.scdn.co/image/"
ART_ID = re.compile(r"^[0-9a-f]{16,64}$")
# Spotify offers 640, 300 and 64px covers; the biggest circle on the board is about 440px.
ART_MAX_WIDTH = 640

TIMEOUT_SECONDS = 15
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_ART_BYTES = 1024 * 1024
# Covers kept in memory (each about 50-150KB), and covers the board will fetch on request.
MAX_ART_CACHE = 12
MAX_KNOWN_ART = 32
MAX_TEXT = 200
# An access token lasts an hour; refresh a little early rather than on a 401.
TOKEN_MARGIN_SECONDS = 120
# How long a half-finished sign-in stays valid.
LINK_TIMEOUT_SECONDS = 10 * 60

# How often to ask what's playing. While a song plays, often enough that a skip on
# someone's phone shows up within a few seconds, and again just after it should end.
PLAYING_POLL_SECONDS = 5
IDLE_POLL_SECONDS = 15
ERROR_POLL_SECONDS = 60
MIN_POLL_SECONDS = 1
MAX_RETRY_AFTER_SECONDS = 15 * 60
# The playhead moving this much more (or less) than the time that passed is a seek,
# worth telling the screens about; anything less they work out themselves.
SEEK_TOLERANCE_MS = 3000


class SpotifyError(Exception):
    """Something went wrong talking to Spotify, with a message that's fine to show people."""

    def __init__(self, message, *, status=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def request_json(method, url, *, headers=None, form=None):
    data = None
    headers = dict(headers or {})
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as err:
        detail = err.read(MAX_RESPONSE_BYTES)
        raise SpotifyError(_explain(err.code, detail), status=err.code, retry_after=_retry_after(err)) from err
    except OSError as err:
        raise SpotifyError("Can't reach Spotify right now.") from err
    # Nothing playing is an empty 204.
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError as err:
        raise SpotifyError("Spotify sent something this board couldn't read.") from err


def fetch_image(url):
    """A cover's bytes and content type, or None if it can't be had."""
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
            content_type = response.headers.get_content_type()
            data = response.read(MAX_ART_BYTES + 1)
    except OSError:
        log.info("Couldn't fetch the album art at %s", url)
        return None
    if not content_type.startswith("image/") or len(data) > MAX_ART_BYTES:
        return None
    return data, content_type


def _retry_after(err):
    try:
        return max(MIN_POLL_SECONDS, min(MAX_RETRY_AFTER_SECONDS, int(err.headers.get("Retry-After"))))
    except (TypeError, ValueError, AttributeError):
        return None


def _explain(status, detail):
    try:
        found = json.loads(detail.decode("utf-8"))
        error = found.get("error")
        message = error.get("message") if isinstance(error, dict) else found.get("error_description") or error
    except (ValueError, AttributeError):
        message = None
    if status == 400 and message in ("invalid_grant", "Refresh token revoked"):
        return "Spotify wouldn't renew the board's sign-in. Connect Spotify again."
    if status in (401, 403):
        return "Spotify turned the board away. Try connecting Spotify again."
    if status == 429:
        return "Spotify is rate-limiting the board. It'll try again shortly."
    return str(message) if message else "Spotify returned an error (%d)." % status


def _verifier_challenge():
    """A PKCE code verifier, and its S256 challenge."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class SpotifyAccount:
    """The linked Spotify account: its tokens, and what it's playing."""

    def __init__(self, client_id=None, token_path=None, *, transport=request_json, now=time.monotonic):
        self._client_id = client_id or None
        self._token_path = token_path
        self._transport = transport
        self._now = now
        self._lock = threading.Lock()
        self._access = None
        self._access_until = 0
        self._pending = None
        self._saved = self._load()

    # State

    @property
    def configured(self):
        return bool(self._client_id)

    @property
    def linked(self):
        return bool(self._saved.get("refresh_token"))

    def status(self):
        return {
            "configured": self.configured,
            "linked": self.linked,
            "account": self._saved.get("account"),
        }

    # Signing in

    def begin_link(self, redirect_uri, back="/"):
        """Starts a sign-in. `back` is where the browser goes once it's done."""
        if not self.configured:
            raise SpotifyError("Add your Spotify client ID to config.json first.")
        state = secrets.token_urlsafe(16)
        verifier, challenge = _verifier_challenge()
        url = "%s?%s" % (AUTH_URL, urllib.parse.urlencode({
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": SCOPES,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "state": state,
        }))
        self._pending = {"state": state, "verifier": verifier, "redirect_uri": redirect_uri, "back": back,
                         "expires": self._now() + LINK_TIMEOUT_SECONDS}
        return {"url": url, "state": state}

    def return_address(self):
        """Where to send the browser after a sign-in, finished or not."""
        return self._pending["back"] if self._pending else "/"

    def finish_link(self, code, state):
        if not isinstance(code, str) or not code.strip():
            raise SpotifyError("That sign-in didn't come back with a code. Start again.")
        if not self._pending or self._now() >= self._pending["expires"]:
            raise SpotifyError("That sign-in took too long. Start again.")
        if not secrets.compare_digest(str(state or ""), self._pending["state"]):
            raise SpotifyError("That sign-in didn't come from this board. Start again.")
        tokens = self._transport("POST", TOKEN_URL, form={
            "grant_type": "authorization_code",
            "code": code.strip(),
            "redirect_uri": self._pending["redirect_uri"],
            "client_id": self._client_id,
            "code_verifier": self._pending["verifier"],
        })
        refresh = tokens.get("refresh_token")
        if not refresh or not tokens.get("access_token"):
            raise SpotifyError("Spotify didn't give the board a lasting sign-in. Start again.")
        with self._lock:
            self._hold(tokens)
            self._save({"refresh_token": refresh})
        self._pending = None
        try:
            name = _text(self._api("GET", "/me").get("display_name"))
        except SpotifyError:
            name = None
        if name:
            with self._lock:
                self._save({**self._saved, "account": name})
        return self.status()

    def unlink(self):
        with self._lock:
            self._access = None
            self._access_until = 0
            self._pending = None
            self._saved = {}
            if self._token_path and os.path.exists(self._token_path):
                try:
                    os.remove(self._token_path)
                except OSError:
                    log.warning("Couldn't delete %s", self._token_path, exc_info=True)
        return self.status()

    # Playback

    def now_playing(self):
        """Spotify's currently-playing answer, or {} when nothing is."""
        return self._api("GET", "/me/player/currently-playing", params={"additional_types": "episode"})

    # Internals

    def _api(self, method, path, *, params=None, retry=True):
        url = API_URL + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        token = self._token()
        try:
            return self._transport(method, url, headers={"Authorization": "Bearer %s" % token})
        except SpotifyError as err:
            if not retry or err.status != 401:
                raise
            # The token expired early or was revoked; get a fresh one and try once more.
            with self._lock:
                self._access = None
                self._access_until = 0
            return self._api(method, path, params=params, retry=False)

    def _token(self):
        with self._lock:
            if not self.linked:
                raise SpotifyError("Connect Spotify first.")
            if self._access and self._now() < self._access_until:
                return self._access
            refresh = self._saved["refresh_token"]
        try:
            tokens = self._transport("POST", TOKEN_URL, form={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "client_id": self._client_id,
            })
        except SpotifyError as err:
            # Revoked (someone removed the board from their Spotify account): forget it,
            # so the widget offers Connect again instead of failing forever.
            if err.status in (400, 401) and self._saved.get("refresh_token") == refresh:
                log.warning("Spotify refused the board's saved sign-in; it needs connecting again.")
                self.unlink()
            raise
        if not tokens.get("access_token"):
            raise SpotifyError("Spotify wouldn't renew the board's sign-in. Connect Spotify again.")
        with self._lock:
            # Unlinked while the refresh was on its way: don't bring the sign-in back.
            if self._saved.get("refresh_token") != refresh:
                raise SpotifyError("Connect Spotify first.")
            self._hold(tokens)
            # With PKCE, Spotify hands out a new refresh token and retires the old one.
            if tokens.get("refresh_token") and tokens["refresh_token"] != refresh:
                self._save({**self._saved, "refresh_token": tokens["refresh_token"]})
            return self._access

    def _hold(self, tokens):
        self._access = tokens.get("access_token")
        lifetime = tokens.get("expires_in")
        lifetime = int(lifetime) if isinstance(lifetime, (int, float, str)) and str(lifetime).isdigit() else 3600
        self._access_until = self._now() + max(60, lifetime - TOKEN_MARGIN_SECONDS)

    def _load(self):
        if not self._token_path or not os.path.exists(self._token_path):
            return {}
        try:
            with open(self._token_path, encoding="utf-8") as f:
                saved = json.load(f)
            return saved if isinstance(saved, dict) else {}
        except (OSError, ValueError):
            log.warning("Couldn't read %s; Spotify will need connecting again.", self._token_path)
            return {}

    def _save(self, saved):
        self._saved = saved
        if not self._token_path:
            return
        folder = os.path.dirname(os.path.abspath(self._token_path))
        try:
            os.makedirs(folder, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=folder, prefix=".spotify-", suffix=".tmp")
            # The refresh token is a key to the account: nobody else on the Pi gets to read it.
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(saved, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._token_path)
        except OSError:
            log.exception("Couldn't save the Spotify sign-in to %s", self._token_path)


# Spotify's answer as the board's own shape


def _text(value):
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text[:MAX_TEXT] or None


def art_id(images):
    """The id of the cover to show (the biggest up to ART_MAX_WIDTH), or None."""
    if not isinstance(images, list):
        return None
    found = []
    for image in images:
        if not isinstance(image, dict) or not isinstance(image.get("url"), str):
            continue
        url = image["url"]
        if not url.startswith(ART_URL) or not ART_ID.match(url[len(ART_URL):]):
            continue
        width = image.get("width") if isinstance(image.get("width"), int) else 0
        found.append((width, url[len(ART_URL):]))
    if not found:
        return None
    fitting = [entry for entry in found if entry[0] <= ART_MAX_WIDTH]
    return max(fitting)[1] if fitting else min(found)[1]


def _milliseconds(value):
    return max(0, int(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def shape_playback(raw, now_ms):
    """Spotify's currently-playing answer as the board's track, or None if nothing is playing.

    `at` is when `progress_ms` was true (ms since the epoch), so a screen can move
    the playhead along by itself between updates.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("item"), dict):
        return None
    item = raw["item"]
    if item.get("type") == "episode":
        show = item.get("show") if isinstance(item.get("show"), dict) else {}
        kind = "episode"
        artist = _text(show.get("name")) or _text(show.get("publisher"))
        album = _text(show.get("publisher"))
        images = item.get("images") or show.get("images")
    else:
        kind = "track"
        artists = item.get("artists") if isinstance(item.get("artists"), list) else []
        artist = _text(", ".join(a["name"] for a in artists if isinstance(a, dict) and isinstance(a.get("name"), str)))
        record = item.get("album") if isinstance(item.get("album"), dict) else {}
        album = _text(record.get("name"))
        images = record.get("images")
    title = _text(item.get("name")) or "Unknown"
    duration = _milliseconds(item.get("duration_ms"))
    progress = _milliseconds(raw.get("progress_ms"))
    return {
        # Local files have no Spotify id; their URI (or failing that the name) still tells songs apart.
        "id": _text(item.get("id")) or _text(item.get("uri")) or title,
        "kind": kind,
        "title": title,
        "artist": artist,
        "album": album,
        "art": art_id(images),
        "playing": bool(raw.get("is_playing")),
        "duration_ms": duration,
        "progress_ms": min(progress, duration) if duration else progress,
        "at": now_ms,
    }


def _same_moment(old, new):
    """Whether `new` is just `old` played on (same song, same pause state, no seek)."""
    if old is None or new is None:
        return old is new
    if any(old[key] != new[key] for key in ("id", "title", "artist", "album", "art", "playing", "duration_ms")):
        return False
    expected = old["progress_ms"] + (new["at"] - old["at"] if old["playing"] else 0)
    if old["duration_ms"]:
        expected = min(expected, old["duration_ms"])
    return abs(expected - new["progress_ms"]) <= SEEK_TOLERANCE_MS


class NowPlaying:
    """What the linked account is playing, read on one background thread.

    snapshot() is pushed to every screen over the event stream; its version only
    changes when something a screen can't work out for itself does (a new song, a
    pause, a seek), not on every check.
    """

    label = "spotify"

    def __init__(self, account, *, feed=None, fetch_art=fetch_image, clock=time.time):
        self._account = account
        self._feed = feed
        self._fetch_art = fetch_art
        self._clock = clock
        self._lock = threading.Lock()
        self._version = 0
        self._track = None
        self._error = None
        self._status = account.status()
        # Covers the board has seen (id -> nothing), newest last, and the ones it holds.
        self._known_art = OrderedDict()
        self._art = OrderedDict()
        self._art_lock = threading.Lock()
        self._wake = threading.Event()
        self._stopped = False
        self._thread = None

    # Reads

    def snapshot(self):
        with self._lock:
            return {
                "version": self._version,
                **self._status,
                "track": copy.deepcopy(self._track),
                "error": self._error,
            }

    def art(self, image_id):
        """A cover the board has shown, as (bytes, content type), or None."""
        if not isinstance(image_id, str) or not ART_ID.match(image_id):
            raise ValueError("That isn't a Spotify cover.")
        with self._lock:
            if image_id not in self._known_art:
                return None
        # One fetch at a time: every screen asks for a new cover at once.
        with self._art_lock:
            if image_id in self._art:
                self._art.move_to_end(image_id)
                return self._art[image_id]
            found = self._fetch_art(ART_URL + image_id)
            if found is None:
                return None
            self._art[image_id] = found
            while len(self._art) > MAX_ART_CACHE:
                self._art.popitem(last=False)
            return found

    # Signing in and out (the account itself is SpotifyAccount)

    def begin_link(self, redirect_uri, back="/"):
        return self._account.begin_link(redirect_uri, back)

    def return_address(self):
        return self._account.return_address()

    def finish_link(self, code, state):
        status = self._account.finish_link(code, state)
        self._publish(status=status, track=None, error=None)
        self.refresh_soon()
        return status

    def unlink(self):
        status = self._account.unlink()
        self._publish(status=status, track=None, error=None)
        return status

    # The poller

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="spotify", daemon=True)
            self._thread.start()

    def stop(self):
        self._stopped = True
        self._wake.set()

    def refresh_soon(self):
        self._wake.set()

    def _loop(self):
        while not self._stopped:
            try:
                delay = self.poll()
            except Exception:  # A failed check must never take the board's server down with it.
                log.exception("Checking what's playing on Spotify failed")
                delay = ERROR_POLL_SECONDS
            # Not linked: sleep until a sign-in wakes the thread.
            self._wake.wait(delay)
            self._wake.clear()

    def poll(self):
        """Asks Spotify once. Returns how long to wait before asking again (None: until woken)."""
        if not self._account.linked:
            self._publish(status=self._account.status(), track=None, error=None)
            return None
        try:
            raw = self._account.now_playing()
        except SpotifyError as err:
            if not self._account.linked:
                # The sign-in was revoked: back to Connect, until someone links again.
                self._publish(status=self._account.status(), track=None, error=None)
                return None
            self._publish(status=self._account.status(), track=self._track, error=str(err))
            return err.retry_after or ERROR_POLL_SECONDS
        track = shape_playback(raw, int(self._clock() * 1000))
        if track and track["art"]:
            self._remember_art(track["art"])
        self._publish(status=self._account.status(), track=track, error=None)
        if not (track and track["playing"]):
            return IDLE_POLL_SECONDS
        left = (track["duration_ms"] - track["progress_ms"]) / 1000 if track["duration_ms"] else PLAYING_POLL_SECONDS
        # Just after the song should end, if that's sooner than the next regular check.
        return max(MIN_POLL_SECONDS, min(PLAYING_POLL_SECONDS, left + 0.5))

    def _remember_art(self, image_id):
        with self._lock:
            self._known_art[image_id] = None
            self._known_art.move_to_end(image_id)
            while len(self._known_art) > MAX_KNOWN_ART:
                self._known_art.popitem(last=False)

    def _publish(self, *, status, track, error):
        with self._lock:
            if _same_moment(self._track, track):
                # Keep the old reading: the screens' playheads already agree with it.
                track = self._track
            if status == self._status and track is self._track and error == self._error:
                return
            self._status = status
            self._track = track
            self._error = error
            self._version += 1
        if self._feed is not None:
            self._feed.notify()
