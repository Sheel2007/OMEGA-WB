import json
import os
import stat
import tempfile
import unittest
import urllib.parse

from board import spotify
from board.store import ChangeFeed

COVER = "ab67616d0000b273" + "0" * 24


def track(name="Song", *, playing=True, progress=1000, duration=200000, item_id="t1", cover=COVER):
    return {
        "is_playing": playing,
        "progress_ms": progress,
        "currently_playing_type": "track",
        "item": {
            "type": "track",
            "id": item_id,
            "name": name,
            "duration_ms": duration,
            "artists": [{"name": "First"}, {"name": "Second"}],
            "album": {"name": "Album", "images": [
                {"url": spotify.ART_URL + "a" * 40, "width": 64, "height": 64},
                {"url": spotify.ART_URL + cover, "width": 640, "height": 640},
                {"url": spotify.ART_URL + "b" * 40, "width": 300, "height": 300},
            ]},
        },
    }


class FakeSpotify:
    """Answers the handful of Spotify endpoints the board uses."""

    def __init__(self):
        self.calls = []
        self.playing = {}
        self.error = None
        self.refresh_token = "refresh-1"
        self.rotated = None

    def __call__(self, method, url, *, headers=None, form=None):
        self.calls.append({"method": method, "url": url, "headers": headers or {}, "form": form})
        if url == spotify.TOKEN_URL:
            if form["grant_type"] == "authorization_code":
                return {"access_token": "access-1", "expires_in": 3600, "refresh_token": self.refresh_token}
            token = {"access_token": "access-2", "expires_in": 3600}
            return {**token, "refresh_token": self.rotated} if self.rotated else token
        if url == spotify.API_URL + "/me":
            return {"display_name": "Sam"}
        if url.startswith(spotify.API_URL + "/me/player/currently-playing"):
            if self.error:
                raise self.error
            return self.playing
        raise AssertionError("unexpected call to %s" % url)


def linked_account(api, path=None, clock=None):
    account = spotify.SpotifyAccount("client-1", path, transport=api, now=lambda: (clock or [0])[0])
    started = account.begin_link("http://127.0.0.1:8080/api/spotify/done", "http://localhost:8080/?kiosk=1")
    state = urllib.parse.parse_qs(urllib.parse.urlsplit(started["url"]).query)["state"][0]
    account.finish_link("code-1", state)
    return account


class SpotifyAccountTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "spotify.json")
        self.api = FakeSpotify()

    def tearDown(self):
        self.tmp.cleanup()

    def test_needs_a_client_id(self):
        account = spotify.SpotifyAccount(None, self.path, transport=self.api)
        self.assertEqual(account.status(), {"configured": False, "linked": False, "account": None})
        with self.assertRaises(spotify.SpotifyError):
            account.begin_link("http://127.0.0.1:8080/api/spotify/done")

    def test_signing_in_uses_pkce_and_keeps_the_refresh_token_private(self):
        account = spotify.SpotifyAccount("client-1", self.path, transport=self.api)
        started = account.begin_link("http://127.0.0.1:8080/api/spotify/done", "http://localhost:8080/?kiosk=1")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(started["url"]).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["redirect_uri"], ["http://127.0.0.1:8080/api/spotify/done"])
        self.assertEqual(query["scope"], [spotify.SCOPES])
        self.assertNotIn("client_secret", query)
        self.assertEqual(account.return_address(), "http://localhost:8080/?kiosk=1")

        with self.assertRaises(spotify.SpotifyError):
            account.finish_link("code-1", "someone-else")
        status = account.finish_link("code-1", query["state"][0])
        self.assertEqual(status, {"configured": True, "linked": True, "account": "Sam"})

        exchange = self.api.calls[0]["form"]
        self.assertEqual(exchange["grant_type"], "authorization_code")
        verifier = exchange["code_verifier"]
        import base64, hashlib
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        self.assertEqual(challenge, query["code_challenge"][0])

        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"refresh_token": "refresh-1", "account": "Sam"})
        self.assertTrue(spotify.SpotifyAccount("client-1", self.path, transport=self.api).linked, "survives a restart")

    def test_a_rotated_refresh_token_is_saved(self):
        clock = [0]
        account = linked_account(self.api, self.path, clock)
        clock[0] = 10 * 3600
        self.api.rotated = "refresh-2"
        account.now_playing()
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["refresh_token"], "refresh-2")

    def test_a_401_gets_a_fresh_token_and_tries_once_more(self):
        account = linked_account(self.api)
        self.api.error = spotify.SpotifyError("expired", status=401)
        with self.assertRaises(spotify.SpotifyError):
            account.now_playing()
        refreshes = [c for c in self.api.calls if c["form"] and c["form"]["grant_type"] == "refresh_token"]
        asks = [c for c in self.api.calls if "currently-playing" in c["url"]]
        self.assertEqual((len(refreshes), len(asks)), (1, 2))

    def test_a_revoked_sign_in_is_forgotten(self):
        clock = [0]
        account = linked_account(self.api, self.path, clock)
        clock[0] = 10 * 3600

        def refuse(method, url, *, headers=None, form=None):
            raise spotify.SpotifyError("Spotify wouldn't renew the board's sign-in.", status=400)
        account._transport = refuse
        with self.assertRaises(spotify.SpotifyError):
            account.now_playing()
        self.assertFalse(account.linked)
        self.assertFalse(os.path.exists(self.path))

    def test_unlinking_forgets_the_account(self):
        account = linked_account(self.api, self.path)
        self.assertEqual(account.unlink(), {"configured": True, "linked": False, "account": None})
        self.assertFalse(os.path.exists(self.path))


