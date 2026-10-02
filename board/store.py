"""Shared plumbing for the board's data: JSON-file stores and a change feed."""
import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# Removed entries are kept in memory (not on disk) so "Undo" can put them back.
MAX_TRASH = 100


class ValidationError(ValueError):
    pass


class NotFound(LookupError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def tidy_text(raw, *, max_length, empty_message, too_long_message):
    if not isinstance(raw, str):
        raise ValidationError("Text must be a string.")
    text = " ".join(raw.split())
    if not text:
        raise ValidationError(empty_message)
    if len(text) > max_length:
        raise ValidationError(too_long_message)
    return text


class ChangeFeed:
    """Lets one event stream sleep until any store changes."""

    def __init__(self):
        self._cond = threading.Condition()
        self._seq = 0

    @property
    def seq(self):
        with self._cond:
            return self._seq

    def notify(self):
        with self._cond:
            self._seq += 1
            self._cond.notify_all()

    def wait(self, seq, timeout):
        with self._cond:
            self._cond.wait_for(lambda: self._seq != seq, timeout=timeout)
            return self._seq

    def wake(self):
        with self._cond:
            self._cond.notify_all()


class JsonStore:
    """In-memory state guarded by a lock, saved atomically to a JSON file on every change.

    Subclasses implement _state(), _to_disk(), _from_disk(data) and _reset().
    """

    label = "data"

    def __init__(self, path=None, clock=utc_now, feed=None):
        self._path = path
        self._clock = clock
        self._feed = feed
        self._changed = threading.Condition()
        self._version = 0
        self._trash = {}
        self._reset()
        self._load()

    # Reads

    def snapshot(self):
        with self._changed:
            return self._state()

    def wait_for_change(self, version, timeout):
        with self._changed:
            self._changed.wait_for(lambda: self._version != version, timeout=timeout)
            return self._state()

    def wake_waiters(self):
        with self._changed:
            self._changed.notify_all()

    # For subclasses (call with self._changed held)

    def _commit(self):
        self._version += 1
        self._save()
        self._changed.notify_all()
        if self._feed is not None:
            self._feed.notify()

    def _discard(self, index, entry):
        self._trash[entry["id"]] = (index, entry)
        while len(self._trash) > MAX_TRASH:
            self._trash.pop(next(iter(self._trash)))

    def _take_from_trash(self, ids, present):
        """Pops the requested trashed entries, oldest position first, as (index, entry) pairs."""
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValidationError("'ids' must be a list of ids.")
        wanted = [i for i in ids if i in self._trash and i not in present]
        return sorted((self._trash.pop(i) for i in wanted), key=lambda pair: pair[0])

    # Disk

    def _save(self):
        if not self._path:
            return
        data = dict(self._to_disk(), version=self._version)
        folder = os.path.dirname(os.path.abspath(self._path))
        try:
            os.makedirs(folder, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=folder, prefix=".%s-" % self.label, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._path)
        except OSError:
            log.exception("Could not save the %s to %s", self.label, self._path)

    def _load(self):
        if not self._path or not os.path.exists(self._path):
            return
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            self._version = int(data.get("version", 0))
            self._from_disk(data)
        except (ValueError, TypeError, KeyError, AttributeError):
            backup = "%s.corrupt-%s" % (self._path, datetime.now().strftime("%Y%m%d%H%M%S"))
            os.replace(self._path, backup)
            log.warning("The %s file was unreadable; moved it to %s and started fresh", self.label, backup)
            self._version = 0
            self._reset()
