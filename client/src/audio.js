// Tiny WebAudio-synthesised sound effects (no audio files). The AudioContext is created lazily on the first
// user gesture (browsers refuse to start audio before one). Volume falls off with distance to the listener.
import { URLP } from './config.js';

function readPref(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function writePref(k, v) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = URLP.mute || readPref('bv.muted') === '1';
    this.volume = Math.max(0, Math.min(1, Number(readPref('bv.volume') ?? 1))); // [accounts] Options → Son
    this.listener = null; // () => {x, z}
    this.noiseBuf = null;
    this.lastPlay = new Map();
    const unlock = () => {
      this._init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (this.ctx && this.ctx.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  _init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.gain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  gain() { return this.muted ? 0 : 0.32 * this.volume; }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** [accounts] 0..1, remembered on this device. */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    writePref('bv.volume', String(this.volume));
    if (this.master) this.master.gain.value = this.gain();
  }

  setMuted(m) {
    this.muted = !!m;
    writePref('bv.muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.gain();
  }

  _env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  _tone(type, f0, f1, dur, vol, out, delay = 0, attack = 0.005) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(g, t, attack, vol, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(filterType, f0, f1, dur, vol, out, delay = 0, q = 1, attack = 0.005) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** Play a named effect at world position `pos` (or UI sound when pos is null). */
  play(name, pos = null) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    let vol = 1;
    if (pos && this.listener) {
      const l = this.listener();
      if (l) {
        const d = Math.hypot(pos.x - l.x, pos.z - l.z);
        if (d > 48) return;
        vol = Math.max(0, 1 - d / 48);
        vol *= vol;
      }
    }
    if (vol < 0.02) return;
    // light rate limiting per sound name
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) || 0;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);
    const out = this.ctx.createGain();
    out.gain.value = vol;
    out.connect(this.master);
    const r = 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'swing': this._noise('bandpass', 2600 * r, 700, 0.16, 0.5, out, 0, 1.4); break;
      case 'heavy': this._noise('bandpass', 1800 * r, 300, 0.26, 0.7, out, 0, 1.2); this._tone('sine', 120, 60, 0.2, 0.3, out, 0.08); break;
      case 'claw': this._noise('bandpass', 1400 * r, 500, 0.14, 0.35, out, 0, 2); break;
      case 'hit': this._tone('sine', 150 * r, 55, 0.14, 0.5, out); this._noise('lowpass', 2500, 400, 0.08, 0.35, out); break;
      case 'crit': this._tone('sine', 170 * r, 50, 0.2, 0.65, out); this._noise('highpass', 3000, 2000, 0.1, 0.35, out); this._tone('triangle', 1400 * r, 900, 0.18, 0.12, out); break;
      case 'cast': this._noise('bandpass', 400 * r, 2400, 0.35, 0.35, out, 0, 2, 0.08); this._tone('sine', 300 * r, 600, 0.3, 0.08, out, 0, 0.05); break;
      case 'frostcast': this._tone('sine', 1300 * r, 1800, 0.35, 0.08, out, 0, 0.05); this._noise('highpass', 3000, 6000, 0.35, 0.2, out, 0, 1, 0.08); break;
      case 'bow': this._tone('triangle', 330 * r, 180, 0.18, 0.25, out); this._noise('bandpass', 3000, 1200, 0.12, 0.2, out, 0.02, 2); break;
      case 'firehit': this._noise('lowpass', 2000 * r, 200, 0.28, 0.5, out); break;
      case 'explode': this._noise('lowpass', 1600 * r, 80, 0.7, 0.9, out); this._tone('sine', 90, 35, 0.5, 0.6, out); break;
      case 'arrowhit': this._tone('square', 220 * r, 90, 0.06, 0.12, out); this._noise('bandpass', 1800, 900, 0.07, 0.3, out, 0, 3); break;
      case 'frost':
        for (let i = 0; i < 4; i++) this._tone('sine', (1200 + i * 380) * r, (1100 + i * 300) * r, 0.5, 0.1, out, i * 0.04);
        this._noise('highpass', 5000, 2000, 0.6, 0.3, out);
        break;
      case 'whirl': this._noise('bandpass', 700 * r, 2600, 0.45, 0.55, out, 0, 1.5, 0.05); break;
      case 'rain': for (let i = 0; i < 6; i++) this._noise('bandpass', 2400, 900, 0.1, 0.18, out, 0.3 + i * 0.12, 3); break;
      case 'slam': this._tone('sine', 70, 28, 0.9, 1.0, out); this._noise('lowpass', 900, 60, 1.0, 0.9, out); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => this._tone('sine', f * r, f * r, 0.4, 0.13, out, i * 0.07, 0.02)); break;
      case 'potion': this._tone('sine', 500 * r, 900, 0.18, 0.15, out); this._tone('sine', 700 * r, 1200, 0.18, 0.1, out, 0.08); break;
      case 'warcry': this._tone('sawtooth', 160 * r, 110, 0.5, 0.18, out, 0, 0.03); this._noise('bandpass', 600, 300, 0.5, 0.4, out, 0, 1.5, 0.03); break;
      case 'levelup': [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone('triangle', f, f, 0.5, 0.16, out, i * 0.09, 0.01)); this._noise('highpass', 6000, 3000, 1.0, 0.1, out, 0.3); break;
      case 'respawn': [392, 523, 784].forEach((f, i) => this._tone('sine', f, f * 1.01, 0.5, 0.12, out, i * 0.1, 0.02)); break;
      case 'death': this._tone('sawtooth', 220 * r, 70, 0.45, 0.12, out); this._noise('lowpass', 800, 100, 0.4, 0.3, out); break;
      case 'bones': for (let i = 0; i < 5; i++) this._tone('square', (500 + Math.random() * 600), 300, 0.05, 0.08, out, i * 0.06); break;
      case 'pdeath': this._tone('sine', 300, 80, 1.2, 0.3, out); this._tone('triangle', 220, 60, 1.2, 0.15, out, 0.1); break;
      case 'click': this._tone('sine', 900, 700, 0.05, 0.1, out); break;
      case 'error': this._tone('square', 180, 140, 0.12, 0.08, out); break;
      case 'loot': this._tone('triangle', 1200 * r, 1600, 0.12, 0.12, out); this._tone('triangle', 1600 * r, 2000, 0.12, 0.1, out, 0.07); break;
      case 'quest': [659, 784, 988].forEach((f, i) => this._tone('triangle', f, f, 0.35, 0.13, out, i * 0.1)); break;
      // [combat-souls]
      case 'roll': this._noise('bandpass', 500 * r, 1500, 0.3, 0.35, out, 0, 1.2, 0.04); this._noise('lowpass', 600, 120, 0.2, 0.25, out, 0.28); break;
      case 'dodge': this._noise('highpass', 2500 * r, 5000, 0.22, 0.25, out, 0, 1, 0.02); break;
      case 'stagger': this._tone('square', 420 * r, 180, 0.2, 0.14, out); this._noise('bandpass', 2200, 800, 0.25, 0.4, out, 0, 2); break;
      case 'guard': this._tone('triangle', 1500 * r, 1200, 0.12, 0.15, out); this._tone('square', 900 * r, 700, 0.08, 0.06, out); break;
      case 'howl': this._tone('sawtooth', 380 * r, 620, 0.5, 0.1, out, 0, 0.12); this._tone('sine', 620 * r, 300, 0.9, 0.12, out, 0.45, 0.05); break;
      case 'roar': this._tone('sawtooth', 110 * r, 55, 1.4, 0.35, out, 0, 0.1); this._noise('lowpass', 700, 90, 1.5, 0.8, out, 0, 1, 0.1); break;
      case 'tele': this._tone('sine', 190 * r, 150, 0.35, 0.12, out, 0, 0.05); break;
      case 'notice': this._tone('triangle', 700 * r, 950, 0.1, 0.1, out); break;
      case 'spear': this._noise('bandpass', 1400 * r, 600, 0.22, 0.3, out, 0, 2); break;
      case 'echo': [880, 1175, 1568, 2093].forEach((f, i) => this._tone('sine', f * r, f * r, 0.7, 0.1, out, i * 0.08, 0.02)); break;
      default: break;
    }
  }
}
