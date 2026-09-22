// Target selection (raycast on hit cylinders), Tab cycling, NPC interaction, ability use with client-side
// pre-checks (range / mana / cooldown / safe zone — the server has the final word) and potion hotkeys.
import * as THREE from 'three';
import { ABILITIES, ITEMS, MONSTERS } from '@shared/data.js';
import { C2S, KIND, INTERACT_RANGE } from '@shared/protocol.js';
import { inVillage } from '@shared/world.js';
import { raycastTerrain } from '../render/terrain.js';

const round2 = (v) => Math.round(v * 100) / 100;

export class Targeting {
  /**
   * ctx: { camera, canvas, state, entities, ui, send, player, notify(text, kind), input, orbit }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hits = [];
    this.id = 0;
    this._last = { id: -1, hp: -1, mhp: -1, lv: -1, n: null };
    this._hoverAt = 0;
    this._cursor = '';
    this._ground = new THREE.Vector3();
    this.deadSince = 0;
  }

  _setRay(x, y) {
    this.ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.ctx.camera);
  }

  /** Entity record under the screen point, or null. */
  pick(x, y) {
    this._setRay(x, y);
    this.hits.length = 0;
    this.ray.intersectObjects(this.ctx.entities.hitMeshes, false, this.hits);
    for (const h of this.hits) {
      const rec = this.ctx.state.entities.get(h.object.userData.entityId);
      if (!rec || rec.isSelf) continue;
      if (rec.dead && rec.k === KIND.MONSTER) continue;
      return rec;
    }
    return null;
  }

  groundPoint(x, y, out) {
    this._setRay(x, y);
    return raycastTerrain(this.ray.ray, out);
  }

  target() {
    return this.id ? this.ctx.state.entities.get(this.id) || null : null;
  }

  hostileTarget() {
    const t = this.target();
    return t && t.k === KIND.MONSTER && !t.dead ? t : null;
  }

  select(id) {
    if (id === this.id) return;
    this.id = id || 0;
    this.deadSince = 0;
    this.ctx.entities.setTarget(this.id);
    this.syncUi(true);
  }

  clear() {
    this.select(0);
  }

  _dist(rec) {
    const p = this.ctx.player;
    return Math.hypot(rec.x - p.x, rec.z - p.z);
  }

  interact(rec) {
    if (this._dist(rec) > INTERACT_RANGE) {
      this.ctx.notify('Trop loin', 'error');
      return;
    }
    this.ctx.player.faceTowards(rec.x, rec.z);
    this.ctx.send({ t: C2S.INTERACT, id: rec.id });
  }

  onClick(button, x, y) {
    if (!this.ctx.state.inGame) return;
    const rec = this.pick(x, y);
    if (!rec) return;
    this.select(rec.id);
    if (rec.k === KIND.NPC) this.interact(rec);
    else if (button === 2 && rec.k === KIND.MONSTER) this.useAbility(0);
  }

  onHover(x, y) {
    const now = performance.now();
    if (now - this._hoverAt < 60) return;
    this._hoverAt = now;
    const rec = this.ctx.state.inGame ? this.pick(x, y) : null;
    const c = !rec ? '' : rec.k === KIND.MONSTER ? 'crosshair' : 'pointer';
    if (c !== this._cursor) {
      this._cursor = c;
      this.ctx.canvas.style.cursor = c;
    }
  }

