import io
import json
import unittest
import urllib.error
from unittest import mock

from board import stocks
from board.store import ChangeFeed

# Thursday 19 November 2026: the bell rings at 9:30 and 16:00 Eastern (14:30 and 21:00 UTC).
OPEN = 1795098600
CLOSE = 1795122000
MIDDAY = OPEN + 3 * 60 * 60
EVENING = CLOSE + 2 * 60 * 60
FRIDAY_OPEN = OPEN + 24 * 60 * 60
STEP = stocks.STEP_SECONDS


def chart(symbol, price, previous, closes=None, *, start=OPEN, end=CLOSE, first=None, when=None, **meta):
    """Yahoo's chart answer for one company, with a bar every five minutes from `first`."""
    closes = [previous, price] if closes is None else closes
    first = start if first is None else first
    return {"chart": {"error": None, "result": [{
        "meta": {
            "symbol": symbol,
            "currency": "USD",
            "regularMarketPrice": price,
            "regularMarketTime": first + STEP * (len(closes) - 1) if when is None else when,
            "previousClose": previous,
            "chartPreviousClose": previous,
            "currentTradingPeriod": {
                "pre": {"start": start - 19800, "end": start},
                "regular": {"start": start, "end": end},
                "post": {"start": end, "end": end + 14400},
            },
            "tradingPeriods": [[{"start": start, "end": end}]],
            **meta,
        },
        "timestamp": [first + STEP * i for i in range(len(closes))],
        "indicators": {"quote": [{"close": closes, "open": closes, "volume": [1] * len(closes)}]},
    }]}}


class FakeYahoo:
    """Answers the chart endpoint from `charts` (symbol -> answer, or an exception to raise)."""

    def __init__(self, charts):
        self.charts = dict(charts)
        self.asked = []

    def __call__(self, url):
        prefix, suffix = stocks.CHART_URL.split("%s")
        assert url.startswith(prefix) and url.endswith(suffix), url
        symbol = url[len(prefix):len(url) - len(suffix)]
        self.asked.append(symbol)
        answer = self.charts.get(symbol, stocks.StocksUnavailable("The market data service answered 404.", status=404))
        if isinstance(answer, Exception):
            raise answer
        return answer


class FakeClock:
    def __init__(self, now=MIDDAY):
        self.now = now

    def __call__(self):
        return self.now


def basket(clock=None, charts=None, symbols=("AAA", "BBB", "CCC", "DDD"), feed=None):
    charts = charts if charts is not None else {
        "AAA": chart("AAA", 110.0, 100.0),
        "BBB": chart("BBB", 49.0, 50.0),
        "CCC": chart("CCC", 20.4, 20.0),
        "DDD": chart("DDD", 300.0, 300.0),
    }
    yahoo = FakeYahoo(charts)
    return stocks.Stocks(symbols, fetch=yahoo, clock=clock or FakeClock(), feed=feed, gap=0), yahoo


class SymbolsFromTest(unittest.TestCase):
    def test_left_out_is_the_ai_index(self):
        self.assertEqual(stocks.symbols_from(None), stocks.SYMBOLS)
        self.assertEqual(stocks.symbols_from(True), stocks.SYMBOLS)
        self.assertEqual(stocks.symbols_from({}), stocks.SYMBOLS)

    def test_the_basket_is_about_ten_listed_companies_with_no_repeats(self):
        self.assertTrue(8 <= len(stocks.SYMBOLS) <= 12)
        self.assertEqual(len(set(stocks.SYMBOLS)), len(stocks.SYMBOLS))
        self.assertTrue(all(stocks.SYMBOL.match(symbol) for symbol in stocks.SYMBOLS))

    def test_false_turns_it_off(self):
        self.assertIsNone(stocks.symbols_from(False))

    def test_a_list_of_tickers_replaces_the_basket(self):
        with self.assertLogs(stocks.log, "WARNING"):
            found = stocks.symbols_from({"symbols": [" nvda ", "MSFT", "nvda", "BRK-B", "BF.B", 7, "", "NOT A TICKER", "../x"]})
        self.assertEqual(found, ("NVDA", "MSFT", "BRK-B", "BF.B"))

    def test_nonsense_falls_back_to_the_ai_index(self):
        for config in ("NVDA", 3, ["NVDA"], {"symbols": "NVDA"}, {"symbols": []}, {"symbols": [None, "?"]}):
            with self.assertLogs(stocks.log, "WARNING"):
                self.assertEqual(stocks.symbols_from(config), stocks.SYMBOLS, config)

    def test_a_long_list_is_cut_off(self):
        many = ["T%d" % i for i in range(stocks.MAX_SYMBOLS + 5)]
        with self.assertLogs(stocks.log, "WARNING"):
            self.assertEqual(len(stocks.symbols_from({"symbols": many})), stocks.MAX_SYMBOLS)


