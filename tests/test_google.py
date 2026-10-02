import json
import os
import stat
import tempfile
import unittest
import urllib.parse
from datetime import date
from zoneinfo import ZoneInfo

from board import google

NEW_YORK = ZoneInfo("America/New_York")


class FakeGoogle:
    """Answers the handful of Google endpoints the board uses."""

    def __init__(self):
        self.calls = []
        self.refresh_token = "refresh-1"
        self.token_error = None
        self.calendar_list = {"items": [
            {"id": "me@example.com", "summary": "Sheel", "accessRole": "owner", "primary": True},
            {"id": "work@example.com", "summary": "Work", "summaryOverride": "Day job", "accessRole": "writer"},
            {"id": "holidays@group.v", "summary": "Holidays", "accessRole": "reader"},
            {"id": "old@example.com", "summary": "Old", "accessRole": "owner", "deleted": True},
        ]}
        self.events = {"items": []}

    def __call__(self, method, url, *, headers=None, form=None, body=None):
        self.calls.append({"method": method, "url": url, "headers": headers or {}, "form": form, "body": body})
        if url == google.TOKEN_URL:
            if self.token_error:
                raise google.GoogleError(self.token_error)
            if form.get("grant_type") == "authorization_code":
                token = {"access_token": "access-1", "expires_in": 3600}
                return {**token, "refresh_token": self.refresh_token} if self.refresh_token else token
            return {"access_token": "access-2", "expires_in": 3600}
        if "/users/me/calendarList" in url:
            return self.calendar_list
        if "/events" in url and method == "GET":
            return self.events
        if "/events" in url and method == "POST":
            return {"id": "created-1", **body}
        if method == "DELETE":
            return {}
        raise AssertionError("unexpected call to %s" % url)


class GoogleAccountTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "google.json")
        self.api = FakeGoogle()
        self.clock = [1000.0]

    def tearDown(self):
        self.tmp.cleanup()

    def account(self, client_id="client-1", secret="secret-1"):
        return google.GoogleAccount(client_id, secret, self.path, transport=self.api,
                                    now=lambda: self.clock[0], clock=lambda: "2026-10-02T12:00:00")

    def linked(self):
        account = self.account()
        started = account.begin_link("http://127.0.0.1:8080/api/calendar/google/done")
        account.finish_link("code-1", started["state"])
        return account

    def test_an_account_with_no_client_is_not_configured(self):
        account = self.account(client_id=None, secret=None)
        self.assertEqual(account.status(), {"configured": False, "linked": False, "account": None,
                                            "target": None, "pending": None})
        with self.assertRaises(google.GoogleError):
            account.begin_link("http://127.0.0.1:8080/done")

    def test_begin_link_builds_a_consent_url_that_asks_for_a_lasting_sign_in(self):
        started = self.account().begin_link("http://127.0.0.1:8080/api/calendar/google/done")
        self.assertTrue(started["url"].startswith(google.AUTH_URL))
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(started["url"]).query)
        self.assertEqual(query["client_id"], ["client-1"])
        self.assertEqual(query["redirect_uri"], ["http://127.0.0.1:8080/api/calendar/google/done"])
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["prompt"], ["consent"])
        self.assertEqual(query["state"], [started["state"]])
        self.assertIn("calendar.events", query["scope"][0])

    def test_finishing_the_sign_in_saves_the_refresh_token_and_names_the_account(self):
        account = self.linked()
        status = account.status()
        self.assertTrue(status["linked"])
        self.assertEqual(status["account"], "Sheel")
        self.assertEqual(status["target"], "me@example.com")
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["refresh_token"], "refresh-1")

    def test_the_saved_sign_in_is_readable_only_by_its_owner(self):
        self.linked()
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)

    def test_a_sign_in_from_somewhere_else_or_too_late_is_refused(self):
        account = self.account()
        account.begin_link("http://127.0.0.1:8080/done")
        with self.assertRaises(google.GoogleError):
            account.finish_link("code-1", "not-the-state")

        started = account.begin_link("http://127.0.0.1:8080/done")
        self.clock[0] += google.LINK_TIMEOUT_SECONDS + 1
        with self.assertRaises(google.GoogleError):
            account.finish_link("code-1", started["state"])

    def test_google_not_sending_a_refresh_token_is_explained(self):
        self.api.refresh_token = None
        account = self.account()
        started = account.begin_link("http://127.0.0.1:8080/done")
        with self.assertRaises(google.GoogleError) as caught:
            account.finish_link("code-1", started["state"])
        self.assertIn("third-party apps", str(caught.exception))

    def test_a_saved_sign_in_survives_a_restart(self):
        self.linked()
        again = self.account()
        self.assertTrue(again.linked)
        self.assertEqual(again.status()["account"], "Sheel")

    def test_unlinking_forgets_the_token_and_the_file(self):
        account = self.linked()
        account.unlink()
        self.assertFalse(account.linked)
        self.assertFalse(os.path.exists(self.path))

    def test_calendars_names_overrides_access_and_skips_deleted_ones(self):
        calendars = self.linked().calendars()
        self.assertEqual([c["name"] for c in calendars], ["Sheel", "Day job", "Holidays"])
        self.assertEqual([c["writable"] for c in calendars], [True, True, False])
        self.assertEqual([c["primary"] for c in calendars], [True, False, False])

    def test_events_asks_google_to_expand_repeating_events(self):
        account = self.linked()
        account.events("me@example.com", date(2026, 10, 2), date(2027, 1, 30))
        url = self.api.calls[-1]["url"]
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertIn("/calendars/me%40example.com/events", url)
        self.assertEqual(query["singleEvents"], ["true"])
        self.assertEqual(query["orderBy"], ["startTime"])
        self.assertTrue(query["timeMin"][0].startswith("2026-10-02"))
        self.assertTrue(query["timeMax"][0].startswith("2027-01-31"))

    def test_the_access_token_is_reused_until_it_is_nearly_out_of_time(self):
        account = self.linked()
        account.calendars()
        account.calendars()
        token_calls = [c for c in self.api.calls if c["url"] == google.TOKEN_URL]
        self.assertEqual(len(token_calls), 1)  # just the one from signing in
        self.assertEqual(self.api.calls[-1]["headers"]["Authorization"], "Bearer access-1")

        self.clock[0] += 3600
        account.calendars()
        self.assertEqual(self.api.calls[-1]["headers"]["Authorization"], "Bearer access-2")

    def test_a_rejected_call_is_tried_once_more_with_a_fresh_token(self):
        account = self.linked()
        calls = {"n": 0}
        original = self.api.__call__

        def flaky(method, url, **kwargs):
            if "calendarList" in url:
                calls["n"] += 1
                if calls["n"] == 1:
                    raise google.GoogleError("Google turned the board away.")
            return original(method, url, **kwargs)

        account._transport = flaky
        self.assertEqual([c["name"] for c in account.calendars()][0], "Sheel")
        self.assertEqual(calls["n"], 2)

    def test_using_an_account_that_was_never_linked_says_so(self):
        with self.assertRaises(google.GoogleError) as caught:
            self.account().calendars()
        self.assertIn("Connect a Google account", str(caught.exception))


