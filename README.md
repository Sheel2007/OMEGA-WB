# Home Board

A shared board for the apartment that runs full screen on a Raspberry Pi and
looks like an iPad home screen: a big clock, widgets, and every app a swipe up away. The
wallpaper follows the real sky, so it's blue during the day, glows at sunset,
and turns to stars at night, with the widgets switching to dark mode after dark.

It has eight widgets, and a Sports page:

- **Calendar.** What's coming up: birthdays, holidays and appointments from your
  Google Calendars. Anyone can add an event on the board or from their phone and
  it goes straight into Google Calendar.
- **Notes.** Sticky notes for everyone at home ("Rent is due Friday").
- **Weather.** Today and the next four days, from [Open-Meteo](https://open-meteo.com) (free, no account).
- **Games.** Four in a Row, Reversi, and Dots and Boxes, for two people taking
  turns on the board or one person against the board, plus Blackjack against
  the dealer.
- **Lights.** The ceiling lights, through [Zigbee2MQTT](https://www.zigbee2mqtt.io)
  (set up as in [zigbee_ceiling](https://github.com/NLBoa/zigbee_ceiling)): tap a
  light to switch it, and set times for lights to go on and off by themselves.
- **Roommate Cup.** Roommate Games, the weekly competition at home. It keeps the
  catalog of games, picks each week's games, texts or emails everyone, and keeps
  score. The widget is a small scoreboard.
- **Grocery.** What to pick up at Lidl and Trader Joe's: scan a product's barcode
  or QR code with your phone, or search for it, and it goes on the list with its
  price, how many, and who's asking. The widget shows the total, split by store.
- **Spotify.** What's playing on the household's Spotify account: the cover in a
  circle with the song's name under it. It starts as a slim one-column widget that
  fits the gap beside the clock, and grows to show the artist, album and how far
  through the song it is.

**Sports** follows Arsenal and Tottenham (Premier League, FA Cup, League Cup and
Champions League), Maryland soccer in the Big Ten, and every Champions League
match. It isn't a widget: swipe right on the first home page (or tap the little
football before the page dots) and the Sports page slides in, with the match
that matters most right now, what's coming up, the latest results and a table.
On a day one of the teams plays, a strip under the clock counts down to kickoff
to the second, then shows the score and the minute all through the match. Tap
any match for its match page: the score and who scored, the line-ups on a pitch
with goals, assists, cards and substitutions, the team stats and a timeline.
While a followed team is playing, the Sports app opens straight onto that match.

The home screen has pages you swipe between, like an iPad, and you can arrange
the widgets yourself. The menu button in the top-right corner switches the
theme (Auto, Light, Dark, **Blocks**, a blocky pixel world whose sky follows
the real time of day, with a cat, fox, slime or robot wandering by depending on
the hour, or **Glass**, an iPadOS-style look with frosted cards over a soft
purple wallpaper, Inter type and iOS-shaped widgets), adds and removes widgets,
and on the board itself exits full screen. Each screen remembers its own theme,
and Glass keeps its own widget arrangement, so switching back leaves the other
layout as it was.

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
- sets up Zigbee for the Lights widget, if a Zigbee USB dongle is plugged in (see "Lights" below)

- adds **Widget Board** to the Pi's app menu, for reopening the board after you exit it

To get out of kiosk mode for maintenance, open the menu (top right) and tap
**Exit to desktop** twice. You can also press **Alt+F4** with a keyboard plugged in.
To bring the board back, pick **Widget Board** from the Pi's app menu, or reboot.

## Using it

- **On the board:** tap a widget to open its app, or swipe up for all of them. On a
  touchscreen an on-screen keyboard appears when you type. Changes show up on
  every screen instantly.
- **On your phone:** open Grocery on the board and scan the QR code under
  "Scan with your phone", or go to `http://<pi-ip>:8080`. You need to be on the
  same Wi-Fi.
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
- **Pages:** swipe left and right (or tap the dots at the bottom).
- **All apps:** swipe up anywhere on the home screen (the way you'd scroll down
  a page), or scroll down with a mouse. The pages lift away and every app rises
  under your finger, so an app you don't keep as a widget is still one swipe and
  a tap away, without a dock taking room on the screen. Swipe down, tap anywhere
  that isn't an app, or press Escape to go back.
- **Arranging widgets:** hold a widget for half a second (or pick **Edit home
  screen** in the menu). Then drag widgets around; hold one against the left or
  right edge to carry it to another page (or to a new page past the last one).
  Tap − to remove a widget, **Add widget** to add one, and **Done** when you're
  finished. On a phone, use the ↑ ↓ buttons instead of dragging.
- **Games:** tap a game on the Games widget. Choose **2 players** to take turns
  on the board or **vs Computer** to play the board. A game in progress is kept
  (even through the nightly reload) until you start a new one.
- **Blackjack** is you against the dealer, so it has no sides to choose and no
  undo. **Hit** takes a card, **Stand** hands over to the dealer, who draws to 16
  and stands on all 17s. A blackjack is 21 on the first two cards. A session runs
  for twenty hands and keeps the score; **New game** starts a fresh one.
- **Lights:** tap a light on the widget to switch it on or off. Open the app for
  the rest:
  - **Schedules** — tap + and set a time, **Turn on** or **Turn off**, which
    lights (or **All lights**, which includes ones paired later), and the days it
    repeats. Pick no days and it runs once, then switches itself off. The switch
    on each schedule pauses it; tap a schedule to change or delete it.
  - **Turn off again** — a Turn off schedule can also keep the lights off: if
    someone switches one back on (to grab something at night, say), it goes off
    again after 15 min, 30 min or 1 hr, and its tile shows when ("Until 11:45 PM").
    Pick how long to keep watching (the choices show the end time, like 7:00 AM).
    A Turn on schedule for those lights ends the watching early, and so does
    pausing or changing the schedule.
  - **When it gets dark** — the row above the schedules. Switch it on and the
    lights come on by themselves once a day, the first time it gets dark between
    noon and the time you pick (9 PM to midnight). Switch them off again and they
    stay off. Tap it to choose how dark (**Before sunset**, **At sunset** or
    **After sunset**, with today's time for each) and which lights. The board
    works out sunset from `latitude` and `longitude` in `config.json`. With a
    Zigbee light sensor paired (any device that reports illuminance, like many
    motion sensors), you can pick it instead, so a stormy afternoon counts too.
    It has to read dim for a few minutes first, and if it stops reporting the
    sun takes over.
  - **Batteries** — battery-powered switches report their charge. At 30% or
    less, the light's tile shows a battery mark and the percentage, and the
    widget's header says so ("Porch battery low"), so there's time to change the
    batteries before the switch stops answering. ⋯ on a light shows its level and
    when it last reported.
  - **Swap On and Off** — tap ⋯ on a light. Use it if a light comes on when the
    board says Off (a switch paired or wired the other way round). Schedules
    follow the swap too.

  - **Pairing a new switch** — tap + on the Lights widget (or **Pair a Light** in
    the app), then hold the switch's
    button for about 30 seconds until its light blinks fast, and let go. The
    widget counts down the four minutes pairing stays open and shows how the
    switch is getting on; once it's ready, pairing stops and the light appears.
    Tap × to stop early. Pair one switch at a time.

  - **Naming a light** — tap ⋯ on it, tap its name, type, and tap **Done**
    (tapping outside the card keeps the old name). Right after pairing, the
    "added" message has a **Name it** button that does the same. Every screen
    shows the new name, and Zigbee2MQTT is renamed to match (`Kitchen Island`
    becomes `kitchen_island`).

  Until it's named, a light goes by its Zigbee2MQTT name (`bedroom_light` shows
  as **Bedroom**), and a new switch is "Light" plus the end of its address.
- **Roommate Cup:** open it and tap **Roommates** to sign everyone up: a name and
  an email, a phone number, or both. There are no passwords, and screens only ever
  show part of each address and number.
  - **Games** is the catalog. A **General** game is one everyone's about as good
    at. A **Specialized** game is one that one roommate is clearly better at, and
    it stays tied to them. About 3 in every 4 games picked are General.
  - **Game Night** sets the day and time, when the games go out that day (8 AM to
    3 PM), and how many games a night (1 to 3). It runs every week until you pause it.
  - On game day, at that time, the board picks the games and sends each roommate an
    email and/or a text with a link that opens the results on their phone. **Pick
    Now** or **Pick Again** picks early or redraws the games nobody has played yet.
    **Send to Everyone** sends them again (at most every 10 minutes).
  - **Record Result:** tap everyone in the order they finished (leave out anyone
    who didn't play), and **Tied** to share the place above. Anyone can do it on the
    board or from the link on their phone.
  - **Points:** one for every roommate you finish ahead of. In a Specialized game,
    everyone who finishes ahead of its specialist gets **+1**. The top scorer of a
    finished game night gets a crown. Tap someone in the standings to see how they
    got their points.
  - Taking a roommate off removes their email and phone from the Pi straight away
    (**Undo** brings them back until the board restarts). Their past results stay.
- **Grocery:** on your phone, tap **Scan** (on the home screen or in the app) and
  point the camera at a barcode or QR code. Trader Joe's own products have 8-digit
  barcodes, Lidl's 13-digit ones, and newer packaging has a QR code; all of them
  work. The board looks the product up in [Open Food Facts](https://world.openfoodfacts.org)
  (free, no account) for its name and, when someone has reported one, a recent
  price from [Open Prices](https://prices.openfoodfacts.org). Check the price,
  how many, the store and **Who's asking?**, then **Add**; the scanner is ready
  for the next one. Your phone remembers who you are.
  - No barcode, or it isn't found? Start typing in the search bar and it predicts
    what you mean as you go ("marin" offers Marinara Sauce): things you've bought
    before first, then Trader Joe's and Lidl products, then everyday groceries.
    Tap one to add it, or press **Search** for everything online (pick **All**,
    **Trader Joe's** or **Lidl** to narrow it), or **Add "…" as typed**. Typing
    the barcode's digits works too.
  - Every item has a picture: the product's photo from Open Food Facts (kept on
    the Pi), or, if there isn't one, tap the camera on the item and take your own;
    it's remembered for next time. Until then it shows an illustration.
  - Tap an item to change its price, quantity, store or who asked, or to remove it.
    Tick it off as it goes in the cart; **Clear** empties the cart.
  - The panel on the right adds it up: the total, per store, and per person, so
    splitting the bill is easy. Anything scanned once is remembered on the Pi with
    its last price, so next time it fills itself in, even offline.
  - **Live scanning needs HTTPS.** Phone browsers only let a page use the camera
    when it's on `https://` (Tailscale can give the Pi an address like that; see
    `hostname`). On plain `http://` on the home Wi-Fi, **Scan** takes a photo
    instead and reads the code from it.
- **Blocks theme:** tap the visiting critter and it jumps. If you'd rather have a
  still picture, turn off **Moving scenery** in the menu.
- **Menu (top right):** pick a theme, add or remove widgets, or edit the home
  screen. These choices are saved separately on each screen, so your phone can
  look different from the board.
- **Arranging the home screen:** press and hold a widget (or pick **Edit home
  screen** in the menu). Then drag any widget wherever you want it; the others
  move out of the way. To move it to another page, push it against the side of
  the screen: the pages peek over, and after a moment it's carried across. To
  resize, pull the curved bracket in a widget's bottom-right corner: it stretches
  with your finger and snaps to small, medium or large when you let go. Tap
  **Done** when you're finished.
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

Notes and any calendar events kept on the board itself are saved on the Pi in
`data/notes.json` and `data/calendar.json`.
Light schedules and swapped switches are in `data/lights.json`.

### Reaching the board when you're out

By default the board hands phones its address on the home Wi-Fi, so the QR code and
the link under **On your phone** only work at home. To use it from anywhere, put the
Pi and your phones on a [Tailscale](https://tailscale.com) network — it's free for
personal use, opens nothing on your router, and nothing is exposed to the internet:

1. On the Pi: `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`.
2. Install Tailscale on each phone and sign in with the same account.
3. Note the name Tailscale gives the Pi (`tailscale status` shows it, something like
   `widget-board.tailnet-name.ts.net`) and put it in `config.json`:

   ```json
   { "hostname": "widget-board.tailnet-name.ts.net" }
   ```

4. Restart the server. The QR code and the address under **On your phone** now use
   that name, which works at home and on mobile data alike.

`hostname` takes a plain name, a `name:port`, or a full `http://`/`https://` address
(useful if something else is terminating TLS in front of the board). Anything it
can't read is ignored, and the board falls back to its Wi-Fi address.

**Don't put the board on a public address without putting a password in front of
it.** There are no accounts: anyone who can reach it can read and change the
grocery list and notes, and — if you've connected Google Calendar — read your
calendars and create or delete events. Tailscale avoids that because only your own
devices can reach the Pi at all. A public tunnel or a forwarded router port does
not, and needs authentication adding first.

Whatever you choose, give the Pi a fixed address on your router (a DHCP
reservation). Otherwise its Wi-Fi address can change and links saved on phones stop
working even at home.

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

### Spotify

The Spotify widget shows what one Spotify account is playing (on any device:
a phone, a speaker, a laptop). It only reads; it never controls playback.

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard),
   create an app, tick **Web API**, and add this **Redirect URI** (with your port
   if it isn't 8080):

   ```
   http://127.0.0.1:8080/api/spotify/done
   ```

2. Copy the app's **Client ID** into `config.json` (no secret needed):

   ```json
   { "spotify": { "client_id": "your client id" } }
   ```

3. Restart the server and tap **Connect** on the Spotify widget *on the board
   itself*. Sign in, say yes, and Spotify sends you back to the board.

Like Google, connecting has to happen on the board's own screen, because Spotify
only sends you back to `http://127.0.0.1`. While the app is in Spotify's
development mode, add the account under **User Management** in the dashboard.

The board asks Spotify what's playing every 5 seconds while something plays and
every 15 seconds otherwise, and covers are fetched by the Pi and kept in memory.
The sign-in is saved in `data/spotify.json`, readable only by the user the
server runs as. To disconnect or switch accounts, remove the app from your
[Spotify account's apps](https://www.spotify.com/account/apps/); the widget
then offers **Connect** again.

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

### Lights (Zigbee)

Nothing to configure. Plug the Zigbee USB dongle (e.g. a Sonoff ZBDongle-P) into
the Pi **before** running `sudo ./pi/install.sh`, and it also sets up everything
the lights need: Mosquitto (the message broker), Node.js, and
[Zigbee2MQTT](https://www.zigbee2mqtt.io) (which drives the dongle), all started
on boot. Plugged it in later? Run `sudo ./pi/zigbee.sh`. Then tap **+** on the
Lights widget (or **Pair a Light** in the app) and hold the switch's button.

Running the script again never replaces the Zigbee network, so paired switches
stay paired. It lives in `/opt/zigbee2mqtt/data` (keep a backup: it holds the
network key). **Switches already paired on a Mac** (the
[zigbee_ceiling](https://github.com/NLBoa/zigbee_ceiling) setup) can come along:
copy `configuration.yaml`, `database.db` and `coordinator_backup.json` from the
Mac's `~/zigbee2mqtt/data/` into `/opt/zigbee2mqtt/data/` on the Pi first, and the
script points them at the Pi's dongle without touching the network key.

Zigbee2MQTT's own page is at `http://<pi-address>:8099` (8080 is the board), if
you ever need its advanced settings. Schedules run on the Pi in its own time zone (`timezone`
above), so they work with every screen off.

Only if your broker is somewhere else, tell the board in `config.json`
(`"lights": false` turns the Lights widget off):

```json
{ "lights": { "mqtt_host": "localhost", "mqtt_port": 1883, "base_topic": "zigbee2mqtt", "username": "", "password": "" } }
```

### Grocery: currency and country

Prices are in US dollars unless you say otherwise (prices found online are only
used when they're in this currency). The search predicts from the Trader Joe's and
Lidl products sold in `country` (the United States unless you say otherwise),
which the Pi downloads from Open Food Facts once a week (about 5,000 names, under
1 MB, in `data/grocery-products.json`):

```json
{ "grocery": { "currency": "EUR", "country": "germany" } }
```

### Sports

Nothing to set up: the scores, line-ups and the Premier League and Champions
League tables come from ESPN's public scoreboard, and the Big Ten table from
[bigten.org](https://bigten.org/sports/msoc/standings) (ESPN has no college
tables). Neither needs an account. The Pi reads the schedules every hour and the
tables every few hours (and again just after a followed match ends); while a
followed match is on it checks the score every 30 seconds and keeps that match's
page fresh. Screens only ever ask the Pi.

It follows Maryland's men's team; to follow the women's team instead, or to turn
Sports off:

```json
{ "sports": { "maryland": "women" } }
```

```json
{ "sports": false }
```

Match pages in the Premier League, FA Cup, League Cup and Champions League also
get what ESPN doesn't have from [FotMob](https://www.fotmob.com): the referee's
record (fouls and yellow cards a match against their league's average, red
cards, penalties), predicted line-ups until the real ones are out, who's injured
or suspended, every player's rating (tap a player for their match stats), both
teams' form, the head-to-head record, expected goals and FotMob's insights. The
Pi reads it only when it reads that match's page from ESPN, and keeps nothing on
the SD card. To leave FotMob out:

```json
{ "sports": { "fotmob": false } }
```

ESPN's scoreboard and FotMob's match details are both unofficial, so if either
changes, the page shows less rather than breaking.

### Roommate Cup: email and texts

Optional: without them the Cup still works, and nothing is sent. Add either or
both to `config.json`:

```json
{
  "roommate_games": {
    "country_code": "1",
    "email": { "host": "smtp.gmail.com", "port": 587, "username": "board@gmail.com",
               "password": "app password", "from": "Home Board <board@gmail.com>" },
    "sms": { "account_sid": "AC…", "auth_token": "…", "from": "+15550001111" }
  }
}
```

- **Email** works with any SMTP account. For Gmail, turn on 2-Step Verification
  and make an [App Password](https://myaccount.google.com/apppasswords); port 587
  uses STARTTLS and 465 uses SSL.
- **Texts** go through [Twilio](https://www.twilio.com): the Account SID, Auth
  Token and a Twilio phone number from its console. (Carriers' email-to-text
  gateways are unreliable and some have shut down, so the board doesn't use them.)
- `country_code` is added to numbers typed without one, so `(555) 123-4567`
  becomes `+15551234567`.
- Set `hostname` (see "Reaching the board when you're out") so the link in the
  message works away from home. Otherwise it only works on the home Wi-Fi.

The board's log says when a send fails, and the app shows it under the games.

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
(or keep it on screen, for measuring). `?glass=live` gives the Glass theme a real
`backdrop-filter` blur instead of its pre-made one, to compare on the Pi.

The rules for working on the board (Pi performance limits, the 1920×1080
layout, text sizes, contrast, touch targets) are in [CLAUDE.md](CLAUDE.md).
Claude Code follows them automatically, and they're worth a read for people too.

Project layout:

```
run.py                  start the server
board/                  server: JSON stores, HTTP API + live updates, weather,
                        Google Calendar (OAuth + API), iCalendar parsing, QR codes,
                        lights (Zigbee2MQTT over a built-in MQTT client) and their schedules,
                        the Roommate Cup and its emails and texts (notify.py),
                        the grocery list, its product lookups (products.py), the stores'
                        product list for predictions and the pictures (grocery_images.py),
                        and the sports scores, tables and match pages (sports.py)
web/
  index.html            the board: a 1920×1080 canvas (phones get a one-column layout)
  css/tokens.css        colours, type sizes and the Light / Dark / Blocks / Glass themes
  css/scene.css         the Blocks scenery (pixel art) and critters
  css/apple.css         the Glass theme's cards, clock, app library and fonts
  fonts/inter/          Inter (SIL Open Font License), used by the Glass theme
  js/main.js            starts everything
  js/services/          the only code that talks to the server or localStorage
  js/apps/<id>/         one folder per app: meta.js, widget.js, app.js, index.js
  js/widget-layout.js   where widgets go, how big they are, and how a drag or resize
                        moves the others (pure, tested)
  js/pager.js           swiping between pages; home-editor.js: edit mode
  js/scene/             Blocks critters (art, what they do, the low-rate ticker)
  js/menu.js            the top-right menu
  js/sky.js             sun position and the wallpaper colours
  js/apple-wallpaper.js the Glass wallpaper and the copy of it its cards show;
                        glass.js lines that copy up behind each card
pi/                     Raspberry Pi install script, kiosk launcher, service file
tests/                  unit tests (Python unittest + node --test)
```

### Adding an app

Make a folder `web/js/apps/<id>/` like `notes/`:

- `meta.js` exports `id`, `name`, `description`, `widgetSize` (the size it starts
  at), `widgetSizes` (every size it can be resized to: `mini`, `small`,
  `medium`, `large`), `iconBackground` and `iconGlyph`. The widget has to look
  right at each size it lists; style them from `.widget--mini`, `.widget--small`,
  `.widget--medium` and `.widget--large` (see CLAUDE.md).
- `widget.js` exports `createWidget(context)`, which returns `{ node, destroy }`.
  `destroy()` must undo every subscription, timer and observer the widget made.
- `app.js` (optional) exports `mount(root, context)` for a full-screen app.
  Apps with one are in the app library (swipe up on the home screen).
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

### Checking the Glass theme on the Pi

Glass doesn't blur live: a real `backdrop-filter` re-blurs every card on every
frame of a page swipe. In Chrome with the GPU off and the CPU slowed 4× it
dropped about a quarter of the frames while switching pages, against one frame
for the pre-made copy (and none for Dark). To see it on the Pi, open the board
with `?glass=live` and swipe between pages, then without it. If live blur looks
smooth there you can keep the parameter, but the copy looks the same.

## Troubleshooting

- **The board doesn't open after reboot.** Check that the server is up with
  `systemctl status widget-board`. If it is, run `~/Widget-Board/pi/kiosk.sh`
  from a terminal on the Pi to see any errors. On desktops that ignore
  `~/.config/autostart`, add the line `~/Widget-Board/pi/kiosk.sh &` to
  `~/.config/labwc/autostart`.
- **Emoji show as boxes.** Run `sudo apt install fonts-noto-color-emoji`.
- **Phones can't connect.** They must be on the same Wi-Fi, and some guest
  networks block devices from seeing each other. Try the IP address the
  board shows under "On your phone". To use the board away from home, see
  "Reaching the board when you're out".
- **A phone that was away shows "Offline".** It reconnects by itself when the
  screen comes back on or the Wi-Fi returns — give it a second. If it doesn't,
  the board's address has probably changed; see the DHCP reservation note above.
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
- **The Lights widget says "Can't reach the lights".** Zigbee isn't set up yet:
  plug in the dongle and run `sudo ./pi/zigbee.sh`. If it was working, check
  `systemctl status mosquitto zigbee2mqtt`. The board keeps retrying.
- **Pairing finds nothing.** Hold the switch's button for the full ~30 seconds
  until it blinks fast, and keep it near the Pi. `journalctl -u zigbee2mqtt -f`
  shows what Zigbee2MQTT sees.
- **A light says "No response", or lights don't switch.** Zigbee2MQTT is stopped
  or the switch has no power. The Zigbee2MQTT web page shows which.
- **A light shows On when it's off.** Tap ⋯ on it in the Lights app and turn on
  **Swap On and Off**.
- **Calendar events are an hour out.** Set `timezone` in `config.json` to your
  IANA time zone, or fix the Pi's with `sudo raspi-config`.

Anyone on your Wi-Fi can open and edit the list and notes, and switch the
lights. There are no accounts. Only the board's own screen can use Exit to desktop.
