"""Texts people when something goes on the grocery list.

Anyone can sign up for these in the Grocery app with their name, number and carrier.
The texts go through the carrier's email-to-text gateway: an email to
5551234567@tmomail.net arrives on that T-Mobile phone as a text. So they cost
nothing and need no texting account, only an SMTP account to send the email from
(board/notify.py). Whoever added the items isn't texted about them.

Adds are gathered until the list has been quiet for a minute (five minutes at
most), so scanning a basket of things sends one text rather than ten, and anything
taken off the list or bought before then is left out. Someone who signs up gets a
welcome text straight away, which shows their carrier is passing the texts on.
"""
import logging
import re
import threading
import time

from .notify import shorten

log = logging.getLogger(__name__)

# The carriers whose gateways still take email: id → (name, gateway). AT&T closed theirs in 2025.
CARRIERS = {
    "tmobile": ("T-Mobile", "tmomail.net"),
    "verizon": ("Verizon", "vtext.com"),
    "googlefi": ("Google Fi", "msg.fi.google.com"),
}
# Sent once the list has been quiet this long, or this long after the first add.
QUIET_SECONDS = 60
LONGEST_WAIT_SECONDS = 300
# One text's worth. Longer ones can arrive split or cut off.
MAX_TEXT = 160
# The list holds at most 200 items, so this is never reached by honest use.
MAX_PENDING = 200
MAX_WELCOMES = 20
WELCOME = "You'll get a text here when someone adds to the grocery list."
US_NUMBER = re.compile(r"^\+1(\d{10})$")


def gateway_address(phone, carrier):
    """Where to email a US number (+15551234567) on `carrier` so it arrives as a text, or None."""
    match = US_NUMBER.match(phone or "")
    if not match or carrier not in CARRIERS:
        return None
    return "%s@%s" % (match.group(1), CARRIERS[carrier][1])


def name_key(name):
    return " ".join((name or "").split()).casefold()


def _join(names, hidden=0):
    if hidden:
        return "%s and %d more" % (", ".join(names), hidden)
    if len(names) == 1:
        return names[0]
    return "%s and %s" % (", ".join(names[:-1]), names[-1])


def _sentence(by, names, hidden=0):
    if by:
        return "%s added %s to the grocery list." % (by, _join(names, hidden))
    return "Added to the grocery list: %s." % _join(names, hidden)


def summary(entries, limit=MAX_TEXT):
    """One text for `entries` ({"name", "by"}): who added what, oldest first, or None.

    When it would run long, the biggest groups list a few names and "and 3 more".
    """
    groups = {}
    for entry in entries:
        # "Noah" and "noah" are one person, shown as they first typed it.
        by, names = groups.setdefault(name_key(entry["by"]), (entry["by"], []))
        if all(name_key(n) != name_key(entry["name"]) for n in names):
            names.append(entry["name"])
    if not groups:
        return None
    shown = {key: len(names) for key, (_, names) in groups.items()}

    def text():
        return " ".join(_sentence(by, names[:shown[key]], len(names) - shown[key])
                        for key, (by, names) in groups.items())

    while len(text()) > limit and any(count > 1 for count in shown.values()):
        biggest = max(shown, key=lambda by: shown[by])
        shown[biggest] -= 1
    return shorten(text(), limit)


def _message(address, text):
    # No subject: a gateway puts it in the text.
    return {"email": address, "phone": None, "subject": "", "text": text, "short": text}


class GroceryTexts:
    """Gathers what's been added to the list and texts it out on its own thread."""

    def __init__(self, notifier, *, recipients, still_wanted=None, clock=time.monotonic):
        self._notifier = notifier
        # Everyone signed up: [{"name", "phone", "carrier"}] (GroceryList.texting_book).
        self._recipients = recipients
        # Which of some item ids are still on the list and not bought (GroceryList.open_ids).
        self._still_wanted = still_wanted
        self._clock = clock
        self._cond = threading.Condition()
        self._pending = []
        self._welcomes = []
        self._first = self._last = None
        self._stopping = False
        self._thread = None

    def added(self, item):
        """Called with each item put on the list (GroceryList's on_add)."""
        with self._cond:
            if self._stopping:
                return
            self._pending = [e for e in self._pending if e["id"] != item["id"]]
            if len(self._pending) >= MAX_PENDING:
                return
            self._pending.append({"id": item["id"], "name": item["name"], "by": item.get("by")})
            self._last = self._clock()
            if self._first is None:
                self._first = self._last
            self._cond.notify_all()

    def joined(self, person):
        """Called with each person who signs up ({"phone", "carrier"}): sends them a welcome text."""
        address = gateway_address(person.get("phone"), person.get("carrier"))
        with self._cond:
            if address and not self._stopping and len(self._welcomes) < MAX_WELCOMES:
                self._welcomes.append(address)
                self._cond.notify_all()

    def send_due(self):
        """Sends what's waiting, if it's due. Returns the messages sent (for tests)."""
        with self._cond:
            welcomes, batch = self._take_due()
        return self._send(welcomes, batch)

    # Running

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="grocery-texts", daemon=True)
        self._thread.start()

    def stop(self):
        with self._cond:
            self._stopping = True
            self._cond.notify_all()

    def _loop(self):
        while True:
            with self._cond:
                welcomes, batch = [], None
                while not self._stopping:
                    welcomes, batch = self._take_due()
                    if welcomes or batch:
                        break
                    self._cond.wait(self._due() - self._clock() if self._pending else None)
                if self._stopping:
                    return
            try:
                self._send(welcomes, batch)
            except Exception:
                log.exception("Grocery texts: sending failed")

    # Internals

    def _due(self):
        return min(self._last + QUIET_SECONDS, self._first + LONGEST_WAIT_SECONDS)

    def _take_due(self):
        """With the lock held: welcomes to send, and the waiting adds if they're due."""
        welcomes, self._welcomes = self._welcomes, []
        if not self._pending or self._clock() < self._due():
            return welcomes, None
        batch, self._pending = self._pending, []
        self._first = self._last = None
        return welcomes, batch

    def _send(self, welcomes, batch):
        messages = [_message(address, WELCOME) for address in welcomes]
        if batch and self._still_wanted is not None:
            wanted = self._still_wanted({e["id"] for e in batch})
            batch = [e for e in batch if e["id"] in wanted]
        if batch:
            for person in self._recipients():
                address = gateway_address(person.get("phone"), person.get("carrier"))
                text = summary([e for e in batch if name_key(e["by"]) != name_key(person["name"])])
                if address and text:
                    messages.append(_message(address, text))
        if messages:
            outcome = self._notifier.deliver(messages)
            if outcome["problem"]:
                log.warning("Grocery texts: %d of %d didn't send: %s",
                            outcome["failed"], len(messages), outcome["problem"])
        return messages