class ShapeTest(unittest.TestCase):
    def test_a_timed_event_comes_back_as_local_wall_clock(self):
        shaped = google.shape_event({
            "id": "e1", "summary": "Dentist", "location": "Dr Patel", "description": "Bring the letter",
            "start": {"dateTime": "2026-10-20T13:00:00Z"},
            "end": {"dateTime": "2026-10-20T13:45:00Z"},
        }, NEW_YORK)
        self.assertEqual(shaped["date"], "2026-10-20")
        self.assertEqual((shaped["time"], shaped["end_time"]), ("09:00", "09:45"))
        self.assertEqual((shaped["days"], shaped["location"], shaped["description"]), (1, "Dr Patel", "Bring the letter"))

    def test_an_all_day_event_counts_its_days_from_google_s_exclusive_end(self):
        shaped = google.shape_event({"id": "h1", "summary": "Trip", "start": {"date": "2026-10-10"},
                                     "end": {"date": "2026-10-13"}}, NEW_YORK)
        self.assertEqual((shaped["time"], shaped["days"]), (None, 3))

    def test_events_without_a_start_or_a_title_are_handled(self):
        self.assertIsNone(google.shape_event({"id": "x", "start": {}}, NEW_YORK))
        self.assertEqual(google.shape_event({"id": "x", "start": {"date": "2026-10-10"}}, NEW_YORK)["title"],
                         "(No title)")

    def test_event_body_sends_a_timed_event_with_the_board_s_zone(self):
        body = google.event_body({"title": "Call", "date": "2026-10-20", "time": "15:00", "endTime": "15:30",
                                  "location": None, "description": None}, "Europe/London")
        self.assertEqual(body, {
            "summary": "Call",
            "start": {"dateTime": "2026-10-20T15:00:00", "timeZone": "Europe/London"},
            "end": {"dateTime": "2026-10-20T15:30:00", "timeZone": "Europe/London"},
        })

    def test_event_body_gives_a_timed_event_without_an_end_an_hour(self):
        body = google.event_body({"title": "Call", "date": "2026-10-20", "time": "15:00"}, "UTC")
        self.assertEqual(body["end"]["dateTime"], "2026-10-20T16:00:00")

    def test_event_body_turns_the_last_day_into_google_s_exclusive_end(self):
        body = google.event_body({"title": "Trip", "date": "2026-10-10", "endDate": "2026-10-12"}, "UTC")
        self.assertEqual((body["start"], body["end"]), ({"date": "2026-10-10"}, {"date": "2026-10-13"}))


if __name__ == "__main__":
    unittest.main()
