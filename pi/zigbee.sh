#!/usr/bin/env bash
# Sets up the Lights widget's Zigbee side on the Pi, so pairing is just + on the board:
#   - Mosquitto, the MQTT broker the board and Zigbee2MQTT both talk to (localhost only)
#   - Zigbee2MQTT, which drives the USB Zigbee dongle, started on boot
# Run by install.sh; safe to run again. An existing Zigbee network (its key and every
# paired switch, in /opt/zigbee2mqtt/data) is never replaced.
#
#   sudo ./pi/zigbee.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./pi/zigbee.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-pi}"
Z2M_DIR=/opt/zigbee2mqtt
Z2M_CONFIG="${Z2M_DIR}/data/configuration.yaml"
# The board itself is on 8080, Zigbee2MQTT's usual port; its own page moves here.
Z2M_FRONTEND_PORT=8099
# Zigbee2MQTT runs on Node 20.15+ or 22.2+; NodeSource only builds 22 for 64-bit Pi OS.
NODE_MAJOR=22
[ "$(dpkg --print-architecture)" = armhf ] && NODE_MAJOR=20

# The dongle, by a name that stays the same whichever USB socket it's in.
DONGLE="$(ls /dev/serial/by-id/ 2>/dev/null | grep -iE 'zigbee|sonoff|zbdongle|conbee|slzb|skyconnect|cc26|efr32' | head -n 1 || true)"
if [ -z "$DONGLE" ]; then
  echo "  No Zigbee USB dongle found, so the lights are skipped for now."
  echo "  Plug it in and run:  sudo ./pi/zigbee.sh"
  exit 0
fi
DONGLE="/dev/serial/by-id/${DONGLE}"
case "$DONGLE" in
  *Dongle_Plus_V2*|*ZBDongle-E*) ADAPTER=ember ;;     # Sonoff ZBDongle-E
  *Sonoff*|*ZBDongle-P*|*cc26*|*CC26*) ADAPTER=zstack ;; # Sonoff ZBDongle-P and other TI sticks
  *) ADAPTER="" ;;                                     # Zigbee2MQTT works it out itself
esac
echo "  Found the Zigbee dongle: ${DONGLE}"

echo "→ Installing Mosquitto (the message broker the board and Zigbee2MQTT share)"
apt-get install -y -qq mosquitto git make g++ gcc
# Mosquitto's own default: listen on this Pi only, no password. Nothing else on the network can reach it.
systemctl enable --now mosquitto.service

echo "→ Installing Node.js ${NODE_MAJOR} for Zigbee2MQTT"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
command -v pnpm >/dev/null || npm install -g pnpm

echo "→ Installing Zigbee2MQTT in ${Z2M_DIR}"
if [ ! -d "${Z2M_DIR}/.git" ]; then
  # Keep anything already there (a data folder copied over from another computer).
  rm -rf "${Z2M_DIR}.download"
  git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git "${Z2M_DIR}.download"
  install -d "$Z2M_DIR"
  cp -a "${Z2M_DIR}.download/." "$Z2M_DIR/"
  rm -rf "${Z2M_DIR}.download"
else
  sudo -u "$RUN_USER" git -C "$Z2M_DIR" pull --ff-only || echo "  (couldn't update Zigbee2MQTT; keeping the version that's there)"
fi
chown -R "$RUN_USER:$RUN_USER" "$Z2M_DIR"
sudo -u "$RUN_USER" bash -c "cd '$Z2M_DIR' && pnpm install --frozen-lockfile && pnpm run build"

# The dongle is a serial port; the dialout group may use it.
usermod -aG dialout "$RUN_USER"

echo "→ Setting up Zigbee2MQTT"
install -d -o "$RUN_USER" -g "$RUN_USER" "${Z2M_DIR}/data"
if [ ! -f "$Z2M_CONFIG" ]; then
  # A new Zigbee network. GENERATE becomes a random key on first start, kept in this file.
  cat > "$Z2M_CONFIG" <<EOF
version: 5
homeassistant:
  enabled: false
frontend:
  enabled: true
  port: ${Z2M_FRONTEND_PORT}
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883
serial:
  port: ${DONGLE}
$( [ -n "$ADAPTER" ] && echo "  adapter: ${ADAPTER}" )
availability:
  enabled: true
advanced:
  network_key: GENERATE
  pan_id: GENERATE
  ext_pan_id: GENERATE
EOF
else
  # An existing network (maybe copied from a Mac): keep it, but point it at this Pi's
  # dongle and move its web page off the board's port.
  python3 "${APP_DIR}/pi/zigbee_config.py" "$Z2M_CONFIG" "$DONGLE" "$Z2M_FRONTEND_PORT"
fi
chown "$RUN_USER:$RUN_USER" "$Z2M_CONFIG"
chmod 600 "$Z2M_CONFIG"

sed -e "s#__USER__#${RUN_USER}#g" -e "s#__DIR__#${Z2M_DIR}#g" \
  "${APP_DIR}/pi/zigbee2mqtt.service" > /etc/systemd/system/zigbee2mqtt.service
systemctl daemon-reload
systemctl enable zigbee2mqtt.service
systemctl restart zigbee2mqtt.service

echo "  Zigbee is ready. Tap + on the Lights widget to pair a switch."
echo "  (Zigbee2MQTT's own page, for renaming switches: http://<pi-address>:${Z2M_FRONTEND_PORT})"