class ShapeTest(unittest.TestCase):
    def test_a_song(self):
        shaped = spotify.shape_playback(track(), 5000)
        self.assertEqual(shaped, {
            "id": "t1", "kind": "track", "title": "Song", "artist": "First, Second", "album": "Album",
            "art": COVER, "playing": True, "duration_ms": 200000, "progress_ms": 1000, "at": 5000,
        })

    def test_nothing_playing(self):
        self.assertIsNone(spotify.shape_playback({}, 0))
        self.assertIsNone(spotify.shape_playback({"is_playing": False, "item": None}, 0))

    def test_an_episode(self):
        shaped = spotify.shape_playback({"is_playing": False, "progress_ms": 5, "item": {
            "type": "episode", "id": "e1", "name": "Ep", "duration_ms": 10,
            "show": {"name": "Show", "publisher": "Pub"},
            "images": [{"url": spotify.ART_URL + COVER, "width": 300}]}}, 0)
        self.assertEqual((shaped["kind"], shaped["artist"], shaped["album"], shaped["art"]), ("episode", "Show", "Pub", COVER))

    def test_a_local_file_has_no_cover_and_odd_values_are_ignored(self):
        raw = track(item_id=None, progress="x")
        raw["item"]["uri"] = "spotify:local:a:b:c:1"
        raw["item"]["album"]["images"] = [{"url": "https://evil.example/x.jpg", "width": 300}]
        shaped = spotify.shape_playback(raw, 0)
        self.assertEqual((shaped["id"], shaped["art"], shaped["progress_ms"]), ("spotify:local:a:b:c:1", None, 0))


class NowPlayingTest(unittest.TestCase):
    def setUp(self):
        self.api = FakeSpotify()
        self.time = [1000.0]
        self.fetched = []
        self.feed = ChangeFeed()

    def board(self, account=None):
        def fetch(url):
            self.fetched.append(url)
            return b"jpeg", "image/jpeg"
        return spotify.NowPlaying(account or linked_account(self.api), feed=self.feed, fetch_art=fetch,
                                  clock=lambda: self.time[0])

    def test_not_linked_waits_to_be_woken(self):
        board = self.board(spotify.SpotifyAccount("client-1", transport=self.api))
        self.assertIsNone(board.poll())
        self.assertEqual(board.snapshot()["track"], None)

    def test_the_version_moves_only_for_a_new_song_a_pause_or_a_seek(self):
        board = self.board()
        self.api.playing = track(progress=1000)
        self.assertEqual(board.poll(), spotify.PLAYING_POLL_SECONDS)
        first = board.snapshot()
        self.assertEqual(first["track"]["title"], "Song")

        self.time[0] += 5
        self.api.playing = track(progress=6000)
        board.poll()
        self.assertEqual(board.snapshot(), first, "played on: nothing to tell the screens")

        self.time[0] += 5
        self.api.playing = track(progress=60000)
        board.poll()
        seeked = board.snapshot()
        self.assertGreater(seeked["version"], first["version"])
        self.assertEqual(seeked["track"]["progress_ms"], 60000)

        self.api.playing = track(progress=60000, playing=False)
        self.assertEqual(board.poll(), spotify.IDLE_POLL_SECONDS)
        self.assertFalse(board.snapshot()["track"]["playing"])

        self.api.playing = track("Next", item_id="t2")
        board.poll()
        self.assertEqual(board.snapshot()["track"]["title"], "Next")

        self.api.playing = {}
        self.assertEqual(board.poll(), spotify.IDLE_POLL_SECONDS)
        self.assertIsNone(board.snapshot()["track"])

    def test_checks_again_just_after_the_song_ends(self):
        board = self.board()
        self.api.playing = track(progress=198000, duration=200000)
        self.assertAlmostEqual(board.poll(), 2.5)

    def test_errors_keep_the_song_and_honour_retry_after(self):
        board = self.board()
        self.api.playing = track()
        board.poll()
        self.api.error = spotify.SpotifyError("Spotify is rate-limiting the board.", status=429, retry_after=30)
        self.assertEqual(board.poll(), 30)
        state = board.snapshot()
        self.assertEqual(state["track"]["title"], "Song")
        self.assertIn("rate-limiting", state["error"])

    def test_covers_come_only_from_songs_the_board_has_shown_and_are_kept(self):
        board = self.board()
        with self.assertRaises(ValueError):
            board.art("../etc/passwd")
        self.assertIsNone(board.art(COVER), "not seen yet")
        self.api.playing = track()
        board.poll()
        self.assertEqual(board.art(COVER), (b"jpeg", "image/jpeg"))
        board.art(COVER)
        self.assertEqual(self.fetched, [spotify.ART_URL + COVER])

    def test_unlinking_clears_the_song(self):
        board = self.board()
        self.api.playing = track()
        board.poll()
        board.unlink()
        state = board.snapshot()
        self.assertEqual((state["linked"], state["track"]), (False, None))


if __name__ == "__main__":
    unittest.main()
