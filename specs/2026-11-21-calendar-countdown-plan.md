# Countdowns Into The Calendar: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the Countdown widget and app into the Calendar widget and app (design A,
"Countdown up top"), keeping countdowns in their own store.

**Architecture:** The countdown store, API and `services/countdown.js` stay the same.
The countdown maths moves into `web/js/apps/calendar/countdowns.js`, together with a
new pure merge (`markCountdowns`, `widgetRows`) that both the widget and the app use.
The Calendar widget and app subscribe to both services. The Countdown app's folder,
CSS and registrations are deleted, and settings version 13 turns a saved Countdown
placement into Calendar.

**Tech Stack:** Vanilla ES modules, CSS, `node --test` and the Python unittest (via
`npm test`). No packages.

**Spec:** `specs/2026-11-21-calendar-countdown-design.md`

## Global Constraints

- Vanilla HTML/CSS/ES6+ only, no build step and no new dependencies.
- **Hit targets** are at least 48×48px.
- **Text** is at least 18–20px for body text, and AA contrast in Light, Dark, Blocks and
  Glass.
- **Colours** come from tokens. No hard-coded colour in a component. Blocks numbers
  inherit the Blocks font stacks and get no font-family of their own.
- **Lifecycle:** `destroy()` and `unmount()` remove every subscription, timer and
  observer. There's one midnight `setTimeout` per widget or app, as now.
- **Sizes:** they change while mounted. Nothing is built for one size only at creation
  time, and layout per size comes from `widget--small|medium|large`.
- **Server limits:** a countdown title is at most 40 characters
  (`board/countdown.py MAX_TITLE_LENGTH`), and a countdown's day is up to 5 years
  ahead.
- **Unchanged:** `board/`, `/api/countdown/*` and `web/js/services/countdown.js`.
- **Commits:** subjects in the repo's style ("Calendar: …", Title Case), ending with the
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line. Work happens on a
  branch, not `master`.

## Review Focus

1. **A Google event with a title over 40 characters**, counted down to from the app,
   must still be recognised as the same thing as its countdown (whose title the server
   cut to 40). Otherwise it shows twice. Test: Task 1,
   `a long event title still matches its 40-character countdown`.
2. **A countdown whose day has passed** never shows in the widget. One that's today
   shows as "Today". Test: Task 1, `today's countdown leads; yesterday's is gone`.
3. **Two countdowns on one day, or a countdown on the same day as an unrelated
   event,** both show, with neither swallowed. Test: Task 1,
   `only a same-titled event is folded into its countdown`.
4. **A Glass screen that had Countdown on page 2 and no Calendar** gets Calendar in that
   exact cell, and the board layout agrees. Test: Task 2,
   `a version 12 screen with only Countdown gets Calendar in its place, on Glass too`.
5. **The medium widget's "then" line** names countdowns 2 and 3. Those must not also
   show as agenda rows. Test: Task 1, `heroes are never also rows`, with
   `heroCount: 3`.

---

### Task 1: Countdown maths moves into Calendar, plus the merge

**Files:**
- Create: `web/js/apps/calendar/countdowns.js` (the body of
  `web/js/apps/countdown/format.js` moved here unchanged, plus the new exports below)
- Delete: `web/js/apps/countdown/format.js`
- Modify: `web/js/apps/countdown/app.js:7`, `web/js/apps/countdown/widget.js:7` and
  `web/js/app-subtitles.js:4`, so their imports point at the new path. These keep
  working until Task 5 deletes them.
- Rename: `tests/js/countdown.test.js` → `tests/js/calendar-countdowns.test.js`, with
  its import path updated.

**Interfaces:**
- Consumes: `upcoming(events, { from, limit })` → `{ rows, total }` and
  `mergeEvents(...)` from `calendar/agenda.js`. Merged events have
  `{ id, title, date, time, endTime, endDate, days, color, ours, writable, ... }`, where
  `days` is the event's span.
