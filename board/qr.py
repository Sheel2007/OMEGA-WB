"""A small QR Code encoder: byte mode, error correction level M, versions 1-6.

That covers up to 106 bytes, plenty for a local URL. Written against the
QR Code spec (ISO/IEC 18004) so the board needs no third-party packages.
"""

# version: (data codewords per block, blocks, error correction codewords per block)
_LEVEL_M = {
    1: (16, 1, 10),
    2: (28, 1, 16),
    3: (44, 1, 26),
    4: (32, 2, 18),
    5: (43, 2, 24),
    6: (27, 4, 16),
}
_ALIGNMENT = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}
_LEVEL_M_FORMAT = 0b00

_MASKS = [
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
]
_FINDER_LIKE = ("10111010000", "00001011101")


def _gf_mul(x, y):
    z = 0
    for i in range(7, -1, -1):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for byte in data:
        factor = byte ^ result.pop(0)
        result.append(0)
        for i, coefficient in enumerate(divisor):
            result[i] ^= _gf_mul(coefficient, factor)
    return result


def format_bits(mask):
    data = (_LEVEL_M_FORMAT << 3) | mask
    remainder = data
    for _ in range(10):
        remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537)
    return ((data << 10) | remainder) ^ 0x5412


def _codewords(text):
    data = text.encode("utf-8")
    for version in sorted(_LEVEL_M):
        per_block, blocks, ec_len = _LEVEL_M[version]
        capacity = per_block * blocks * 8
        if 4 + 8 + len(data) * 8 <= capacity:
            break
    else:
        raise ValueError("Text is too long for a small QR code (max 106 bytes).")

    bits = []

    def push(value, length):
        bits.extend((value >> i) & 1 for i in range(length - 1, -1, -1))

    push(0b0100, 4)
    push(len(data), 8)
    for byte in data:
        push(byte, 8)
    push(0, min(4, capacity - len(bits)))
    push(0, -len(bits) % 8)

    codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = 0xEC
    while len(codewords) < per_block * blocks:
        codewords.append(pad)
        pad ^= 0xEC ^ 0x11

    divisor = rs_divisor(ec_len)
    data_blocks = [codewords[i * per_block:(i + 1) * per_block] for i in range(blocks)]
    ec_blocks = [rs_remainder(block, divisor) for block in data_blocks]
    interleaved = [block[i] for i in range(per_block) for block in data_blocks]
    interleaved += [block[i] for i in range(ec_len) for block in ec_blocks]
    return version, interleaved


class _Grid:
    def __init__(self, version):
        self.version = version
        self.size = version * 4 + 17
        self.dark = [[False] * self.size for _ in range(self.size)]
        self.reserved = [[False] * self.size for _ in range(self.size)]

    def put(self, x, y, dark):
        self.dark[y][x] = dark
        self.reserved[y][x] = True

    def draw_function_patterns(self):
        size = self.size
        for i in range(size):
            self.put(6, i, i % 2 == 0)
            self.put(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (size - 4, 3), (3, size - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < size and 0 <= y < size:
                        self.put(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        positions = _ALIGNMENT[self.version]
        last = len(positions) - 1
        for i, ax in enumerate(positions):
            for j, ay in enumerate(positions):
                if (i, j) in ((0, 0), (0, last), (last, 0)):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.put(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self.draw_format(0)

    def draw_format(self, mask):
        bits = format_bits(mask)
        bit = lambda i: (bits >> i) & 1 == 1  # noqa: E731
        size = self.size
        for i in range(6):
            self.put(8, i, bit(i))
        self.put(8, 7, bit(6))
        self.put(8, 8, bit(7))
        self.put(7, 8, bit(8))
        for i in range(9, 15):
            self.put(14 - i, 8, bit(i))
        for i in range(8):
            self.put(size - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self.put(8, size - 15 + i, bit(i))
        self.put(8, size - 8, True)

    def draw_data(self, codewords):
        size = self.size
        index, total = 0, len(codewords) * 8
        right = size - 1
        while right >= 1:
            if right == 6:
                right = 5
            upward = (right + 1) & 2 == 0
            for vert in range(size):
                y = size - 1 - vert if upward else vert
                for x in (right, right - 1):
                    if not self.reserved[y][x] and index < total:
                        self.dark[y][x] = (codewords[index >> 3] >> (7 - (index & 7))) & 1 == 1
                        index += 1
            right -= 2

    def apply_mask(self, mask):
        test = _MASKS[mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.reserved[y][x] and test(x, y):
                    self.dark[y][x] = not self.dark[y][x]


def _penalty(dark):
    size = len(dark)
    score = 0
    lines = dark + [list(column) for column in zip(*dark)]
    for line in lines:
        run_value, run_length = None, 0
        for value in line + [None]:
            if value == run_value:
                run_length += 1
                continue
            if run_length >= 5:
                score += 3 + run_length - 5
            run_value, run_length = value, 1
        text = "".join("1" if v else "0" for v in line)
        score += 40 * sum(text[i:i + 11] in _FINDER_LIKE for i in range(len(text) - 10))
    for y in range(size - 1):
        for x in range(size - 1):
            if dark[y][x] == dark[y][x + 1] == dark[y + 1][x] == dark[y + 1][x + 1]:
                score += 3
    total = size * size
    dark_count = sum(map(sum, dark))
    score += 10 * (abs(dark_count * 20 - total * 10) // total)
    return score


def encode(text):
    """Return the QR code for ``text`` as rows of booleans (True = dark)."""
    version, codewords = _codewords(text)
    best = None
    for mask in range(8):
        grid = _Grid(version)
        grid.draw_function_patterns()
        grid.draw_data(codewords)
        grid.apply_mask(mask)
        grid.draw_format(mask)
        score = _penalty(grid.dark)
        if best is None or score < best[0]:
            best = (score, grid.dark)
    return best[1]


def to_svg(text, border=4):
    modules = encode(text)
    dim = len(modules) + border * 2
    path = "".join(
        "M%d,%dh1v1h-1z" % (x + border, y + border)
        for y, row in enumerate(modules)
        for x, dark in enumerate(row)
        if dark
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
        'shape-rendering="crispEdges"><path fill="currentColor" d="%s"/></svg>' % (dim, dim, path)
    )
