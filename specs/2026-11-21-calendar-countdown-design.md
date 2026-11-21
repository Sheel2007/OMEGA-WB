# Countdowns move into the Calendar

## Why

Having a Calendar widget and a Countdown widget is repetitive. Both are about "what's
coming up", and they come with two apps, two add forms and two cards on the home screen.
Noah wants them combined.

## What it becomes

There's one Calendar widget and one Calendar app. Countdowns are part of the Calendar:
the next ones sit above the event list as big numbers. The Countdown widget and the
Countdown app go away.

Noah picked **design A, "Countdown up top"**, from the clickable mockups (small, medium
and large in Glass).

### Goals

- One card on the home screen shows both what's on and the days being waited for.
- One place to add either one: the Calendar app's add form, with a **Count down to this**
  switch.
- Nothing is lost. The three countdowns on the board now (UMD finals, Winter break, Next
  semester) still show, and so does any screen's widget placement where possible.

### Non-goals

- Server, API and service changes. The Calendar app uses `services.countdown` as it is:
  `addCountdown(title, date)`, `removeCountdown(id)` and `restoreCountdowns(ids)`.
- Countdowns don't sync to Google Calendar, and they don't follow a Google event that
  gets moved. This is a known trade-off of the storage approach (below).
- No new countdown features (times, colours, recurring countdowns).
- No change to the server's countdown store or its API.

### Anti-goals (it's a failure even if it works)

- The countdown numbers get small enough that they no longer read from across the room.
  The big number is the point of a countdown.
- The same thing appears twice in one widget (a countdown row next to the event it was
  made from).
- A screen that had only the Countdown widget is left with neither widget.

## Approaches

**Storage** (Noah picked 1):

1. **Countdowns keep their own list (picked).** `data/countdowns.json`,
   `board/countdown.py`, `/api/countdown/*` and `services/countdown.js` stay as they are.
   The merge happens entirely on screen.
   - Cheap and safe: the server and the Google code aren't touched.
   - Countdowns keep reaching 5 years ahead and keep their "Been and gone" list.
   - Cost: a countdown isn't a real calendar event, so it isn't in Google Calendar on
     phones.
2. **Countdowns become marked calendar events.** Each countdown is a flag on an event,
   saved on the Pi's own events and stored inside Google for Google events, with marked
   events read beyond the feed's 120-day window (`WINDOW_DAYS`) and a migration of the
   existing countdowns. It's a true merge, but roughly three times the work, and it
   touches the two-way Google code.

**Widget look:** three designs were mocked up. Noah picked A.

- **A, Countdown up top (picked):** the next countdown as a hero above the agenda.
- **B, One list counted in days:** every row leads with its days away.
- **C, Rolling weeks:** a month-style grid with countdown days filled in.

## The design

### Calendar widget (`web/js/apps/calendar/widget.js`)

The widget subscribes to both `services.calendar` and `services.countdown`. "Upcoming
countdowns" means today's and later ones, soonest first (`upcoming()` from today's
`countdown/format.js`).

- **Small (1 × 1):**
  - On top, the next countdown as a hero: the big number, "days to", the name, and the
    day ("Mon, Dec 14").
  - Under it, a hairline, then the next events. The number of rows is set by
    `fitRows()`; in the mockup it was 3.
