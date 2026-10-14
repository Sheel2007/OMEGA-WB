"""The board's own monitor: switched off when nobody's around, and on again for motion or a tap.

Only the picture goes. The Pi, the board server and Chromium keep running, so the
board is there the moment the screen comes back. The server runs as a systemd
service without the desktop's environment, so it finds the desktop session itself:

- Wayland (Raspberry Pi OS since Bookworm, labwc or Wayfire): `wlopm`, which asks the
  compositor to power the outputs down, as the desktop's own screen blanking does.
- X11 (older Raspberry Pi OS): `xset dpms force off`.

`"screen": {"off": "...", "on": "..."}` in config.json runs other commands instead,
and `"screen": false` turns this off.
"""
import logging
import os
import shlex
import shutil
import subprocess
import threading
import time
from collections import namedtuple

log = logging.getLogger(__name__)

COMMAND_TIMEOUT_SECONDS = 5
# How long the test button leaves the screen off.
TEST_SECONDS = 5
# The desktop may start (or stop) after the server, so it's looked for again this often.
FIND_EVERY_SECONDS = 30

Method = namedtuple("Method", "name env off on")


def settings_from(raw):
    """Reads the `screen` setting: {} to find the desktop's own way, commands of your own, or None for off."""
    if raw is False:
        return None
    if raw is None or raw is True:
        return {}
    if not isinstance(raw, dict):
        log.warning("Ignoring 'screen' in config.json: it should be an object like {\"off\": \"...\", \"on\": \"...\"}.")
        return {}
    off, on = raw.get("off"), raw.get("on")
    if off is None and on is None:
        return {}
    if not (isinstance(off, str) and off.strip() and isinstance(on, str) and on.strip()):
        log.warning("Ignoring 'screen' in config.json: it needs both an 'off' and an 'on' command.")
        return {}
    return {"off": shlex.split(off), "on": shlex.split(on)}


def _wayland_socket(runtime_dir, listdir):
    try:
        names = sorted(listdir(runtime_dir))
    except OSError:
        return None
    return next((n for n in names if n.startswith("wayland-") and not n.endswith(".lock")), None)


def find_method(settings=None, *, which=shutil.which, environ=os.environ, listdir=os.listdir,
                exists=os.path.exists, uid=None):
    """How to switch the screen off here: (Method, None), or (None, what's missing in words)."""
    runtime = environ.get("XDG_RUNTIME_DIR") or "/run/user/%d" % (os.getuid() if uid is None else uid)
    env = dict(environ, XDG_RUNTIME_DIR=runtime)
    if settings and settings.get("off"):
        return Method("your commands", env, [settings["off"]], [settings["on"]]), None
    wayland = environ.get("WAYLAND_DISPLAY") or _wayland_socket(runtime, listdir)
    if wayland:
        if not which("wlopm"):
            return None, "The Pi's desktop needs wlopm to switch the screen off. Run: sudo apt install wlopm"
        return Method("wlopm", dict(env, WAYLAND_DISPLAY=wayland), [["wlopm", "--off", "*"]], [["wlopm", "--on", "*"]]), None
    display = environ.get("DISPLAY") or (":0" if exists("/tmp/.X11-unix/X0") else None)
    if display and which("xset"):
        env = dict(env, DISPLAY=display)
        env.setdefault("XAUTHORITY", os.path.join(os.path.expanduser("~"), ".Xauthority"))
        # DPMS is left off while the screen's on, so the desktop doesn't blank it by itself.
        return Method("xset", env, [["xset", "+dpms"], ["xset", "dpms", "force", "off"]],
                      [["xset", "dpms", "force", "on"], ["xset", "-dpms"]]), None
    return None, "No desktop to switch off was found. On the Pi, check the board is open on its screen."


class Screen:
    """Switches the monitor off and on, one command at a time.

    `on_change()` is called after the screen changes (or a test starts or ends), so
    screens can be told. Never call set() or test() while holding a lock on_change takes.
    """

    def __init__(self, settings=None, *, run=subprocess.run, find=find_method, clock=time.monotonic):
        self._settings = settings or {}
        self._run = run
        self._find = find
        self._clock = clock
        self._busy = threading.Lock()
        self._stop = threading.Event()
        self._on = True
        self._testing = False
        self._error = None
        self._found = None  # (when, (method, problem))
        self.on_change = None

    @property
    def on(self):
        return self._on

    def status(self):
        method, problem = self._method()
        return {
            "on": self._on,
            "testing": self._testing,
            # "wlopm", "xset" or "your commands"; None when the screen can't be switched here.
            "method": method.name if method else None,
            "problem": problem,
            # Why the last try failed, until one works.
            "error": self._error,
        }

    def start(self):
        """Makes sure the screen is on, in case the board restarted while it was off."""
        if self._method()[0] is not None:
            self.set(True)

    def stop(self):
        self._stop.set()

    def set(self, on):
        """Switches the screen on or off. True if it worked."""
        with self._busy:
            return self._apply(on)

    def test(self, seconds=TEST_SECONDS):
        """Switches the screen off for a few seconds, then on again. True if both worked."""
        with self._busy:
            self._testing = True
            self._changed()
            try:
                if not self._apply(False):
                    return False
                self._stop.wait(seconds)
                return self._apply(True)
            finally:
                self._testing = False
                self._changed()

    def _method(self):
        now = self._clock()
        if self._found is None or now - self._found[0] >= FIND_EVERY_SECONDS:
            self._found = (now, self._find(self._settings))
        return self._found[1]

    def _apply(self, on):
        self._found = None  # look again: the desktop may have just started
        method, problem = self._method()
        if method is None:
            return self._fail(problem)
        word = "on" if on else "off"
        for argv in method.on if on else method.off:
            try:
                result = self._run(argv, env=method.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   text=True, timeout=COMMAND_TIMEOUT_SECONDS, check=False)
            except (OSError, subprocess.SubprocessError) as err:
                return self._fail("Couldn't run %s to switch the screen %s: %s" % (argv[0], word, err))
            if result.returncode != 0:
                said = (result.stderr or "").strip().splitlines()
                return self._fail("%s couldn't switch the screen %s: %s" % (
                    argv[0], word, said[0] if said else "exit code %d" % result.returncode))
        self._error = None
        if self._on != on:
            log.info("Screen: switched %s with %s", word, method.name)
        self._on = on
        self._changed()
        return True

    def _fail(self, message):
        if message != self._error:
            log.warning("Screen: %s", message)
        self._error = message
        self._changed()
        return False

    def _changed(self):
        if self.on_change is not None:
            self.on_change()
