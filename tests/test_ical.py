import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from board import ical

NEW_YORK = ZoneInfo("America/New_York")


def feed(*events, name="Home"):
    body = "".join("BEGIN:VEVENT\r\n%s\r\nEND:VEVENT\r\n" % event.strip().replace("\n", "\r\n") for event in events)
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:%s\r\n%sEND:VCALENDAR\r\n" % (name, body)


def when(text, *, start, days=120, local=NEW_YORK):
    return ical.occurrences(
        ical.read_calendar(text),
        window_start=start,
        window_end=start + timedelta(days=days),
        local=local,
    )


class LineParsingTest(unittest.TestCase):
    def test_unfolds_continuation_lines(self):
        self.assertEqual(ical.unfold("SUMMARY:Long\r\n  title\r\nUID:1"), ["SUMMARY:Long title", "UID:1"])

    def test_splits_name_parameters_and_value(self):
        name, params, value = ical.split_line("DTSTART;TZID=Europe/Paris;VALUE=DATE-TIME:20261002T090000")
        self.assertEqual(name, "DTSTART")
        self.assertEqual(params, {"TZID": "Europe/Paris", "VALUE": "DATE-TIME"})
        self.assertEqual(value, "20261002T090000")

    def test_a_colon_inside_a_quoted_parameter_is_not_the_separator(self):
        name, params, value = ical.split_line('ATTENDEE;CN="Ada: Lovelace":mailto:ada@example.com')
        self.assertEqual((name, params["CN"], value), ("ATTENDEE", "Ada: Lovelace", "mailto:ada@example.com"))

    def test_unescapes_text_values(self):
        self.assertEqual(ical.unescape("Dinner\\, then\\na film\\; maybe"), "Dinner, then\na film; maybe")

    def test_reads_the_calendar_name_and_ignores_alarms_and_timezones(self):
        text = (
            "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Family\r\n"
            "BEGIN:VTIMEZONE\r\nTZID:Europe/Paris\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\n"
            "END:STANDARD\r\nEND:VTIMEZONE\r\n"
            "BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Dentist\r\nDTSTART;VALUE=DATE:20261009\r\n"
            "BEGIN:VALARM\r\nTRIGGER:-PT30M\r\nSUMMARY:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        )
        parsed = ical.read_calendar(text)
        self.assertEqual(parsed["name"], "Family")
        self.assertEqual(len(parsed["events"]), 1)
        self.assertEqual(ical.first(parsed["events"][0], "SUMMARY"), "Dentist")
        self.assertNotIn("TRIGGER", parsed["events"][0])


class MomentTest(unittest.TestCase):
    def test_reads_all_day_utc_and_zoned_starts(self):
        self.assertEqual(ical.parse_moment("20261225", {"VALUE": "DATE"}, NEW_YORK), date(2026, 12, 25))
        self.assertEqual(
            ical.parse_moment("20261002T143000Z", {}, NEW_YORK),
            datetime(2026, 10, 2, 14, 30, tzinfo=timezone.utc),
        )
        zoned = ical.parse_moment("20261002T090000", {"TZID": "America/New_York"}, timezone.utc)
        self.assertEqual(zoned.utcoffset(), timedelta(hours=-4))

    def test_an_unknown_timezone_falls_back_to_the_board_s_own(self):
        moment = ical.parse_moment("20261002T090000", {"TZID": "Mars/Olympus"}, NEW_YORK)
        self.assertEqual(moment.tzinfo, NEW_YORK)

    def test_reads_durations(self):
        self.assertEqual(ical.parse_duration("P1D"), timedelta(days=1))
        self.assertEqual(ical.parse_duration("PT1H30M"), timedelta(hours=1, minutes=30))
        self.assertEqual(ical.parse_duration("P2W"), timedelta(weeks=2))
        with self.assertRaises(ValueError):
            ical.parse_duration("soon")


class OccurrenceTest(unittest.TestCase):
    def test_timed_event_comes_back_as_local_wall_clock(self):
        text = feed("UID:1\nSUMMARY:Parcel\nDTSTART:20261003T183000Z\nDTEND:20261003T193000Z")
        found = when(text, start=date(2026, 10, 1))
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["date"], "2026-10-03")
        self.assertEqual(found[0]["time"], "14:30")  # 18:30 UTC is 14:30 in New York in October
        self.assertEqual(found[0]["end_time"], "15:30")
        self.assertIsNone(found[0]["location"])

    def test_all_day_event_has_no_time_and_a_span_in_days(self):
        text = feed("UID:1\nSUMMARY:Trip\nDTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261013")
        found = when(text, start=date(2026, 10, 1))
        self.assertEqual((found[0]["date"], found[0]["time"], found[0]["days"]), ("2026-10-10", None, 3))

    def test_an_event_without_a_title_still_shows(self):
        found = when(feed("UID:1\nDTSTART;VALUE=DATE:20261010"), start=date(2026, 10, 1))
        self.assertEqual(found[0]["title"], ical.NO_TITLE)

    def test_skips_events_outside_the_window_and_cancelled_ones(self):
        text = feed(
            "UID:1\nSUMMARY:Last month\nDTSTART;VALUE=DATE:20260901",
            "UID:2\nSUMMARY:Next year\nDTSTART;VALUE=DATE:20280101",
            "UID:3\nSUMMARY:Called off\nSTATUS:CANCELLED\nDTSTART;VALUE=DATE:20261010",
            "UID:4\nSUMMARY:Soon\nDTSTART;VALUE=DATE:20261010",
        )
        self.assertEqual([e["title"] for e in when(text, start=date(2026, 10, 1))], ["Soon"])

    def test_a_multi_day_event_that_began_before_the_window_still_shows(self):
        text = feed("UID:1\nSUMMARY:Away\nDTSTART;VALUE=DATE:20260928\nDTEND;VALUE=DATE:20261005")
        self.assertEqual(len(when(text, start=date(2026, 10, 1))), 1)

    def test_an_unreadable_event_is_dropped_without_losing_the_others(self):
        text = feed("UID:1\nSUMMARY:Broken\nDTSTART:not-a-date", "UID:2\nSUMMARY:Fine\nDTSTART;VALUE=DATE:20261010")
        self.assertEqual([e["title"] for e in when(text, start=date(2026, 10, 1))], ["Fine"])

    def test_results_are_in_order_with_all_day_events_first(self):
        text = feed(
            "UID:1\nSUMMARY:Evening\nDTSTART:20261010T230000Z",
            "UID:2\nSUMMARY:All day\nDTSTART;VALUE=DATE:20261010",
            "UID:3\nSUMMARY:Earlier\nDTSTART;VALUE=DATE:20261009",
        )
        self.assertEqual([e["title"] for e in when(text, start=date(2026, 10, 1))], ["Earlier", "All day", "Evening"])


