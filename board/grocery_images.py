"""Pictures for the grocery list.

- Product photos come from Open Food Facts. The Pi fetches each one once, keeps it
  in data/grocery-images/ and serves it to every screen, so phones and the board
  never talk to Open Food Facts themselves and the pictures still show offline.
- Photos people take on their phones (for things Open Food Facts has no picture
  of) are kept in data/grocery-photos/. Phones shrink them before sending, so each
  is a few tens of kilobytes.

Both folders are bounded: the oldest cached product photos are dropped, and taken
photos only once nothing on the list or in the catalog uses them any more.
No image library is needed: files are only checked to be JPEG, PNG or WebP.
"""
import logging
import os
import re
import tempfile
import threading
import time
import urllib.request
import uuid
from collections import OrderedDict
from urllib.parse import urlsplit

from .grocery import normalize_code
from .products import USER_AGENT, ProductsUnavailable

log = logging.getLogger(__name__)

# Where Open Food Facts keeps its pictures. Nothing else is ever fetched.
IMAGE_HOSTS = ("images.openfoodfacts.org", "static.openfoodfacts.org")
FETCH_TIMEOUT_SECONDS = 8
MAX_IMAGE_BYTES = 400 * 1024
MAX_PHOTO_BYTES = 600 * 1024
MAX_CACHED = 400
MAX_PHOTOS = 300
# A product with no picture isn't asked about again for a while.
MISSING_SECONDS = 6 * 60 * 60
MAX_MISSING = 500
PHOTO_NAME = re.compile(r"^[a-f0-9]{16}\.(?:jpg|png|webp)$")
TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def sniff(data):
    """The file extension for JPEG, PNG or WebP data, or None for anything else."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        data = response.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image too large")
    return data


def allowed_url(url):
    if not isinstance(url, str):
        return False
    parts = urlsplit(url)
    return parts.scheme == "https" and parts.hostname in IMAGE_HOSTS


def _write(folder, name, data):
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".img-", suffix=".tmp")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, os.path.join(folder, name))


def _prune(folder, keep, in_use=frozenset()):
    """Deletes the least recently used files beyond `keep`, never one in `in_use`."""
    try:
        names = [n for n in os.listdir(folder) if not n.startswith(".")]
    except FileNotFoundError:
        return
    if len(names) <= keep:
        return
    names.sort(key=lambda n: os.path.getmtime(os.path.join(folder, n)))
    extra = len(names) - keep
    for name in names:
        if extra <= 0:
            break
        if name in in_use:
            continue
        try:
            os.remove(os.path.join(folder, name))
            extra -= 1
        except OSError:
            log.warning("Couldn't remove %s", name, exc_info=True)


def _read(path):
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None
    try:
        # Recently shown pictures are the last to be pruned.
        os.utime(path)
    except OSError:
        pass
    ext = sniff(data)
    return (data, TYPES[ext]) if ext else None


class ProductImages:
    """Product photos by barcode, fetched from Open Food Facts once and kept on the Pi."""

    def __init__(self, folder, products, fetch=fetch_bytes, now=time.monotonic):
        self._folder = folder
        self._products = products
        self._fetch = fetch
        self._now = now
        self._lock = threading.Lock()
        self._missing = OrderedDict()

    def get(self, raw_code):
        """(bytes, content type) for a barcode's picture, or None if there isn't one."""
        code = normalize_code(raw_code)
        if code is None:
            raise ValueError("That isn't a barcode.")
        path = os.path.join(self._folder, code + ".img")
        if os.path.exists(path):
            return _read(path)
        with self._lock:
            since = self._missing.get(code)
            if since is not None and self._now() - since < MISSING_SECONDS:
                return None
        try:
            url = self._products.image_url(code)
        except ProductsUnavailable:
            # Offline: say nothing now, and try again next time it's shown.
            return None
        data = None
        if allowed_url(url):
            try:
                data = self._fetch(url)
            except (OSError, ValueError):
                log.info("Couldn't fetch the picture for %s", code, exc_info=True)
        if not data or not sniff(data):
            self._mark_missing(code)
            return None
        try:
            _write(self._folder, code + ".img", data)
            _prune(self._folder, MAX_CACHED)
        except OSError:
            log.warning("Couldn't save the picture for %s", code, exc_info=True)
        return data, TYPES[sniff(data)]

    def _mark_missing(self, code):
        with self._lock:
            self._missing[code] = self._now()
            self._missing.move_to_end(code)
            while len(self._missing) > MAX_MISSING:
                self._missing.popitem(last=False)


class Photos:
    """Photos people take of things, saved under random names."""

    def __init__(self, folder, in_use=frozenset):
        self._folder = folder
        # Called before pruning: the photo names the list and catalog still use.
        self._in_use = in_use

    def save(self, data):
        if not data:
            raise ValueError("Send the photo.")
        if len(data) > MAX_PHOTO_BYTES:
            raise ValueError("That photo is too big.")
        ext = sniff(data)
        if ext is None:
            raise ValueError("Send the photo as a JPEG, PNG or WebP picture.")
        name = "%s.%s" % (uuid.uuid4().hex[:16], ext)
        _write(self._folder, name, data)
        _prune(self._folder, MAX_PHOTOS, set(self._in_use()) | {name})
        return name

    def exists(self, name):
        return isinstance(name, str) and bool(PHOTO_NAME.match(name)) and os.path.exists(os.path.join(self._folder, name))

    def read(self, name):
        if not isinstance(name, str) or not PHOTO_NAME.match(name):
            return None
        return _read(os.path.join(self._folder, name))