  /** Tab: cycle through the nearest living monsters in front of the camera. */
  cycle() {
    const p = this.ctx.player;
    const fwd = this.ctx.orbit.forward({ x: 0, z: 0 });
    const list = [];
    for (const rec of this.ctx.state.entities.values()) {
      if (rec.k !== KIND.MONSTER || rec.dead) continue;
      const dx = rec.x - p.x, dz = rec.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 40) continue;
      if (d > 7 && (dx * fwd.x + dz * fwd.z) / d < 0.15) continue;
      list.push({ rec, d });
    }
    if (!list.length) {
      this.ctx.notify('Aucun ennemi à proximité.', 'error');
      return;
    }
    list.sort((a, b) => a.d - b.d);
    const cands = list.slice(0, 8);
    const i = cands.findIndex((c) => c.rec.id === this.id);
    this.select(cands[(i + 1) % cands.length].rec.id);
  }

  nearestHostile(maxDist) {
    const p = this.ctx.player;
    let best = null, bd = maxDist;
    for (const rec of this.ctx.state.entities.values()) {
      if (rec.k !== KIND.MONSTER || rec.dead) continue;
      const d = Math.hypot(rec.x - p.x, rec.z - p.z);
      if (d < bd) { bd = d; best = rec; }
    }
    return best;
  }

  useAbility(slot) {
    const { state, notify, send, player } = this.ctx;
    const self = state.self;
    if (!state.inGame || !self) return;
    if (self.dead) { notify('Vous êtes mort.', 'error'); return; }
    const abId = self.abilities?.[slot];
    const ab = ABILITIES[abId];
    if (!ab) return;
    const now = performance.now();
    // (slot 0 is the auto-attack: re-sending it while on cooldown just (re)selects the auto-attack target)
    if (slot !== 0 && state.cooldowns[slot] > now + 80) {
      notify(`${ab.name} n'est pas encore prêt.`, 'error');
      return;
    }
    if ((ab.mp || 0) > (self.mp ?? 0)) { notify('Pas assez de mana.', 'error'); return; }
    if (inVillage(player.x, player.z)) {
      notify('Le combat est interdit dans le village.', 'error');
      return;
    }
    switch (ab.kind) {
      case 'melee':
      case 'projectile': {
        let t = this.hostileTarget();
        if (!t) {
          t = this.nearestHostile(ab.range + 4);
          if (t) this.select(t.id);
        }
        if (!t) { notify('Aucune cible.', 'error'); return; }
        if (this._dist(t) > ab.range + 0.5) { notify('Cible hors de portée.', 'error'); return; }
        player.faceTowards(t.x, t.z);
        send({ t: C2S.ABILITY, slot, tg: t.id });
        break;
      }
      case 'aoe_target': {
        const t = this.hostileTarget();
        let x, z;
        if (t) { x = t.x; z = t.z; }
        else if (this.groundPoint(this.ctx.input.mouseX, this.ctx.input.mouseY, this._ground)) { x = this._ground.x; z = this._ground.z; }
        else { notify('Aucune cible.', 'error'); return; }
        if (Math.hypot(x - player.x, z - player.z) > ab.range + 0.5) { notify('Zone hors de portée.', 'error'); return; }
        player.faceTowards(x, z);
        const msg = { t: C2S.ABILITY, slot, x: round2(x), z: round2(z) };
        if (t) msg.tg = t.id;
        send(msg);
        break;
      }
      default:
        send({ t: C2S.ABILITY, slot });
        break;
    }
  }

  /** 5 = best healing potion, 6 = mana potion. */
  usePotion(mana) {
    const { state, notify, send } = this.ctx;
    const self = state.self;
    if (!state.inGame || !self) return;
    if (self.dead) { notify('Vous êtes mort.', 'error'); return; }
    let best = -1, bestV = 0;
    (self.inv || []).forEach((s, i) => {
      if (!s) return;
      const it = ITEMS[s.id];
      if (!it || it.type !== 'consumable') return;
      const v = mana ? it.mana || 0 : it.heal || 0;
      if (v > bestV) { bestV = v; best = i; }
    });
    if (best < 0) {
      notify(mana ? 'Aucune potion de mana.' : 'Aucune potion de soin.', 'error');
      return;
    }
    send({ t: C2S.USE_ITEM, slot: best });
  }

  /** Push the target frame to the UI when something changed; auto-clear dead / vanished targets. */
  syncUi(force = false) {
    const { ui } = this.ctx;
    let t = this.target();
    if (this.id && !t) { this.id = 0; this.ctx.entities.setTarget(0); }
    if (t && t.dead && t.k === KIND.MONSTER) {
      const now = performance.now();
      if (!this.deadSince) this.deadSince = now;
      else if (now - this.deadSince > 1500) { this.clear(); return; }
    }
    t = this.target();
    const L = this._last;
    if (!t) {
      if (L.id !== 0 || force) { L.id = 0; ui.setTarget(null); }
      return;
    }
    if (!force && L.id === t.id && L.hp === t.hp && L.mhp === t.mhp && L.lv === t.lv && L.n === t.n) return;
    L.id = t.id; L.hp = t.hp; L.mhp = t.mhp; L.lv = t.lv; L.n = t.n;
    const boss = !!t.b || !!MONSTERS[t.mt]?.boss;
    ui.setTarget({
      id: t.id,
      name: t.n || '',
      level: t.lv || 1,
      hp: Math.max(0, t.hp),
      mhp: t.mhp,
      kind: t.k,
      boss,
      hostile: t.k === KIND.MONSTER,
    });
  }
}
