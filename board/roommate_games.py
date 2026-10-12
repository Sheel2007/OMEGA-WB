"""Roommate Games: the weekly competition between everyone at home.

The board keeps:

- the roommates who signed up: a name, an email and a phone number, no passwords;
- the catalog of games, in two buckets. General games are ones everyone is about
  as good at. A Specialized game is one that the roommate who put it on the list
  is clearly better at, so it stays tied to that roommate (its specialist);
- the weekly game night (which day, what time, when the picks go out, how many
  games), which runs every week until someone pauses it;
- every game night: the games drawn for it and, once played, who finished where.

Points are worked out from the results each time they're needed, so no stored
total can disagree with the results. Each game gives a point for every roommate you
finish ahead of. In a Specialized game, everyone who isn't the specialist and
finishes ahead of them gets UPSET_BONUS extra.

On game day, when the picks are due, a background thread draws the night's games
(about three General for every Specialized one) and texts and/or emails everyone a
link for recording the results (board/notify.py). Email addresses and phone numbers
stay on the Pi. Screens only ever get them masked.
"""
import copy
import logging
import random
import re
import threading
import uuid
from datetime import date, datetime, timedelta

from .notify import clean_phone, mask_phone
from .store import JsonStore, NotFound, ValidationError, tidy_text

log = logging.getLogger(__name__)

KINDS = ("general", "specialized")
# The share of picks that come from the Specialized bucket.
SPECIALIZED_SHARE = 0.25
# How many recent picks the draw looks back on to keep that share steady.
SHARE_WINDOW = 12
UPSET_BONUS = 1
MAX_PLAYERS = 12
MAX_GAMES = 60
MAX_PER_NIGHT = 3
# Ten years of weekly game nights; the oldest drop off after that.
MAX_WEEKS = 520
WEEKS_SENT = 12
LEDGER_SENT = 40
MAX_PLAYER_NAME = 30
MAX_GAME_NAME = 40
MAX_EMAIL = 254
# "Send again" from the app waits this long after the last send, so nobody gets
# a burst of texts from a few impatient taps.
RESEND_MINUTES = 10
# Lands each check just after the minute turns over.
TICK_MARGIN_SECONDS = 0.2

DEFAULT_SCHEDULE = {"on": True, "day": 5, "time": "19:00", "announce": "10:00", "perNight": 1}
TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CLIENT_ID = re.compile(r"^[a-f0-9]{8,32}$")
EMAIL = re.compile(r"^[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+$")
DAY_NAMES = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")


# Cleaning what people type


def clean_player_name(raw):
    if not isinstance(raw, str):
        raise ValidationError("A name must be text.")
    return tidy_text(raw, max_length=MAX_PLAYER_NAME, empty_message="Type a name first.",
                     too_long_message="Keep names under %d characters." % MAX_PLAYER_NAME)


def clean_game_name(raw):
    if not isinstance(raw, str):
        raise ValidationError("A game's name must be text.")
    return tidy_text(raw, max_length=MAX_GAME_NAME, empty_message="Type the game's name first.",
                     too_long_message="Keep game names under %d characters." % MAX_GAME_NAME)


