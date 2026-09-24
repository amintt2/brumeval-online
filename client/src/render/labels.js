// DOM overlay for nameplates and floating combat text, positioned by projecting world points each frame.
// (Equivalent to CSS2DRenderer but with pooling, distance fading and minimal DOM writes.)
import * as THREE from 'three';
import './labels.css';
import { RENDER } from '../config.js';
import { glyph, statusList } from '../ui/icons.js'; // [skilltree] status chips

const _v = new THREE.Vector3();
/** Floating combat text farther than this from the camera is not drawn. */
const TEXT_MAX_DIST = 70;

export class Nameplate {
  constructor(layer) {
    this.layer = layer;
    this.anchor = new THREE.Vector3();
    this.el = document.createElement('div');
    this.el.className = 'np';
    this.q = document.createElement('div');
    this.q.className = 'np-q';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'np-name';
    this.lvEl = document.createElement('span');
    this.lvEl.className = 'np-lv';
    this.txtEl = document.createElement('span');
    this.nameEl.append(this.lvEl, this.txtEl);
    this.hpEl = document.createElement('div');
    this.hpEl.className = 'np-hp';
    this.hpFill = document.createElement('i');
    this.hpEl.appendChild(this.hpFill);
    // [skilltree] Renaissance title under the name, status chips above the health bar
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'np-title';
    this.stEl = document.createElement('div');
    this.stEl.className = 'np-st';
    this._title = '';
    this._st = 0;
    this.el.append(this.q, this.nameEl, this.titleEl, this.stEl, this.hpEl);
    this.el.style.display = 'none';
    this._shown = false;
    this._x = -1e9; this._y = -1e9; this._s = -1; this._o = -1;
    this._name = null; this._lv = null; this._color = null; this._hp = -1; this._marker = undefined;
    this.visible = true;
    this.maxDist = RENDER.labelMaxDist;
  }
  setText(name, level) {
    if (name !== this._name) { this._name = name; this.txtEl.textContent = name; }
    const lv = level ? String(level) : '';
    if (lv !== this._lv) { this._lv = lv; this.lvEl.textContent = lv; this.lvEl.style.display = lv ? '' : 'none'; }
  }
  setColor(css) {
    if (css !== this._color) { this._color = css; this.nameEl.style.color = css; }
  }
  setHp(frac) {
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - this._hp) > 0.001) { this._hp = f; this.hpFill.style.transform = `scaleX(${f.toFixed(3)})`; }
  }
  toggle(cls, on) { this.el.classList.toggle(cls, !!on); }
  /** [skilltree] « Né de la Brume II » under a player's name ('' = none). */
  setTitle(t) {
    if (t === this._title) return;
    this._title = t;
    this.titleEl.textContent = t;
    this.el.classList.toggle('has-title', !!t);
  }
  /** [skilltree] Status flags (EntState.stt) as small coloured chips. */
  setStatus(flags) {
    if (flags === this._st) return;
    this._st = flags;
    this.stEl.replaceChildren();
    for (const s of statusList(flags)) {
      const chip = document.createElement('i');
      chip.className = `np-chip st-${s.id}`;
      chip.style.setProperty('--c', s.color);
      chip.title = s.name;
      chip.appendChild(glyph(s.glyph));
      this.stEl.appendChild(chip);
    }
    this.el.classList.toggle('has-st', flags !== 0);
  }
  setMarker(m, grey = false) {
    const key = m ? m + (grey ? 'g' : '') : null;
    if (key === this._marker) return;
    this._marker = key;
    this.q.textContent = m || '';
    this.q.classList.toggle('on', !!m);
    this.q.classList.toggle('grey', !!grey);
  }
  hide() {
    if (this._shown) { this._shown = false; this.el.style.display = 'none'; }
  }
}

