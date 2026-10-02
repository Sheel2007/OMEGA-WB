# Home Board

A shared board for the apartment that runs full screen on a Raspberry Pi and
looks like an iPad home screen: a big clock, widgets, and a dock of apps. The
wallpaper follows the real sky, so it's blue during the day, glows at sunset,
and turns to stars at night, with the widgets switching to dark mode after dark.

It has five widgets:

- **Shopping list.** Anyone can add to it on the board's touchscreen or from
  their phone (scan the QR code in the app). Changes show up everywhere instantly.
- **Calendar.** What's coming up: birthdays, holidays and appointments from your
  Google Calendars. Anyone can add an event on the board or from their phone and
  it goes straight into Google Calendar.
- **Notes.** Sticky notes for everyone at home ("Rent is due Friday").
- **Weather.** Today and the next four days, from [Open-Meteo](https://open-meteo.com) (free, no account).
- **Games.** Four in a Row, Reversi, and Dots and Boxes, for two people taking
  turns on the board, or one person against the board.

The home screen has pages you swipe between, like an iPad, and you can arrange
the widgets yourself. The menu button in the top-right corner switches the
theme (Auto, Light, Dark, or **Blocks**, a blocky pixel world whose sky follows
the real time of day, with a cat, fox, slime or robot wandering by depending on
the hour), adds and removes widgets, and on the board itself exits full screen.

Everything runs on what ships with Raspberry Pi OS: a small Python server
(standard library only) and plain HTML/CSS/JS. There's nothing to install
and no build step.

## Set it up on the Pi

You need Raspberry Pi OS **with desktop**, connected to your home Wi-Fi.

```bash
git clone <this repo> ~/Widget-Board     # or copy the folder over
cd ~/Widget-Board
cp config.example.json config.json       # optional, see "Settings" below
sudo ./pi/install.sh
sudo reboot
```

After the reboot, the board opens full screen by itself. The install script:

- runs the server on boot as a systemd service (`widget-board`), restarting it if it ever stops
- opens Chromium in kiosk mode (no tabs or address bar) when the desktop starts
- installs the color emoji font used for item icons
- turns off screen blanking so the board stays on

- adds **Widget Board** to the Pi's app menu, for reopening the board after you exit it

To get out of kiosk mode for maintenance, open the menu (top right) and tap
**Exit to desktop** twice. You can also press **Alt+F4** with a keyboard plugged in.
To bring the board back, pick **Widget Board** from the Pi's app menu, or reboot.

## Using it

- **On the board:** tap the widget or the dock icon to open the list. On a
  touchscreen an on-screen keyboard appears. Suggestions above the keys
  come from what you've bought before.
- **On your phone:** open the shopping list on the board and scan the QR code
  under "On your phone", or go to `http://<pi-ip>:8080`. You need to be on the
  same Wi-Fi.
- Tap an item to mark it bought. Tap **Clear bought** once things are put away.
  Removing or clearing items can be undone from the message that pops up.
- **Notes:** tap + on the Notes widget to post one. Tap × on a note to take
  it down (you can undo that too).
- **Calendar:** type what's happening, then fill in as much as you like:
  - **When** — a day button (Today, Tomorrow, the week ahead) or the date picker.
  - **Time** — leave it **All day** and pick how many days it runs, or set a start
    time and tap **30 min / 1 hr / 2 hr / 4 hr** (or set the end time yourself).
  - **Details** — a place and a note, both optional.
  - **Goes on** — which Google calendar it lands on, or **This board**. Only shown
    when more than one is available.

  Tap × to take an event off; **Undo** puts it back, on Google too. Events from
  calendars you can't write to (Holidays, Birthdays) have no × and say which
  calendar they came from. There's a QR code under "On your phone" for adding
  events from your phone.
- **Pages:** swipe left and right (or tap the dots above the dock).
- **Arranging widgets:** hold a widget for half a second (or pick **Edit home
  screen** in the menu). Then drag widgets around; hold one against the left or
  right edge to carry it to another page (or to a new page past the last one).
  Tap − to remove a widget, **Add widget** to add one, and **Done** when you're
  finished. On a phone, use the ↑ ↓ buttons instead of dragging.
- **Games:** tap a game on the Games widget. Choose **2 players** to take turns
  on the board or **vs Computer** to play the board. A game in progress is kept
  (even through the nightly reload) until you start a new one.
- **Blocks theme:** tap the visiting critter and it jumps. If you'd rather have a
  still picture, turn off **Moving scenery** in the menu.
- **Menu (top right):** pick a theme, add or remove widgets, or edit the home
  screen. These choices are saved separately on each screen, so your phone can
  look different from the board.
- In kiosk mode, the board goes back to the home screen after 90 seconds
  untouched, and it reloads itself once a night at 4am to stay fresh.

## Settings

`config.json` is optional; see `config.example.json` for the whole thing:

```json
{ "port": 8080, "latitude": 40.71, "longitude": -74.01, "units": "fahrenheit" }
```

Set your latitude and longitude to get the **weather** and to match the sky's
sunrise and sunset to yours. Without them, the Weather widget asks for them and
the board estimates sunrise and sunset from your timezone (up to an hour off).
`units` is `"fahrenheit"` or `"celsius"` (the default). The weather needs the Pi
to be online; it's fetched at most every 15 minutes and shared by every screen.
Restart after changing settings: `sudo systemctl restart widget-board`.

The shopping list, notes and any calendar events kept on the board itself are
saved on the Pi in `data/shopping.json`, `data/notes.json` and `data/calendar.json`.

### Google Calendar

The board can read *and* write your Google calendars. Connecting an account is a
one-off job on the Pi:

1. Go to the [Google Cloud console](https://console.cloud.google.com/), make a
   project, and under **APIs & Services** enable the **Google Calendar API**.
2. Under **APIs & Services → OAuth consent screen**, pick **External**, fill in
   the app name and your email, and add yourself as a **Test user**.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**.
   Copy the client ID and secret into `config.json`:

   ```json
   {
     "google": {
       "client_id": "000000000000-yourclient.apps.googleusercontent.com",
       "client_secret": "GOCSPX-yoursecret"
     }
   }
   ```

4. Restart the server, open the **Calendar** app *on the board itself* and tap
   **Connect Google Calendar**. Sign in, say yes, and Google sends you back to
   the board.

The board then shows every calendar on the account — your own, **Birthdays**,
**Holidays in …** — and new events go onto the one marked *New events here*
(change it with the **Goes on** buttons when adding an event). Deleting an event
on the board deletes it in Google.

Connecting has to happen on the board's screen, because Google sends you back to
`http://127.0.0.1:8080`, which only means "the Pi" on the Pi itself. Everything
after that works from any phone on the Wi-Fi. If you'd rather not use a keyboard
on the board, plug one in for the sign-in, or use VNC.

The sign-in is saved in `data/google.json`, readable only by the user the server
runs as. **Disconnect Google** in the app removes it; you can also revoke the
board from your [Google account's app list](https://myaccount.google.com/permissions).

#### Without an account: read-only subscriptions

If you only want to *see* a calendar, use its **secret address in iCal format**
instead — no Google project, no sign-in:

```json
{
  "calendars": [
    { "name": "Holidays", "url": "https://calendar.google.com/calendar/ical/.../basic.ics", "color": "orange" }
  ]
}
```

Open Google Calendar on a computer, hover the calendar in the left sidebar →
**⋮ → Settings and sharing**, scroll to **Integrate calendar**, and copy
**Secret address in iCal format**. Treat those addresses like passwords: anyone
with one can read that calendar. `name` is optional (the calendar's own name is
used), `color` is one of `blue`, `purple`, `teal`, `pink`, `orange` or `green`,
and up to six are read. These are read-only; events added on the board go to
Google (if connected) or stay on the board.

`timezone` is an IANA name like `"Europe/London"`; without it the board uses the
Pi's own time zone, which is usually right. Calendars are read at most every 15
minutes, shared by every screen, and the next four months of birthdays, holidays
and repeating events are worked out on the Pi.

## Updating

```bash
cd ~/Widget-Board && git pull
sudo systemctl restart widget-board
```

The board notices the restart and reloads itself.

## Developing

```bash
python3 run.py                 # http://localhost:8080 (add ?kiosk=1 for kiosk behaviour)
npm test                       # Python + JS tests (no packages needed)
```

Add `?at=19:30` to the URL to preview the board at another time of day, and
`?critter=now` (or `?critter=stay`) to bring a Blocks critter out straight away
(or keep it on screen, for measuring).

The rules for working on the board (Pi performance limits, the 1920×1080
layout, text sizes, contrast, touch targets) are in [CLAUDE.md](CLAUDE.md).
Claude Code follows them automatically, and they're worth a read for people too.

Project layout:

```
run.py                  start the server
board/                  server: JSON stores, HTTP API + live updates, weather,
                        Google Calendar (OAuth + API), iCalendar parsing, QR codes
web/
  index.html            the board: a 1920×1080 canvas (phones get a one-column layout)
  css/tokens.css        colours, type sizes and the Light / Dark / Blocks themes
  css/scene.css         the Blocks scenery (pixel art) and critters
  js/main.js            starts everything
  js/services/          the only code that talks to the server or localStorage
  js/apps/<id>/         one folder per app: meta.js, widget.js, app.js, index.js
  js/widget-layout.js   where widgets go on each page (pure, tested)
  js/pager.js           swiping between pages; home-editor.js: edit mode
  js/scene/             Blocks critters (art, what they do, the low-rate ticker)
  js/menu.js            the top-right menu
  js/sky.js             sun position and the wallpaper colours
pi/                     Raspberry Pi install script, kiosk launcher, service file
tests/                  unit tests (Python unittest + node --test)
```

### Adding an app

Make a folder `web/js/apps/<id>/` like `notes/`:

- `meta.js` exports `id`, `name`, `description`, `widgetSize` (`tall`, `wide` or
  `medium`), `iconBackground` and `iconGlyph`.
- `widget.js` exports `createWidget(context)`, which returns `{ node, destroy }`.
  `destroy()` must undo every subscription, timer and observer the widget made.
- `app.js` (optional) exports `mount(root, context)` for a full-screen app.
  Apps with one get a dock icon.
- `index.js` re-exports all of that.

Add its styles in `web/css/apps/<id>.css`, link that file in `index.html`, and
list the app in `web/js/apps/index.js`. It then shows up in **Add widget**.

### Checking the Blocks scenery on the Pi

The moving scenery is built to cost almost nothing: it only moves things that
are already drawn (no repainting), ticks once a second for the clouds and 8
times a second while a critter is visiting, and stops completely while an app is
open. On a laptop it uses about 0.2% of one core for clouds and under 1% during
a visit. To check on the Pi itself:

1. Leave the board on Blocks for an hour, then run `vcgencmd get_throttled`
   (should print `throttled=0x0`) and `vcgencmd measure_temp`, and compare the
   temperature with an hour on Light.
2. Run `top` and watch the `chromium` processes for a few minutes on Blocks and
   on Light. They should be within a few percent of each other.
3. If either looks worse, turn off **Moving scenery** in the menu: Blocks then
   costs the same as Light.

## Troubleshooting

- **The board doesn't open after reboot.** Check that the server is up with
  `systemctl status widget-board`. If it is, run `~/Widget-Board/pi/kiosk.sh`
  from a terminal on the Pi to see any errors. On desktops that ignore
  `~/.config/autostart`, add the line `~/Widget-Board/pi/kiosk.sh &` to
  `~/.config/labwc/autostart`.
- **Emoji show as boxes.** Run `sudo apt install fonts-noto-color-emoji`.
- **Phones can't connect.** They must be on the same Wi-Fi, and some guest
  networks block devices from seeing each other. Try the IP address the
  board shows under "On your phone".
- **The screen still goes to sleep.** Turn off Screen Blanking in
  Raspberry Pi Configuration → Display.
- **The Weather widget says to add your location.** Put `latitude` and
  `longitude` in `config.json` (see Settings) and restart the server.
- **"Can't reach the weather service."** The Pi is offline, or Open-Meteo is
  down. The board keeps showing the last forecast for up to 6 hours.
- **A calendar says "Couldn't read this calendar."** The address is wrong or has
  been reset. Copy **Secret address in iCal format** again (it must end in
  `.ics`) and restart the server. The Calendar app lists each calendar and
  whether it's syncing.
- **"Google turned the board away."** The sign-in was revoked or expired. Tap
  **Disconnect Google**, then **Connect Google Calendar** again. While the OAuth
  consent screen is still in *Testing*, Google expires the board's sign-in after
  a week — publish the consent screen to stop that.
- **Connect Google Calendar says it must be done on the board.** The sign-in has
  to start from the Pi's own screen; a phone can't complete Google's redirect.
- **Calendar events are an hour out.** Set `timezone` in `config.json` to your
  IANA time zone, or fix the Pi's with `sudo raspi-config`.

Anyone on your Wi-Fi can open and edit the list and notes. There are no
accounts. Only the board's own screen can use Exit to desktop.
