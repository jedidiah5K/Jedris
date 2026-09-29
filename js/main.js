'use strict';

/* ---------- main loop: fixed 60 Hz simulation, render every frame ---------- */
let lastFrame = performance.now();
let accumulator = 0;
function frame(now) {
  accumulator += Math.min(250, now - lastFrame);
  lastFrame = now;
  while (accumulator >= TICK_MS) {
    App.tick();
    accumulator -= TICK_MS;
  }
  Touch.sync();
  render(now);
  requestAnimationFrame(frame);
}

Input.init();
Touch.init();
updateRecords();
const tickClock = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
tickClock();
setInterval(tickClock, 10000);
requestAnimationFrame(frame);
Account.init();

// Installable app: keeps a copy of the game for offline play (only when served over http/https).
if ('serviceWorker' in navigator && Account.available) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Exposed for automated tests and tinkering in the console.
window.Jedris = { Game, App, Account, Online, Touch, SHAPES, KICKS_JLSTZ, KICKS_I, KICKS_180, settings, TICK_MS, comboAttack, gravityForLevel };
