import subprocess
import unittest

from board.screen import Screen, find_method, settings_from


def tools(*names):
    return lambda name: "/usr/bin/" + name if name in names else None


def no_files(_path):
    raise FileNotFoundError(_path)


class Run:
    """Stands in for subprocess.run: records each command, and fails the ones asked to."""

    def __init__(self, fail=(), message="no output"):
        self.commands = []
        self.envs = []
        self.fail = fail
        self.message = message

    def __call__(self, argv, env=None, **_):
        self.commands.append(argv)
        self.envs.append(env)
        failed = any(argv[: len(f)] == list(f) for f in self.fail)
        return subprocess.CompletedProcess(argv, 1 if failed else 0, stdout=None, stderr=self.message if failed else "")


class FindTest(unittest.TestCase):
    def test_the_pis_wayland_desktop_is_found_from_the_service(self):
        method, problem = find_method(which=tools("wlopm", "xset"), environ={"HOME": "/home/pi"}, uid=1000,
                                      listdir=lambda path: ["wayland-0.lock", "wayland-0", "pulse"])
        self.assertIsNone(problem)
        self.assertEqual(method.name, "wlopm")
        self.assertEqual((method.env["XDG_RUNTIME_DIR"], method.env["WAYLAND_DISPLAY"]), ("/run/user/1000", "wayland-0"))
        self.assertEqual((method.off, method.on), ([["wlopm", "--off", "*"]], [["wlopm", "--on", "*"]]))

    def test_wayland_without_wlopm_says_what_to_install(self):
        method, problem = find_method(which=tools("xset"), environ={"WAYLAND_DISPLAY": "wayland-1"}, uid=1000,
                                      listdir=no_files)
        self.assertIsNone(method, "xset can't power down a Wayland screen")
        self.assertIn("sudo apt install wlopm", problem)

    def test_an_x11_desktop_uses_dpms(self):
        method, _ = find_method(which=tools("xset"), environ={"HOME": "/home/pi"}, uid=1000, listdir=no_files,
                                exists=lambda path: path == "/tmp/.X11-unix/X0")
        self.assertEqual(method.name, "xset")
        self.assertEqual(method.env["DISPLAY"], ":0")
        self.assertEqual(method.on[-1], ["xset", "-dpms"], "and the desktop doesn't blank it by itself afterwards")

    def test_nothing_to_switch_off_says_so(self):
        method, problem = find_method(which=tools(), environ={}, uid=501, listdir=no_files, exists=lambda path: False)
        self.assertIsNone(method)
        self.assertIn("No desktop", problem)

    def test_commands_from_config_come_first(self):
        settings = settings_from({"off": "ddcutil setvcp d6 04", "on": "ddcutil setvcp d6 01"})
        method, _ = find_method(settings, which=tools(), environ={}, uid=1000, listdir=no_files)
        self.assertEqual((method.name, method.off, method.on),
                         ("your commands", [["ddcutil", "setvcp", "d6", "04"]], [["ddcutil", "setvcp", "d6", "01"]]))

    def test_settings(self):
        self.assertEqual(settings_from(None), {})
        self.assertIsNone(settings_from(False))
        self.assertEqual(settings_from({"off": "x"}), {}, "both are needed")
        self.assertEqual(settings_from("off"), {})


def wlopm(settings=None):
    method, _ = find_method(settings, which=tools("wlopm"), environ={"WAYLAND_DISPLAY": "wayland-0"}, uid=1000,
                            listdir=no_files)
    return method, None


class ScreenTest(unittest.TestCase):
    def test_switching_runs_the_desktops_command_and_tells_screens(self):
        run, changes = Run(), []
        screen = Screen(run=run, find=wlopm)
        screen.on_change = lambda: changes.append(screen.on)
        self.assertTrue(screen.set(False))
        self.assertEqual(run.commands, [["wlopm", "--off", "*"]])
        self.assertEqual(run.envs[0]["WAYLAND_DISPLAY"], "wayland-0")
        self.assertFalse(screen.status()["on"])
        self.assertTrue(screen.set(True))
        self.assertEqual(changes, [False, True])

    def test_a_failure_is_kept_and_the_screen_stays_on(self):
        screen = Screen(run=Run(fail=[["wlopm"]]), find=wlopm)
        self.assertFalse(screen.set(False))
        status = screen.status()
        self.assertTrue(status["on"])
        self.assertEqual(status["error"], "wlopm couldn't switch the screen off: no output")

    def test_without_a_desktop_nothing_runs(self):
        run = Run()
        screen = Screen(run=run, find=lambda settings: (None, "No desktop to switch off was found."))
        self.assertFalse(screen.set(False))
        self.assertEqual(run.commands, [])
        self.assertEqual(screen.status()["error"], "No desktop to switch off was found.")
        screen.start()
        self.assertEqual(run.commands, [], "nothing to make sure of")

    def test_the_test_goes_off_then_on(self):
        run, testing = Run(), []
        screen = Screen(run=run, find=wlopm)
        screen.on_change = lambda: testing.append(screen.status()["testing"])
        self.assertTrue(screen.test(seconds=0))
        self.assertEqual(run.commands, [["wlopm", "--off", "*"], ["wlopm", "--on", "*"]])
        self.assertTrue(screen.on)
        self.assertEqual((testing[0], testing[-1]), (True, False))

    def test_a_failed_test_does_not_leave_it_dark(self):
        run = Run(fail=[["wlopm", "--off"]])
        screen = Screen(run=run, find=wlopm)
        self.assertFalse(screen.test(seconds=0))
        self.assertTrue(screen.on)
        self.assertEqual(len(run.commands), 1)

    def test_the_desktop_is_looked_for_again_after_a_while(self):
        found, now = [], [0]
        screen = Screen(run=Run(), find=lambda settings: found.append(1) or wlopm(), clock=lambda: now[0])
        screen.status()
        screen.status()
        self.assertEqual(len(found), 1)
        now[0] = 31
        screen.status()
        self.assertEqual(len(found), 2)


if __name__ == "__main__":
    unittest.main()