class ShapeQuoteTest(unittest.TestCase):
    def test_a_company_as_the_board_keeps_it(self):
        quote = stocks.shape_quote("NVDA", chart("NVDA", 145.98, 150.96, [156.91, 150.96, 145.98]))
        self.assertEqual(quote["symbol"], "NVDA")
        self.assertEqual(quote["price"], 145.98)
        self.assertEqual(quote["previous_close"], 150.96)
        self.assertEqual(quote["change"], -3.3)
        self.assertEqual(quote["time"], OPEN + 2 * STEP)
        self.assertEqual(quote["session"], (OPEN, CLOSE))
        self.assertEqual(quote["chart"]["session"], (OPEN, CLOSE))
        self.assertEqual(sorted(quote["chart"]["ratios"]), [0, 1, 2])
        self.assertAlmostEqual(quote["chart"]["ratios"][1], 1.0)

    def test_the_close_before_can_come_from_either_field(self):
        raw = chart("NVDA", 110.0, 100.0)
        del raw["chart"]["result"][0]["meta"]["previousClose"]
        self.assertEqual(stocks.shape_quote("NVDA", raw)["change"], 10.0)

    def test_anything_unreadable_is_no_quote(self):
        broken = [
            None, [], "nope", {}, {"chart": None}, {"chart": {"result": None, "error": {"code": "Not Found"}}},
            {"chart": {"result": []}}, {"chart": {"result": ["x"]}}, {"chart": {"result": [{"meta": "x"}]}},
            chart("MSFT", 110.0, 100.0),                      # somebody else's answer
            chart("NVDA", None, 100.0), chart("NVDA", "110", 100.0), chart("NVDA", True, 100.0),
            chart("NVDA", 0, 100.0), chart("NVDA", -4.0, 100.0), chart("NVDA", float("nan"), 100.0),
            chart("NVDA", 110.0, 0), chart("NVDA", 110.0, float("inf")),
        ]
        for raw in broken:
            self.assertIsNone(stocks.shape_quote("NVDA", raw), raw)

    def test_a_price_without_a_chart_still_counts(self):
        for damage in ({"timestamp": None}, {"indicators": None}, {"indicators": {"quote": []}},
                       {"indicators": {"quote": [{"close": [1.0]}]}}, {"timestamp": ["a", "b"]}):
            raw = chart("NVDA", 110.0, 100.0)
            raw["chart"]["result"][0].update(damage)
            quote = stocks.shape_quote("NVDA", raw)
            self.assertEqual(quote["change"], 10.0)
            self.assertIsNone(quote["chart"], damage)

    def test_steps_nothing_traded_in_are_left_out_not_guessed(self):
        quote = stocks.shape_quote("NVDA", chart("NVDA", 104.0, 100.0, [101.0, None, "x", 104.0]))
        self.assertEqual(sorted(quote["chart"]["ratios"]), [0, 3])

    def test_trading_hours_that_make_no_sense_are_dropped(self):
        for start, end in ((CLOSE, OPEN), (OPEN, OPEN), (OPEN, OPEN + 3 * 24 * 3600)):
            quote = stocks.shape_quote("NVDA", chart("NVDA", 110.0, 100.0, start=start, end=end))
            self.assertIsNone(quote["session"])
            self.assertIsNone(quote["chart"])

    def test_before_the_bell_the_chart_is_still_yesterdays(self):
        # Yahoo already names Friday's hours, but the bars are Thursday's.
        raw = chart("NVDA", 110.0, 100.0, [100.0, 105.0, 110.0], start=FRIDAY_OPEN, end=FRIDAY_OPEN + CLOSE - OPEN,
                    first=OPEN, tradingPeriods=[[{"start": OPEN, "end": CLOSE}]])
        quote = stocks.shape_quote("NVDA", raw)
        self.assertEqual(quote["session"], (FRIDAY_OPEN, FRIDAY_OPEN + CLOSE - OPEN))
        self.assertEqual(quote["chart"]["session"], (OPEN, CLOSE))
        # And with no hours that fit the bars, there's no chart rather than a wrong one.
        raw["chart"]["result"][0]["meta"]["tradingPeriods"] = "?"
        self.assertIsNone(stocks.shape_quote("NVDA", raw)["chart"])

    def test_a_huge_chart_is_cut_to_the_newest_bars(self):
        closes = [100.0 + i for i in range(stocks.MAX_POINTS + 50)]
        raw = chart("NVDA", 110.0, 100.0, closes, end=OPEN + 23 * 3600)
        self.assertEqual(len(stocks.shape_quote("NVDA", raw)["chart"]["ratios"]), stocks.MAX_POINTS)


