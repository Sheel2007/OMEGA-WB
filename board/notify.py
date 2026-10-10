"""Texts and emails from the board: email over SMTP, texts through Twilio's REST API.

Standard library only (smtplib and urllib), like the rest of the server. Both are
optional and set up in config.json under "roommate_games"; with neither, the board
still works and people share the link from the app instead.
"""
import base64
import json
import logging
import re
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import parseaddr

log = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 20
SMS_TIMEOUT_SECONDS = 15
TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json"
# Twilio splits longer texts into several (and bills each); the board keeps to two.
MAX_SMS_LENGTH = 320
ACCOUNT_SID = re.compile(r"^AC[0-9a-fA-F]{32}$")
E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def settings_from(raw):
    """Reads the email and text settings under "roommate_games" in config.json.

    Returns {"email": {...} or None, "sms": {...} or None, "country_code": "1"}.
    Anything that doesn't make sense is logged and left out, so a typo turns that
    channel off rather than stopping the board.
    """
    raw = raw if isinstance(raw, dict) else {}
    country = str(raw.get("country_code", "1")).lstrip("+")
    if not country.isdigit() or not 1 <= len(country) <= 3:
        log.warning("Ignoring 'country_code' in config.json: it should be digits, like \"1\" or \"44\".")
        country = "1"
    return {"email": _email_settings(raw.get("email")), "sms": _sms_settings(raw.get("sms")), "country_code": country}


def _email_settings(raw):
    if not raw:
        return None
    if not isinstance(raw, dict):
        log.warning("Ignoring 'roommate_games.email' in config.json: it should be an object.")
        return None
    host, port = raw.get("host"), raw.get("port", 587)
    sender = raw.get("from") or raw.get("username")
    if not (isinstance(host, str) and host.strip()):
        log.warning("Ignoring 'roommate_games.email' in config.json: 'host' must be the SMTP server, like smtp.gmail.com.")
        return None
    if not (isinstance(port, int) and 0 < port < 65536):
        log.warning("Ignoring 'roommate_games.email' in config.json: 'port' must be a port number.")
        return None
    if not (isinstance(sender, str) and "@" in parseaddr(sender)[1]):
        log.warning("Ignoring 'roommate_games.email' in config.json: 'from' must be an email address.")
        return None
    username, password = raw.get("username"), raw.get("password")
    return {
        "host": host.strip(),
        "port": port,
        "from": sender.strip(),
        "username": username if isinstance(username, str) and username else None,
        "password": password if isinstance(password, str) else None,
    }


def _sms_settings(raw):
    if not raw:
        return None
    if not isinstance(raw, dict):
        log.warning("Ignoring 'roommate_games.sms' in config.json: it should be an object.")
        return None
    sid, token, sender = raw.get("account_sid"), raw.get("auth_token"), raw.get("from")
    if not (isinstance(sid, str) and ACCOUNT_SID.match(sid)):
        log.warning("Ignoring 'roommate_games.sms' in config.json: 'account_sid' should start with AC.")
        return None
    if not (isinstance(token, str) and token):
        log.warning("Ignoring 'roommate_games.sms' in config.json: 'auth_token' is missing.")
        return None
    if not (isinstance(sender, str) and E164.match(sender)):
        log.warning("Ignoring 'roommate_games.sms' in config.json: 'from' must be a number like +15551234567.")
        return None
    return {"account_sid": sid, "auth_token": token, "from": sender}


def shorten(text, limit=MAX_SMS_LENGTH):
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


