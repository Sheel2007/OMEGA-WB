"""Stocks: the AI Index, a basket of the biggest listed AI companies shown as one fund.

The Stocks widget is a one-column strip beside the clock: how the basket has moved
today, a small chart of its day, and each company's own move.

The prices come from Yahoo Finance's chart endpoint (unofficial, no account and no
key): one small answer per company with its price, the close before, the hours of
its trading day and the day's five-minute closes. Everything read is checked and
shaped into the board's own format, so a change there means less on screen, never
a crash.

One background thread asks: every couple of minutes while the market is open, and
a few times an hour when it's closed. Every screen gets the answer over the event
stream. Nothing is written to the SD card.

Only the standard library.
"""
import copy
import json
import logging
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, time as clock_time, timedelta, timezone

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # Python older than 3.9
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

log = logging.getLogger(__name__)

NAME = "AI Index"
# The basket: the largest listed companies whose business is building or running AI
# (chips, clouds, models, and the software sold on top). OpenAI and Anthropic are
# private, so they can't be in it. "stocks": {"symbols": [...]} in config.json
# replaces the list.
SYMBOLS = ("NVDA", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "TSM", "AMD", "ORCL", "PLTR")
MAX_SYMBOLS = 20
SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1d&interval=5m"
# Yahoo answers 429 to urllib's own User-Agent and to ones that copy a whole
# browser's (checked with curl); a short one that says who's asking is answered.
USER_AGENT = "Mozilla/5.0 (compatible; WidgetBoard/1.0)"
TIMEOUT_SECONDS = 15
# An answer is about 9KB.
MAX_RESPONSE_BYTES = 256 * 1024

# How often to ask. Open: the day's chart is in five-minute steps, so every two
# minutes is as fresh as a wall needs and is ten small requests. Closed: nothing
# moves, so twice an hour (and once more just as the market should open).
OPEN_POLL_SECONDS = 120
CLOSED_POLL_SECONDS = 30 * 60
MIN_POLL_SECONDS = 5
# Asked this long after an opening or closing bell, so Yahoo has turned over too.
BELL_MARGIN_SECONDS = 5
# After a failure: a minute, then twice as long each time, up to half an hour.
ERROR_POLL_SECONDS = 60
MAX_ERROR_POLL_SECONDS = 30 * 60
MAX_RETRY_AFTER_SECONDS = 60 * 60
# A breath between companies, so a round isn't ten requests at once.
REQUEST_GAP_SECONDS = 0.3
# While Yahoo can't be reached the last reading stays up (marked as offline), but
# not for longer than this: old prices shouldn't pass for today's.
KEEP_STALE_SECONDS = 60 * 60

# The day's chart: five-minute steps, at most this many (a full day is 79).
STEP_SECONDS = 5 * 60
MAX_POINTS = 120
MAX_SESSION_SECONDS = 24 * 60 * 60
BASE_LEVEL = 100

UNREACHABLE = "Can't reach the market data."

# US markets open at 9:30 Eastern on weekdays. Only used to guess when to look
# again while they're closed; whether they *are* open comes from Yahoo's answer
# (which knows about holidays and half days).
try:
    US_EASTERN = ZoneInfo("America/New_York") if ZoneInfo else timezone(timedelta(hours=-5))
except (ZoneInfoNotFoundError, ValueError, OSError):
    US_EASTERN = timezone(timedelta(hours=-5))
US_OPEN = clock_time(9, 30)