def quote(symbol, price, previous, closes=None, **kwargs):
    return stocks.shape_quote(symbol, chart(symbol, price, previous, closes, **kwargs))


class IndexTest(unittest.TestCase):
    def test_equal_weighted_from_a_base_of_100_at_yesterdays_close(self):
        # +10%, -2%, +2% and flat: a mean of +2.5%, however big each company is.
        quotes = [quote("AAA", 110.0, 100.0), quote("BBB", 49.0, 50.0), quote("CCC", 20.4, 20.0), quote("DDD", 3000.0, 3000.0)]
        self.assertEqual(stocks.index_of(quotes), {"level": 102.5, "change": 2.5})
        self.assertEqual(stocks.index_of([quote("AAA", 100.0, 100.0)]), {"level": 100.0, "change": 0.0})

    def test_the_move_is_the_mean_of_the_companies_own_moves(self):
        quotes = [quote("AAA", 145.98, 150.96), quote("BBB", 495.44, 507.31), quote("CCC", 352.09, 362.62)]
        mean = sum(q["change"] for q in quotes) / len(quotes)
        self.assertAlmostEqual(stocks.index_of(quotes)["change"], mean, delta=0.011)

    def test_no_companies_is_no_index(self):
        self.assertIsNone(stocks.index_of([]))

    def test_at_least_half_the_basket_has_to_answer(self):
        self.assertEqual([stocks.min_constituents(n) for n in (1, 2, 3, 4, 10, 11)], [1, 1, 2, 2, 5, 6])

    def test_the_days_line_is_the_mean_at_every_step(self):
        quotes = [quote("AAA", 110.0, 100.0, [100.0, 104.0, 110.0]), quote("BBB", 49.0, 50.0, [50.0, 50.0, 49.0])]
        self.assertEqual(stocks.index_series(quotes), {"start": OPEN, "end": CLOSE, "step": STEP, "levels": [100.0, 102.0, 104.0]})

    def test_a_quiet_company_stays_at_its_last_trade(self):
        quotes = [quote("AAA", 110.0, 100.0, [100.0, None, 110.0, 110.0]), quote("BBB", 50.0, 50.0, [50.0, 50.0, 50.0])]
        self.assertEqual(stocks.index_series(quotes)["levels"], [100.0, 100.0, 105.0, 105.0])

    def test_no_point_until_every_company_has_traded(self):
        quotes = [quote("AAA", 110.0, 100.0, [None, 110.0, 110.0]), quote("BBB", 50.0, 50.0, [50.0, 50.0, 50.0])]
        self.assertEqual(stocks.index_series(quotes)["levels"], [None, 105.0, 105.0])

    def test_companies_without_a_chart_or_on_another_day_are_left_out_of_the_line(self):
        quotes = [
            quote("AAA", 110.0, 100.0, [100.0, 110.0]),
            quote("BBB", 55.0, 50.0, [50.0, 55.0]),
            quote("CCC", 30.0, 20.0, [20.0, 30.0], start=OPEN + 3600, end=CLOSE + 3600),
            quote("DDD", 90.0, 100.0, [], when=OPEN),
        ]
        self.assertEqual(stocks.index_series(quotes)["levels"], [100.0, 110.0])
        self.assertIsNone(stocks.index_series([quotes[3]]))
        self.assertIsNone(stocks.index_series([]))

    def test_the_line_never_runs_past_the_closing_bell(self):
        closes = [100.0] * 79
        series = stocks.index_series([quote("AAA", 100.0, 100.0, closes)])
        self.assertEqual(len(series["levels"]), 79)
        self.assertEqual(series["start"] + series["step"] * 78, CLOSE)


