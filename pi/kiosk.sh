#!/usr/bin/env bash
# Opens the board full screen in Chromium (no tabs, no address bar).
# install.sh makes this run automatically when the Pi's desktop starts.
# To leave kiosk mode, use "Exit to desktop" in the board's menu (or press Alt+F4).
set -u

PORT="${WIDGET_BOARD_PORT:-8080}"
URL="${WIDGET_BOARD_URL:-http://localhost:${PORT}/?kiosk=1}"
PROFILE="${HOME}/.config/widget-board-browser"

# The server starts at boot too; give it up to a minute to be ready.
for _ in $(seq 1 60); do
  if curl -fs "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  echo "Chromium isn't installed. Run: sudo apt install chromium" >&2
  exit 1
fi

# After a power cut Chromium would show a "Restore pages?" bar over the board.
PREFS="${PROFILE}/Default/Preferences"
if [ -f "$PREFS" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"
fi

exec "$BROWSER" \
  --kiosk "$URL" \
  --user-data-dir="$PROFILE" \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --check-for-update-interval=31536000 \
  --password-store=basic
