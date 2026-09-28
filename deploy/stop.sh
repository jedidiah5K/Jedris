#!/bin/sh
# Stop the Jedris server started by deploy/start.sh.
pkill -f "node server/index.js" && echo "Jedris stopped." || echo "Jedris was not running."