- Produces, all from `web/js/apps/calendar/countdowns.js`:
  - Everything `format.js` exported, with the same names and behaviour: `daysLeft`,
    `upcoming`, `finished`, `bigNumber`, `leftLabel`, `dateLabel`, `countLabel`,
    `nextLabel` and `spoken`. Importers that also use agenda's `upcoming` import this
    one as `upcoming as upcomingCountdowns`.
  - `MAX_COUNTDOWN_TITLE = 40`
  - `sameThing(event, countdown) → boolean`: true when `event.date === countdown.date`
    and `fold(event.title).slice(0, 40).trim() === fold(countdown.title)`. Here `fold`
    trims, collapses whitespace and lower-cases.
  - `markCountdowns(events, countdowns, today) → events[]`:
    - Each event matching an upcoming countdown gets
      `countdown: { id, left }`.
    - Each upcoming countdown with no matching event is added as
      `{ id: 'countdown:' + id, title, date, time: null, endTime: null, endDate: date,
      days: 1, color: null, ours: false, writable: false, countdown: { id, left } }`.
    - Finished countdowns are ignored. The result is sorted the way `mergeEvents`
      sorts.
  - `widgetRows({ events, countdowns, today, heroCount, limit }) → { heroes, rows,
    total }`:
    - `heroes` is the first `heroCount` of `upcoming(countdowns, today)`, with `days`
      on each.
    - `rows` and `total` come from agenda's `upcoming(markCountdowns(events,
      nonHeroes, today), { from: today, limit })`, after dropping every event for
      which `sameThing(event, hero)` holds for some hero.

- [ ] **Step 1: Move the file and the test.**
  - `git mv web/js/apps/countdown/format.js web/js/apps/calendar/countdowns.js`
  - `git mv tests/js/countdown.test.js tests/js/calendar-countdowns.test.js`
  - Change the test's import to `../../web/js/apps/calendar/countdowns.js`, and the
    three importers listed under Files.
  - In `countdowns.js`, the import from `'../calendar/agenda.js'` becomes
    `'./agenda.js'`.

- [ ] **Step 2: Run `node --test tests/js/calendar-countdowns.test.js`.** Expected:
  PASS. This confirms the move broke nothing.

- [ ] **Step 3: Write the failing tests** in `tests/js/calendar-countdowns.test.js`.
  They use the file's existing `finals` (Dec 14), `winter` (Dec 22) and `spring`
  (2027-01-27), a new `const NOW = '2026-11-21'` (the file's `TODAY` is Nov 20 and
  stays), and events run through `mergeEvents` from `agenda.js`.

```js
test('only a same-titled event is folded into its countdown', () => {
  const events = mergeEvents({ events: [
    { id: 'e1', title: '  umd FINALS ', date: '2026-12-14' },
    { id: 'e2', title: 'Library shift', date: '2026-12-14', time: '09:00' },
  ] });
  const twin = { id: 'c2', title: 'Pack', date: '2026-12-14' };
  const marked = markCountdowns(events, [finals, twin], NOW);
  assert.deepEqual(marked.map((e) => [e.title, e.countdown?.id ?? null]), [
    ['umd FINALS', 'a'], ['Pack', 'c2'], ['Library shift', null],
  ]);
  assert.equal(marked[0].countdown.left, 23);
});

test('a long event title still matches its 40-character countdown', () => {
  const long = 'Department of Computer Science end-of-semester showcase';
  const events = mergeEvents({ events: [{ id: 'e', title: long, date: '2026-12-11' }] });
  const cut = { id: 'c', title: long.slice(0, 40).trim(), date: '2026-12-11' };
  assert.equal(sameThing(events[0], cut), true);
  assert.equal(markCountdowns(events, [cut], NOW).length, 1);
});

test('heroes are never also rows', () => {
  const events = mergeEvents({ events: [{ id: 'e', title: 'UMD finals', date: '2026-12-14' }] });
  const one = widgetRows({ events, countdowns: [finals, winter, spring], today: NOW, heroCount: 1, limit: 10 });
  assert.deepEqual(one.heroes.map((h) => [h.id, h.days]), [['a', 23]]);
  assert.deepEqual(one.rows.map((r) => r.countdown?.id), ['b', 'c']);
  const three = widgetRows({ events, countdowns: [finals, winter, spring], today: NOW, heroCount: 3, limit: 10 });
  assert.equal(three.heroes.length, 3);
  assert.deepEqual(three.rows, []);
});

