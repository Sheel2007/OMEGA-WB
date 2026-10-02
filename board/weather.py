"""Weather for the board, from Open-Meteo (free, no API key), cached so every screen shares one request."""
import json
import logging
import math
import threading
import time
import urllib.request
from urllib.parse import urlencode

from .store import utc_now

log = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 5
FETCH_TIMEOUT_SECONDS = 10
CACHE_SECONDS = 15 * 60
# After a failed request, don't try again for a while (the Pi may be offline).
RETRY_SECONDS = 2 * 60
# An old forecast is better than none, up to a point.
STALE_LIMIT_SECONDS = 6 * 60 * 60
UNITS = {"celsius": "C", "fahrenheit": "F"}


class WeatherUnavailable(Exception):
    pass


def degrees(value):
    # round() goes to the nearest even number (18.5 -> 18); forecasts round halves up.
    return math.floor(value + 0.5)


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "WidgetBoard/1.0"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return json.load(response)


class WeatherService:
    def __init__(self, location, unit="celsius", fetch=fetch_json, now=time.monotonic):
        if unit not in UNITS:
            raise ValueError("Weather unit must be 'celsius' or 'fahrenheit', not %r." % unit)
        self._location = location
        self._unit = unit
        self._fetch = fetch
        self._now = now
        self._lock = threading.Lock()
        self._cached = None
        self._cached_at = None
        self._failed_at = None

    def forecast(self):
        if not self._location:
            raise WeatherUnavailable("Add your latitude and longitude to config.json to see the weather.")
        with self._lock:
            now = self._now()
            if self._cached is not None and now - self._cached_at < CACHE_SECONDS:
                return dict(self._cached, stale=False)
            if self._failed_at is None or now - self._failed_at >= RETRY_SECONDS:
                try:
                    self._cached = self._shape(self._fetch(self._url()))
                    self._cached_at = now
                    self._failed_at = None
                    return dict(self._cached, stale=False)
                except (OSError, ValueError, KeyError, TypeError, IndexError):
                    log.warning("Couldn't refresh the weather", exc_info=True)
                    self._failed_at = now
            if self._cached is not None and now - self._cached_at < STALE_LIMIT_SECONDS:
                return dict(self._cached, stale=True)
            raise WeatherUnavailable("Can't reach the weather service right now.")

    def _url(self):
        return "%s?%s" % (FORECAST_URL, urlencode({
            "latitude": self._location["latitude"],
            "longitude": self._location["longitude"],
            "current": "temperature_2m,weather_code,is_day",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "temperature_unit": self._unit,
            "timezone": "auto",
            "forecast_days": FORECAST_DAYS,
        }))

    def _shape(self, data):
        current = data["current"]
        daily = data["daily"]
        days = [
            {
                "date": daily["time"][i],
                "code": int(daily["weather_code"][i]),
                "high": degrees(daily["temperature_2m_max"][i]),
                "low": degrees(daily["temperature_2m_min"][i]),
                "precipitation": daily["precipitation_probability_max"][i],
            }
            for i in range(len(daily["time"]))
        ]
        if not days:
            raise ValueError("forecast has no days")
        return {
            "unit": UNITS[self._unit],
            "current": {
                "temperature": degrees(current["temperature_2m"]),
                "code": int(current["weather_code"]),
                "is_day": bool(current["is_day"]),
            },
            "daily": days,
            "updated": utc_now(),
        }
