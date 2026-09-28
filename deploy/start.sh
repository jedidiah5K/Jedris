#!/bin/sh
# Start (or restart) Jedris under pm2 and save it, as dcism.org's
# Custom Application Hosting expects.
#   Usage: PORT=<port from the subdomain settings> sh deploy/start.sh
cd "$(dirname "$0")/.." || exit 1
if [ -z "$PORT" ]; then
  echo "Set PORT to the port shown in admin.dcism.org > Subdomains > settings, e.g.:"
  echo "  PORT=20279 sh deploy/start.sh"
  exit 1
fi
npx pm2 delete jedris > /dev/null 2>&1
PORT="$PORT" npx pm2 start ecosystem.config.cjs && npx pm2 save
sleep 2
if curl -fs "http://127.0.0.1:${PORT}/api/health"; then
  echo
  echo "Jedris is up on port ${PORT}."
else
  echo "Jedris did not answer yet. Check: npx pm2 logs jedris --lines 30"
fi