test("today's countdown leads; yesterday's is gone", () => {
  const rows = widgetRows({ events: [], countdowns: [finals, winter], today: '2026-12-14', heroCount: 1, limit: 10 });
  assert.equal(rows.heroes[0].days, 0);
  assert.equal(bigNumber(rows.heroes[0].days).number, 'Today');
  const after = widgetRows({ events: [], countdowns: [finals, winter], today: '2026-12-15', heroCount: 1, limit: 10 });
  assert.deepEqual(after.heroes.map((h) => h.id), ['b']);
  assert.deepEqual(after.rows, []);
});

test('with no countdowns it is just the agenda', () => {
  const events = mergeEvents({ events: [{ id: 'e', title: 'Rent due', date: '2026-11-24' }] });
  const result = widgetRows({ events, countdowns: [], today: NOW, heroCount: 3, limit: 10 });
  assert.deepEqual(result.heroes, []);
  assert.deepEqual(result.rows.map((r) => r.id), ['e']);
  assert.equal(result.total, 1);
});
```

- [ ] **Step 4: Run `node --test tests/js/calendar-countdowns.test.js`.** Expected:
  FAIL, because `markCountdowns`, `sameThing` and `widgetRows` aren't exported.

- [ ] **Step 5: Implement `MAX_COUNTDOWN_TITLE`, `sameThing`, `markCountdowns` and
  `widgetRows`** in `countdowns.js`, as specified under Interfaces. Import `upcoming as
  upcomingEvents` from `./agenda.js`. Sort the result of `markCountdowns` by date, then
  all-day before timed, then time, then title, so it matches `order()` in
  `agenda.js`.

- [ ] **Step 6: Run `npm test`.** Expected: PASS, with the old Countdown widget and app
  still working.

- [ ] **Step 7: Commit:** `Calendar: Move The Countdown Maths Into The Calendar`.

---

### Task 2: Saved screens: Countdown becomes Calendar (settings version 13)

**Files:**
- Modify: `web/js/services/settings.js`. Change `SCHEMA_VERSION` (line 26),
  `UPGRADABLE` and the version comment above them, add a new export after
  `renameWidgets`, and call it in `load()`.
- Test: `tests/js/settings.test.js`

**Interfaces:**
- Produces `foldCountdown(raw) → raw`, exported from `settings.js`, with the same input
  shapes as `renameWidgets`: pages of placements or of plain ids, or anything else,
  which is returned untouched. A page set holds at most one widget of an id. For each
  page set:
  - **No `calendar` anywhere in the set:** the first `countdown` becomes `calendar`,
    keeping its object's other fields.
  - **Otherwise:** every `countdown` is removed.
- `load()` applies `foldCountdown` to `saved.pages` and `saved.applePages` before
  `renameWidgets`, on every path (version 1's `[saved.widgets]` included).
- `SCHEMA_VERSION = 13`, and `UPGRADABLE` gains `12`.

- [ ] **Step 1: Write the failing tests** in `tests/js/settings.test.js`. Use an
  `options()` variant whose `widgets` include `calendar` and do **not** include
  `countdown`, as in the real board after Task 5.

```js
test('a version 12 screen with only Countdown gets Calendar in its place, on Glass too', () => {
  const settings = createSettingsService(options(saved({
    version: 12, theme: 'apple',
    pages: [[at('weather', 'medium', 4, 1)], [at('countdown', 'large', 1, 1)]],
    applePages: [[at('weather', 'medium', 1, 2)], [at('countdown', 'large', 1, 1)]],
  })));
  assert.deepEqual(settings.get().pages, [[at('weather', 'medium', 1, 2)], [at('calendar', 'large', 1, 1)]]);
  settings.setTheme('light');
  assert.deepEqual(settings.get().pages, [[at('weather', 'medium', 4, 1)], [at('calendar', 'large', 1, 1)]]);
});