class TimingTest(unittest.TestCase):
    def test_open_only_between_the_bells(self):
        quotes = [quote("AAA", 110.0, 100.0)]
        self.assertFalse(stocks.market_open(quotes, OPEN - 1))
        self.assertTrue(stocks.market_open(quotes, OPEN))
        self.assertTrue(stocks.market_open(quotes, CLOSE - 1))
        self.assertFalse(stocks.market_open(quotes, CLOSE))
        self.assertFalse(stocks.market_open([quote("AAA", 110.0, 100.0, start=CLOSE, end=OPEN)], MIDDAY))

    def test_while_open_it_asks_every_couple_of_minutes(self):
        quotes = [quote("AAA", 110.0, 100.0)]
        self.assertEqual(stocks.next_poll_delay(quotes, MIDDAY), stocks.OPEN_POLL_SECONDS)
        self.assertTrue(60 <= stocks.OPEN_POLL_SECONDS <= 120)

    def test_and_once_more_just_after_the_closing_bell(self):
        quotes = [quote("AAA", 110.0, 100.0)]
        self.assertEqual(stocks.next_poll_delay(quotes, CLOSE - 30), 30 + stocks.BELL_MARGIN_SECONDS)
        self.assertEqual(stocks.next_poll_delay(quotes, CLOSE - 1), 1 + stocks.BELL_MARGIN_SECONDS)

    def test_while_closed_it_asks_far_less_often(self):
        quotes = [quote("AAA", 110.0, 100.0)]
        self.assertEqual(stocks.next_poll_delay(quotes, EVENING), stocks.CLOSED_POLL_SECONDS)
        self.assertGreaterEqual(stocks.CLOSED_POLL_SECONDS, 10 * stocks.OPEN_POLL_SECONDS)

    def test_and_again_just_after_the_opening_bell(self):
        # Before the bell, from the day's own hours.
        quotes = [quote("AAA", 110.0, 100.0)]
        self.assertEqual(stocks.next_poll_delay(quotes, OPEN - 600), 600 + stocks.BELL_MARGIN_SECONDS)
        # After yesterday's close, from the clock: Friday at 9:30 Eastern.
        self.assertEqual(stocks.next_poll_delay(quotes, FRIDAY_OPEN - 600), 600 + stocks.BELL_MARGIN_SECONDS)
        self.assertEqual(stocks.next_poll_delay(quotes, FRIDAY_OPEN - 1), stocks.MIN_POLL_SECONDS + 1)

    def test_the_next_opening_bell_skips_the_weekend(self):
        self.assertEqual(stocks.next_us_open(MIDDAY), FRIDAY_OPEN)
        self.assertEqual(stocks.next_us_open(OPEN - 1), OPEN)
        self.assertEqual(stocks.next_us_open(OPEN), FRIDAY_OPEN)
        friday_evening = FRIDAY_OPEN + 10 * 3600
        self.assertEqual(stocks.next_us_open(friday_evening), FRIDAY_OPEN + 3 * 24 * 3600)
        # In summer the bell is at 13:30 UTC: Monday 6 July 2026.
        self.assertEqual(stocks.next_us_open(1783296000), 1783344600)

    def test_failures_back_off_and_respect_retry_after(self):
        waits = [stocks.error_delay(n) for n in range(1, 9)]
        self.assertEqual(waits[:4], [60, 120, 240, 480])
        self.assertEqual(waits[-1], stocks.MAX_ERROR_POLL_SECONDS)
        self.assertEqual(waits, sorted(waits))
        self.assertEqual(stocks.error_delay(1, retry_after=900), 900)
        self.assertEqual(stocks.error_delay(1, retry_after=5), 60)
        self.assertEqual(stocks.error_delay(1, retry_after=10 ** 9), stocks.MAX_RETRY_AFTER_SECONDS)
        self.assertEqual(stocks.error_delay(10 ** 6), stocks.MAX_ERROR_POLL_SECONDS)


