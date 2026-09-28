# Jedris

**Competitive block stacking in your browser.** Jedris is a fast, modern falling-block game with guideline-accurate mechanics, a neon HUD, and two-player local versus. The whole game is static HTML, CSS and JavaScript, so there's no build step, no server code, and no dependencies.

![Jedris gameplay](assets/og-image.png)

## Play

- **Locally:** download or clone the repository and open `index.html` in Chrome, Firefox, Edge or Safari.
- **On the web:** upload the folder to any static host (see [Hosting](#hosting)).

## Modes

| Mode | Goal |
| --- | --- |
| **40 Lines** | Clear 40 lines as fast as possible. Personal best is saved. |
| **Blitz** | Score as much as you can in 2 minutes. Gravity rises every 10 lines. |
| **Zen** | Endless, relaxed stacking. No timer and no game over. |
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

## Project layout

```
index.html              Page shell: menus, settings, help, results
css/style.css           All styling
js/config.js            Constants, default settings, localStorage
js/pieces.js            Piece shapes, SRS kick tables, scoring/attack tables, RNG
js/sound.js             Synthesized sound effects (Web Audio, no audio files)
js/game.js              Game class: board logic, handling, spins, garbage (one per player)
js/input.js             Keyboard → per-player actions
js/render.js            Canvas renderer, HUD and visual effects
js/ui.js                App flow, menus, settings and keybind editor
js/main.js              Fixed-timestep main loop
assets/                 Favicon, app icons and share image
tests/                  Game-logic suite (open tests/index.html) and headless runner
```

The scripts are plain `<script>` tags rather than ES modules, so the game also runs when `index.html` is opened directly from disk.

## Tests

Open `tests/index.html` in a browser to run the game-logic suite. To run everything headlessly (logic suite plus a UI smoke test):

```sh
npm install
npx playwright install chromium
npm test
```

GitHub Actions runs the same tests on every push and pull request.

## Hosting

Jedris is fully static. Upload these files and folders, keeping the structure, to your web root (for example over SFTP):

```
index.html  manifest.webmanifest  css/  js/  assets/
```

`tests/`, `package.json` and `.github/` are only for development and don't need to be uploaded.

The display fonts load from Google Fonts. If they're unavailable, the game falls back to system fonts.

## Credits

Built by [@jedidiah5K](https://github.com/jedidiah5K). Jedris is an independent project. It isn't affiliated with or endorsed by any other block-stacking game or its owners.