test('a version 12 screen with both drops Countdown and moves nothing else', () => {
  const settings = createSettingsService(options(saved({
    version: 12, theme: 'light',
    pages: [[at('calendar', 'small', 4, 1), at('countdown', 'small', 6, 1), at('weather', 'medium', 8, 1)]],
  })));
  assert.deepEqual(settings.get().pages, [[at('calendar', 'small', 4, 1), at('weather', 'medium', 8, 1)]]);
});

test('an old screen that listed Countdown by id gets Calendar', () => {
  assert.deepEqual(foldCountdown([['weather', 'countdown']]), [['weather', 'calendar']]);
  assert.deepEqual(foldCountdown([['calendar'], ['countdown']]), [['calendar'], []]);
  assert.equal(foldCountdown(null), null);
});
```

  These layouts were checked against today's service: on Glass, page 1's top row is the
  clock's, so Weather sits at row 2. `get().pages` is the layout of the theme in use,
  and `setTheme('light')` switches it.

- [ ] **Step 2: Run `node --test tests/js/settings.test.js`.** Expected: FAIL, because
  `foldCountdown` isn't exported and Countdown isn't swapped.

- [ ] **Step 3: Implement `foldCountdown`** and wire it into `load()`. Bump the version,
  and add one comment line: "Version 13 folds Countdown into Calendar
  (`foldCountdown`)".

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit:** `Settings: Turn A Saved Countdown Widget Into Calendar`.

---

### Task 3: The Calendar widget shows the countdowns (design A)

**Files:**
- Modify: `web/js/apps/calendar/widget.js`
- Modify: `web/css/apps/calendar.css`, adding a "Countdowns in the widget" section after
  "Widget", with per-size and per-theme rules
- Modify: `web/css/apple.css`, so the `:is(.countdown-widget, .countdown-app)` rule at
  line 229 becomes `:is(.calendar-widget, .calendar-app)` and the accent line at 133 is
  removed. Countdown selectors in the empty-state rules are removed in Task 5.

**Interfaces:**
- Consumes: from Task 1, `widgetRows`, `upcoming as upcomingCountdowns`, `bigNumber`,
  `dateLabel` and `spoken`. Also `services.countdown.getState()` and `.subscribe(fn)`
  (state `{ countdowns }`).
- Produces: DOM only. This class structure is used by Task 4's CSS reuse:
  - `.calendar-widget__heroes` is a `ul` of `.calendar-widget__hero` items. Each holds
    `.calendar-widget__hero-number`, `.calendar-widget__hero-unit` (`"days to"`, or
    `"days"` at large, or empty on the day), `.calendar-widget__hero-title` and
    `.calendar-widget__hero-date`.
  - `.calendar-widget__then` is the medium line (`"Winter break 31 · Next semester
    67"`), with each number in a `<b>`.
  - Agenda rows with a countdown get `.calendar-widget__item--countdown`, and
    `.calendar-widget__time` reads `leftLabel(days)` (for example "23 days").

**Behaviour:**
- **How many heroes:** `heroCount` is 1 for `node.dataset.size === 'small'`, and 3
  otherwise. At medium, the first is the hero and the other two make up the "then"
  line, hidden at small and large.
- **Re-rendering:**
  - `render()` uses the latest state of both services.
  - The existing `ResizeObserver` calls `render()` when `node.dataset.size` differs from
    the size last rendered, and `fit()` otherwise.
  - Heroes are reconciled by id with `reconcile()`. Up to 3 are kept in the DOM, and
    CSS hides the 2nd and 3rd at medium (`.widget--medium
    .calendar-widget__hero:nth-child(n+2) { display: none }`).
- **Empty state:** "Nothing on" shows only when there are no rows **and** no heroes.
- **Accessibility:** `aria-label` on each hero is `spoken(item, today)`.
- **Teardown:** `destroy()` also calls the countdown unsubscribe. The existing midnight
  timer re-renders both.
- **Layout:**
  - **Small:** a column (head, heroes, list, more).
  - **Medium:** a grid with areas `"head head" "hero list" "hero more"`, columns about
    `1fr 1.25fr`, and a hairline between.
  - **Large:** a column, with heroes as a 3-column grid divided by hairlines, then the
    list.
