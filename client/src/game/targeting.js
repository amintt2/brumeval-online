// Target selection (raycast on hit cylinders), Tab cycling, NPC interaction, ability use with client-side
// pre-checks (range / mana / cooldown / safe zone — the server has the final word) and potion hotkeys.
import * as THREE from 'three';
import { ITEMS, MONSTERS } from '@shared/data.js';
import { C2S, KIND, INTERACT_RANGE } from '@shared/protocol.js';
import { inVillage } from '@shared/world.js';
import { WEAPON_NEED_TEXT } from '@shared/skills.js';
import { raycastTerrain } from '../render/terrain.js';
import { loadoutOf, specOf, isItemEntry } from './skillState.js'; // [skilltree]

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

  /** Hostile target for an ability: the current one, else the nearest in reach (selected). */
  _aimTarget(range) {
    let t = this.hostileTarget();
    if (!t) {
      t = this.nearestHostile(range + 4);
      if (t) this.select(t.id);
    }
    return t;
  }

  /**
   * [skilltree] Use the entry of action bar slot `slot` (0..7): an ability of the loadout (resolved with the tree:
   * variants, passives, Inaptitude, weapon) or a consumable ('item:<id>'). Client-side pre-checks only; the server
   * has the final word. `opts.ph` = 'start' | 'release' (Attaque chargée on the base attack).
   */
  useAbility(slot, opts = {}) {
    const { state, notify, send, player } = this.ctx;
    const self = state.self;
    if (!state.inGame || !self) return false;
    if (self.dead) { notify('Vous êtes mort.', 'error'); return false; }
    const entry = loadoutOf(self)[slot];
    if (!entry) return false;
    if (isItemEntry(entry)) return this.useItemEntry(entry.slice(5));
    const ab = specOf(self, entry);
    if (!ab) return false;
    const now = performance.now();
    // (slot 0 is the auto-attack: re-sending it while on cooldown just (re)selects the auto-attack target)
    if (!ab.base && state.cooldowns[slot] > now + 80) {
      notify(`${ab.name} n'est pas encore prêt.`, 'error');
      return false;
    }
    if (ab.usable === false) { notify(`${ab.name} : il faut ${WEAPON_NEED_TEXT[ab.need] || 'une autre arme'}.`, 'error'); return false; }
    if ((ab.mp || 0) > (self.mp ?? 0)) { notify('Pas assez de mana.', 'error'); return false; }
    // [combat-souls] no attack in the middle of a roll; stamina (the server has the final word)
    if (player.rolling) return false;
    if ((ab.st || 0) > player.st + 2) {
      notify('Pas assez d\'endurance.', 'error');
      this.ctx.ui.staminaEmpty?.();
      return false;
    }
    if (inVillage(player.x, player.z)) {
      notify('Le combat est interdit dans le village.', 'error');
      return false;
    }
    const range = ab.range || 0;
    const kind = ab.kind;
    const needTarget = kind === 'melee' || kind === 'projectile' || kind === 'debuff' || (kind === 'channel' && !ab.shape && !(ab.channel && typeof ab.channel === 'object'));
    const msg = { t: C2S.ABILITY, slot };
    if (opts.ph) msg.ph = opts.ph;
    if (needTarget && !(kind === 'melee' && ab.shape?.arc >= 180)) {
      const t = this._aimTarget(range);
      if (!t) { notify('Aucune cible.', 'error'); return false; }
      if (opts.ph !== 'start' && this._dist(t) > range + 0.5) { notify('Cible hors de portée.', 'error'); return false; }
      player.faceTowards(t.x, t.z);
      msg.tg = t.id;
    } else if (kind === 'aoe_target' || kind === 'trap' || kind === 'summon' || (kind === 'channel' && ab.shape === 'circle' && ab.at !== 'self')) {
      const t = this.hostileTarget();
      let x, z;
      if (t) { x = t.x; z = t.z; msg.tg = t.id; }
      else if (this.groundPoint(this.ctx.input.mouseX, this.ctx.input.mouseY, this._ground)) { x = this._ground.x; z = this._ground.z; }
      else if (kind === 'aoe_target') { notify('Aucune cible.', 'error'); return false; }
      else { x = player.x + Math.sin(player.ry) * 4; z = player.z + Math.cos(player.ry) * 4; }
      if (kind === 'aoe_target' && range > 0 && Math.hypot(x - player.x, z - player.z) > range + 0.5) { notify('Zone hors de portée.', 'error'); return false; }
      if (range > 0 && Math.hypot(x - player.x, z - player.z) > range) {
        // traps / summons: clamp to the reach in the pointed direction
        const a = Math.atan2(x - player.x, z - player.z);
        x = player.x + Math.sin(a) * range * 0.95; z = player.z + Math.cos(a) * range * 0.95;
      }
      player.faceTowards(x, z);
      msg.x = round2(x); msg.z = round2(z);
    } else {
      // self abilities, dashes, cones: aim at the target when there is one
      const t = this.hostileTarget();
      if (t) { msg.tg = t.id; player.faceTowards(t.x, t.z); }
    }
    send(msg);
    if (!ab.base && !opts.ph) this._commit(ab, now); // [combat-souls] (base attack: on the server's `cd`)
    return true;
  }

  /** [skilltree] A consumable of the action bar: the first stack of it in the bag. */
  useItemEntry(itemId) {
    const { state, notify, send } = this.ctx;
    const inv = state.self?.inv || [];
    const idx = inv.findIndex((s) => s && s.id === itemId);
    if (idx < 0) {
      // potions: any potion of the same kind (the best first)
      const it = ITEMS[itemId];
      const mana = !!it?.mana;
      if (it && (it.heal || it.mana)) return this.usePotion(mana);
      notify(`Plus de ${it?.name || 'cet objet'} dans le sac.`, 'error');
      return false;
    }
    send({ t: C2S.USE_ITEM, slot: idx });
    return true;
  }

  /** [combat-souls] Predict the attack commitment (recovery slow) and stamina cost of a cast. */
  _commit(ab, now) {
    const p = this.ctx.player;
    p.commit(ab, now);
    p.spend(ab.st || 0, now);
  }

  /** 5 = best healing potion, 6 = mana potion. */
  usePotion(mana) {
    const { state, notify, send } = this.ctx;
    const self = state.self;
    if (!state.inGame || !self) return false;
    if (self.dead) { notify('Vous êtes mort.', 'error'); return false; }
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
      return false;
    }
    send({ t: C2S.USE_ITEM, slot: best });
    return true;
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
    if (!force && L.id === t.id && L.hp === t.hp && L.mhp === t.mhp && L.lv === t.lv && L.n === t.n && L.stt === (t.stt || 0) && L.rb === (t.rb || 0)) return;
    L.id = t.id; L.hp = t.hp; L.mhp = t.mhp; L.lv = t.lv; L.n = t.n; L.stt = t.stt || 0; L.rb = t.rb || 0;
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
      stt: t.stt || 0, // [skilltree] status flags (brûlure, froid, gel, poison…)
      rb: t.rb || 0,   // [skilltree] Renaissances of a player
    });
  }
}
