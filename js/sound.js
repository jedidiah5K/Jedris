'use strict';

/* =========================================================================
 * SOUND (Web Audio, synthesized)
 * ========================================================================= */
const Sound = {
  ctx: null,
  master: null,
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.1, freqEnd = null, delay = 0) {
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  play(name, arg = 0) {
    if (!settings.sound || !this.ctx || this.ctx.state !== 'running') return;
    this.master.gain.value = settings.volume;
    switch (name) {
      case 'move': this.tone(900, 0.02, 'square', 0.02); break;
      case 'rotate': this.tone(620, 0.04, 'triangle', 0.08, 700); break;
      case 'hold': this.tone(420, 0.07, 'sine', 0.1, 620); break;
      case 'hard': this.tone(170, 0.08, 'square', 0.08, 90); break;
      case 'lock': this.tone(240, 0.04, 'triangle', 0.06); break;
      case 'clear': {
        const notes = [0, 523, 659, 784, 1047];
        for (let i = 1; i <= arg; i++) this.tone(notes[i], 0.12, 'triangle', 0.1, null, (i - 1) * 0.04);
        break;
      }
      case 'spin': this.tone(700, 0.18, 'sawtooth', 0.06, 1400); break;
      case 'pc': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.11, null, i * 0.06)); break;
      case 'combo': this.tone(440 * Math.pow(2, Math.min(arg, 12) / 12), 0.08, 'sine', 0.08); break;
      case 'garbage': this.tone(120, 0.14, 'sawtooth', 0.08, 70); break;
      case 'count': this.tone(520, 0.1, 'sine', 0.12); break;
      case 'go': this.tone(880, 0.2, 'sine', 0.12); break;
      case 'topout': this.tone(400, 0.6, 'sawtooth', 0.1, 60); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.12, null, i * 0.1)); break;
    }
  },
};
