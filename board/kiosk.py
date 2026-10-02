"""Leaving kiosk mode from the board's own screen (no keyboard needed)."""
import ipaddress
import logging
import subprocess

log = logging.getLogger(__name__)

# pi/kiosk.sh starts Chromium with this profile folder, so it's how we find that one window.
PROFILE_PATTERN = "--user-data-dir=.*widget-board-browser"
COMMAND_TIMEOUT_SECONDS = 5


def is_local_address(address):
    """True for requests made by the Pi itself, which is the only screen allowed to exit kiosk mode."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback


class Kiosk:
    def __init__(self, run=subprocess.run):
        self._run = run

    def is_running(self):
        return self._signal("pgrep") == 0

    def close(self):
        self._signal("pkill")

    def _signal(self, tool):
        try:
            result = self._run(
                [tool, "-f", "--", PROFILE_PATTERN],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=COMMAND_TIMEOUT_SECONDS,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            log.warning("Couldn't run %s to find the kiosk browser", tool, exc_info=True)
            return None
        return result.returncode
