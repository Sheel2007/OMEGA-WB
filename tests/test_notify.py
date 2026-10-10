import io
import json
import smtplib
import unittest
import urllib.error
import urllib.parse

from board.notify import Notifier, settings_from, shorten

EMAIL = {"host": "smtp.example.com", "port": 587, "from": "Board <board@example.com>", "username": "board", "password": "pw"}
SMS = {"account_sid": "AC" + "0" * 32, "auth_token": "token", "from": "+15550001111"}


def message(**fields):
    return {"email": None, "phone": None, "subject": "Game night", "text": "Long text", "short": "Short text", **fields}


class FakeSmtp:
    instances = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port
        self.sent, self.logins, self.tls = [], [], False
        FakeSmtp.instances.append(self)

    def ehlo(self):
        pass

    def has_extn(self, name):
        return name == "starttls"

    def starttls(self, context=None):
        self.tls = True

    def login(self, user, password):
        self.logins.append((user, password))

    def send_message(self, msg):
        if msg["To"] == "bounce@example.com":
            raise smtplib.SMTPRecipientsRefused({})
        self.sent.append(msg)

    def quit(self):
        pass


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class SettingsTest(unittest.TestCase):
    def test_nothing_set_up_is_fine(self):
        self.assertEqual(settings_from(None), {"email": None, "sms": None, "country_code": "1"})

    def test_reads_email_and_texts(self):
        settings = settings_from({"email": EMAIL, "sms": SMS, "country_code": "+44"})
        self.assertEqual(settings["email"]["host"], "smtp.example.com")
        self.assertEqual(settings["sms"]["from"], "+15550001111")
        self.assertEqual(settings["country_code"], "44")

    def test_mistakes_turn_a_channel_off(self):
        with self.assertLogs("board.notify", "WARNING"):
            self.assertIsNone(settings_from({"email": {"host": "smtp.example.com", "from": "nobody"}})["email"])
        with self.assertLogs("board.notify", "WARNING"):
            self.assertIsNone(settings_from({"sms": {**SMS, "from": "555"}})["sms"])


class NotifierTest(unittest.TestCase):
    def setUp(self):
        FakeSmtp.instances = []
        self.requests = []

    def urlopen(self, request, timeout=None):
        self.requests.append(request)
        if b"%2B19999999999" in request.data:
            raise urllib.error.HTTPError(request.full_url, 400, "Bad", {}, io.BytesIO(json.dumps(
                {"message": "The 'To' number is not a valid phone number."}).encode()))
        return FakeResponse(b"{}")

    def notifier(self, email=EMAIL, sms=SMS):
        return Notifier(email, sms, smtp=FakeSmtp, smtp_ssl=FakeSmtp, urlopen=self.urlopen)

    def test_emails_go_out_over_one_secure_connection(self):
        outcome = self.notifier(sms=None).deliver([message(email="a@example.com"), message(email="b@example.com")])
        self.assertEqual(outcome, {"sent": 2, "failed": 0, "problem": None})
        server = FakeSmtp.instances[0]
        self.assertTrue(server.tls)
        self.assertEqual(server.logins, [("board", "pw")])
        self.assertEqual([m["To"] for m in server.sent], ["a@example.com", "b@example.com"])
        self.assertEqual(server.sent[0]["Subject"], "Game night")

    def test_texts_go_to_twilio(self):
        outcome = self.notifier(email=None).deliver([message(phone="+15551234567")])
        self.assertEqual(outcome["sent"], 1)
        request = self.requests[0]
        self.assertEqual(request.full_url, "https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json" % SMS["account_sid"])
        self.assertTrue(request.headers["Authorization"].startswith("Basic "))
        form = urllib.parse.parse_qs(request.data.decode())
        self.assertEqual(form, {"To": ["+15551234567"], "From": ["+15550001111"], "Body": ["Short text"]})

    def test_problems_are_counted_and_explained(self):
        outcome = self.notifier().deliver([
            message(email="a@example.com", phone="+19999999999"),
            message(email="bounce@example.com"),
            message(phone="+15551234567"),
        ])
        self.assertEqual(outcome["sent"], 2, "the first roommate still got the email")
        self.assertEqual(outcome["failed"], 1)
        self.assertIn("Check the address", outcome["problem"])

    def test_twilio_explains_a_bad_number(self):
        outcome = self.notifier(email=None).deliver([message(phone="+19999999999")])
        self.assertEqual(outcome["failed"], 1)
        self.assertIn("not a valid phone number", outcome["problem"])

    def test_a_roommate_with_nothing_usable_is_reported(self):
        outcome = self.notifier(sms=None).deliver([message(phone="+15551234567")])
        self.assertEqual(outcome, {"sent": 0, "failed": 1, "problem": "Some roommates have no email or phone the board can use."})

    def test_long_texts_are_cut_short(self):
        self.assertEqual(len(shorten("x" * 500)), 320)
        self.assertEqual(shorten("short"), "short")


if __name__ == "__main__":
    unittest.main()