- **Medium (2 × 1):** two columns.
  - **Left:** the next countdown as a hero (a bigger number, "days to", the name). Under
    it, one line with the next two countdowns and their days ("Winter break 31 · Next
    semester 67"), left out if there are none.
  - **Right:** the agenda, sized with `fitRows()`.
- **Large (2 × 2):**
  - Up to three countdowns across the top, each with its big number, "days", the name
    and the day, divided by hairlines (the layout of today's Countdown widget at medium).
  - Under them, a hairline and the agenda, sized with `fitRows()`.
- **No upcoming countdowns:** the widget is exactly today's Calendar widget, with no
  hero and no empty slot.
- **A countdown that's today:** the number reads "Today" (`bigNumber()`), as now.
- **Countdowns inside the agenda:** a countdown whose day falls within the rows shown
  also appears in the agenda as a row in the countdown colour, with "N days" where the
  time would be.
  - It's merged into the list by date, as an all-day item.
  - It doesn't show in the agenda while it's also the hero, so the next countdown never
    appears twice.
- **De-duplicating:** if a calendar event on the same day has the same title as a
  countdown (case-insensitive, trimmed), the event row is shown in the countdown colour
  with the days, and no separate countdown row is added. This covers countdowns made
  from an event.
- **Header:** the meta line stays `nextLabel(events)`. The + opens the Calendar app with
  the `add` intent, as now.
- **Midnight:** one `setTimeout` at local midnight re-renders both lists. Today's widget
  already has this timer; it stays the only one. `destroy()` removes both subscriptions,
  the timer and the `ResizeObserver`.
- **Sizes:** sizes change while the widget is mounted, so the hero is built once and laid
  out purely from `widget--small|medium|large` in CSS, like the other widgets. Nothing is
  rebuilt for one size.

### The pure part (node-tested)

`web/js/apps/countdown/format.js` moves to `web/js/apps/calendar/countdowns.js`, with
`tests/js/countdown.test.js` going with it as `tests/js/calendar-countdowns.test.js`. A
new pure function there decides what the widget shows:

`widgetRows({ events, countdowns, today, heroCount })` returns
`{ heroes, rows }`.

- `heroes`: the first `heroCount` upcoming countdowns.
- `rows`: the agenda items, merged by date, with three rules:
  - Hero countdowns are left out.
  - Other countdowns appear as `{ countdown: true, days }` rows.
  - An event matching a countdown (same day and title) is marked as a countdown and
    takes its place.

`heroCount` is 1 for small and medium, and 3 for large. The widget calls it again when
its size changes. That's a re-render, not a rebuild: the same nodes are reconciled. It
is tested for:

- the hero being left out of the agenda
- a countdown matched to an event
- a countdown on the same day as an unrelated event
- no countdowns at all
- today's countdown
- a countdown that's already been

### Calendar app (`web/js/apps/calendar/app.js`)

- **The add form:**
  - A **Count down to this** switch joins the form rows: a `role="switch"` button with a
    48px hit area that reads well from across the room.
  - While it's on:
    - The Time, Details and Goes-on rows hide. A countdown is a name and a day.
    - The title is limited to 40 characters, the countdown server's limit.
    - Add sends to `countdown.addCountdown(title, date)` instead of the calendar.
    - The toast offers Undo, like the old Countdown app.
  - After adding, the switch turns back off.
- **A Countdowns panel in the side column, above Calendars:**
  - The upcoming countdowns, soonest first: the days left in the countdown colour, the
    name, the day, and a remove button (with Undo).
  - Under them, a collapsed "Been and gone" list, carried over from the Countdown app,
    where each one has its own remove button (with Undo). There's no clear-all button
    today and none is added.
  - With no countdowns, the panel shows a one-line hint ("Switch on Count down to this
    when you add something").
- **Count down to this, from an event:**
  - Every agenda event gets a small hourglass button (48px, next to remove), shown on
    Google and iCal events too.
  - Tapping it adds a countdown with the event's title (cut to 40 characters) and its
    first day.
  - Events already counted down to (same day and title) show the button pressed.
    Tapping a pressed button removes that countdown.
- **The agenda in the app:** countdown days are shown in the agenda too, with the same
  merge rules as the widget (there's no hero here, so all of them show), as countdown
  rows within their day.
- **Phones:** the compact layout keeps working. The side column already comes after the
  agenda there (`order: 5`), so the Countdowns panel sits below the agenda. That's fine,
  because the agenda shows the countdown rows itself.

### Removed

These go:

- `web/js/apps/countdown/` (`app.js`, `widget.js`, `meta.js`, `index.js`)
- its `APPS` entry, its `DEFAULT_WIDGETS` entry and `WIDGETS_SINCE.countdown`
- `web/css/apps/countdown.css` and its `<link>` in `index.html`
- the `countdown` entry in `app-subtitles.js`
- `--icon-countdown`
- the countdown lines in `apple.css`: the empty-state selectors, and the widget accent
  that moves to the calendar's countdown numbers

The styles the hero, the panel and the switch need move into `calendar.css`.
`--accent-countdown` stays as the countdown colour in Glass. Each theme keeps a
countdown colour token (`--countdown-number` today) that passes AA.

In Blocks, the numbers use the Blocks Digits font through the existing font stacks, with
no font-family of their own.

`#/app/countdown` (a phone that saved the old link) opens the Calendar app.
`route()` in `app-host.js` gets a small alias table for it. Without that, an unknown app
quietly goes home.

### Saved home screens (`services/settings.js`, version 13)

`SCHEMA_VERSION` goes to 13, and 12 joins `UPGRADABLE`. When a screen saved at 12 or
earlier is loaded, its board `pages` and its Glass `applePages` are each handled on
their own:

- **It has a Countdown placement and no Calendar:** the Countdown placement becomes a
  Calendar placement, with the same `col`, `row` and `size`. Calendar supports small,
  medium and large, so every Countdown size is valid.
- **It has both:** the Countdown placement is dropped, leaving a gap. Nothing else
  moves.
- **Neither:** nothing changes.

This runs before `normalize`, alongside `renameWidgets`, so the unknown `countdown` id
is never seen. It's tested in the settings tests, including Glass and a Countdown on
page 2.

### Docs

- **`CLAUDE.md`:**
  - The widget list goes from ten to nine. Countdown is described as part of Calendar:
    its list still lives in `data/countdowns.json` through `board/countdown.py`, and the
    pure maths is in `web/js/apps/calendar/countdowns.js`.
  - The settings version history gets one line.
- **`README.md`:** the same change wherever Countdown is listed.

### Testing and checking

- `npm test` passes, including `tests/js/widget-sizes.test.js` and the moved and new
  countdown tests.
- The widget is rendered in the real board (`python3 run.py`) at small, medium and large
  in Light, Dark, Blocks and Glass, with three, one and no countdowns. The kiosk
  scale is checked at 1920 × 1080, and the phone layout at 390px wide.
- Checked by hand: the add form's switch, the hourglass button on an event and the
  Countdowns panel's remove and clear.

## Calls made without asking (check these)

- The countdown colour per theme is lime in Glass (as now), and whatever
  `--countdown-number` is in the others.
- The hourglass button on every event, including Google and iCal ones, is how you count
  down to an existing event. It copies the event; it doesn't link to it.
- Countdown and event titles are matched case-insensitively and trimmed to spot
  duplicates. Different spellings show twice.
- On a screen that had both widgets, the Countdown's place is left empty rather than
  everything shuffling up to fill it.
- `#/app/countdown` opens Calendar, rather than going home.
- The design doc lives in `specs/`, because `docs/` is the public website.

## Left to the builder

- Exact sizes, spacing and the hero's type scale at each size and in each theme. The
  mockup is a guide, and the 10-foot type minimums in `CLAUDE.md` win.
- The hourglass glyph: reuse the Countdown icon's hourglass shape.
- How the "Been and gone" list collapses.