class RecurrenceTest(unittest.TestCase):
    def test_a_yearly_birthday_shows_this_year_s_date(self):
        text = feed("UID:1\nSUMMARY:Sam's birthday\nDTSTART;VALUE=DATE:19910418\nRRULE:FREQ=YEARLY")
        found = when(text, start=date(2026, 4, 1), days=30)
        self.assertEqual([e["date"] for e in found], ["2026-04-18"])

    def test_a_yearly_rule_is_not_walked_year_by_year_from_the_start(self):
        # A rule from 1901 must still be cheap: the walk skips whole intervals.
        text = feed("UID:1\nSUMMARY:Anniversary\nDTSTART;VALUE=DATE:19010418\nRRULE:FREQ=YEARLY;INTERVAL=1")
        self.assertEqual([e["date"] for e in when(text, start=date(2400, 4, 1), days=30)], ["2400-04-18"])

    def test_weekly_with_byday_lands_on_each_named_day(self):
        text = feed("UID:1\nSUMMARY:Bins\nDTSTART;VALUE=DATE:20260105\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH")
        found = when(text, start=date(2026, 10, 5), days=7)
        self.assertEqual([e["date"] for e in found], ["2026-10-05", "2026-10-08", "2026-10-12"])

    def test_interval_and_count_are_honoured(self):
        text = feed("UID:1\nSUMMARY:Class\nDTSTART;VALUE=DATE:20261005\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3")
        found = when(text, start=date(2026, 10, 1), days=120)
        self.assertEqual([e["date"] for e in found], ["2026-10-05", "2026-10-19", "2026-11-02"])

    def test_until_ends_the_series(self):
        text = feed("UID:1\nSUMMARY:Standup\nDTSTART;VALUE=DATE:20261005\nRRULE:FREQ=DAILY;UNTIL=20261007T235959Z")
        self.assertEqual(len(when(text, start=date(2026, 10, 1), days=30)), 3)

    def test_monthly_on_the_third_sunday_and_on_the_last_day(self):
        third = feed("UID:1\nSUMMARY:Brunch\nDTSTART;VALUE=DATE:20260118\nRRULE:FREQ=MONTHLY;BYDAY=3SU")
        self.assertEqual([e["date"] for e in when(third, start=date(2026, 10, 1), days=60)], ["2026-10-18", "2026-11-15"])
        last = feed("UID:2\nSUMMARY:Rent\nDTSTART;VALUE=DATE:20260131\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1")
        self.assertEqual([e["date"] for e in when(last, start=date(2026, 10, 1), days=60)], ["2026-10-31", "2026-11-30"])

    def test_monthly_skips_months_without_that_day(self):
        text = feed("UID:1\nSUMMARY:Report\nDTSTART;VALUE=DATE:20260131\nRRULE:FREQ=MONTHLY")
        found = when(text, start=date(2027, 1, 1), days=90)
        self.assertEqual([e["date"] for e in found], ["2027-01-31", "2027-03-31"])

    def test_yearly_on_the_fourth_thursday_of_november(self):
        text = feed("UID:1\nSUMMARY:Thanksgiving\nDTSTART;VALUE=DATE:20251127\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH")
        self.assertEqual([e["date"] for e in when(text, start=date(2026, 11, 1), days=30)], ["2026-11-26"])

    def test_a_recurring_timed_event_keeps_its_local_hour_across_a_clock_change(self):
        text = feed("UID:1\nSUMMARY:Call\nDTSTART;TZID=America/New_York:20261029T090000\nRRULE:FREQ=WEEKLY;BYDAY=TH")
        found = when(text, start=date(2026, 10, 25), days=21)
        # The US clocks go back on 1 November 2026; the call stays at 9am local.
        self.assertEqual([(e["date"], e["time"]) for e in found][:3],
                         [("2026-10-29", "09:00"), ("2026-11-05", "09:00"), ("2026-11-12", "09:00")])

    def test_exdate_removes_one_occurrence(self):
        text = feed(
            "UID:1\nSUMMARY:Bins\nDTSTART;VALUE=DATE:20261005\nRRULE:FREQ=WEEKLY;BYDAY=MO\n"
            "EXDATE;VALUE=DATE:20261012"
        )
        found = when(text, start=date(2026, 10, 1), days=21)
        self.assertEqual([e["date"] for e in found], ["2026-10-05", "2026-10-19"])

    def test_a_moved_instance_replaces_that_date_only(self):
        text = feed(
            "UID:1\nSUMMARY:Bins\nDTSTART;VALUE=DATE:20261005\nRRULE:FREQ=WEEKLY;BYDAY=MO",
            "UID:1\nSUMMARY:Bins (moved)\nRECURRENCE-ID;VALUE=DATE:20261012\nDTSTART;VALUE=DATE:20261013",
        )
        found = when(text, start=date(2026, 10, 1), days=21)
        self.assertEqual([(e["date"], e["title"]) for e in found],
                         [("2026-10-05", "Bins"), ("2026-10-13", "Bins (moved)"), ("2026-10-19", "Bins")])

    def test_rdate_adds_an_extra_occurrence(self):
        text = feed("UID:1\nSUMMARY:Open day\nDTSTART;VALUE=DATE:20261005\nRDATE;VALUE=DATE:20261020,20261021")
        self.assertEqual([e["date"] for e in when(text, start=date(2026, 10, 1), days=30)],
                         ["2026-10-05", "2026-10-20", "2026-10-21"])

    def test_a_rule_part_we_don_t_support_shows_the_event_once_rather_than_wrongly(self):
        text = feed("UID:1\nSUMMARY:Odd\nDTSTART;VALUE=DATE:20261005\nRRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1")
        self.assertEqual([e["date"] for e in when(text, start=date(2026, 10, 1), days=60)], ["2026-10-05"])

    def test_a_daily_rule_running_for_years_is_bounded(self):
        text = feed("UID:1\nSUMMARY:Every day\nDTSTART;VALUE=DATE:20200101\nRRULE:FREQ=DAILY")
        found = when(text, start=date(2026, 10, 1), days=120)
        self.assertEqual(len(found), 121)
        self.assertEqual(found[0]["date"], "2026-10-01")

    def test_never_returns_more_than_the_limit(self):
        text = feed(*("UID:%d\nSUMMARY:Event %d\nDTSTART;VALUE=DATE:20261010" % (i, i) for i in range(30)))
        found = ical.occurrences(
            ical.read_calendar(text),
            window_start=date(2026, 10, 1),
            window_end=date(2026, 11, 1),
            local=NEW_YORK,
            limit=10,
        )
        self.assertEqual(len(found), 10)


if __name__ == "__main__":
    unittest.main()
