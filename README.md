# Home Board

A shared board for the apartment that runs full screen on a Raspberry Pi and
looks like an iPad home screen: a big clock, widgets, and a dock of apps. The
wallpaper follows the real sky, so it's blue during the day, glows at sunset,
and turns to stars at night, with the widgets switching to dark mode after dark.

The first app is a **shopping list**. Anyone can add to it on the board's
touchscreen or from their phone (scan the QR code in the app). Changes show
up everywhere instantly.

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

To get out of kiosk mode for maintenance, press **Alt+F4** with a keyboard plugged in.

## Using it

- **On the board:** tap the widget or the dock icon to open the list. On a
  touchscreen an on-screen keyboard appears. Suggestions above the keys
  come from what you've bought before.
- **On your phone:** open the shopping list on the board and scan the QR code
  under "On your phone", or go to `http://<pi-ip>:8080`. You need to be on the
  same Wi-Fi.
- Tap an item to mark it bought. Tap **Clear bought** once things are put away.
  Removing or clearing items can be undone from the message that pops up.
- In kiosk mode, the board goes back to the home screen after 90 seconds
  untouched, and it reloads itself once a night at 4am to stay fresh.

## Settings

`config.json` is optional:

```json
{ "port": 8080, "latitude": 40.71, "longitude": -74.01 }
```

Set your latitude and longitude so the sky's sunrise and sunset match yours
exactly. Without them, the board estimates your location from the timezone,
which can put sunrise and sunset off by up to an hour. Restart after
changing it: `sudo systemctl restart widget-board`.

The list is saved in `data/shopping.json`.

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

Project layout:

```
run.py              start the server
board/              server: shopping list store, HTTP API + live updates, QR codes
web/                the board itself
  js/main.js        home screen, clock, opening and closing apps
  js/sky.js         sun position and the wallpaper colors
  js/apps/          one module per app (shopping.js has the app and its widget)
  js/keyboard.js    on-screen keyboard for kiosk mode
pi/                 Raspberry Pi install script, kiosk launcher, service file
tests/              unit tests (Python unittest + node --test)
```

### Adding an app

Create `web/js/apps/<name>.js` exporting `id`, `name`, `iconBackground`,
`iconGlyph`, `mount(root, context)` and, if it has one, `widget(context)`.
Then list it in `web/js/apps/index.js`. It will show up in the dock, and its
widget will appear on the home screen. Use `shopping.js` as the example.

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

Anyone on your Wi-Fi can open and edit the list. There are no accounts.
