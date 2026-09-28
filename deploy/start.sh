#!/bin/sh
# Start the Jedris server in the background if it isn't already running.
# Safe to run repeatedly (for example from cron every few minutes).
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-51920}"
if curl -fs "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1; then
  echo "Jedris is already running on port ${PORT}."
  exit 0
fi
PORT="$PORT" nohup node server/index.js >> jedris.log 2>&1 &
echo "Started Jedris on port ${PORT} (pid $!). Logs: $(pwd)/jedris.log"
