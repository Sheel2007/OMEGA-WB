import subprocess
import unittest

from board.kiosk import Kiosk, is_local_address


class FakeRun:
    def __init__(self, returncode=0, error=None):
        self.returncode = returncode
        self.error = error
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        if self.error:
            raise self.error
        return subprocess.CompletedProcess(args, self.returncode)


class KioskTest(unittest.TestCase):
    def test_finds_the_kiosk_browser_by_its_profile_folder(self):
        run = FakeRun(returncode=0)
        self.assertTrue(Kiosk(run=run).is_running())
        self.assertEqual(run.calls[0][0], "pgrep")
        self.assertIn("widget-board-browser", run.calls[0][-1])

    def test_not_running_when_nothing_matches(self):
        self.assertFalse(Kiosk(run=FakeRun(returncode=1)).is_running())

    def test_not_running_where_pgrep_does_not_exist(self):
        self.assertFalse(Kiosk(run=FakeRun(error=FileNotFoundError())).is_running())

    def test_close_signals_only_the_kiosk_browser(self):
        run = FakeRun()
        Kiosk(run=run).close()
        self.assertEqual(run.calls[0][0], "pkill")
        self.assertIn("widget-board-browser", run.calls[0][-1])

    def test_close_survives_a_missing_pkill(self):
        Kiosk(run=FakeRun(error=FileNotFoundError())).close()


class LocalAddressTest(unittest.TestCase):
    def test_loopback_addresses_are_local(self):
        for address in ["127.0.0.1", "127.8.0.1", "::1", "::ffff:127.0.0.1"]:
            self.assertTrue(is_local_address(address), address)

    def test_other_devices_are_not(self):
        for address in ["192.168.1.20", "10.0.0.5", "::ffff:192.168.1.20", "fe80::1", "nonsense", ""]:
            self.assertFalse(is_local_address(address), address)


if __name__ == "__main__":
    unittest.main()
