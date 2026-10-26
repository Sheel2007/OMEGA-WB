"""The jukebox: play the sound of a YouTube video on the board, from a phone.

Deliberately quiet. There is no widget, no app, nothing in any menu, and the whole
thing only exists when `jukebox` is turned on in config.json — without it the
addresses answer the same 404 as an address that was never built. The way in is a
secret knock on the phone; the board (and only the board) plays what it's told,
through YouTube's own embedded player.

There is no password on it: it plays a video's sound and can read nothing, so the
knock is the whole lock. That holds because only the house can reach the board.

Nothing here is written to the SD card: a prank shouldn't outlive a reboot.
"""
import copy
import re
from urllib.parse import parse_qs, urlsplit

from .store import JsonStore, ValidationError, utc_now

# A YouTube video id is always eleven of these.
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# "90", "90s", "1m30s", "2h5m" — the forms a YouTube link puts in t= or start=.
CLOCK = re.compile(r"^(?:(?P<h>\d{1,2})h)?(?:(?P<m>\d{1,4})m)?(?:(?P<s>\d{1,6})s?)?$")
HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}
# Paths that carry the id in the next segment, rather than in ?v=.
ID_IN_PATH = ("/embed/", "/shorts/", "/v/", "/live/")

MAX_VOLUME = 100
DEFAULT_VOLUME = 60
# The longest a video may be asked to start at (a day), so a silly t= can't be sent.
MAX_START_SECONDS = 24 * 60 * 60
# What the board is allowed to report back about its player.
PLAYER_STATES = ("idle", "loading", "playing", "blocked", "error")


def seconds_from(raw):
    """A YouTube t= value in seconds. 0 for anything that isn't one."""
    if raw is None:
        return 0
    text = str(raw).strip().lower()
    if not text:
        return 0
    match = CLOCK.match(text)
    if not match or not any(match.groupdict().values()):
        return 0
    parts = {key: int(value) for key, value in match.groupdict().items() if value}
    total = parts.get("h", 0) * 3600 + parts.get("m", 0) * 60 + parts.get("s", 0)
    return min(total, MAX_START_SECONDS)


def video_from(raw):
    """(video id, start seconds) from any YouTube link, or from a bare id."""
    if not isinstance(raw, str) or not raw.strip():
        raise ValidationError("Paste a YouTube link first.")
    text = raw.strip()
    if VIDEO_ID.match(text):
        return text, 0

    # A pasted link often arrives without its scheme ("youtu.be/...").
    parts = urlsplit(text if "//" in text else "https://" + text)
    if parts.hostname is None or parts.hostname.lower() not in HOSTS:
        raise ValidationError("That isn't a YouTube link.")

    query = parse_qs(parts.query)
    path = parts.path
    if parts.hostname.lower().endswith("youtu.be"):
        video = path.lstrip("/").split("/")[0]
    elif any(path.startswith(prefix) for prefix in ID_IN_PATH):
        video = path.split("/")[2] if len(path.split("/")) > 2 else ""
    else:
        video = (query.get("v") or [""])[0]

    if not VIDEO_ID.match(video or ""):
        raise ValidationError("That link doesn't have a video in it.")
    # The start time can be in the query or, on an old-style link, the fragment.
    start = (query.get("t") or query.get("start") or [None])[0]
    if start is None and parts.fragment.startswith("t="):
        start = parts.fragment[2:]
    return video, seconds_from(start)


def clean_volume(raw):
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValidationError("Volume must be a number.")
    return max(0, min(MAX_VOLUME, round(raw)))


class Jukebox(JsonStore):
    """What the board should be playing, if anything. Memory only."""

    label = "jukebox"

    def __init__(self, *, feed=None, clock=utc_now):
        super().__init__(None, clock=clock, feed=feed)

    # Commands

    def play(self, url):
        video, start = video_from(url)
        with self._changed:
            self._track = {"video": video, "start": start, "asked": self._clock()}
            # A new song starts fresh, whatever the last one's player was doing.
            self._player = "loading"
            self._detail = None
            self._commit()
            return {"state": self._state()}

    def stop(self):
        with self._changed:
            self._track = None
            self._player = "idle"
            self._detail = None
            self._commit()
            return {"state": self._state()}

    def set_volume(self, level):
        volume = clean_volume(level)
        with self._changed:
            if volume != self._volume:
                self._volume = volume
                self._commit()
            return {"state": self._state()}

    def report(self, player, detail=None):
        """The board saying what its player actually did, so the phone can tell."""
        if player not in PLAYER_STATES:
            raise ValidationError("Unknown player state.")
        with self._changed:
            detail = detail if isinstance(detail, str) and detail.strip() else None
            if (player, detail) != (self._player, self._detail):
                self._player, self._detail = player, detail[:120] if detail else None
                self._commit()
            return {"state": self._state()}

    # JsonStore hooks

    def _reset(self):
        self._track = None
        self._volume = DEFAULT_VOLUME
        self._player = "idle"
        self._detail = None

    def _state(self):
        return {
            "version": self._version,
            "track": copy.deepcopy(self._track),
            "volume": self._volume,
            "player": self._player,
            "detail": self._detail,
        }

    # Never saved: there's no file, and a prank shouldn't survive a reboot.
    def _to_disk(self):
        return {}

    def _from_disk(self, data):
        return None


def enabled_from(config):
    """Whether config.json asks for the jukebox at all. Off unless it says so."""
    setting = config.get("jukebox") if isinstance(config, dict) else None
    # A bare true turns it on; a settings object does too, unless it says otherwise.
    if isinstance(setting, dict):
        return setting.get("enabled", True) is not False
    return setting is True
