#!/usr/bin/env bash
# Tries the board as it is in this folder on the Pi, without touching the real one.
# Run it on your laptop: it copies this folder (uncommitted changes and all) to the Pi
# over SSH, which Tailscale lets you reach from anywhere, and runs it there as a test
# board on port 8081 with its own data. The real board on 8080 keeps running.
#
#   pi/dev.sh          copy this folder over and (re)start the test board
#   pi/dev.sh logs     follow the test board's log (Ctrl+C to stop following)
#   pi/dev.sh stop     stop the test board
#
# WIDGET_BOARD_PI is how ssh reaches the Pi (default: roommates, its Tailscale name),
# for example: export WIDGET_BOARD_PI=pi@roommates
# WIDGET_BOARD_DEV_PORT picks another port for the test board (default: 8081).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI="${WIDGET_BOARD_PI:-roommates}"
PORT="${WIDGET_BOARD_DEV_PORT:-8081}"
HOST="${PI#*@}"

# Runs on the Pi: swaps in the copied folder and restarts the test board from it.
# Its data and log stay in ~/widget-board-dev. Its settings are the real board's own,
# except that it leaves the monitor alone: switching that is the real board's job.
read -r -d '' START_ON_PI <<'EOF' || true
set -eu
port="$1"
dir="$HOME/widget-board-dev"
server="$dir/app/run.py"
live="$(systemctl show -p WorkingDirectory --value widget-board 2>/dev/null || true)"
[ -n "$live" ] || live="$HOME/Widget-Board"

pkill -f "$server" || true
for _ in $(seq 1 50); do
  pgrep -f "$server" >/dev/null || break
  sleep 0.1
done

rm -rf "$dir/app"
mkdir -p "$dir/app" "$dir/data"
tar -xzf - -C "$dir/app"

# Otherwise the health check below would be answered by whatever is there, such as the real board.
if curl -s -o /dev/null "http://localhost:$port/"; then
  echo "Something else is already using port $port on the Pi. Pick another with WIDGET_BOARD_DEV_PORT." >&2
  exit 1
fi

# The copy has the same passwords in it as the real one, so only this user can read it.
umask 077
python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}
config["screen"] = False
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
' "$live/config.json" "$dir/config.json"

cd "$dir/app"
PYTHONUNBUFFERED=1 nohup python3 "$server" --port "$port" --data "$dir/data" --config "$dir/config.json" \
  >"$dir/server.log" 2>&1 </dev/null &
pid=$!

for _ in $(seq 1 40); do
  if curl -fs "http://localhost:$port/api/health" >/dev/null 2>&1; then
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.25
done
echo "The test board didn't start. The end of its log:" >&2
tail -n 20 "$dir/server.log" >&2
exit 1
EOF

read -r -d '' STOP_ON_PI <<'EOF' || true
if pkill -f "$HOME/widget-board-dev/app/run.py"; then
  echo "Stopped the test board."
else
  echo "The test board wasn't running."
fi
EOF

# Runs a bash script on the Pi, passing it the given arguments.
on_pi() {
  local script="$1"
  shift
  local command arg
  command="bash -c $(printf '%q' "$script") widget-board-dev"
  for arg in "$@"; do
    command+=" $(printf '%q' "$arg")"
  done
  ssh -o ConnectTimeout=10 "$PI" "$command"
}

# ssh exits with 255 when it couldn't get to the Pi at all.
explain_failure() {
  local status="$1"
  if [ "$status" -eq 255 ]; then
    echo >&2
    echo "Couldn't reach the Pi as \"$PI\". Check that:" >&2
    echo "  - Tailscale is connected on this computer and the Pi is online (tailscale status)" >&2
    echo "  - the Pi has SSH turned on (sudo raspi-config nonint do_ssh 0)" >&2
    echo "  - WIDGET_BOARD_PI has the Pi's user name, e.g. export WIDGET_BOARD_PI=pi@$HOST" >&2
  fi
  exit "$status"
}

# Every file in this folder that git doesn't ignore, so data/ and config.json stay
# behind, and files deleted but not yet committed are left out.
files() {
  git -C "$APP_DIR" ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' file; do
      if [ -e "$APP_DIR/$file" ]; then printf '%s\0' "$file"; fi
    done
}

start() {
  echo "→ Copying $APP_DIR to $PI"
  local status=0
  # Plain ustar, without macOS's ._ files and extended attributes, unpacks cleanly on the Pi.
  files | (cd "$APP_DIR" && COPYFILE_DISABLE=1 tar --format=ustar --null -T - -czf -) |
    on_pi "$START_ON_PI" "$PORT" || status=$?
  [ "$status" -eq 0 ] || explain_failure "$status"
  echo "Test board is running:"
  echo "  From here:         http://$HOST:$PORT"
  echo "  On the Pi itself:  http://localhost:$PORT/?kiosk=1"
}

case "${1:-start}" in
  start)
    start
    ;;
  stop)
    on_pi "$STOP_ON_PI" || explain_failure "$?"
    ;;
  logs)
    ssh -t -o ConnectTimeout=10 "$PI" 'tail -n 50 -f "$HOME/widget-board-dev/server.log"' || explain_failure "$?"
    ;;
  *)
    echo "Usage: pi/dev.sh [start|logs|stop]" >&2
    exit 2
    ;;
esac