class Notifier:
    """Delivers one message to each roommate, by email and/or text, whichever is set up."""

    def __init__(self, email=None, sms=None, *, smtp=smtplib.SMTP, smtp_ssl=smtplib.SMTP_SSL,
                 urlopen=urllib.request.urlopen):
        self._email = email
        self._sms = sms
        self._smtp = smtp
        self._smtp_ssl = smtp_ssl
        self._urlopen = urlopen

    @property
    def channels(self):
        return {"email": self._email is not None, "sms": self._sms is not None}

    def deliver(self, messages):
        """Sends each message ({"email", "phone", "subject", "text", "short"}).

        Returns {"sent": people reached, "failed": people missed, "problem": the first
        thing that went wrong, worded for people}. Never raises.
        """
        reached, missed, problems = set(), set(), []
        emails = [(i, m) for i, m in enumerate(messages) if self._email and m.get("email")]
        if emails:
            ok, problem = self._send_emails([m for _, m in emails])
            for (index, _), sent in zip(emails, ok):
                (reached if sent else missed).add(index)
            if problem:
                problems.append(problem)
        for index, message in enumerate(messages):
            if not (self._sms and message.get("phone")):
                continue
            problem = self._send_text(message["phone"], message["short"])
            if problem:
                missed.add(index)
                problems.append(problem)
            else:
                reached.add(index)
        unreachable = [i for i in range(len(messages)) if i not in reached and i not in missed]
        if unreachable and not problems:
            problems.append("Some roommates have no email or phone the board can use.")
        return {
            "sent": len(reached),
            "failed": len(set(range(len(messages))) - reached),
            "problem": problems[0] if problems else None,
        }

    # Email

    def _send_emails(self, messages):
        """One connection for everyone. Returns ([sent?] per message, problem or None)."""
        settings = self._email
        try:
            if settings["port"] == 465:
                server = self._smtp_ssl(settings["host"], settings["port"], timeout=SMTP_TIMEOUT_SECONDS,
                                        context=ssl.create_default_context())
            else:
                server = self._smtp(settings["host"], settings["port"], timeout=SMTP_TIMEOUT_SECONDS)
        except (OSError, smtplib.SMTPException) as err:
            log.warning("Roommate Games: couldn't reach the email server: %s", err)
            return [False] * len(messages), "Couldn't reach the email server (%s)." % settings["host"]
        results, problem = [], None
        try:
            server.ehlo()
            if settings["port"] != 465 and server.has_extn("starttls"):
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            if settings["username"]:
                server.login(settings["username"], settings["password"] or "")
            for message in messages:
                try:
                    server.send_message(self._email_message(message))
                    results.append(True)
                except (smtplib.SMTPException, ValueError) as err:
                    log.warning("Roommate Games: an email didn't send: %s", err)
                    results.append(False)
                    problem = problem or "An email didn't send. Check the address."
        except smtplib.SMTPAuthenticationError:
            problem = "The email server didn't accept the username and password in config.json."
        except (OSError, smtplib.SMTPException) as err:
            log.warning("Roommate Games: sending email failed: %s", err)
            problem = "Sending email failed (%s)." % type(err).__name__
        finally:
            try:
                server.quit()
            except (OSError, smtplib.SMTPException):
                pass
        results += [False] * (len(messages) - len(results))
        return results, problem

    def _email_message(self, message):
        email = EmailMessage()
        email["From"] = self._email["from"]
        email["To"] = message["email"]
        email["Subject"] = message["subject"]
        email.set_content(message["text"])
        return email

    # Texts

    def _send_text(self, phone, body):
        """Returns None once Twilio has the text, or what went wrong."""
        settings = self._sms
        data = urllib.parse.urlencode({"To": phone, "From": settings["from"], "Body": shorten(body)}).encode()
        login = base64.b64encode(("%s:%s" % (settings["account_sid"], settings["auth_token"])).encode()).decode()
        request = urllib.request.Request(
            TWILIO_URL % settings["account_sid"],
            data=data,
            method="POST",
            headers={"Authorization": "Basic " + login, "Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with self._urlopen(request, timeout=SMS_TIMEOUT_SECONDS) as response:
                response.read()
            return None
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8")).get("message")
            except (ValueError, AttributeError, OSError):
                detail = None
            log.warning("Roommate Games: Twilio refused a text (%s): %s", err.code, detail)
            return "A text didn't send: %s" % (detail or "Twilio said %d." % err.code)
        except (OSError, ValueError) as err:
            log.warning("Roommate Games: couldn't reach Twilio: %s", err)
            return "Couldn't reach Twilio to send texts."