class StocksTest(unittest.TestCase):
    def test_before_the_first_reading_there_is_nothing_but_no_error(self):
        board, yahoo = basket()
        self.assertEqual(board.snapshot(), {
            "version": 0, "enabled": True, "name": "AI Index", "market": None, "index": None, "series": None,
            "constituents": [], "as_of": None, "error": None,
        })
        self.assertEqual(yahoo.asked, [])

    def test_a_reading_is_the_index_its_line_and_every_company(self):
        feed = ChangeFeed()
        board, yahoo = basket(feed=feed)
        delay = board.poll()
        state = board.snapshot()
        self.assertEqual(yahoo.asked, ["AAA", "BBB", "CCC", "DDD"])
        self.assertEqual(state["version"], 1)
        self.assertEqual(feed.seq, 1)
        self.assertEqual(state["market"], "open")
        self.assertEqual(state["index"], {"level": 102.5, "change": 2.5, "count": 4, "of": 4})
        self.assertEqual(state["series"], {"start": OPEN, "end": CLOSE, "step": STEP, "levels": [100.0, 102.5]})
        self.assertEqual(state["constituents"], [
            {"symbol": "AAA", "price": 110.0, "change": 10.0},
            {"symbol": "BBB", "price": 49.0, "change": -2.0},
            {"symbol": "CCC", "price": 20.4, "change": 2.0},
            {"symbol": "DDD", "price": 300.0, "change": 0.0},
        ])
        self.assertEqual(state["as_of"], OPEN + STEP)
        self.assertIsNone(state["error"])
        self.assertEqual(delay, stocks.OPEN_POLL_SECONDS)
        json.dumps(state)

    def test_the_version_only_moves_when_something_shown_does(self):
        feed = ChangeFeed()
        clock = FakeClock(EVENING)
        board, yahoo = basket(clock, feed=feed)
        self.assertEqual(board.poll(), stocks.CLOSED_POLL_SECONDS)
        self.assertEqual(board.snapshot()["market"], "closed")
        clock.now += stocks.CLOSED_POLL_SECONDS
        board.poll()
        board.poll()
        self.assertEqual(board.snapshot()["version"], 1)
        self.assertEqual(feed.seq, 1)
        yahoo.charts["AAA"] = chart("AAA", 120.0, 100.0)
        board.poll()
        self.assertEqual(board.snapshot()["version"], 2)
        self.assertEqual(board.snapshot()["index"]["change"], 5.0)

    def test_the_bell_closes_the_market(self):
        clock = FakeClock(CLOSE - 20)
        board, _yahoo = basket(clock)
        self.assertEqual(board.poll(), 20 + stocks.BELL_MARGIN_SECONDS)
        self.assertEqual(board.snapshot()["market"], "open")
        clock.now = CLOSE + stocks.BELL_MARGIN_SECONDS
        self.assertEqual(board.poll(), stocks.CLOSED_POLL_SECONDS)
        self.assertEqual(board.snapshot()["market"], "closed")

    def test_a_company_that_does_not_answer_is_left_out(self):
        board, yahoo = basket()
        del yahoo.charts["BBB"]                      # 404: Yahoo doesn't know it
        yahoo.charts["DDD"] = {"chart": {"result": None}}
        with self.assertLogs(stocks.log, "WARNING") as logged:
            delay = board.poll()
            board.poll()
        self.assertEqual(len(logged.output), 1)      # said once, not every round
        state = board.snapshot()
        self.assertEqual([c["symbol"] for c in state["constituents"]], ["AAA", "CCC"])
        self.assertEqual(state["index"], {"level": 106.0, "change": 6.0, "count": 2, "of": 4})
        self.assertIsNone(state["error"])
        self.assertEqual(delay, stocks.OPEN_POLL_SECONDS)

    def test_too_few_companies_is_an_error_not_an_index(self):
        board, _yahoo = basket(charts={"AAA": chart("AAA", 110.0, 100.0)})
        with self.assertLogs(stocks.log, "WARNING"):
            delay = board.poll()
        state = board.snapshot()
        self.assertIsNone(state["index"])
        self.assertEqual(state["error"], stocks.UNREACHABLE)
        self.assertEqual(delay, stocks.ERROR_POLL_SECONDS)

    def test_offline_stops_asking_and_backs_off(self):
        board, yahoo = basket()
        board.poll()
        yahoo.asked.clear()
        yahoo.charts["AAA"] = stocks.StocksUnavailable("Can't reach the market data service.")
        with self.assertLogs(stocks.log, "WARNING") as logged:
            delays = [board.poll() for _ in range(3)]
        self.assertEqual(delays, [60, 120, 240])
        self.assertEqual(yahoo.asked, ["AAA"] * 3)   # not the other three, each time
        self.assertEqual(len(logged.output), 1)
        state = board.snapshot()
        # The last reading stays up, marked as offline.
        self.assertEqual(state["error"], stocks.UNREACHABLE)
        self.assertEqual(state["index"]["change"], 2.5)
        self.assertEqual(state["version"], 2)

    def test_told_to_slow_down_it_waits_as_long_as_asked(self):
        board, yahoo = basket()
        yahoo.charts["BBB"] = stocks.StocksUnavailable("The market data service answered 429.", status=429, retry_after=1800)
        with self.assertLogs(stocks.log, "WARNING"):
            self.assertEqual(board.poll(), 1800)
        self.assertEqual(yahoo.asked, ["AAA", "BBB"])
        yahoo.charts["BBB"] = stocks.StocksUnavailable("The market data service answered 503.", status=503)
        self.assertEqual(board.poll(), 120)
        self.assertEqual(yahoo.asked, ["AAA", "BBB", "AAA", "BBB"])

    def test_it_recovers_and_starts_the_back_off_again(self):
        board, yahoo = basket()
        good = dict(yahoo.charts)
        yahoo.charts["AAA"] = stocks.StocksUnavailable("offline")
        with self.assertLogs(stocks.log, "WARNING"):
            board.poll()
            board.poll()
        yahoo.charts = good
        with self.assertLogs(stocks.log, "INFO"):
            self.assertEqual(board.poll(), stocks.OPEN_POLL_SECONDS)
        self.assertIsNone(board.snapshot()["error"])
        yahoo.charts = {"AAA": stocks.StocksUnavailable("offline")}
        with self.assertLogs(stocks.log, "WARNING"):
            self.assertEqual(board.poll(), stocks.ERROR_POLL_SECONDS)

    def test_old_prices_do_not_stay_up_for_ever(self):
        clock = FakeClock()
        board, yahoo = basket(clock)
        board.poll()
        yahoo.charts = {"AAA": stocks.StocksUnavailable("offline")}
        with self.assertLogs(stocks.log, "WARNING"):
            clock.now += stocks.KEEP_STALE_SECONDS - 1
            board.poll()
            self.assertIsNotNone(board.snapshot()["index"])
            clock.now += 2
            board.poll()
        state = board.snapshot()
        self.assertIsNone(state["index"])
        self.assertIsNone(state["series"])
        self.assertEqual(state["constituents"], [])
        self.assertEqual(state["error"], stocks.UNREACHABLE)

    def test_turned_off_it_never_goes_online(self):
        yahoo = FakeYahoo({})
        board = stocks.Stocks(stocks.symbols_from(False), fetch=yahoo)
        self.assertIsNone(board.poll())
        board.start()
        self.assertIsNone(board._thread)
        state = board.snapshot()
        self.assertFalse(state["enabled"])
        self.assertIsNone(state["index"])
        self.assertEqual(yahoo.asked, [])

    def test_a_snapshot_is_a_copy(self):
        board, _yahoo = basket()
        board.poll()
        board.snapshot()["constituents"].clear()
        board.snapshot()["series"]["levels"].clear()
        self.assertEqual(len(board.snapshot()["constituents"]), 4)
        self.assertEqual(len(board.snapshot()["series"]["levels"]), 2)

    def test_the_thread_stops_when_asked(self):
        board, yahoo = basket()
        board.start()
        board.start()
        thread = board._thread
        for _ in range(200):
            if board.snapshot()["version"]:
                break
            thread.join(0.01)
        board.stop()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(yahoo.asked, ["AAA", "BBB", "CCC", "DDD"])

    def test_tickers_are_escaped_in_the_address(self):
        board, yahoo = basket(symbols=("BRK-B",), charts={"BRK-B": chart("BRK-B", 110.0, 100.0)})
        board.poll()
        self.assertEqual(yahoo.asked, ["BRK-B"])