def clean_email(raw):
    """A tidied address, or None when left blank."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValidationError("An email address must be text.")
    text = raw.strip()
    if not text:
        return None
    if len(text) > MAX_EMAIL or not EMAIL.match(text):
        raise ValidationError("That email address doesn't look right.")
    local, domain = text.rsplit("@", 1)
    return "%s@%s" % (local, domain.lower())


def mask_email(email):
    if not email:
        return None
    local, domain = email.rsplit("@", 1)
    return "%s•••@%s" % (local[0], domain)


def clean_schedule(raw, current):
    """`current` with the changes in `raw`, checked."""
    if not isinstance(raw, dict):
        raise ValidationError("Send the schedule as a JSON object.")
    schedule = dict(current)
    for key in ("on", "day", "time", "announce", "perNight"):
        if key in raw:
            schedule[key] = raw[key]
    if not isinstance(schedule["on"], bool):
        raise ValidationError("Say whether game night is on or paused.")
    day = schedule["day"]
    if not (isinstance(day, int) and not isinstance(day, bool) and 0 <= day <= 6):
        raise ValidationError("Pick a day from 0 (Sunday) to 6 (Saturday).")
    if not (isinstance(schedule["time"], str) and TIME.match(schedule["time"])):
        raise ValidationError("Pick a time for game night.")
    if not (isinstance(schedule["announce"], str) and TIME.match(schedule["announce"])):
        raise ValidationError("Pick when the games are sent out.")
    if schedule["announce"] >= schedule["time"]:
        raise ValidationError("The games have to go out before game night starts.")
    per = schedule["perNight"]
    if not (isinstance(per, int) and not isinstance(per, bool) and 1 <= per <= MAX_PER_NIGHT):
        raise ValidationError("Pick from 1 to %d games a night." % MAX_PER_NIGHT)
    return {key: schedule[key] for key in DEFAULT_SCHEDULE}


def clean_order(raw, known_ids):
    """Who finished where: a list of places, each a list of the roommates tied there.

    [["a"], ["b", "c"], ["d"]] is a first, two tied for second, and a fourth. Anyone
    left out didn't play. None clears the result.
    """
    if raw is None:
        return None
    if not isinstance(raw, list) or not all(isinstance(group, list) and group for group in raw):
        raise ValidationError("Send the result as a list of places.")
    seen = set()
    for group in raw:
        for player_id in group:
            if not isinstance(player_id, str) or player_id not in known_ids:
                raise ValidationError("Someone in that result isn't signed up.")
            if player_id in seen:
                raise ValidationError("Each roommate can only finish once.")
            seen.add(player_id)
    if len(seen) < 2:
        raise ValidationError("A result needs at least two roommates.")
    return [list(group) for group in raw]


# The rules


def weekday(day):
    """0 for Sunday through 6 for Saturday, matching the schedule's days."""
    return (day.weekday() + 1) % 7


def score(order, specialist=None):
    """{player id: (points, bonus)} for one game's result.

    A point for every roommate you finish ahead of. When the game is Specialized and
    its specialist played, everyone else who finished ahead of them gets the bonus.
    """
    remaining = sum(len(group) for group in order)
    special_place = next((i for i, group in enumerate(order) if specialist in group), None)
    points = {}
    for place, group in enumerate(order):
        remaining -= len(group)
        for player_id in group:
            upset = special_place is not None and place < special_place and player_id != specialist
            points[player_id] = (remaining, UPSET_BONUS if upset else 0)
    return points


def places(order):
    """{player id: finishing place}, with ties sharing a place (1, 2, 2, 4)."""
    found, ahead = {}, 0
    for group in order:
        for player_id in group:
            found[player_id] = ahead + 1
        ahead += len(group)
    return found


def specialized_chance(recent_kinds):
    """How likely the next pick is to be Specialized, given the picks before it.

    0.25 when the recent picks are on target, more when Specialized games are behind,
    less (down to none) when they're ahead. Over any run of picks the share stays
    close to a quarter but which week gets one is still a surprise.
    """
    window = recent_kinds[-SHARE_WINDOW:]
    behind = SPECIALIZED_SHARE * len(window) - window.count("specialized")
    return min(1.0, max(0.0, SPECIALIZED_SHARE + behind / 2))


def choose_games(games, *, count, recent_kinds, avoid, rng):
    """Draws `count` different games from `games` (the ones that can be picked).

    Each pick's bucket comes from specialized_chance(). A bucket with nothing left
    hands the pick to the other one. Games in `avoid` (last game night's) are only
    picked when there's nothing else in their bucket.
    """
    kinds = list(recent_kinds)
    picked = []
    for _ in range(count):
        left = [g for g in games if g["id"] not in {p["id"] for p in picked}]
        by_kind = {kind: [g for g in left if g["kind"] == kind] for kind in KINDS}
        want = "specialized" if rng.random() < specialized_chance(kinds) else "general"
        bucket = by_kind[want] or by_kind["general" if want == "specialized" else "specialized"]
        if not bucket:
            break
        fresh = [g for g in bucket if g["id"] not in avoid]
        game = rng.choice(fresh or bucket)
        picked.append(game)
        kinds.append(game["kind"])
    return picked


def clock_label(time):
    hours, minutes = (int(part) for part in time.split(":"))
    return "%d:%02d %s" % (hours % 12 or 12, minutes, "PM" if hours >= 12 else "AM")


def night_label(day_key):
    day = date.fromisoformat(day_key)
    return "%s, %s %d" % (DAY_NAMES[weekday(day)], day.strftime("%B"), day.day)


