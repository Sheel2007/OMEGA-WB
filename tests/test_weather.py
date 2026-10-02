import unittest
from urllib.parse import parse_qs, urlsplit

from board.weather import CACHE_SECONDS, RETRY_SECONDS, STALE_LIMIT_SECONDS, WeatherService, WeatherUnavailable

SAMPLE = {
    "current": {"time": "2026-10-01T14:00", "temperature_2m": 21.6, "weather_code": 2, "is_day": 1},
    "daily": {
        "time": ["2026-10-01", "2026-10-02", "2026-10-03"],
        "weather_code": [2, 61, 0],
        "temperature_2m_max": [23.4, 18.5, 20.0],
        "temperature_2m_min": [14.2, 12.6, 11.4],
        "precipitation_probability_max": [10, 80, None],
    },
}


class FakeFetch:
    def __init__(self, response=SAMPLE):
        self.response = response
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class WeatherServiceTest(unittest.TestCase):
    def setUp(self):
        self.fetch = FakeFetch()
        self.clock = FakeClock()
        self.weather = WeatherService({"latitude": 40.71, "longitude": -74.01}, "fahrenheit", fetch=self.fetch, now=self.clock)

    def test_without_a_location_explains_how_to_set_one(self):
        weather = WeatherService(None, fetch=self.fetch)
        with self.assertRaises(WeatherUnavailable) as caught:
            weather.forecast()
        self.assertIn("config.json", str(caught.exception))
        self.assertEqual(self.fetch.urls, [])

    def test_asks_open_meteo_for_this_place_in_the_chosen_unit(self):
        self.weather.forecast()
        query = parse_qs(urlsplit(self.fetch.urls[0]).query)
        self.assertEqual(query["latitude"], ["40.71"])
        self.assertEqual(query["longitude"], ["-74.01"])
        self.assertEqual(query["temperature_unit"], ["fahrenheit"])
        self.assertEqual(query["timezone"], ["auto"])

    def test_shapes_the_forecast_for_the_board(self):
        result = self.weather.forecast()
        self.assertEqual(result["unit"], "F")
        self.assertEqual(result["current"], {"temperature": 22, "code": 2, "is_day": True})
        self.assertEqual(
            result["daily"][1],
            {"date": "2026-10-02", "code": 61, "high": 19, "low": 13, "precipitation": 80},
        )
        self.assertIsNone(result["daily"][2]["precipitation"])
        self.assertFalse(result["stale"])

    def test_reuses_the_forecast_until_it_is_old(self):
        self.weather.forecast()
        self.clock.now += CACHE_SECONDS - 1
        self.weather.forecast()
        self.assertEqual(len(self.fetch.urls), 1)
        self.clock.now += 2
        self.weather.forecast()
        self.assertEqual(len(self.fetch.urls), 2)

    def test_keeps_showing_the_last_forecast_when_a_refresh_fails(self):
        self.weather.forecast()
        self.fetch.response = OSError("offline")
        self.clock.now += CACHE_SECONDS + 1
        result = self.weather.forecast()
        self.assertTrue(result["stale"])
        self.assertEqual(result["current"]["temperature"], 22)

    def test_gives_up_on_a_forecast_that_is_too_old(self):
        self.weather.forecast()
        self.fetch.response = OSError("offline")
        self.clock.now += STALE_LIMIT_SECONDS + 1
        with self.assertRaises(WeatherUnavailable):
            self.weather.forecast()

    def test_waits_before_retrying_after_a_failure(self):
        self.fetch.response = OSError("offline")
        with self.assertRaises(WeatherUnavailable):
            self.weather.forecast()
        self.clock.now += RETRY_SECONDS - 1
        with self.assertRaises(WeatherUnavailable):
            self.weather.forecast()
        self.assertEqual(len(self.fetch.urls), 1)
        self.fetch.response = SAMPLE
        self.clock.now += 2
        self.assertEqual(self.weather.forecast()["current"]["code"], 2)

    def test_a_malformed_response_counts_as_a_failure(self):
        self.fetch.response = {"current": {}}
        with self.assertRaises(WeatherUnavailable):
            self.weather.forecast()

    def test_celsius_is_the_default_unit(self):
        weather = WeatherService({"latitude": 1, "longitude": 2}, fetch=self.fetch, now=self.clock)
        self.assertEqual(weather.forecast()["unit"], "C")

    def test_rejects_an_unknown_unit(self):
        with self.assertRaises(ValueError):
            WeatherService({"latitude": 1, "longitude": 2}, "kelvin")


if __name__ == "__main__":
    unittest.main()
