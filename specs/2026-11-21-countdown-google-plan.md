# Countdowns In Google Calendar: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Countdowns create (or link to) all-day events in the linked Google calendar
and follow them. Every event shows how many days away it is.

**Architecture:**
- **Store:** `Countdowns` gains link fields and methods for them.
- **Sync step:** a new `CountdownSync` runs after each `CalendarSources` refresh,
  through a new `after_refresh` hook.
- **Server:** `server.py` passes the hourglass's event id, and deletes the board's own
  event when its countdown is removed.
- **Screens:** pure label functions in `agenda.js`, used by the widget and the app.

**Tech Stack:** Python 3 stdlib, vanilla JS. Tests run with `npm test`.

**Spec:** `specs/2026-11-21-calendar-countdown-design.md` (Follow-up section).

## Global Constraints
- Stdlib only, and the server must never crash: Google errors are caught and logged.
- **The sync never creates a second event for a countdown.** Only an unlinked
  countdown gets an event.
- **Countdown names** are at most 40 characters, cut by code point.
- **Commits:** Title Case subjects, with the `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>` trailer, on branch `countdown-google-sync`.

## Review Focus
1. **A countdown 200 days ahead:** its event is made once and never again, even
   though the board never sees that event. Test: Task 2,
   `test_a_far_off_countdown_gets_one_event_only`.
2. **The hourglass on an existing event** links to it, and removing that countdown
   leaves the event alone. Test: Task 3, `test_hourglass_link_is_kept_and_not_deleted`.
3. **Google down while removing:** Undo must not lead to a duplicate later. The link
   is kept, because the deletion failed. Test: Task 1,
   `test_forget_event_only_after_delete`, and Task 3's server test.
4. **The event moved on a phone:** the countdown follows its day and name. Test: Task
   2, `test_follows_a_moved_or_renamed_event`.
5. **Google unlinked:** the sync does nothing and nothing crashes. Test: Task 2,
   `test_does_nothing_without_a_writable_account`.

### Task 1: The countdown store keeps a link
**Files:** `board/countdown.py`, `tests/test_countdown.py`.

**Produces:**
- `add(raw_title, raw_day, countdown_id=None, event=None)`: `event` is a string of at
  most 300 characters, stored as `made: False`.
- `link(countdown_id, event_id, made)`
- `follow(countdown_id, title, day)`: re-sorts; a no-op when nothing changed.
- `forget_event(countdown_id)`: clears the link on the trashed copy.
- `upcoming()`: copies of the countdowns still to come.
- **On disk:** `_valid_countdown` keeps `event` and `made` when they're valid.
  Countdowns without them keep the old shape.

**Tests:**
- link, follow and forget
- the shape is unchanged without a link
- the link round-trips through the disk
- `test_forget_event_only_after_delete`: `forget_event` on a removed countdown, then
  `restore`, gives a countdown with no link

### Task 2: CountdownSync
**Files:** create `board/countdown_sync.py` and `tests/test_countdown_sync.py`.

**Produces:** `CountdownSync(countdowns, sources, board_events=lambda: [],
today=date.today)` with `.sync()`. `sources` must have:
- `snapshot()`: `events` and `account.linked`
- `writable()`
- `add(calendar_id, raw) → event dict with "id"`

Also `same_thing(event, countdown)`, whose rule mirrors `sameThing` in JS.

**Tests:**
- links an existing event instead of making one
- makes an event when there's none, and stores `made`
- `test_a_far_off_countdown_gets_one_event_only`: sync twice, `add` is called once
- `test_follows_a_moved_or_renamed_event`
- finished countdowns are skipped
- a Google error leaves the countdown unlinked and is retried on the next sync
- `test_does_nothing_without_a_writable_account`

### Task 3: Wiring
**Files:**
- `board/calendar.py`: `CalendarSources(..., after_refresh=None)` is called at the
  end of `_refresh`, and its exceptions are logged.
- `run.py`: builds `CountdownSync` and passes it in.
- `board/server.py`:
  - `countdown_add` passes `event` and then calls `calendar_sources.refresh_soon()`.
  - `countdown_remove` deletes the made event (logging errors), and calls
    `forget_event` only after the deletion succeeds.
- `web/js/services/countdown.js`: `addCountdown(title, date, { event } = {})`.
- `web/js/apps/calendar/app.js`: the hourglass passes `node.dataset.eventId` when the
  row isn't a `countdown:` pseudo-row.
- `tests/test_server.py`

**Tests:**
- `test_hourglass_link_is_kept_and_not_deleted`
- removing a made countdown deletes its event; with a failing delete, the link is
  kept

### Task 4: Days away on every event
**Files:**
- `web/js/apps/calendar/agenda.js`: `daysBadge(key, today)` returns
  'Today' / 'Tmrw' / '3 days'. `dayHeading(key, today)` returns `dayLabel` plus
  ` · in N days` from 2 days on.
- `web/js/apps/calendar/countdowns.js`: `sameThing` also matches
  `countdown.event === event.id`.
- the widget, the app and `calendar.css` (the widget's day column widens to about
  5.4rem)
- `tests/js/calendar-agenda.test.js` and `tests/js/calendar-countdowns.test.js`

**Check:** the widget and app in Glass, in the browser.
