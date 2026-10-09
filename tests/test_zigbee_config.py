import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location("zigbee_config", os.path.join(HERE, "..", "pi", "zigbee_config.py"))
zigbee_config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(zigbee_config)

DONGLE = "/dev/serial/by-id/usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_abc-if00-port0"

# The configuration the switches were first paired with on a Mac (zigbee_ceiling).
MAC = """version: 5
homeassistant:
  enabled: false
frontend:
  enabled: true
  port: 8080
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883        # Raspberry Pi (Docker): mqtt://mosquitto:1883
serial:
  port: /dev/cu.usbserial-10           # macOS
  adapter: zstack
advanced:
  network_key: [1, 2, 3]
  pan_id: 6754
  ext_pan_id: [221, 221]
devices:
  '0xffffb40e060aceac':
    friendly_name: bedroom_light
"""


class FitTest(unittest.TestCase):
    def test_a_config_from_the_mac_is_pointed_at_this_pi_with_the_network_untouched(self):
        fitted = zigbee_config.fit(MAC, DONGLE, 8099)
        self.assertIn("  port: %s\n" % DONGLE, fitted)
        self.assertIn("frontend:\n  enabled: true\n  port: 8099\n", fitted, "off the board's port 8080")
        for kept in ("  network_key: [1, 2, 3]\n", "  pan_id: 6754\n", "  ext_pan_id: [221, 221]\n",
                     "    friendly_name: bedroom_light\n", "  adapter: zstack\n", "  base_topic: zigbee2mqtt\n"):
            self.assertIn(kept, fitted)
        self.assertEqual(zigbee_config.fit(fitted, "/dev/null", 8099), fitted.replace(DONGLE, "/dev/null")
                         if not os.path.exists(DONGLE) else fitted)

    def test_a_port_that_exists_and_a_free_frontend_port_are_kept(self):
        text = "frontend:\n  port: 8123\nserial:\n  port: /dev/null\nmqtt:\n  server: mqtt://localhost:1883\n"
        self.assertEqual(zigbee_config.fit(text, DONGLE, 8099), text)

    def test_missing_sections_and_one_line_forms_are_filled_in(self):
        fitted = zigbee_config.fit("frontend: true\nversion: 5", DONGLE, 8099)
        self.assertEqual(fitted, "frontend:\n  port: 8099\nversion: 5\nserial:\n  port: %s\nmqtt:\n  server: mqtt://localhost:1883\n" % DONGLE)


if __name__ == "__main__":
    unittest.main()
