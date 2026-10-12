#!/usr/bin/env python3
"""Start the Widget Board server.

    python3 run.py              # serves on http://0.0.0.0:8080
    python3 run.py --port 9000
"""
import argparse
import json
import logging
import os
import signal
import sys

from board.calendar import CalendarChoices, CalendarSources, CalendarStore, local_zone, sources_from
from board.google import GoogleAccount
from board.grocery import GroceryList
from board.grocery_images import Photos, ProductImages
from board.grocery_texts import GroceryTexts
from board.kiosk import Kiosk
from board.lights import Lights, settings_from as lights_settings_from
from board.notes import NotesBoard
from board.notify import Notifier, settings_from as notify_settings_from
from board.products import ProductLookup
from board.spotify import NowPlaying, SpotifyAccount
from board.sports import Sports, follows_from
from board.store_products import StoreProducts
from board.roommate_games import RoommateGames
from board.server import ROOT, BoardServer, lan_address, phone_address
from board.store import ChangeFeed
from board.weather import WeatherService

DEFAULT_PORT = 8080
# The app the texts and emails link to, opening its results sheet.
ROOMMATE_GAMES_LINK = "roommate-games"


def load_config(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def location_from(config):
    latitude, longitude = config.get("latitude"), config.get("longitude")
    if isinstance(latitude, (int, float)) and isinstance(longitude, (int, float)):
        return {"latitude": latitude, "longitude": longitude}
    return None


def google_from(config, data_folder):
    """The Google account, from the OAuth client in config.json plus any saved sign-in."""
    client = config.get("google") if isinstance(config.get("google"), dict) else {}
    return GoogleAccount(
        client.get("client_id"),
        client.get("client_secret"),
        os.path.join(data_folder, "google.json"),
    )


def spotify_from(config, data_folder, feed):
    """What's playing on Spotify, from the app's client ID in config.json plus any saved sign-in."""
    client = config.get("spotify") if isinstance(config.get("spotify"), dict) else {}
    account = SpotifyAccount(client.get("client_id"), os.path.join(data_folder, "spotify.json"))
    return NowPlaying(account, feed=feed)


def currency_from(config):
    """The currency grocery prices are in: a three-letter code such as USD or EUR."""
    grocery = config.get("grocery") if isinstance(config.get("grocery"), dict) else {}
    currency = grocery.get("currency", "USD")
    if isinstance(currency, str) and len(currency) == 3 and currency.isalpha():
        return currency.upper()
    logging.warning("Ignoring grocery currency %r in config.json; using USD.", currency)
    return "USD"


def store_products_from(config, data_folder):
    """The two stores' product list, for the country in config.json (the US unless it says otherwise)."""
    grocery = config.get("grocery") if isinstance(config.get("grocery"), dict) else {}
    path = os.path.join(data_folder, "grocery-products.json")
    try:
        return StoreProducts(path, country=grocery.get("country", "united-states"))
    except ValueError as err:
        logging.warning("%s Using united-states.", err)
        return StoreProducts(path)


def grocery_texts_from(config, notify, **kwargs):
    """Texts for grocery adds, sent as email from the account under "grocery.texts" (or the
    Roommate Cup's) in config.json, or None when there's no account or "texts" is false."""
    grocery = config.get("grocery") if isinstance(config.get("grocery"), dict) else {}
    texts = grocery.get("texts")
    if texts is False:
        return None
    own = texts.get("email") if isinstance(texts, dict) else None
    email = notify_settings_from({"email": own})["email"] if own else notify["email"]
    if email is None:
        logging.info("Grocery texts are off: they're sent as email, so add an email account to config.json.")
        return None
    return GroceryTexts(Notifier(email), **kwargs)


def weather_from(config, location):
    unit = config.get("units", "celsius")
    try:
        return WeatherService(location, unit)
    except ValueError as err:
        logging.warning("%s Using celsius.", err)
        return WeatherService(location)


def main():
    parser = argparse.ArgumentParser(description="Run the Widget Board server.")
    parser.add_argument("--host", default="0.0.0.0", help="address to listen on (default: all interfaces)")
    parser.add_argument("--port", type=int, help="port to listen on (default: config.json or %d)" % DEFAULT_PORT)
    parser.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    parser.add_argument("--data", default=os.path.join(ROOT, "data"), help="folder for the saved list and notes")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = load_config(args.config)
    port = args.port or config.get("port") or DEFAULT_PORT

    location = location_from(config)
    zone = local_zone(config.get("timezone"))
    feed = ChangeFeed()
    account = google_from(config, args.data)
    sources = CalendarSources(
        sources_from(config.get("calendars")),
        account=account,
        choices=CalendarChoices(os.path.join(args.data, "calendar-choices.json"), feed=feed),
        zone=zone,
        feed=feed,
    )
    lights = Lights(
        os.path.join(args.data, "lights.json"),
        mqtt=lights_settings_from(config.get("lights")),
        zone=zone,
        location=location,
        feed=feed,
    )
    currency = currency_from(config)
    store_products = store_products_from(config, args.data)
    products = ProductLookup(currency, catalog=store_products)
    # Each needs the other: the list checks photos exist, and pruning keeps the ones it uses.
    photos = Photos(os.path.join(args.data, "grocery-photos"), in_use=lambda: grocery.photos_in_use())
    notify = notify_settings_from(config.get("roommate_games"))
    # Texts whoever signed up in the Grocery app when things go on the list.
    grocery_texts = grocery_texts_from(config, notify, recipients=lambda: grocery.texting_book(),
                                       still_wanted=lambda ids: grocery.open_ids(ids))
    grocery = GroceryList(os.path.join(args.data, "grocery.json"), currency=currency, photo_exists=photos.exists,
                          texts=grocery_texts is not None,
                          on_add=grocery_texts.added if grocery_texts else None,
                          on_join=grocery_texts.joined if grocery_texts else None, feed=feed)
    roommate_games = RoommateGames(
        os.path.join(args.data, "roommate-games.json"),
        notifier=Notifier(notify["email"], notify["sms"]),
        country_code=notify["country_code"],
        zone=zone,
        feed=feed,
    )
    spotify = spotify_from(config, args.data, feed)
    sports = Sports(follows_from(config.get("sports")), feed=feed)
    server = BoardServer(
        (args.host, port),
        notes=NotesBoard(os.path.join(args.data, "notes.json"), feed=feed),
        calendar=CalendarStore(os.path.join(args.data, "calendar.json"), feed=feed),
        calendar_sources=sources,
        google=account,
        feed=feed,
        weather=weather_from(config, location),
        kiosk=Kiosk(),
        lights=lights,
        roommate_games=roommate_games,
        grocery=grocery,
        products=products,
        store_products=store_products,
        product_images=ProductImages(os.path.join(args.data, "grocery-images"), products),
        photos=photos,
        spotify=spotify,
        sports=sports,
        location=location,
        public_url=phone_address(config.get("hostname"), port),
    )
    roommate_games.set_link(lambda: server.phone_url(ROOMMATE_GAMES_LINK) + "/record")
    sources.start()
    lights.start()
    roommate_games.start()
    if grocery_texts:
        grocery_texts.start()
    store_products.start()
    spotify.start()
    sports.start()

    # systemd stops services with SIGTERM; exit the same clean way as Ctrl+C.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print("Widget Board is running")
    print("  On this machine:  http://localhost:%d/?kiosk=1" % port)
    print("  On your phone:    %s" % server.phone_url())
    if server.public_url:
        print("  On the home Wi-Fi: http://%s:%d" % (lan_address(), port))
    try:
        server.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        server.wake_streams()
        lights.stop()
        roommate_games.stop()
        if grocery_texts:
            grocery_texts.stop()
        store_products.stop()
        spotify.stop()
        sports.stop()
        server.server_close()


if __name__ == "__main__":
    main()
