#!/usr/bin/env python3
"""Fits an existing Zigbee2MQTT configuration.yaml to this Pi, without touching the network.

    python3 pi/zigbee_config.py <configuration.yaml> <dongle path> <frontend port>

Used by pi/zigbee.sh when a configuration is already there (say, copied from the Mac
the switches were first paired on). It points `serial.port` at this Pi's dongle when
the one named doesn't exist here, moves the web page off 8080 (the board's port),
and sets `mqtt.server` to the broker on this Pi. Everything else, above all
network_key, pan_id and ext_pan_id, is left exactly as it was: changing those would
mean pairing every switch again.

Standard library only, so it edits the lines it needs rather than parsing YAML.
"""
import os
import re
import sys

BOARD_PORT = 8080


def set_key(lines, section, key, value, keep=lambda current: False):
    """Sets `section.key` to `value`, adding either if missing, unless keep(current value) says not to."""
    start = next((i for i, line in enumerate(lines) if re.match(r"^%s:" % re.escape(section), line)), None)
    if start is None:
        lines += ["%s:\n" % section, "  %s: %s\n" % (key, value)]
        return
    if re.match(r"^%s:\s*[^\s#]" % re.escape(section), lines[start]):
        # An old one-line form such as `frontend: true` becomes a block.
        lines[start] = "%s:\n" % section
    end = start + 1
    while end < len(lines) and (not lines[end].strip() or lines[end][0] in " \t"):
        end += 1
    children = [i for i in range(start + 1, end) if lines[i].strip() and not lines[i].lstrip().startswith("#")]
    indent = (len(lines[children[0]]) - len(lines[children[0]].lstrip())) if children else 2
    pattern = re.compile(r"^ {%d}%s:\s*(.*?)\s*(#.*)?$" % (indent, re.escape(key)))
    for i in children:
        match = pattern.match(lines[i])
        if match:
            if not keep(match.group(1).strip("'\"")):
                lines[i] = "%s%s: %s\n" % (" " * indent, key, value)
            return
    lines.insert(start + 1, "%s%s: %s\n" % (" " * indent, key, value))


def fit(text, dongle, frontend_port):
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    set_key(lines, "serial", "port", dongle, keep=os.path.exists)
    set_key(lines, "mqtt", "server", "mqtt://localhost:1883", keep=lambda current: current == "mqtt://localhost:1883")
    set_key(lines, "frontend", "port", str(frontend_port),
            keep=lambda current: current.isdigit() and int(current) != BOARD_PORT)
    return "".join(lines)


def main():
    path, dongle, frontend_port = sys.argv[1], sys.argv[2], int(sys.argv[3])
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fitted = fit(text, dongle, frontend_port)
    if fitted != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(fitted)
        print("  Updated %s for this Pi (the Zigbee network itself is unchanged)." % path)


if __name__ == "__main__":
    main()
