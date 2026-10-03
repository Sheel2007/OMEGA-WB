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

from board.calendar import CalendarSources, CalendarStore, local_zone, sources_from
from board.google import GoogleAccount
from board.kiosk import Kiosk
from board.notes import NotesBoard
from board.server import ROOT, BoardServer, lan_address, phone_address
from board.shopping import ShoppingList
from board.store import ChangeFeed
from board.weather import WeatherService

DEFAULT_PORT = 8080


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
    feed = ChangeFeed()
    account = google_from(config, args.data)
    sources = CalendarSources(
        sources_from(config.get("calendars")),
        account=account,
        zone=local_zone(config.get("timezone")),
        feed=feed,
    )
    server = BoardServer(
        (args.host, port),
        shopping=ShoppingList(os.path.join(args.data, "shopping.json"), feed=feed),
        notes=NotesBoard(os.path.join(args.data, "notes.json"), feed=feed),
        calendar=CalendarStore(os.path.join(args.data, "calendar.json"), feed=feed),
        calendar_sources=sources,
        google=account,
        feed=feed,
        weather=weather_from(config, location),
        kiosk=Kiosk(),
        location=location,
        public_url=phone_address(config.get("hostname"), port),
    )
    sources.start()

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
        server.server_close()


if __name__ == "__main__":
    main()
