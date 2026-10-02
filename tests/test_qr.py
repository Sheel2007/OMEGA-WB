import unittest

from board import qr


class ReedSolomonTest(unittest.TestCase):
    def test_matches_the_hello_world_1m_reference_vector(self):
        # Data codewords for "HELLO WORLD" at version 1-M, from the QR spec walkthrough.
        data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
        ec = qr.rs_remainder(data, qr.rs_divisor(10))
        self.assertEqual(ec, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])


class FormatBitsTest(unittest.TestCase):
    def test_level_m_format_strings(self):
        # Reference table values for error correction level M.
        expected = {
            0: 0b101010000010010,
            1: 0b101000100100101,
            4: 0b100010111111001,
            7: 0b100101010100000,
        }
        for mask, bits in expected.items():
            with self.subTest(mask=mask):
                self.assertEqual(qr.format_bits(mask), bits)


class EncodeTest(unittest.TestCase):
    def test_picks_the_smallest_version_that_fits(self):
        self.assertEqual(len(qr.encode("hi")), 21)  # version 1
        self.assertEqual(len(qr.encode("x" * 42)), 29)  # version 3 holds 42 bytes at M
        self.assertEqual(len(qr.encode("x" * 43)), 33)  # version 4

    def test_rejects_text_that_needs_a_large_code(self):
        with self.assertRaises(ValueError):
            qr.encode("x" * 107)

    def test_has_finder_patterns_timing_and_dark_module(self):
        modules = qr.encode("http://192.168.1.23:8080/#/app/shopping")
        size = len(modules)
        for x0, y0 in ((0, 0), (size - 7, 0), (0, size - 7)):
            ring = [modules[y0][x0 + i] for i in range(7)]
            self.assertEqual(ring, [True] * 7)
            centre = modules[y0 + 3][x0 + 2: x0 + 5]
            self.assertEqual(centre, [True] * 3)
            self.assertFalse(modules[y0 + 1][x0 + 1])
        timing = [modules[6][x] for x in range(8, size - 8)]
        self.assertEqual(timing, [i % 2 == 0 for i in range(8, size - 8)])
        self.assertTrue(modules[size - 8][8])

    def test_svg_output(self):
        svg = qr.to_svg("hello")
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn('viewBox="0 0 29 29"', svg)  # 21 modules + 4-module quiet zone each side
        self.assertIn("<path", svg)


if __name__ == "__main__":
    unittest.main()
