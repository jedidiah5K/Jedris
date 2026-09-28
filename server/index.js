'use strict';

/* =========================================================================
 * JEDRIS SERVER
 * Serves the static game and runs online versus over WebSockets (any path ending in /ws).
 *   PORT  listening port (default 51920, the first dcism.org Node port)
 *   HOST  bind address (default 127.0.0.1; use 0.0.0.0 to expose directly)
 * ========================================================================= */
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Hub } = require('./hub');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIRS = ['css', 'js', 'assets'];
const PUBLIC_FILES = ['index.html', 'manifest.webmanifest'];
const MAX_MSGS_PER_SEC = 120;
const VERSION = require('../package.json').version;

function createServer() {
  const app = express();
  app.disable('x-powered-by');
  const hub = new Hub();

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, version: VERSION, online: hub.clients.size });
  });
  for (const dir of PUBLIC_DIRS) app.use(`/${dir}`, express.static(path.join(ROOT, dir), { maxAge: '1h' }));
  for (const file of PUBLIC_FILES) app.get(`/${file}`, (req, res) => res.sendFile(path.join(ROOT, file)));
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
  app.use((req, res) => res.status(404).type('text').send('Not found'));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (!pathname.endsWith('/ws')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const client = hub.connect((obj) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    });
    let windowStart = Date.now(), count = 0;
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > MAX_MSGS_PER_SEC) return;
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      hub.message(client, msg);
    });
    ws.on('close', () => hub.disconnect(client));
    ws.on('error', () => {});
  });

  // Drop connections that stop answering pings.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  server.on('close', () => clearInterval(heartbeat));

  return { app, server, wss, hub };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 51920;
  const host = process.env.HOST || '127.0.0.1';
  const { server, wss } = createServer();
  server.listen(port, host, () => {
    console.log(`Jedris ${VERSION} listening on http://${host}:${port}`);
  });
  const shutdown = () => {
    for (const ws of wss.clients) ws.terminate();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer };
