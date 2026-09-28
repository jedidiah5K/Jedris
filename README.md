# Jedris

**Competitive block stacking in your browser.** Jedris is a fast, modern falling-block game with guideline-accurate mechanics, a neon HUD, local versus, and real-time online versus.

The game itself is plain HTML, CSS and JavaScript with no build step, so it also runs straight from disk. A small Node.js server (Express + WebSockets) hosts it online and runs matchmaking.

![Jedris gameplay](assets/og-image.png)

## Play

- **Offline:** download or clone the repository and open `index.html` in Chrome, Firefox, Edge or Safari. Every mode except Online Versus works this way.
- **With online play:** run the server (`npm install`, then `npm start`) and open http://localhost:51920.
- **On the web:** see [Deploying to dcism.org](#deploying-to-dcismorg).

## Modes

| Mode | Goal |
| --- | --- |
| **40 Lines** | Clear 40 lines as fast as possible. Personal best is saved. |
| **Blitz** | Score as much as you can in 2 minutes. Gravity rises every 10 lines. |
| **Zen** | Endless, relaxed stacking. No timer and no game over. |
| **Online Versus** | Real-time 1v1 against anyone: quick match, or share a 4-letter room code with a friend. Best of 3, with rematches. |
| **Local Versus** | Two players, one keyboard, split screen. Send garbage to top out your opponent. Best of 3 rounds. |

## Controls

All keys can be rebound in **Config**. Solo modes use the Player 1 keys.

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move left / right | `A` / `D` | `←` / `→` |
| Soft drop | `S` | `↓` |
| Hard drop | `W` | `↑` |
| Rotate CCW / CW | `Q` / `E` | `,` / `.` |
| Rotate 180° | `R` | `/` |
| Hold | `Left Shift` | `Right Shift` |
| Quick retry (solo) | `` ` `` | |
| Pause | `Esc` | `Esc` |

Some keyboards can't register many keys at once (ghosting). If inputs drop in versus, try binding keys that are further apart.

## Mechanics

- 10×20 playfield with 2 hidden rows above it
- SRS rotation with full wall-kick tables (separate I-piece table), plus 180° rotation
- 7-bag randomizer (independent per player), hold, 5-piece preview, ghost piece
- 500 ms lock delay that resets on move/rotate, with a maximum of 15 resets per piece
- Configurable DAS, ARR (0 = instant), soft drop factor (including instant) and DAS cut on rotate; the last-pressed direction wins
- Fixed 60 Hz simulation, independent of the display's refresh rate
- T-spin and T-spin Mini detection (3-corner rule), back-to-back, combos and perfect clears

### Attack table

| Clear | Lines sent |
| --- | --- |
| Single / Double / Triple / Quad | 0 / 1 / 2 / 4 |
| T-Spin Single / Double / Triple | 2 / 4 / 6 |
| T-Spin Mini Single / Double | 0 / 1 |
| Back-to-back bonus | +1 |
| Perfect clear | +10 |
| Combo (2–3 / 4–5 / 6–7 / 8–10 / 11+) | +1 / +2 / +3 / +4 / +5 |

Incoming garbage waits in the meter beside your board for 500 ms. Clearing lines cancels it first. Each attack arrives as rows with one shared hole column.

## Online versus

Each player's browser simulates its own board with the same rules as offline play. The server relays each board 30 times a second (so you see your opponent live), forwards attacks as incoming garbage, and decides rounds when someone tops out. The 500 ms garbage delay also absorbs normal network latency.

Protocol (JSON over a WebSocket at `<site>/ws`):

| Client → server | Server → client |
| --- | --- |
| `hello {name}`, `quick`, `create`, `join {code}`, `cancel` | `welcome`, `queued`, `room {code}`, `error` |
| `state {s}` (board snapshot), `attack {n}`, `dead {round}` | `match`, `round {seed}`, `opp {s}`, `garbage {n}` |
| `rematch`, `leave`, `ping` | `roundEnd`, `matchEnd`, `rematchAsk`, `opponentLeft`, `pong` |

`GET /api/health` reports the server version and how many players are connected.

## Project layout

```
index.html              Page shell: menus, lobby, settings, help, results
css/style.css           All styling
js/config.js            Constants, default settings, localStorage
js/pieces.js            Piece shapes, SRS kick tables, scoring/attack tables, RNG
js/sound.js             Synthesized sound effects (Web Audio, no audio files)
js/game.js              Game class: board logic, handling, spins, garbage (one per player)
js/input.js             Keyboard → per-player actions
js/render.js            Canvas renderer, HUD and visual effects
js/ui.js                App flow, menus, settings and keybind editor
js/online.js            Online versus client: lobby, networking, opponent board mirror
js/main.js              Fixed-timestep main loop
server/index.js         Node server: static files, /api/health, WebSocket endpoint
server/hub.js           Matchmaking, rooms, rounds and relays
deploy/                 dcism.org .htaccess and start/stop scripts
assets/                 Favicon, app icons and share image
tests/                  Logic suite (open tests/index.html), UI and online end-to-end tests
```

The client uses plain `<script>` tags rather than ES modules, so it still runs when `index.html` is opened directly from disk.

## Development

Requires Node.js 18 or newer.

```sh
npm install
npm start                 # http://localhost:51920 (PORT and HOST env vars override)
```

Tests:

```sh
npx playwright install chromium   # once
npm test                          # server unit tests, game logic + UI, two-browser online match
```

You can also open `tests/index.html` in a browser to run the game-logic suite by hand. GitHub Actions runs `npm test` on every push and pull request.

## Deploying to dcism.org

dcism.org runs Node.js apps behind Apache. Your app listens on one of the ports 51920–51929, and an `.htaccess` file in the subdomain folder forwards traffic to it.

1. **Upload** the project to your subdomain folder over SFTP (everything except `node_modules/`, `tests/` and `.github/`).
2. **Install dependencies** over SSH, inside that folder:
   ```sh
   npm ci --omit=dev
   ```
3. **Add the proxy:** copy `deploy/dcism.htaccess` to `.htaccess` in the same folder. If you use a port other than 51920, change it in both `RewriteRule` lines.
4. **Start the server:**
   ```sh
   sh deploy/start.sh        # or: PORT=51921 sh deploy/start.sh
   ```
   It runs in the background, logs to `jedris.log`, and does nothing if Jedris is already running. `sh deploy/stop.sh` stops it.
5. **Check it:** open `https://<your-subdomain>.dcism.org/api/health`. It should say `"ok": true`.

If the server restarts, run `deploy/start.sh` again. If your account allows cron, `*/5 * * * * sh /path/to/jedris/deploy/start.sh` keeps it running automatically.

If online matches connect but never start, or the lobby keeps saying the server is offline while `/api/health` works, the host is probably blocking WebSocket proxying. Everything else in the game still works.

The display fonts load from Google Fonts. If they're unavailable, the game falls back to system fonts.

## Credits

Built by [@jedidiah5K](https://github.com/jedidiah5K). Jedris is an independent project. It isn't affiliated with or endorsed by any other block-stacking game or its owners.
