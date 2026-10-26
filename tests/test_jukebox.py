import unittest

from board.jukebox import DEFAULT_VOLUME, Jukebox, enabled_from, seconds_from, video_from
from board.store import ChangeFeed, ValidationError

VIDEO = "dQw4w9WgXcQ"


class LinkTest(unittest.TestCase):
    def test_reads_every_shape_of_youtube_link(self):
        for link in [
            "https://www.youtube.com/watch?v=%s" % VIDEO,
            "http://youtube.com/watch?v=%s" % VIDEO,
            "https://m.youtube.com/watch?v=%s" % VIDEO,
            "https://music.youtube.com/watch?v=%s" % VIDEO,
            "https://youtu.be/%s" % VIDEO,
            "youtu.be/%s" % VIDEO,
            "www.youtube.com/watch?v=%s" % VIDEO,
            "https://www.youtube.com/embed/%s" % VIDEO,
            "https://www.youtube.com/shorts/%s" % VIDEO,
            "https://www.youtube.com/live/%s" % VIDEO,
            "https://www.youtube-nocookie.com/embed/%s" % VIDEO,
            "  https://www.youtube.com/watch?v=%s  " % VIDEO,
            VIDEO,
        ]:
            with self.subTest(link=link):
                self.assertEqual(video_from(link)[0], VIDEO)

    def test_keeps_the_extra_query_a_shared_link_carries(self):
        shared = "https://www.youtube.com/watch?v=%s&list=PL123&index=4&pp=abc" % VIDEO
        self.assertEqual(video_from(shared), (VIDEO, 0))

    def test_starts_where_the_link_says(self):
        self.assertEqual(video_from("https://youtu.be/%s?t=43" % VIDEO)[1], 43)
        self.assertEqual(video_from("https://youtu.be/%s?t=1m30s" % VIDEO)[1], 90)
        self.assertEqual(video_from("https://www.youtube.com/watch?v=%s&t=1h2m3s" % VIDEO)[1], 3723)
        self.assertEqual(video_from("https://www.youtube.com/embed/%s?start=12" % VIDEO)[1], 12)
        # The old style put it in the fragment.
        self.assertEqual(video_from("https://www.youtube.com/watch?v=%s#t=30" % VIDEO)[1], 30)

    def test_a_silly_start_time_is_clamped_or_ignored(self):
        # A long but readable time is clamped to a day...
        self.assertEqual(seconds_from("999999"), 24 * 60 * 60)
        self.assertEqual(seconds_from("99h"), 24 * 60 * 60)
        # ...and anything that isn't a time at all is simply the start.
        for junk in ["", None, "soon", "--5", "1x2", "99999999999"]:
            self.assertEqual(seconds_from(junk), 0)

    def test_refuses_anything_that_isn_t_a_youtube_video(self):
        for bad in [
            "",
            "   ",
            None,
            5,
            "https://vimeo.com/12345",
            "https://example.com/watch?v=%s" % VIDEO,
            "https://www.youtube.com/",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/feed/subscriptions",
            # A lookalike host must not get through.
            "https://youtube.com.evil.example/watch?v=%s" % VIDEO,
            "https://notyoutube.com/watch?v=%s" % VIDEO,
        ]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    video_from(bad)


class SettingTest(unittest.TestCase):
    def test_off_unless_the_config_asks_for_it(self):
        for off in [{}, None, {"jukebox": False}, {"jukebox": {"enabled": False}}, {"jukebox": "yes please"}]:
            self.assertFalse(enabled_from(off), off)
        for on in [{"jukebox": True}, {"jukebox": {}}, {"jukebox": {"enabled": True}}]:
            self.assertTrue(enabled_from(on), on)


class JukeboxTest(unittest.TestCase):
    def setUp(self):
        self.feed = ChangeFeed()
        self.box = Jukebox(feed=self.feed)

    def test_starts_with_nothing_playing(self):
        state = self.box.snapshot()
        self.assertIsNone(state["track"])
        self.assertEqual(state["player"], "idle")
        self.assertEqual(state["volume"], DEFAULT_VOLUME)

    def test_playing_puts_the_video_on_the_board(self):
        result = self.box.play("https://youtu.be/%s?t=30" % VIDEO)
        track = result["state"]["track"]
        self.assertEqual(track["video"], VIDEO)
        self.assertEqual(track["start"], 30)
        self.assertEqual(result["state"]["player"], "loading")
        self.assertGreater(result["state"]["version"], 0)

    def test_asking_for_the_same_song_again_counts_as_a_restart(self):
        first = self.box.play(VIDEO)["state"]["track"]
        second = self.box.play(VIDEO)["state"]["track"]
        # Same video, but a new ask, so the board knows to start it over.
        self.assertEqual(first["video"], second["video"])
        self.assertGreater(self.box.snapshot()["version"], 1)

    def test_stop_clears_it(self):
        self.box.play(VIDEO)
        state = self.box.stop()["state"]
        self.assertIsNone(state["track"])
        self.assertEqual(state["player"], "idle")

    def test_volume_is_kept_between_nothing_and_full(self):
        self.assertEqual(self.box.set_volume(150)["state"]["volume"], 100)
        self.assertEqual(self.box.set_volume(-20)["state"]["volume"], 0)
        self.assertEqual(self.box.set_volume(33.4)["state"]["volume"], 33)
        for bad in ["loud", None, True]:
            with self.assertRaises(ValidationError):
                self.box.set_volume(bad)

    def test_setting_the_same_volume_again_changes_nothing(self):
        self.box.set_volume(40)
        version = self.box.snapshot()["version"]
        self.box.set_volume(40)
        self.assertEqual(self.box.snapshot()["version"], version)

    def test_the_board_reports_what_its_player_did(self):
        self.box.play(VIDEO)
        self.assertEqual(self.box.report("playing")["state"]["player"], "playing")
        blocked = self.box.report("blocked", "The board's browser blocked the sound.")["state"]
        self.assertEqual(blocked["player"], "blocked")
        self.assertIn("blocked", blocked["detail"])
        with self.assertRaises(ValidationError):
            self.box.report("dancing")

    def test_a_link_that_isn_t_a_video_plays_nothing(self):
        with self.assertRaises(ValidationError):
            self.box.play("https://vimeo.com/12345")
        self.assertIsNone(self.box.snapshot()["track"])

    def test_every_change_wakes_the_event_stream(self):
        before = self.feed.seq
        self.box.play(VIDEO)
        self.assertNotEqual(self.feed.seq, before)

    def test_nothing_is_ever_written_to_disk(self):
        self.box.play(VIDEO)
        # There is no file to write: a prank shouldn't survive a reboot.
        self.assertIsNone(self.box._path)
        self.assertEqual(self.box._to_disk(), {})


if __name__ == "__main__":
    unittest.main()