def invitation(week, *, time, recipient, names, link):
    """The email and the text one roommate gets for a game night."""
    lines, short = [], []
    for pick in week["picks"]:
        if pick["kind"] == "specialized" and pick["specialist"] == recipient["id"]:
            lines.append("• %s (Specialized: your game. Everyone who beats you gets +%d.)" % (pick["name"], UPSET_BONUS))
            short.append("%s (your specialty)" % pick["name"])
        elif pick["kind"] == "specialized":
            expert = names.get(pick["specialist"], "its specialist")
            lines.append("• %s (Specialized: %s's game. Finish ahead of %s for +%d.)"
                         % (pick["name"], expert, expert, UPSET_BONUS))
            short.append("%s (beat %s for +%d)" % (pick["name"], expert, UPSET_BONUS))
        else:
            lines.append("• %s (General)" % pick["name"])
            short.append(pick["name"])
    when = "%s at %s" % (night_label(week["id"]), clock_label(time))
    games = "game" if len(week["picks"]) == 1 else "games"
    text = [
        "Hi %s," % recipient["name"],
        "",
        "Roommate Cup game night is %s." % when,
        "",
        "Tonight's %s:" % games,
        *lines,
        "",
    ]
    if link:
        text += ["When a game's done, anyone can record who won here:", link, ""]
    text.append("Scoring: a point for every roommate you finish ahead of.")
    sms = "Roommate Cup tonight at %s: %s." % (clock_label(time), ", ".join(short))
    if link:
        sms += " Record results: %s" % link
    return {
        "email": recipient.get("email"),
        "phone": recipient.get("phone"),
        "subject": "Roommate Cup: %s" % when,
        "text": "\n".join(text),
        "short": sms,
    }


# The store