- **Hero number:** `--font-display`, weight 800, `tabular-nums`, coloured
  `var(--countdown-number)`.
  - Define `--countdown-number` in `calendar.css` on `.calendar-widget,
    .calendar-app`, as `var(--text)`, carried over from `countdown.css` line 8. Glass
    overrides it to `--accent-countdown` (the `apple.css` change above).
  - Carry over countdown.css's Blocks rules for numbers as needed.
- **Countdown rows:** in the agenda, they use the same colour for the title and the
  days.

- [ ] **Step 1: Implement the widget changes** in `widget.js`, as above.

- [ ] **Step 2: Write the CSS** for small, medium and large, and per theme.

- [ ] **Step 3: Run `npm test`.** Expected: PASS. `widget-sizes` is unaffected.

- [ ] **Step 4: Check it in the real board.**
  - Start the dev server with `preview_start` (add a `.claude/launch.json` entry
    running `python3 run.py`, port 8080, if there isn't one).
  - In edit mode, put Calendar at small, medium and large on the board layout and on
    Glass, in each of Light, Dark, Blocks and Glass.
  - Expected at each: three heroes at large, one hero plus the "then" line at medium,
    one hero at small.
  - Nothing is clipped inside the card. The hero number is at least 2.4rem at small.
  - No countdown appears both as a hero (or in the "then" line) and as a row.
  - Remove all countdowns through `/api/countdown/remove`, or temporarily empty them,
    and confirm the widget looks exactly like it does on `master`.
  - Screenshot the 12 combinations for the final report.

- [ ] **Step 5: Commit:** `Calendar: Show The Countdowns In The Calendar Widget`.

---

### Task 4: The Calendar app takes over adding and managing countdowns

**Files:**
- Modify: `web/js/apps/calendar/app.js`
- Modify: `web/css/apps/calendar.css`, adding the switch, the Countdowns panel, the
  hourglass button and countdown agenda rows. Port the needed bits of
  `countdown.css`'s app section, Blocks rules included.

**Interfaces:**
- Consumes: from Task 1, `markCountdowns`, `upcoming as upcomingCountdowns`,
  `finished`, `bigNumber`, `leftLabel`, `dateLabel` and `MAX_COUNTDOWN_TITLE`. Also
  `services.countdown`: `addCountdown(title, date)`, `removeCountdown(id)`,
  `restoreCountdowns(ids)`, `getState()` and `subscribe(fn)`.
- Produces: `intent('add')` behaves as today.

**Behaviour:**
- **The Count down to this switch:**
  - A `button.when-row__switch` with `role="switch"` and `aria-checked`, at least 48px
    tall, in a new `row('Countdown', switchButton)` placed after `whenRow`.
  - While on:
    - `timeRow`, `detailRow` and `calendarRow` are hidden.
    - `title.maxLength` is 40 (it's 80 while off).
    - Submitting calls `countdown.addCountdown(title.value, draft.date)` instead of the
      calendar.
    - On success, the toast reads `"Counting down to {title}"` with an Undo that calls
      `removeCountdown(result.countdown.id)`. `addCountdown` resolves to the server's
      answer, `{ state, countdown }` (`board/countdown.py`'s `add`).
    - The title is cleared and the switch goes back off.
- **The Countdowns panel:**
  - A `section.panel.panel--countdowns` with the title "Countdowns", placed first in
    `.calendar-app__side`.
  - Upcoming countdowns, soonest first, each showing: the big `bigNumber` number in
    `--countdown-number`, the name, `dateLabel`, and a 48px remove button. Removing
    gives a toast with Undo (`restoreCountdowns([id])`), worded as in today's
    `countdown/app.js:129-138`.
  - A `details` "Been and gone" with `finished()` items, each with the same remove
    button, hidden when there are none.
  - With none at all: `"Switch on Count down to this when you add something."`
- **The agenda:**
  - `render()` runs `groupByDay(markCountdowns(events, countdowns, today), …)`.
  - Rows with `event.countdown` get `.agenda__event--countdown`. Their `agenda__when`
    reads `leftLabel(event.countdown.left)`.
  - Every row gets a 48px hourglass `button.agenda__count`, with `aria-pressed` set to
    `Boolean(event.countdown)` and the label "Count down to {title}" or "Stop counting
    down to {title}".
  - Pressing it: if pressed, `removeCountdown(event.countdown.id)`. If not,
    `addCountdown(event.title.slice(0, 40), event.date)`.
  - Pseudo-rows (ids starting `countdown:`) hide the × button, because the hourglass
    removes them.
- **Subscriptions:** the app subscribes to `countdown` as well. `unmount()`
  unsubscribes, and the midnight timer re-renders both.
- **Phones:** no layout change. The side column already follows the agenda at
  `order: 5`.

- [ ] **Step 1: Implement the switch and its submit path.**

- [ ] **Step 2: Implement the Countdowns panel.**

- [ ] **Step 3: Implement the countdown rows and the hourglass button in the agenda.**

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Check it in the real board.**
  - **Glass, kiosk size:**
    - Switch on, type "Spring break", pick a day and Add. Expected: the toast, the new
      countdown in the panel, a lime row in the agenda, and the widget updated behind.
    - Undo removes it.
    - Tap the hourglass on an ordinary event. Expected: it presses, the row turns
      countdown-coloured with its days, and the panel lists it. Tap it again and it's
      gone.
  - **Phone (390 × 844):** the switch and the panel are usable with a finger.
  - **Blocks:** numbers use the Blocks digits.

- [ ] **Step 6: Commit:** `Calendar: Add Countdowns From The Calendar App`.

---

### Task 5: Remove the Countdown widget and app

**Files:**
- Delete: `web/js/apps/countdown/` (`app.js`, `widget.js`, `meta.js`, `index.js`) and
  `web/css/apps/countdown.css`
- Modify:
  - `web/index.html:33`: drop the stylesheet link.
  - `web/js/apps/index.js`: drop the import, the `APPS`, `DEFAULT_WIDGETS` and
    `WIDGETS_SINCE` entries, and Countdown in the comment.
  - `web/js/app-subtitles.js`: drop the import and the `countdown` entry.
  - `web/css/tokens.css`: remove the `--icon-countdown` lines (69 and 317, and the
    comment at 68). Keep `--accent-countdown`.
  - `web/css/apple.css`: remove the countdown selectors in the empty-state rules
    (lines 209, 216 and 224).
  - `web/js/app-host.js`: in `route()` (line 141), add
    `const ALIASES = { countdown: 'calendar' }` and look the app up by
    `ALIASES[match[1]] ?? match[1]`.
  - `CLAUDE.md`:
    - In Widget Scope, nine widgets. Countdown is described inside Calendar: the list
      in `data/countdowns.json` through `board/countdown.py`, shown above the agenda,
      added with the Count down to this switch. The pure maths is in
      `web/js/apps/calendar/countdowns.js`.
    - Drop the separate Countdown sentence.
  - `README.md`: the same wherever Countdown is listed.

- [ ] **Step 1: Make the deletions and edits above.**

- [ ] **Step 2: Run
  `grep -rn "countdown" web/js web/css web/index.html | grep -v "services/countdown\|calendar/countdowns\|countdown-number\|accent-countdown\|countdown\b.*service"`.**
  Expected: only intended references (the Calendar app and widget using
  `services.countdown`, and sports' unrelated kickoff "countdown"). Read each hit.

- [ ] **Step 3: Run `npm test`.** Expected: PASS. `widget-sizes` now checks one app
  fewer.

- [ ] **Step 4: Check it in the real board.**
  - With a pre-change settings blob in localStorage (version 12, Countdown placed and
    no Calendar), reload. Expected: Calendar sits in Countdown's cell.
  - The app library has no Countdown.
  - Opening `#/app/countdown` opens Calendar.
  - There are no console errors.

- [ ] **Step 5: Commit:** `Countdown: Fold The Countdown Widget Into Calendar`.