class FetchTest(unittest.TestCase):
    def response(self, body, headers=None):
        answer = mock.MagicMock()
        answer.__enter__.return_value.read.side_effect = lambda limit: body[:limit]
        return answer

    def test_reads_json_with_a_user_agent_yahoo_answers(self):
        with mock.patch("urllib.request.urlopen", return_value=self.response(b'{"chart": {}}')) as urlopen:
            self.assertEqual(stocks.fetch_json(stocks.CHART_URL % "NVDA"), {"chart": {}})
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, "https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=1d&interval=5m")
        self.assertEqual(request.get_header("User-agent"), stocks.USER_AGENT)
        self.assertEqual(urlopen.call_args[1]["timeout"], stocks.TIMEOUT_SECONDS)

    def test_too_much_or_not_json_is_refused(self):
        with mock.patch("urllib.request.urlopen", return_value=self.response(b" " * (stocks.MAX_RESPONSE_BYTES + 10))):
            with self.assertRaises(stocks.StocksUnavailable):
                stocks.fetch_json("https://example.test/")
        with mock.patch("urllib.request.urlopen", return_value=self.response(b"<html>Too Many Requests")):
            with self.assertRaises(stocks.StocksUnavailable) as caught:
                stocks.fetch_json("https://example.test/")
        self.assertEqual(caught.exception.status, 200)

    def test_an_http_error_carries_its_status_and_retry_after(self):
        for headers, expected in (({"Retry-After": "120"}, 120), ({}, None), ({"Retry-After": "soon"}, None),
                                  ({"Retry-After": "-5"}, None)):
            error = urllib.error.HTTPError("https://example.test/", 429, "Too Many Requests", headers, io.BytesIO(b""))
            with mock.patch("urllib.request.urlopen", side_effect=error):
                with self.assertRaises(stocks.StocksUnavailable) as caught:
                    stocks.fetch_json("https://example.test/")
            self.assertEqual(caught.exception.status, 429)
            self.assertEqual(caught.exception.retry_after, expected)

    def test_no_network_has_no_status(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("no route")):
            with self.assertRaises(stocks.StocksUnavailable) as caught:
                stocks.fetch_json("https://example.test/")
        self.assertIsNone(caught.exception.status)


if __name__ == "__main__":
    unittest.main()