export class LabelLayer {
  constructor(container) {
    this.root = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.plates = new Set();
    this.texts = [];
    this.freeTexts = [];
    for (let i = 0; i < 48; i++) {
      const el = document.createElement('div');
      el.className = 'fct';
      this.root.appendChild(el);
      this.freeTexts.push({ el, pos: new THREE.Vector3(), age: 0, life: 1, dx: 0, rise: 60, big: false, cls: '' });
    }
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
  }

  addNameplate() {
    const np = new Nameplate(this);
    this.root.appendChild(np.el);
    this.plates.add(np);
    return np;
  }

  removeNameplate(np) {
    if (!np) return;
    this.plates.delete(np);
    np.el.remove();
  }

  /** Floating combat text. cls: '' | 'crit' | 'self' | 'heal' | 'mana' | 'info' | 'xp' */
  spawnText(text, pos, cls = '') {
    let t = this.freeTexts.pop();
    if (!t) t = this.texts.shift(); // recycle the oldest
    t.el.textContent = text;
    if (t.cls !== cls) { t.el.className = cls ? `fct ${cls}` : 'fct'; t.cls = cls; }
    t.pos.copy(pos);
    t.age = 0;
    t.big = cls.includes('crit');
    t.life = t.big ? 1.35 : 1.1;
    t.dx = (Math.random() - 0.5) * 50;
    t.rise = t.big ? 70 : 56;
    t.el.style.display = 'block';
    t.el.style.opacity = '1';
    this.texts.push(t);
  }

  update(camera, dt) {
    const W = this.width, H = this.height;
    const camPos = camera.position;
    for (const np of this.plates) {
      if (!np.visible) { np.hide(); continue; }
      const d = camPos.distanceTo(np.anchor);
      if (d > np.maxDist) { np.hide(); continue; }
      _v.copy(np.anchor).project(camera);
      if (_v.z > 1 || _v.x < -1.3 || _v.x > 1.3 || _v.y < -1.3 || _v.y > 1.4) { np.hide(); continue; }
      const x = (_v.x * 0.5 + 0.5) * W;
      const y = (-_v.y * 0.5 + 0.5) * H;
      const s = Math.min(1.08, Math.max(0.7, 1.16 - d / 70));
      const o = 1 - Math.min(1, Math.max(0, (d - (np.maxDist - 12)) / 12));
      if (!np._shown) { np._shown = true; np.el.style.display = 'flex'; }
      if (Math.abs(x - np._x) > 0.3 || Math.abs(y - np._y) > 0.3 || Math.abs(s - np._s) > 0.01) {
        np._x = x; np._y = y; np._s = s;
        np.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%) scale(${s.toFixed(3)})`;
        np.el.style.zIndex = String(1000 - Math.round(d * 10));
      }
      if (Math.abs(o - np._o) > 0.02) { np._o = o; np.el.style.opacity = o.toFixed(2); }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.age += dt;
      if (t.age >= t.life) {
        t.el.style.display = 'none';
        this.texts.splice(i, 1);
        this.freeTexts.push(t);
        continue;
      }
      _v.copy(t.pos).project(camera);
      const d = camPos.distanceTo(t.pos);
      if (_v.z > 1 || d > TEXT_MAX_DIST) { t.el.style.opacity = '0'; continue; }
      // shrink with distance (like the nameplates) so far-away fights do not clutter the screen
      const ds = Math.min(1, Math.max(0.45, 1.2 - d / 45));
      const k = t.age / t.life;
      const ease = 1 - (1 - k) * (1 - k);
      const x = (_v.x * 0.5 + 0.5) * W + t.dx * ease * ds;
      const y = (-_v.y * 0.5 + 0.5) * H - t.rise * ease * ds;
      const pop = (t.age < 0.12 ? 1 + (t.big ? 0.8 : 0.45) * (1 - t.age / 0.12) : 1) * ds;
      t.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(2)})`;
      t.el.style.opacity = (k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35).toFixed(2);
    }
  }

  clearTexts() {
    for (const t of this.texts) { t.el.style.display = 'none'; this.freeTexts.push(t); }
    this.texts.length = 0;
  }
}