class StocksUnavailable(Exception):
    """Yahoo couldn't be reached, said no, or sent something unreadable."""

    def __init__(self, message, *, status=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def _retry_after(headers):
    """Retry-After as seconds, when it's given as a number."""
    try:
        seconds = int(headers.get("Retry-After", ""))
    except (AttributeError, TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as err:
        raise StocksUnavailable("The market data service answered %d." % err.code, status=err.code,
                                retry_after=_retry_after(err.headers)) from err
    except OSError as err:
        raise StocksUnavailable("Can't reach the market data service.") from err
    if len(data) > MAX_RESPONSE_BYTES:
        raise StocksUnavailable("The market data service sent more than the board will read.", status=200)
    try:
        return json.loads(data)
    except ValueError as err:
        raise StocksUnavailable("The market data service sent something unreadable.", status=200) from err


def symbols_from(config):
    """The basket, from the "stocks" setting in config.json, or None when it's off.

    Left out (or true), it's the AI Index above. {"symbols": ["NVDA", ...]} makes it
    those companies instead; anything that isn't a ticker is ignored. false turns the
    widget off: nothing is ever fetched.
    """
    if config is False:
        return None
    if config is None or config is True:
        return SYMBOLS
    if not isinstance(config, dict):
        log.warning('Ignoring "stocks" in config.json: it should be false or {"symbols": [...]}.')
        return SYMBOLS
    wanted = config.get("symbols")
    if wanted is None:
        return SYMBOLS
    if not isinstance(wanted, list):
        log.warning('Ignoring "stocks.symbols" in config.json: it should be a list of tickers.')
        return SYMBOLS
    symbols = []
    for entry in wanted:
        symbol = entry.strip().upper() if isinstance(entry, str) else ""
        if not SYMBOL.match(symbol):
            log.warning('Ignoring %r in "stocks.symbols": it isn\'t a ticker.', entry)
        elif symbol not in symbols:
            symbols.append(symbol)
    if len(symbols) > MAX_SYMBOLS:
        log.warning('"stocks.symbols" has more than %d tickers; using the first %d.', MAX_SYMBOLS, MAX_SYMBOLS)
        symbols = symbols[:MAX_SYMBOLS]
    if not symbols:
        log.warning('"stocks.symbols" in config.json names no tickers; using the AI Index.')
        return SYMBOLS
    return tuple(symbols)


# Yahoo's answer as the board's own shape


def _number(value):
    """A real, finite number, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def _price(value):
    number = _number(value)
    return number if number is not None and number > 0 else None


def _period(raw):
    """A trading day's (start, end) in seconds since the epoch, or None."""
    if not isinstance(raw, dict):
        return None
    start, end = _number(raw.get("start")), _number(raw.get("end"))
    if start is None or end is None or not 0 < end - start <= MAX_SESSION_SECONDS:
        return None
    return int(start), int(end)


def _bars(result):
    """The day's (time, close) pairs, oldest first, leaving out steps nothing traded in."""
    times = result.get("timestamp")
    indicators = result.get("indicators") if isinstance(result.get("indicators"), dict) else {}
    quotes = indicators.get("quote")
    first = quotes[0] if isinstance(quotes, list) and quotes and isinstance(quotes[0], dict) else {}
    closes = first.get("close")
    if not isinstance(times, list) or not isinstance(closes, list) or len(times) != len(closes):
        return []
    bars = []
    for when, close in zip(times[-MAX_POINTS:], closes[-MAX_POINTS:]):
        when, close = _number(when), _price(close)
        if when is not None and close is not None:
            bars.append((int(when), close))
    return sorted(bars)


def _chart_session(meta, bars):
    """The trading day the chart's bars belong to, as (start, end), or None.

    Before the opening bell Yahoo can already name today's hours while the bars are
    still yesterday's, so a period only counts if the bars are inside it.
    """
    if not bars:
        return None
    periods = meta.get("tradingPeriods")
    while isinstance(periods, list) and periods:
        periods = periods[0]
    current = meta.get("currentTradingPeriod") if isinstance(meta.get("currentTradingPeriod"), dict) else {}
    for raw in (periods, current.get("regular")):
        period = _period(raw)
        if period and period[0] <= bars[0][0] and bars[-1][0] <= period[1]:
            return period
    return None


def shape_quote(symbol, raw):
    """One company from Yahoo's chart answer, or None if it can't be trusted.

    { symbol, price, previous_close, change (percent since the close before),
      time (of the price), session (start, end of its trading day, or None),
      chart: { session, ratios: { step: price / previous_close } } or None }
    """
    chart = raw.get("chart") if isinstance(raw, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    result = results[0] if isinstance(results, list) and results and isinstance(results[0], dict) else None
    meta = result.get("meta") if result and isinstance(result.get("meta"), dict) else None
    if meta is None or not isinstance(meta.get("symbol"), str) or meta["symbol"].upper() != symbol:
        return None
    price = _price(meta.get("regularMarketPrice"))
    # With a one-day chart both are the close before the day charted.
    previous = _price(meta.get("previousClose")) or _price(meta.get("chartPreviousClose"))
    if price is None or previous is None:
        return None
    current = meta.get("currentTradingPeriod") if isinstance(meta.get("currentTradingPeriod"), dict) else {}
    when = _number(meta.get("regularMarketTime"))
    bars = _bars(result)
    charted = _chart_session(meta, bars)
    ratios = {}
    if charted:
        for at, close in bars:
            ratios[(at - charted[0]) // STEP_SECONDS] = close / previous
    return {
        "symbol": symbol,
        "price": round(price, 2),
        "previous_close": round(previous, 2),
        "change": round((price / previous - 1) * 100, 2),
        "time": int(when) if when is not None and when > 0 else None,
        "session": _period(current.get("regular")),
        "chart": {"session": charted, "ratios": ratios} if ratios else None,
    }


# The index
#
# Equal-weighted: every company counts the same, however big it is. Each one's
# price is taken relative to its own close the day before, and the index is the
# mean of those, on a base of 100. So the index stood at exactly 100 at yesterday's
# close, 101.5 means the basket is up 1.5% today, and the day's move is simply the
# mean of the companies' own percent moves. (A level that carried on from day to
# day would need a history kept somewhere; the board keeps nothing on the SD card,
# and "how is it doing today" is the question a glance at the wall asks.)
# A company with no usable price is left out of the mean, never guessed.


def min_constituents(basket_size):
    """How many companies must answer for there to be an index: at least half."""
    return max(1, (basket_size + 1) // 2)


def index_of(quotes):
    """{ level, change } for the companies that have a price, or None if none do."""
    ratios = [quote["price"] / quote["previous_close"] for quote in quotes]
    if not ratios:
        return None
    mean = sum(ratios) / len(ratios)
    return {"level": round(BASE_LEVEL * mean, 2), "change": round((mean - 1) * 100, 2)}


def index_series(quotes):
    """The index through the day, in five-minute steps: { start, end, step, levels }.

    levels[i] is the index at start + i * step, or None for a step before every
    company had traded. A company that didn't trade in a step is still at its last
    trade (that is its price), so the same companies make up every point and the
    line doesn't jump when one of them has a quiet five minutes. Only companies
    charted over the same trading day count. None if there's nothing to draw.
    """
    charted = [quote["chart"] for quote in quotes if quote.get("chart")]
    if not charted:
        return None
    session = Counter(chart["session"] for chart in charted).most_common(1)[0][0]
    charts = [chart["ratios"] for chart in charted if chart["session"] == session]
    start, end = session
    last_step = min(max(max(ratios) for ratios in charts), (end - start) // STEP_SECONDS, MAX_POINTS - 1)
    levels = []
    latest = [None] * len(charts)
    for step in range(last_step + 1):
        for i, ratios in enumerate(charts):
            latest[i] = ratios.get(step, latest[i])
        if any(value is None for value in latest):
            levels.append(None)
        else:
            levels.append(round(BASE_LEVEL * sum(latest) / len(latest), 2))
    if all(level is None for level in levels):
        return None
    return {"start": start, "end": end, "step": STEP_SECONDS, "levels": levels}


def market_open(quotes, now):
    """Whether any company's trading day is on right now."""
    return any(q["session"] and q["session"][0] <= now < q["session"][1] for q in quotes)


def next_us_open(now):
    """The next weekday 9:30 Eastern after `now`, in seconds since the epoch."""
    local = datetime.fromtimestamp(now, US_EASTERN)
    for days in range(8):
        opens = datetime.combine(local.date() + timedelta(days=days), US_OPEN, US_EASTERN)
        if opens.weekday() < 5 and opens.timestamp() > now:
            return opens.timestamp()
    return now + CLOSED_POLL_SECONDS


def next_poll_delay(quotes, now):
    """How long to wait after a good reading before asking again."""
    sessions = [quote["session"] for quote in quotes if quote["session"]]
    closing = [end for start, end in sessions if start <= now < end]
    if closing:
        # Open: again soon, and just after the closing bell if that comes first.
        wait = min(OPEN_POLL_SECONDS, min(closing) - now + BELL_MARGIN_SECONDS)
    else:
        # Closed: now and then, and just after the next opening bell.
        opening = [start for start, _end in sessions if start > now]
        opens = min(opening) if opening else next_us_open(now)
        wait = min(CLOSED_POLL_SECONDS, opens - now + BELL_MARGIN_SECONDS)
    return max(MIN_POLL_SECONDS, wait)


def error_delay(failures, retry_after=None):
    """How long to wait after `failures` failed rounds in a row."""
    wait = min(MAX_ERROR_POLL_SECONDS, ERROR_POLL_SECONDS * 2 ** min(max(failures, 1) - 1, 10))
    if retry_after:
        wait = max(wait, min(retry_after, MAX_RETRY_AFTER_SECONDS))
    return wait


class Stocks:
    """The index and its companies, read on one background thread.

    snapshot() is pushed to every screen over the event stream; its version only
    changes when something on it does (so not at all while the market is closed).
    `symbols` of None is the widget turned off: nothing is fetched.
    """

    label = "stocks"

    def __init__(self, symbols=SYMBOLS, *, feed=None, fetch=fetch_json, clock=time.time, gap=REQUEST_GAP_SECONDS):
        self._symbols = tuple(symbols) if symbols else ()
        self._feed = feed
        self._fetch = fetch
        self._clock = clock
        self._gap = gap
        self._lock = threading.Lock()
        self._version = 0
        self._shown = self._payload(None, None)
        # The last good reading, when it was read, and how many rounds have failed since.
        self._reading = None
        self._read_at = None
        self._failures = 0
        # Tickers Yahoo doesn't know, so each is only logged once.
        self._unknown = set()
        self._stop = threading.Event()
        self._thread = None

    # Reads

    def snapshot(self):
        with self._lock:
            return {"version": self._version, **copy.deepcopy(self._shown)}

    def _payload(self, reading, error):
        reading = reading or {}
        return {
            "enabled": bool(self._symbols),
            "name": NAME,
            # "open" or "closed"; None until there's a reading.
            "market": reading.get("market"),
            "index": reading.get("index"),
            "series": reading.get("series"),
            "constituents": reading.get("constituents", []),
            # When the newest price is from, in seconds since the epoch.
            "as_of": reading.get("as_of"),
            "error": error,
        }

    # The thread

    def start(self):
        if self._thread is None and self._symbols:
            self._thread = threading.Thread(target=self._loop, name="stocks", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        while not self._stop.is_set():
            try:
                delay = self.poll()
            except Exception:  # A failed read must never take the board's server down with it.
                log.exception("Reading the stock prices failed")
                delay = MAX_ERROR_POLL_SECONDS
            self._stop.wait(delay)

    def poll(self):
        """Asks about every company once. Returns how long to wait before asking again."""
        if not self._symbols:
            return None
        quotes, failure = self._read()
        if self._stop.is_set():
            return None
        now = self._clock()
        if len(quotes) < min_constituents(len(self._symbols)):
            return self._failed(failure, now)
        if self._failures:
            log.info("The market data is back.")
        self._failures = 0
        self._reading = {
            "market": "open" if market_open(quotes, now) else "closed",
            "index": {**index_of(quotes), "count": len(quotes), "of": len(self._symbols)},
            "series": index_series(quotes),
            "constituents": [{key: quote[key] for key in ("symbol", "price", "change")} for quote in quotes],
            "as_of": max((quote["time"] for quote in quotes if quote["time"]), default=None),
        }
        self._read_at = now
        self._publish(self._payload(self._reading, None))
        return next_poll_delay(quotes, now)

    def _read(self):
        """Every company that answered, shaped, and the last thing that went wrong (or None)."""
        quotes = []
        failure = None
        for index, symbol in enumerate(self._symbols):
            if index and self._gap and self._stop.wait(self._gap):
                break
            try:
                raw = self._fetch(CHART_URL % urllib.parse.quote(symbol, safe=""))
            except StocksUnavailable as err:
                failure = err
                if err.status not in (200, 404):
                    # Offline, refused or told to slow down (429): asking for the
                    # rest would only make it worse. A ticker Yahoo doesn't know
                    # (404) or one unreadable answer is just that company's problem.
                    break
                if err.status == 404 and symbol not in self._unknown:
                    self._unknown.add(symbol)
                    log.warning("The market data service doesn't know %s; leaving it out of the index.", symbol)
                continue
            quote = shape_quote(symbol, raw)
            if quote:
                quotes.append(quote)
        return quotes, failure

    def _failed(self, failure, now):
        self._failures += 1
        if self._failures == 1:
            log.warning("Couldn't read the stock prices: %s", failure or "too few companies answered.")
        if self._reading and now - self._read_at > KEEP_STALE_SECONDS:
            self._reading = None
        self._publish(self._payload(self._reading, UNREACHABLE))
        return error_delay(self._failures, failure.retry_after if failure else None)

    def _publish(self, payload):
        with self._lock:
            if payload == self._shown:
                return
            self._shown = payload
            self._version += 1
        if self._feed is not None:
            self._feed.notify()
