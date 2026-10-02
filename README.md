# Home Board

A shared board for the apartment that runs full screen on a Raspberry Pi and
looks like an iPad home screen: a big clock, widgets, and a dock of apps. The
wallpaper follows the real sky, so it's blue during the day, glows at sunset,
and turns to stars at night, with the widgets switching to dark mode after dark.

It has three widgets:

- **Shopping list.** Anyone can add to it on the board's touchscreen or from
  their phone (scan the QR code in the app). Changes show up everywhere instantly.
- **Notes.** Sticky notes for everyone at home ("Rent is due Friday").
- **Weather.** Today and the next four days, from [Open-Meteo](https://open-meteo.com) (free, no account).

The menu button in the top-right corner switches the theme (Auto, Light, Dark,
or Retro, an 8-bit look), adds and removes widgets, and on the board itself
exits full screen.

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
- **Menu (top right):** pick a theme, or tap **Add widget** to add or remove
  widgets. These choices are saved separately on each screen, so your phone
  can look different from the board.
- In kiosk mode, the board goes back to the home screen after 90 seconds
  untouched, and it reloads itself once a night at 4am to stay fresh.

## Settings

`config.json` is optional:

```json
{ "port": 8080, "latitude": 40.71, "longitude": -74.01, "units": "fahrenheit" }
```

Set your latitude and longitude to get the **weather** and to match the sky's
sunrise and sunset to yours. Without them, the Weather widget asks for them and
the board estimates sunrise and sunset from your timezone (up to an hour off).
`units` is `"fahrenheit"` or `"celsius"` (the default). The weather needs the Pi
to be online; it's fetched at most every 15 minutes and shared by every screen.
Restart after changing settings: `sudo systemctl restart widget-board`.

The shopping list and notes are saved on the Pi in `data/shopping.json` and
`data/notes.json`.

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

Add `?at=19:30` to the URL to preview the board at another time of day.

The rules for working on the board (Pi performance limits, the 1920×1080
layout, text sizes, contrast, touch targets) are in [CLAUDE.md](CLAUDE.md).
Claude Code follows them automatically, and they're worth a read for people too.

Project layout:

```
run.py                  start the server
board/                  server: JSON stores, HTTP API + live updates, weather, QR codes
web/
  index.html            the board: a 1920×1080 canvas (phones get a one-column layout)
  css/tokens.css        colours, type sizes and the Light / Dark / Retro themes
  js/main.js            starts everything
  js/services/          the only code that talks to the server or localStorage
  js/apps/<id>/         one folder per app: index.js, widget.js, app.js
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

Anyone on your Wi-Fi can open and edit the list and notes. There are no
accounts. Only the board's own screen can use Exit to desktop.
