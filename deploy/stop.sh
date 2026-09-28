#!/bin/sh
# Stop Jedris (pm2), plus any copy started by older versions of start.sh.
cd "$(dirname "$0")/.." || exit 1
npx pm2 delete jedris > /dev/null 2>&1 && npx pm2 save > /dev/null 2>&1
pkill -f "node server/index.js" > /dev/null 2>&1
echo "Jedris stopped."