class RoommateGames(JsonStore):
    label = "roommate games"

    def __init__(self, path=None, *, notifier=None, country_code="1", zone=None, feed=None, clock=None,
                 rng=None, run=None):
        self._notifier = notifier
        self._country = country_code
        self._zone = zone
        self._wall_clock = clock or self._local_now
        self._rng = rng or random.Random()
        # How a send is started: on its own thread, so nobody waits on the mail server.
        self._run = run or (lambda work: threading.Thread(target=work, name="roommate-games-send", daemon=True).start())
        self._link = None
        self._sending = False
        self._stop = threading.Event()
        self._thread = None
        super().__init__(path, clock=self._stamp, feed=feed)

    def _local_now(self):
        return datetime.now(self._zone).replace(tzinfo=None)

    def _stamp(self):
        return self._wall_clock().isoformat(timespec="seconds")

    def set_link(self, link):
        """`link()` gives the address on the invitations, which opens the results sheet."""
        self._link = link

    # Running

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="roommate-games", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        while True:
            now = self._wall_clock()
            if self._stop.wait(60 - now.second - now.microsecond / 1e6 + TICK_MARGIN_SECONDS):
                return
            try:
                self.tick(self._wall_clock())
            except Exception:
                log.exception("Roommate Games: the weekly check failed")

    def tick(self, now):
        """On game day, once the picks are due: draw the games, then send them out.

        Run every minute. It catches up after the board was off at the time the picks
        were due, and each game night is only drawn and sent once. Invitations stop
        going out once game night has started, since by then everyone's there.
        """
        today, minute = now.date().isoformat(), now.strftime("%H:%M")
        with self._changed:
            schedule = self._schedule
            if not schedule["on"] or weekday(now.date()) != schedule["day"] or minute < schedule["announce"]:
                return
            week = self._find_week(today)
            if week is None:
                week = self._draw(today)
                if week is None:
                    return
                self._commit()
            due = week["notified"] is None and minute < schedule["time"] and self._active() and not self._sending
        if due and self._can_send():
            try:
                self.notify(today, manual=False)
            except ValidationError as err:
                log.info("Roommate Games: not sending the games: %s", err)

    # Players

    def add_player(self, raw, player_id=None):
        if not isinstance(raw, dict):
            raise ValidationError("Send the roommate as a JSON object.")
        name = clean_player_name(raw.get("name"))
        email = clean_email(raw.get("email"))
        phone = clean_phone(raw.get("phone"), self._country)
        if not (email or phone):
            raise ValidationError("Add an email or a phone number so the board can send the games.")
        with self._changed:
            active = self._active()
            if len(active) >= MAX_PLAYERS:
                raise ValidationError("That's as many roommates as the board keeps (%d)." % MAX_PLAYERS)
            self._check_name_free(name, active)
            player = {"id": self._new_id(player_id), "name": name, "email": email, "phone": phone,
                      "joined": self._clock(), "left": False}
            self._players.append(player)
            self._commit()
            return {"state": self._state(), "player": self._public_player(player)}

    def update_player(self, player_id, raw):
        """Changes a name, email or phone. Only the fields sent change; "" clears one."""
        if not isinstance(raw, dict):
            raise ValidationError("Send the changes as a JSON object.")
        with self._changed:
            player = self._get_player(player_id)
            changes = {}
            if "name" in raw:
                changes["name"] = clean_player_name(raw["name"])
                self._check_name_free(changes["name"], [p for p in self._active() if p is not player])
            if "email" in raw:
                changes["email"] = clean_email(raw["email"])
            if "phone" in raw:
                changes["phone"] = clean_phone(raw["phone"], self._country)
            merged = {**player, **changes}
            if not (merged["email"] or merged["phone"]):
                raise ValidationError("Keep an email or a phone number so the board can send the games.")
            if merged != player:
                player.update(changes)
                self._commit()
            return {"state": self._state(), "player": self._public_player(player)}

    def remove_player(self, player_id):
        """Takes a roommate off the board. Their results stay in past game nights.

        Their email and phone are wiped from the file straight away; Undo puts them
        back from memory for as long as the board keeps running.
        """
        with self._changed:
            player = self._get_player(player_id)
            index = self._active().index(player)
            self._discard(index, {"id": player["id"], "player": copy.deepcopy(player)})
            player.update(left=True, email=None, phone=None)
            self._commit()
            return {"state": self._state(), "player": self._public_player(player)}

    def restore_players(self, player_ids):
        with self._changed:
            ids = self._trashed(player_ids, "player")
            present = {p["id"] for p in self._active()}
            restored = []
            for _, entry in self._take_from_trash(ids, present):
                saved = entry["player"]
                player = next((p for p in self._players if p["id"] == saved["id"]), None)
                if player is None or len(self._active()) >= MAX_PLAYERS:
                    continue
                player.update(left=False, email=saved["email"], phone=saved["phone"])
                restored.append(player["id"])
            if restored:
                self._commit()
            return {"state": self._state(), "restored": restored}

    # The catalog

    def add_game(self, raw, game_id=None):
        if not isinstance(raw, dict):
            raise ValidationError("Send the game as a JSON object.")
        name = clean_game_name(raw.get("name"))
        with self._changed:
            if len(self._games) >= MAX_GAMES:
                raise ValidationError("The catalog is full. Take a game off to make room.")
            self._check_game_free(name)
            kind, specialist = self._clean_kind(raw.get("kind"), raw.get("specialist"))
            game = {"id": self._new_id(game_id), "name": name, "kind": kind, "specialist": specialist,
                    "added": self._clock()}
            self._games.append(game)
            self._commit()
            return {"state": self._state(), "game": copy.deepcopy(game)}

    def update_game(self, game_id, raw):
        if not isinstance(raw, dict):
            raise ValidationError("Send the changes as a JSON object.")
        with self._changed:
            game = self._get_game(game_id)
            name = clean_game_name(raw["name"]) if "name" in raw else game["name"]
            if name.casefold() != game["name"].casefold():
                self._check_game_free(name)
            kind, specialist = self._clean_kind(raw.get("kind", game["kind"]), raw.get("specialist", game["specialist"]))
            changes = {"name": name, "kind": kind, "specialist": specialist}
            if any(game[key] != value for key, value in changes.items()):
                game.update(changes)
                self._commit()
            return {"state": self._state(), "game": copy.deepcopy(game)}

    def remove_game(self, game_id):
        """Takes a game out of the catalog. Game nights it was played on keep it."""
        with self._changed:
            game = self._get_game(game_id)
            index = self._games.index(game)
            self._games.pop(index)
            self._discard(index, {"id": game["id"], "game": game})
            self._commit()
            return {"state": self._state(), "game": copy.deepcopy(game)}

    def restore_games(self, game_ids):
        with self._changed:
            ids = self._trashed(game_ids, "game")
            present = {g["id"] for g in self._games}
            restored = []
            for index, entry in self._take_from_trash(ids, present):
                if len(self._games) >= MAX_GAMES:
                    break
                self._games.insert(min(index, len(self._games)), entry["game"])
                restored.append(entry["id"])
            if restored:
                self._commit()
            return {"state": self._state(), "restored": restored}

    # The weekly game night

    def set_schedule(self, raw):
        with self._changed:
            schedule = clean_schedule(raw, self._schedule)
            if schedule != self._schedule:
                self._schedule = schedule
                self._commit()
            return {"state": self._state()}

    def draw(self, again=False):
        """Picks the games for the next game night, or picks again for it.

        Picking again only redraws the games nobody has recorded a result for.
        """
        if not isinstance(again, bool):
            raise ValidationError("'again' must be true or false.")
        with self._changed:
            night = self._next_night(self._wall_clock())
            week = self._find_week(night)
            if week is not None and not again:
                raise ValidationError("Those games are already picked. Pick again to change them.")
            if week is not None and all(p["result"] for p in week["picks"]):
                raise ValidationError("Every game that night has a result already.")
            if self._draw(night) is None:
                raise ValidationError("Add some games to the catalog first.")
            self._commit()
            return {"state": self._state(), "week": night}

    def record(self, week_id, pick_id, raw_order):
        """Who finished where in one of a game night's games (None takes the result away)."""
        with self._changed:
            week = self._find_week(week_id)
            if week is None:
                raise NotFound("That game night isn't on the board anymore.")
            pick = next((p for p in week["picks"] if p["id"] == pick_id), None)
            if pick is None:
                raise NotFound("That game isn't part of that night anymore.")
            known = {p["id"] for p in self._active()}
            if pick["result"]:
                # Fixing an old result can keep someone who's since moved out.
                known |= {player_id for group in pick["result"] for player_id in group}
            order = clean_order(raw_order, known)
            if order != pick["result"]:
                pick["result"] = order
                pick["recorded"] = self._clock() if order else None
                self._commit()
            return {"state": self._state()}

    def notify(self, week_id=None, *, manual=True):
        """Texts and emails everyone a game night's games. Sending happens in the background."""
        with self._changed:
            week = self._find_week(week_id) if week_id else (self._weeks[-1] if self._weeks else None)
            if week is None:
                raise NotFound("Pick the games before sending them out.")
            if not self._can_send():
                raise ValidationError("Texts and emails aren't set up. Add them to config.json on the Pi.")
            if self._sending:
                raise ValidationError("Already sending. Give it a moment.")
            sent_at = (week["notified"] or {}).get("at")
            if manual and sent_at:
                wait = datetime.fromisoformat(sent_at) + timedelta(minutes=RESEND_MINUTES) - self._wall_clock()
                if wait > timedelta(0):
                    minutes = max(1, round(wait.total_seconds() / 60))
                    raise ValidationError("Just sent. You can send again in %d min." % minutes)
            players = self._active()
            if not players:
                raise ValidationError("Sign up the roommates first.")
            names = {p["id"]: p["name"] for p in self._players}
            link = self._link() if self._link else None
            messages = [invitation(week, time=self._schedule["time"], recipient=p, names=names, link=link)
                        for p in players]
            self._sending = True
            self._announce()
            night = week["id"]

        def send():
            try:
                outcome = self._notifier.deliver(messages)
            except Exception:
                log.exception("Roommate Games: sending the games failed")
                outcome = {"sent": 0, "failed": len(messages), "problem": "Sending failed. See the board's log."}
            with self._changed:
                self._sending = False
                target = self._find_week(night)
                if target is not None:
                    target["notified"] = {"at": self._clock(), **outcome}
                    self._commit()
                else:
                    self._announce()

        self._run(send)
        return {"state": self.snapshot()}

    # Internals (call with self._changed held)

    def _active(self):
        return [p for p in self._players if not p["left"]]

    def _get_player(self, player_id):
        player = next((p for p in self._active() if p["id"] == player_id), None)
        if player is None:
            raise NotFound("That roommate isn't signed up anymore.")
        return player

    def _get_game(self, game_id):
        game = next((g for g in self._games if g["id"] == game_id), None)
        if game is None:
            raise NotFound("That game isn't in the catalog anymore.")
        return game

    def _check_name_free(self, name, others):
        if any(p["name"].casefold() == name.casefold() for p in others):
            raise ValidationError("There's already a roommate called %s." % name)

    def _check_game_free(self, name):
        if any(g["name"].casefold() == name.casefold() for g in self._games):
            raise ValidationError("%s is already in the catalog." % name)

    def _clean_kind(self, kind, specialist):
        if kind not in KINDS:
            raise ValidationError("Pick General or Specialized.")
        if kind == "general":
            return kind, None
        if not any(p["id"] == specialist for p in self._active()):
            raise ValidationError("Pick the roommate who's best at it.")
        return kind, specialist

    def _trashed(self, ids, kind):
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValidationError("'ids' must be a list of ids.")
        return [i for i in ids if i in self._trash and kind in self._trash[i][1]]

    def _new_id(self, requested):
        taken = {p["id"] for p in self._players} | {g["id"] for g in self._games} | set(self._trash)
        if isinstance(requested, str) and CLIENT_ID.match(requested) and requested not in taken:
            return requested
        return uuid.uuid4().hex[:12]

    def _can_send(self):
        return self._notifier is not None and any(self._notifier.channels.values())

    def _find_week(self, week_id):
        return next((w for w in self._weeks if w["id"] == week_id), None)

    def _next_night(self, now):
        """The date of the next game night: today if it's game day, unless it's all played."""
        today = now.date()
        night = today + timedelta(days=(self._schedule["day"] - weekday(today)) % 7)
        week = self._find_week(night.isoformat())
        if week is not None and week["picks"] and all(p["result"] for p in week["picks"]):
            night += timedelta(days=7)
        return night.isoformat()

    def _draw(self, night):
        """Draws (or redraws) `night`'s games and returns the game night, or None with no games."""
        week = self._find_week(night)
        kept = [p for p in week["picks"] if p["result"]] if week else []
        active = {p["id"] for p in self._active()}
        # A Specialized game is only in the draw while its specialist is still here.
        choices = [g for g in self._games if g["kind"] == "general" or g["specialist"] in active]
        choices = [g for g in choices if g["id"] not in {p["game"] for p in kept}]
        earlier = [w for w in self._weeks if w["id"] < night]
        recent = [p["kind"] for w in earlier for p in w["picks"]] + [p["kind"] for p in kept]
        avoid = {p["game"] for p in earlier[-1]["picks"]} if earlier else set()
        if week:
            # Picking again should come up with something different where it can.
            avoid |= {p["game"] for p in week["picks"] if not p["result"]}
        drawn = choose_games(choices, count=self._schedule["perNight"] - len(kept), recent_kinds=recent,
                             avoid=avoid, rng=self._rng)
        if not drawn:
            return None
        picks = kept + [
            {"id": uuid.uuid4().hex[:8], "game": g["id"], "name": g["name"], "kind": g["kind"],
             "specialist": g["specialist"], "result": None, "recorded": None}
            for g in drawn
        ]
        if week is None:
            week = {"id": night, "picks": picks, "drawn": self._clock(), "notified": None}
            self._weeks.append(week)
            self._weeks.sort(key=lambda w: w["id"])
            del self._weeks[:-MAX_WEEKS]
        else:
            week.update(picks=picks, drawn=self._clock())
        return week

    def _announce(self):
        """Tells every screen about a change that isn't worth writing to the SD card."""
        self._version += 1
        self._changed.notify_all()
        if self._feed is not None:
            self._feed.notify()

    def _public_player(self, player):
        return {
            "id": player["id"],
            "name": player["name"],
            "email": mask_email(player["email"]),
            "phone": mask_phone(player["phone"]),
        }

    def _standings(self):
        """Everyone's points, game by game, worked out from every result on the board."""
        totals = {p["id"]: {"points": 0, "bonus": 0, "played": 0, "wins": 0, "crowns": 0} for p in self._players}
        ledger = {p["id"]: [] for p in self._players}
        for week in self._weeks:
            night = {}
            for pick in week["picks"]:
                if not pick["result"]:
                    continue
                where = places(pick["result"])
                of = len(where)
                for player_id, (points, bonus) in score(pick["result"], pick["specialist"]).items():
                    if player_id not in totals:
                        continue
                    total = totals[player_id]
                    total["points"] += points + bonus
                    total["bonus"] += bonus
                    total["played"] += 1
                    total["wins"] += where[player_id] == 1
                    night[player_id] = night.get(player_id, 0) + points + bonus
                    ledger[player_id].append({
                        "week": week["id"], "pick": pick["id"], "game": pick["name"], "kind": pick["kind"],
                        "place": where[player_id], "of": of, "points": points, "bonus": bonus,
                    })
            complete = week["picks"] and all(p["result"] for p in week["picks"])
            best = max(night.values(), default=0)
            if complete and best > 0:
                for player_id, points in night.items():
                    if points == best:
                        totals[player_id]["crowns"] += 1
        return totals, ledger

    # JsonStore hooks

    def _reset(self):
        self._players = []
        self._games = []
        self._schedule = dict(DEFAULT_SCHEDULE)
        self._weeks = []

    def _state(self):
        totals, ledger = self._standings()
        active = self._active()
        players = [{**self._public_player(p), **totals[p["id"]]} for p in active]
        players.sort(key=lambda p: (-p["points"], -p["crowns"], p["name"].casefold()))
        rank = 0
        for index, player in enumerate(players):
            if index == 0 or player["points"] != players[index - 1]["points"]:
                rank = index + 1
            player["rank"] = rank
        here = {p["id"] for p in active}
        played = {}
        for week in self._weeks:
            for pick in week["picks"]:
                stats = played.setdefault(pick["game"], {"count": 0, "last": None})
                stats["count"] += 1
                stats["last"] = week["id"]
        games = [
            {**g, "played": played.get(g["id"], {}).get("count", 0), "last": played.get(g["id"], {}).get("last"),
             "available": g["kind"] == "general" or g["specialist"] in here}
            for g in self._games
        ]
        return {
            "version": self._version,
            "players": players,
            # Everyone who's ever played, for the names on past game nights.
            "names": {p["id"]: p["name"] for p in self._players},
            "games": copy.deepcopy(games),
            "schedule": dict(self._schedule),
            "weeks": copy.deepcopy(self._weeks[-WEEKS_SENT:]),
            "ledger": {player_id: entries[::-1][:LEDGER_SENT] for player_id, entries in ledger.items() if player_id in here},
            "channels": self._notifier.channels if self._notifier else {"email": False, "sms": False},
            "sending": self._sending,
            "bonus": UPSET_BONUS,
        }

    def _to_disk(self):
        return {"players": self._players, "games": self._games, "schedule": self._schedule, "weeks": self._weeks}

    def _from_disk(self, data):
        players = []
        for raw in data.get("players", []):
            if not (isinstance(raw["id"], str) and isinstance(raw["name"], str) and isinstance(raw.get("left", False), bool)):
                raise ValueError("bad player")
            players.append({
                "id": raw["id"],
                "name": raw["name"],
                "email": raw.get("email") if isinstance(raw.get("email"), str) else None,
                "phone": raw.get("phone") if isinstance(raw.get("phone"), str) else None,
                "joined": raw.get("joined"),
                "left": raw.get("left", False),
            })
        games = []
        for raw in data.get("games", []):
            if not (isinstance(raw["id"], str) and isinstance(raw["name"], str) and raw["kind"] in KINDS):
                raise ValueError("bad game")
            specialist = raw.get("specialist") if raw["kind"] == "specialized" else None
            games.append({"id": raw["id"], "name": raw["name"], "kind": raw["kind"],
                          "specialist": specialist if isinstance(specialist, str) else None, "added": raw.get("added")})
        try:
            schedule = clean_schedule(data.get("schedule") or {}, DEFAULT_SCHEDULE)
        except ValidationError as err:
            raise ValueError("bad schedule") from err
        weeks = [_valid_week(raw) for raw in data.get("weeks", [])]
        self._players, self._games, self._schedule = players, games, schedule
        self._weeks = sorted(weeks, key=lambda w: w["id"])[-MAX_WEEKS:]


def _valid_week(raw):
    if not (isinstance(raw["id"], str) and DATE.match(raw["id"]) and isinstance(raw["picks"], list)):
        raise ValueError("bad game night")
    picks = []
    for pick in raw["picks"]:
        if not (isinstance(pick["id"], str) and isinstance(pick["name"], str) and pick["kind"] in KINDS):
            raise ValueError("bad pick")
        result = pick.get("result")
        if result is not None and not (isinstance(result, list) and all(
                isinstance(group, list) and group and all(isinstance(i, str) for i in group) for group in result)):
            raise ValueError("bad result")
        picks.append({
            "id": pick["id"], "game": pick.get("game"), "name": pick["name"], "kind": pick["kind"],
            "specialist": pick.get("specialist") if pick["kind"] == "specialized" else None,
            "result": result, "recorded": pick.get("recorded"),
        })
    notified = raw.get("notified")
    return {"id": raw["id"], "picks": picks, "drawn": raw.get("drawn"),
            "notified": notified if isinstance(notified, dict) else None}
