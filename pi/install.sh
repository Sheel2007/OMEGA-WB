#!/usr/bin/env bash
# Sets up a Raspberry Pi to run the board:
#   - starts the board server on boot
#   - opens it full screen when the desktop logs in
#   - keeps the screen from going to sleep
# Safe to run again after pulling updates.
#
#   sudo ./pi/install.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./pi/install.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-pi}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
PORT="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('port', 8080))" "${APP_DIR}/config.json" 2>/dev/null || echo 8080)"

echo "→ Installing the emoji font (and Chromium, if it's missing)"
apt-get update -qq
apt-get install -y -qq fonts-noto-color-emoji curl
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  apt-get install -y -qq chromium || apt-get install -y -qq chromium-browser
fi

echo "→ Starting the board server on boot"
sed -e "s#__USER__#${RUN_USER}#g" -e "s#__DIR__#${APP_DIR}#g" \
  "${APP_DIR}/pi/widget-board.service" > /etc/systemd/system/widget-board.service
systemctl daemon-reload
systemctl enable widget-board.service
systemctl restart widget-board.service

echo "→ Opening the board full screen when the desktop starts"
chmod +x "${APP_DIR}/pi/kiosk.sh"
AUTOSTART_DIR="${RUN_HOME}/.config/autostart"
install -d -o "$RUN_USER" -g "$RUN_USER" "$AUTOSTART_DIR"
cat > "${AUTOSTART_DIR}/widget-board.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Widget Board
Exec=env WIDGET_BOARD_PORT=${PORT} ${APP_DIR}/pi/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF
chown "$RUN_USER:$RUN_USER" "${AUTOSTART_DIR}/widget-board.desktop"

# After "Exit to desktop" in the board's menu, this brings the board back from the app menu.
APPS_DIR="${RUN_HOME}/.local/share/applications"
install -d -o "$RUN_USER" -g "$RUN_USER" "${RUN_HOME}/.local" "${RUN_HOME}/.local/share" "$APPS_DIR"
cat > "${APPS_DIR}/widget-board.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Widget Board
Comment=Open the home board full screen
Exec=env WIDGET_BOARD_PORT=${PORT} ${APP_DIR}/pi/kiosk.sh
Icon=${APP_DIR}/web/icon.svg
Categories=Utility;
EOF
chown "$RUN_USER:$RUN_USER" "${APPS_DIR}/widget-board.desktop"

echo "→ Keeping the screen awake"
if command -v raspi-config >/dev/null; then
  raspi-config nonint do_blanking 1 || echo "  (couldn't change screen blanking; turn it off in Raspberry Pi Configuration > Display)"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Done. Reboot to start the board full screen:  sudo reboot"
echo "Roommates can open it on their phones at:     http://${IP:-<pi-address>}:${PORT}"
