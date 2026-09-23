// OFFLINE test mode (?offline=1): a tiny local simulation speaking exactly the network protocol of
// shared/protocol.js, so the client runs through the very same code paths (snapshots with the delta rule,
// fx / dmg / heal / death events, dialogs, cooldowns…). It is NOT the authoritative server — just enough of it
// to render the world, walk around, fight a few monsters, talk to the NPCs and see every effect.
import {
  C2S, S2C, FX, KIND, STATE, TICK_RATE, SNAPSHOT_EVERY, VIEW_RADIUS, INTERACT_RANGE, CORPSE_TIME_S, DAY_LENGTH_S,
} from '@shared/protocol.js';
import {
  CLASSES, ABILITIES, MONSTERS, ITEMS, NPCS, QUESTS, INV_SIZE, REGEN, MAX_LEVEL,
  playerStats, monsterStats, computeDamage, monsterXp, xpToNext, canUse,
} from '@shared/data.js';
import { SPAWN_POINT, NPC_SPAWNS, inVillage, VILLAGE, isWalkable } from '@shared/world.js';
import { CollisionWorld } from '@shared/collision.js';
// [combat-souls]
import { STAMINA, ROLL, ECHO, inTelegraph, regenStamina } from '@shared/combat.js';

const LATENCY_MS = 35;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const STATIC = ['k', 'n', 'm', 'lv', 'c', 'sc', 'b', 'mt', 'nk'];

const TEST_SPAWNS = [
  { mt: 'slime', x: 40, z: 16, n: 4, r: 7 },
  { mt: 'wolf', x: 4, z: -46, n: 3, r: 6 },
  { mt: 'goblin', x: -46, z: -8, n: 3, r: 6 },
  { mt: 'skeleton', x: 34, z: -36, n: 2, r: 5 },
  { mt: 'golem', x: 118, z: -132, n: 1, r: 4 },
];

export class FakeServer {
  constructor({ cls = 'warrior', name = 'Voyageur', tod = null } = {}) {
    this.cls = CLASSES[cls] ? cls : 'warrior';
    this.name = name;
    this.todFixed = tod;
    this.tod = tod ?? 0.36;
    this.tick = 0;
    this.nextId = 1;
    this.ents = new Map();
    this.known = new Map(); // id -> static signature sent
    this.collision = new CollisionWorld();
    this.timers = [];
    this.out = null;
    this.interval = null;
    this.rand = Math.random;
    this.dialogNpc = 0;
  }

  // ---------------------------------------------------------------- transport
  attach(cb) {
    this.out = cb;
    this._init();
    this.startedAt = performance.now();
    this.interval = setInterval(() => this._tick(), 1000 / TICK_RATE);
    this.send({ t: S2C.AUTH_OK, id: this.player.id, self: this._selfState(), tod: this.tod, online: 2, motd: 'Mode hors ligne : simulation locale de test.' });
    this.send({ t: S2C.CHAT, ch: 'system', text: 'Mode hors ligne — aucun serveur requis. Monstres de test autour du village.' });
  }

  detach() {
    clearInterval(this.interval);
    this.interval = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    this.out = null;
  }

  send(msg) {
    if (!this.out) return;
    const data = JSON.stringify(msg);
    const out = this.out;
    setTimeout(() => { if (this.out === out) out(JSON.parse(data)); }, LATENCY_MS);
  }

  later(ms, fn) {
    const t = setTimeout(() => {
      const i = this.timers.indexOf(t);
      if (i >= 0) this.timers.splice(i, 1);
      if (this.out) fn();
    }, ms);
    this.timers.push(t);
  }

  now() {
    return performance.now();
  }

  // ---------------------------------------------------------------- world setup
  _init() {
    const c = CLASSES[this.cls];
    const level = 6;
    const eq = { weapon: c.start.weapon, armor: c.start.armor };
    const st = playerStats(this.cls, level, eq);
    const inv = new Array(INV_SIZE).fill(null);
    const give = [['potion_hp_s', 6], ['potion_hp_l', 2], ['potion_mp_s', 5], ['slime_gel', 4], ['wolf_pelt', 2]];
    const upgrade = { warrior: 'steel_sword', mage: 'arcane_staff', ranger: 'long_bow' }[this.cls];
    give.push([upgrade, 1]);
    give.forEach(([id, q], i) => { inv[i] = { id, q }; });
    // ?at=x,z[,ry] → start somewhere else than the village square (screenshots, testing a zone)
    const at = (new URLSearchParams(location.search).get('at') || '').split(',').map(Number);
    const start = at.length >= 2 && at.every(Number.isFinite) && isWalkable(at[0], at[1])
      ? { x: at[0], z: at[1], ry: at[2] || 0 } : SPAWN_POINT;
    this.player = this._add({
      k: KIND.PLAYER, n: this.name, m: c.model, c: this.cls, lv: level, x: start.x, z: start.z, ry: start.ry,
      hp: st.mhp, mhp: st.mhp,
    });
    Object.assign(this.player, {
      name: this.name, cls: this.cls, level, xp: 40, gold: 180, mp: st.mmp, mmp: st.mmp, stats: st, inv, eq,
      quests: { q_slimes: { state: 'done', n: 8 } }, abilities: c.abilities.slice(), dead: false,
      cds: [0, 0, 0, 0], autoTarget: 0, lastCombat: -1e9, regenAcc: 0,
      // [combat-souls]
      st: STAMINA.max, mst: STAMINA.max, stSpentAt: -1e9, sentSt: STAMINA.max, sprint: false, exhausted: false,
      iframeUntil: 0, rollReady: 0, echo: null,
    });
    this.teleSeq = 0;
    for (const n of NPC_SPAWNS) {
      const def = NPCS[n.key];
      this._add({ k: KIND.NPC, n: def.name, m: def.model, nk: n.key, lv: 1, x: n.x, z: n.z, ry: n.ry, hp: 100, mhp: 100, home: { x: n.x, z: n.z } });
    }
    // a friendly fake player strolling around the well
    const otherCls = this.cls === 'mage' ? 'ranger' : 'mage';
    this.buddy = this._add({ k: KIND.PLAYER, n: 'Aelis', m: CLASSES[otherCls].model, c: otherCls, lv: 8, x: 9, z: 0, ry: 0, hp: 150, mhp: 160, buddy: true, ang: 0 });
    for (const s of TEST_SPAWNS) for (let i = 0; i < s.n; i++) this._spawnMonster(s);
    // ?mobs=40 → extra monsters around the eastern village exit (rendering stress test)
    const extra = Math.min(200, Math.max(0, parseInt(new URLSearchParams(location.search).get('mobs') || '0', 10) || 0));
    const kinds = ['slime', 'wolf', 'goblin', 'skeleton'];
    for (let i = 0; i < extra; i++) this._spawnMonster({ mt: kinds[i % kinds.length], x: 48, z: 8, r: 16 });
  }

  _add(e) {
    const ent = { id: this.nextId++, s: STATE.IDLE, tg: 0, sl: 0, sc: 1, b: 0, ...e };
    this.ents.set(ent.id, ent);
    return ent;
  }

  _spawnMonster(zone) {
    const def = MONSTERS[zone.mt];
    let x = zone.x, z = zone.z;
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * zone.r;
      x = zone.x + Math.cos(a) * d; z = zone.z + Math.sin(a) * d;
      if (this.collision.penetration(x, z, def.radius) < 0.01) break;
    }
    const lv = def.level[0] + Math.floor(this.rand() * (def.level[1] - def.level[0] + 1));
    const st = monsterStats(zone.mt, lv);
    return this._add({
      k: KIND.MONSTER, n: def.name, m: def.model, mt: zone.mt, lv, sc: def.scale || 1, b: def.boss ? 1 : 0,
      x, z, ry: this.rand() * 6.28, hp: st.mhp, mhp: st.mhp, st, zone, home: { x: zone.x, z: zone.z },
      ai: 'idle', wp: null, wpAt: 0, nextAtk: 0, nextSlam: 0, slowUntil: 0, returning: false,
    });
  }

  _selfState() {
    const p = this.player;
    return {
      id: p.id, name: p.name, cls: p.cls, level: p.level, xp: p.xp, xpNext: xpToNext(p.level), hp: p.hp, mhp: p.mhp,
      mp: p.mp, mmp: p.mmp, gold: p.gold, stats: { atk: p.stats.atk, def: p.stats.def, crit: p.stats.crit, speed: p.stats.speed },
      inv: p.inv.map((s) => (s ? { ...s } : null)), eq: { ...p.eq }, quests: JSON.parse(JSON.stringify(p.quests)),
      abilities: p.abilities.slice(), x: r2(p.x), z: r2(p.z), ry: r3(p.ry), dead: p.dead,
      st: Math.floor(p.st), mst: p.mst, echo: p.echo ? { ...p.echo } : null, // [combat-souls]
    };
  }

  _self(fields) {
    const s = this._selfState();
    const out = { t: S2C.SELF };
    for (const f of fields) out[f] = s[f];
    this.send(out);
  }

  notify(kind, text) {
    this.send({ t: S2C.NOTIFY, kind, text });
  }

  err(code, msg) {
    this.send({ t: S2C.ERR, code, msg });
  }

  // ---------------------------------------------------------------- incoming messages
  receive(msg) {
    const p = this.player;
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case C2S.PING: this.send({ t: S2C.PONG, c: msg.c, s: Date.now() }); break;
      case C2S.MOVE:
        if (p.dead || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
        if (Math.hypot(msg.x - p.x, msg.z - p.z) > 0.001) p.movedAt = this.now();
        p.x = msg.x; p.z = msg.z; p.ry = Number.isFinite(msg.ry) ? msg.ry : p.ry;
        if (this.dialogNpc) {
          const n = this.ents.get(this.dialogNpc);
          if (!n || Math.hypot(n.x - p.x, n.z - p.z) > 8) { this.dialogNpc = 0; this.send({ t: S2C.CLOSE_DIALOG }); }
        }
        break;
      case C2S.ABILITY: this._ability(msg); break;
      case C2S.STOP: p.autoTarget = 0; break;
      case C2S.CHAT: this._chat(String(msg.text || '').trim().slice(0, 200)); break;
      case C2S.INTERACT: this._interact(msg.id); break;
      case C2S.QUEST_ACCEPT: this._questAccept(msg.id, msg.q); break;
      case C2S.QUEST_TURNIN: this._questTurnin(msg.id, msg.q); break;
      case C2S.BUY: this._buy(msg.id, msg.item, msg.qty || 1); break;
      case C2S.SELL: this._sell(msg.id, msg.slot); break;
      case C2S.USE_ITEM: this._useItem(msg.slot); break;
      case C2S.EQUIP: this._equip(msg.slot); break;
      case C2S.UNEQUIP: this._unequip(msg.slot); break;
      case C2S.DROP:
        if (p.inv[msg.slot]) { p.inv[msg.slot] = null; this._self(['inv']); this.notify('info', 'Objet jeté.'); }
        break;
      case C2S.RESPAWN: this._respawn(); break;
      // [combat-souls]
      case C2S.DODGE: this._dodge(msg); break;
      case C2S.SPRINT: p.sprint = msg.on === true; break;
      default: break;
    }
  }

  _chat(text) {
    if (!text) return;
    const p = this.player;
    if (text.startsWith('/w ')) {
      const [, to, ...rest] = text.split(' ');
      if (to && to.toLowerCase() === 'aelis') {
        this.send({ t: S2C.CHAT, ch: 'whisper_out', to: 'Aelis', text: rest.join(' ') });
        this.later(900, () => this.send({ t: S2C.CHAT, ch: 'whisper_in', from: 'Aelis', text: 'Salut ! Belle journée pour chasser le gluant.' }));
      } else this.err('bad_request', `${to || '?'} n'est pas en ligne.`);
      return;
    }
    if (text === '/who') { this.send({ t: S2C.CHAT, ch: 'system', text: `En ligne (2) : ${p.name}, Aelis` }); return; }
    if (text === '/help') { this.send({ t: S2C.CHAT, ch: 'system', text: 'Commandes : /w nom message, /who, /help' }); return; }
    this.send({ t: S2C.CHAT, ch: 'global', from: p.name, text });
  }

  // ---------------------------------------------------------------- combat
  _ability(msg) {
    const p = this.player;
    const slot = msg.slot;
    if (!(slot >= 0 && slot <= 3)) return;
    if (p.dead) return this.err('dead', 'Vous êtes mort.');
    const id = p.abilities[slot];
    const ab = ABILITIES[id];
    let target = null;
    if (ab.kind === 'melee' || ab.kind === 'projectile') {
      target = this.ents.get(msg.tg);
      if (!target) return this.err('no_target', 'Aucune cible sélectionnée.');
      if (target.k !== KIND.MONSTER) return this.err('bad_target', 'Cible invalide.');
      if (target.s === STATE.DEAD) return this.err('bad_target', 'Cette cible est déjà morte.');
    }
    if (inVillage(p.x, p.z)) return this.err('safe_zone', 'Impossible de combattre dans le village');
    if (target && (slot === 0 || p.autoTarget)) p.autoTarget = target.id;
    const e = this._cast(slot, target, msg);
    if (e && !(slot === 0 && e[0] === 'cooldown')) this.err(e[0], e[1]);
  }

  _cast(slot, target, msg) {
    const p = this.player;
    const now = this.now();
    const id = p.abilities[slot];
    const ab = ABILITIES[id];
    if (p.cds[slot] > now) return ['cooldown', `${ab.name} n'est pas encore prêt.`];
    if ((ab.mp || 0) > p.mp) return ['no_mana', 'Pas assez de mana.'];
    if (target && Math.hypot(target.x - p.x, target.z - p.z) > ab.range + 0.5) return ['out_of_range', 'Cible hors de portée.'];
    if (ab.kind === 'aoe_target') {
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return ['bad_request', 'Zone invalide.'];
      if (Math.hypot(msg.x - p.x, msg.z - p.z) > ab.range + 0.5) return ['out_of_range', 'Zone hors de portée.'];
    }
    p.cds[slot] = now + ab.cd * 1000;
    this.send({ t: S2C.CD, slot, ms: ab.cd * 1000 });
    if (ab.mp) { p.mp -= ab.mp; this._self(['mp']); }
    if (ab.st) { p.st = Math.max(0, p.st - ab.st); p.stSpentAt = now; } // [combat-souls]
    p.lastCombat = now;
    if (target) p.ry = Math.atan2(target.x - p.x, target.z - p.z);
    const fxNear = (m) => this.send({ t: S2C.FX, ...m });
    switch (ab.kind) {
      case 'melee':
        fxNear({ k: FX.SWING, src: p.id, tg: target.id, ab: id });
        this._hitMonster(target, ab, id);
        break;
      case 'projectile': {
        const hits = ab.hits || 1;
        fxNear({ k: FX.CAST, src: p.id, tg: target.id, ab: id });
        for (let i = 0; i < hits; i++) {
          this.later(i * 250, () => {
            if (target.s === STATE.DEAD) return;
            const ms = Math.round((Math.hypot(target.x - p.x, target.z - p.z) / ab.speed) * 1000);
            fxNear({ k: FX.PROJ, src: p.id, tg: target.id, ab: id, ms });
            this.later(ms, () => { if (target.s !== STATE.DEAD && this.ents.has(target.id)) this._hitMonster(target, ab, id); });
          });
        }
        break;
      }
      case 'aoe_self':
        fxNear({ k: FX.AOE, src: p.id, x: r2(p.x), z: r2(p.z), r: ab.radius, ab: id });
        for (const m of this._monstersNear(p.x, p.z, ab.radius)) {
          this._hitMonster(m, ab, id);
          if (ab.slow) m.slowUntil = now + ab.slow.dur * 1000;
        }
        break;
      case 'aoe_target':
        fxNear({ k: FX.CAST, src: p.id, ab: id });
        fxNear({ k: FX.AOE, src: p.id, x: r2(msg.x), z: r2(msg.z), r: ab.radius, ab: id });
        this.later(600, () => { for (const m of this._monstersNear(msg.x, msg.z, ab.radius)) this._hitMonster(m, ab, id); });
        break;
      case 'self_heal': {
        fxNear({ k: FX.HEAL, tg: p.id, ab: id });
        this._healPlayer(Math.round(p.mhp * ab.heal));
        break;
      }
      default: break;
    }
    return null;
  }

  _monstersNear(x, z, r) {
    const out = [];
    for (const e of this.ents.values()) {
      if (e.k === KIND.MONSTER && e.s !== STATE.DEAD && !e.returning && Math.hypot(e.x - x, e.z - z) <= r) out.push(e);
    }
    return out;
  }

  _hitMonster(m, ab, abId) {
    const p = this.player;
    if (m.s === STATE.DEAD) return;
    if (m.returning) return;
    const d = computeDamage(p.stats.atk, ab.power || 1, m.st.def, p.stats.crit, this.rand(), this.rand());
    m.hp = Math.max(0, m.hp - d.amount);
    m.ai = 'chase';
    m.lastHitAt = this.now();
    this.send({ t: S2C.DMG, src: p.id, tg: m.id, v: d.amount, crit: d.crit, hp: m.hp, ab: abId });
    if (m.hp <= 0) this._killMonster(m);
  }

  _killMonster(m) {
    const p = this.player;
    m.s = STATE.DEAD;
    m.tg = 0;
    if (p.autoTarget === m.id) p.autoTarget = 0;
    this.send({ t: S2C.DEATH, id: m.id, by: p.id });
    const def = MONSTERS[m.mt];
    const xp = monsterXp(m.mt, m.lv, p.level);
    this._giveXp(xp);
    const gold = def.gold[0] + Math.floor(this.rand() * (def.gold[1] - def.gold[0] + 1));
    p.gold += gold;
    this.notify('gold', `+${gold} pièces d'or`);
    for (const dr of def.drops) {
      if (this.rand() < dr.ch) {
        if (this._addItem(dr.id, 1)) this.notify('loot', `Vous avez obtenu : ${ITEMS[dr.id].name}`);
        else this.notify('error', `Inventaire plein — objet perdu : ${ITEMS[dr.id].name}`);
      }
    }
    for (const [qid, q] of Object.entries(p.quests)) {
      const Q = QUESTS[qid];
      if (q.state === 'active' && Q.goal.kill === m.mt) {
        q.n = Math.min(Q.goal.count, q.n + 1);
        if (q.n >= Q.goal.count) q.state = 'ready';
        this.notify('quest', `${def.name} éliminés : ${q.n}/${Q.goal.count}`);
      }
    }
    this._self(['xp', 'xpNext', 'level', 'gold', 'inv', 'quests', 'hp', 'mhp', 'mp', 'mmp', 'stats']);
    this.later(CORPSE_TIME_S * 1000, () => { this.ents.delete(m.id); });
    this.later(Math.min(def.respawn, 10) * 1000, () => {
      const n = this._spawnMonster(m.zone);
      this.later(60, () => this.send({ t: S2C.FX, k: FX.RESPAWN, src: n.id }));
    });
  }

  _giveXp(xp) {
    const p = this.player;
    this.notify('xp', `+${xp} XP`);
    p.xp += xp;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      p.lv = p.level;
      p.stats = playerStats(p.cls, p.level, p.eq);
      p.mhp = p.stats.mhp; p.mmp = p.stats.mmp; p.hp = p.mhp; p.mp = p.mmp;
      this.send({ t: S2C.FX, k: FX.LEVEL, src: p.id });
      this.notify('level', `Niveau ${p.level} atteint !`);
      this.send({ t: S2C.CHAT, ch: 'system', text: `${p.name} a atteint le niveau ${p.level} !` });
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }

  _healPlayer(v) {
    const p = this.player;
    const before = p.hp;
    p.hp = Math.min(p.mhp, p.hp + v);
    this.send({ t: S2C.HEAL, tg: p.id, v: p.hp - before, hp: p.hp });
    this._self(['hp']);
  }

  // ---------------------------------------------------------------- [combat-souls]
  _dodge(msg) {
    const p = this.player;
    const now = this.now();
    if (p.dead || !Number.isFinite(msg.dx) || !Number.isFinite(msg.dz)) return;
    if (now < p.rollReady) { this.err('cooldown', 'Roulade pas encore prête'); return; }
    if (p.st < STAMINA.roll) { this.err('no_stamina', 'Pas assez d\'endurance'); return; }
    p.st -= STAMINA.roll;
    p.stSpentAt = now;
    p.iframeUntil = now + ROLL.iframeMs;
    p.rollReady = now + ROLL.cdMs;
    p.sentSt = Math.floor(p.st);
    this._self(['st']);
    this.send({ t: S2C.FX, k: FX.ROLL, src: p.id, dx: r3(msg.dx), dz: r3(msg.dz) });
  }

  _stamina(dt, now) {
    const p = this.player;
    if (p.dead) return;
    const moving = now - (p.movedAt || 0) < 250;
    if (p.sprint && !p.exhausted && p.st > 0 && moving) {
      p.st = Math.max(0, p.st - STAMINA.sprintPerS * dt);
      p.stSpentAt = now;
      if (p.st <= 0) p.exhausted = true;
    } else {
      p.st = regenStamina(p.st, p.mst, now - p.stSpentAt, dt * 1000);
    }
    if (p.exhausted && p.st >= STAMINA.sprintMin) p.exhausted = false;
    const v = Math.floor(p.st);
    if (v !== p.sentSt && (Math.abs(v - p.sentSt) >= 4 || v === 0 || v >= p.mst)) { p.sentSt = v; this._self(['st']); }
    // death echo pick-up
    if (p.echo && Math.hypot(p.x - p.echo.x, p.z - p.echo.z) <= ECHO.pickupR) {
      const xp = p.echo.xp;
      p.echo = null;
      this.send({ t: S2C.FX, k: FX.ECHO, src: p.id, v: xp });
      this.notify('info', 'Écho récupéré : votre expérience vous revient.');
      this._self(['echo']);
      this._giveXp(xp);
    }
  }

  /** Telegraphed heavy attack of an offline monster (same shapes as the server). */
  _telegraph(m, atk) {
    const p = this.player;
    const a = Math.atan2(p.x - m.x, p.z - m.z);
    const at = atk.at === 'target' ? { x: p.x, z: p.z } : { x: m.x, z: m.z };
    const t = { id: ++this.teleSeq, src: m.id, shape: atk.shape, x: r2(at.x), z: r2(at.z), r: atk.r || 0, a: r3(a), ms: atk.windup, ab: atk.id, clip: atk.clip };
    if (atk.shape === 'ring') t.r2 = atk.r2;
    if (atk.shape === 'cone') t.arc = atk.arc;
    if (atk.shape === 'line') { t.w = atk.wid; t.len = atk.len; }
    m.ry = a;
    m.busyUntil = this.now() + atk.windup + (atk.rec || 500);
    this.send({ t: S2C.TELE, ...t });
    this.later(atk.windup, () => {
      if (m.s === STATE.DEAD || p.dead) return;
      if (inTelegraph({ ...t, w: t.w }, p.x, p.z, 0.45)) this._damagePlayer(m, atk.power || 1.3);
    });
  }

  _damagePlayer(m, power) {
    const p = this.player;
    if (p.dead) return;
    if (this.now() < p.iframeUntil) { this.send({ t: S2C.FX, k: FX.DODGE, tg: p.id }); return; } // [combat-souls]
    const d = computeDamage(m.st.atk, power, p.stats.def, m.st.crit, this.rand(), this.rand());
    p.hp = Math.max(0, p.hp - d.amount);
    p.lastCombat = this.now();
    this.send({ t: S2C.DMG, src: m.id, tg: p.id, v: d.amount, crit: d.crit, hp: p.hp });
    this._self(['hp']);
    if (p.hp <= 0) {
      p.dead = true;
      p.s = STATE.DEAD;
      p.autoTarget = 0;
      this.send({ t: S2C.DEATH, id: p.id, by: m.id });
      this.notify('error', `Vous avez été vaincu (${m.n}).`);
      // [combat-souls] death echo
      if (p.echo) this.notify('error', `Votre écho précédent s'est dissipé à jamais (${p.echo.xp} XP perdus).`);
      p.echo = null;
      if (p.xp > 0) {
        p.echo = { x: r2(p.x), z: r2(p.z), xp: p.xp };
        p.xp = 0;
        this.notify('info', `Votre écho (${p.echo.xp} XP) repose là où vous êtes tombé. Retrouvez-le avant de mourir à nouveau !`);
      }
      this._self(['dead', 'hp', 'xp', 'echo']);
    }
  }

  _respawn() {
    const p = this.player;
    if (!p.dead) return;
    p.dead = false;
    p.s = STATE.IDLE;
    p.hp = p.mhp; p.mp = p.mmp;
    p.st = p.mst; p.sentSt = p.mst; p.exhausted = false; // [combat-souls]
    p.x = SPAWN_POINT.x; p.z = SPAWN_POINT.z; p.ry = SPAWN_POINT.ry;
    this._self(['dead', 'hp', 'mp', 'x', 'z', 'ry', 'st']);
    this.send({ t: S2C.CORRECT, x: p.x, z: p.z });
    this.send({ t: S2C.FX, k: FX.RESPAWN, src: p.id });
    this.notify('info', 'Vous êtes de retour au village de Brumeval.');
  }

  // ---------------------------------------------------------------- items / npcs
  _addItem(id, q) {
    const p = this.player;
    const it = ITEMS[id];
    const stack = it.stack || 1;
    for (const s of p.inv) if (s && s.id === id && s.q < stack) { const add = Math.min(q, stack - s.q); s.q += add; q -= add; if (!q) return true; }
    for (let i = 0; i < p.inv.length && q > 0; i++) if (!p.inv[i]) { const add = Math.min(q, stack); p.inv[i] = { id, q: add }; q -= add; }
    return q === 0;
  }

  _useItem(slot) {
    const p = this.player;
    const s = p.inv[slot];
    if (!s || p.dead) return;
    const it = ITEMS[s.id];
    if (it.type === 'consumable') {
      if (it.heal) this._healPlayer(it.heal);
      if (it.mana) { p.mp = Math.min(p.mmp, p.mp + it.mana); this.notify('info', `+${it.mana} mana`); }
      s.q--;
      if (s.q <= 0) p.inv[slot] = null;
      this._self(['inv', 'hp', 'mp']);
    } else if (it.type === 'weapon' || it.type === 'armor') this._equip(slot);
  }

  _equip(slot) {
    const p = this.player;
    const s = p.inv[slot];
    if (!s) return;
    const it = ITEMS[s.id];
    if (it.type !== 'weapon' && it.type !== 'armor') return this.err('cant_use', 'Cet objet ne peut pas être équipé.');
    if (!canUse(it, p.cls, p.level)) return this.err('cant_use', 'Vous ne pouvez pas utiliser cet objet.');
    const prev = p.eq[it.type];
    p.eq[it.type] = s.id;
    p.inv[slot] = prev ? { id: prev, q: 1 } : null;
    this._restat();
    this.notify('info', `${it.name} équipé.`);
  }

  _unequip(eqSlot) {
    const p = this.player;
    const id = p.eq[eqSlot];
    if (!id) return;
    if (!this._addItem(id, 1)) return this.err('inv_full', 'Inventaire plein.');
    p.eq[eqSlot] = null;
    this._restat();
  }

  _restat() {
    const p = this.player;
    p.stats = playerStats(p.cls, p.level, p.eq);
    p.mhp = p.stats.mhp; p.mmp = p.stats.mmp;
    p.hp = Math.min(p.hp, p.mhp); p.mp = Math.min(p.mp, p.mmp);
    this._self(['inv', 'eq', 'stats', 'mhp', 'mmp', 'hp', 'mp']);
  }

  _dialogFor(npc) {
    const p = this.player;
    const def = NPCS[npc.nk];
    const quests = [];
    for (const qid of def.quests || []) {
      const Q = QUESTS[qid];
      const st = p.quests[qid];
      if (st && st.state === 'done') continue;
      if (st) quests.push({ q: qid, state: st.state, n: st.n });
      else if ((!Q.requires || p.quests[Q.requires]?.state === 'done') && p.level >= Q.lvl) quests.push({ q: qid, state: 'available', n: 0 });
    }
    return { t: S2C.DIALOG, id: npc.id, npc: npc.nk, name: def.name, text: def.greeting, quests, shop: def.shop ? def.shop.slice() : null };
  }

  _npcInRange(id) {
    const n = this.ents.get(id);
    const p = this.player;
    if (!n || n.k !== KIND.NPC) { this.err('bad_target', 'PNJ introuvable.'); return null; }
    if (Math.hypot(n.x - p.x, n.z - p.z) > INTERACT_RANGE + 1) { this.err('too_far', 'Trop loin.'); return null; }
    return n;
  }

  _interact(id) {
    const n = this._npcInRange(id);
    if (!n) return;
    this.dialogNpc = n.id;
    this.send(this._dialogFor(n));
  }

  _questAccept(id, q) {
    const n = this._npcInRange(id);
    const p = this.player;
    if (!n || !QUESTS[q] || p.quests[q]) return;
    p.quests[q] = { state: 'active', n: 0 };
    this.notify('quest', `Quête acceptée : ${QUESTS[q].name}`);
    this._self(['quests']);
    this.send(this._dialogFor(n));
  }

  _questTurnin(id, q) {
    const n = this._npcInRange(id);
    const p = this.player;
    if (!n || p.quests[q]?.state !== 'ready') return;
    const R = QUESTS[q].reward;
    p.quests[q].state = 'done';
    p.gold += R.gold;
    for (const [iid, qty] of R.items || []) this._addItem(iid, qty);
    if (R.classItem?.[p.cls]) this._addItem(R.classItem[p.cls], 1);
    this.notify('quest', `Quête terminée : ${QUESTS[q].name}`);
    this._giveXp(R.xp);
    this._self(['quests', 'gold', 'inv', 'xp', 'xpNext', 'level', 'hp', 'mhp', 'mp', 'mmp', 'stats']);
    this.send(this._dialogFor(n));
  }

  _buy(id, item, qty) {
    const n = this._npcInRange(id);
    const p = this.player;
    if (!n || !NPCS[n.nk].shop?.includes(item)) return;
    const cost = ITEMS[item].price * qty;
    if (p.gold < cost) return this.err('no_gold', "Vous n'avez pas assez d'or.");
    if (!this._addItem(item, qty)) return this.err('inv_full', 'Inventaire plein.');
    p.gold -= cost;
    this.notify('gold', `Acheté : ${ITEMS[item].name} (−${cost} or)`);
    this._self(['gold', 'inv']);
  }

  _sell(id, slot) {
    const n = this._npcInRange(id);
    const p = this.player;
    const s = p.inv[slot];
    if (!n || !s) return;
    const gain = (ITEMS[s.id].sell || 0) * s.q;
    p.inv[slot] = null;
    p.gold += gain;
    this.notify('gold', `Vendu : ${ITEMS[s.id].name} (+${gain} or)`);
    this._self(['gold', 'inv']);
  }

  // ---------------------------------------------------------------- simulation
  _tick() {
    const dt = 1 / TICK_RATE;
    const now = this.now();
    this.tick++;
    if (this.todFixed === null) this.tod = (this.tod + dt / DAY_LENGTH_S) % 1;
    const p = this.player;
    // auto attack
    if (p.autoTarget && !p.dead) {
      const t = this.ents.get(p.autoTarget);
      if (!t || t.s === STATE.DEAD) p.autoTarget = 0;
      else if (p.cds[0] <= now && !inVillage(p.x, p.z) && Math.hypot(t.x - p.x, t.z - p.z) <= ABILITIES[p.abilities[0]].range + 0.5) this._cast(0, t, {});
    }
    p.s = p.dead ? STATE.DEAD : now - (p.movedAt || 0) < 250 ? STATE.MOVE : STATE.IDLE;
    this._stamina(dt, now); // [combat-souls]
    // regen
    p.regenAcc += dt;
    if (p.regenAcc >= 1 && !p.dead) {
      p.regenAcc = 0;
      const rest = now - p.lastCombat > REGEN.restDelay * 1000;
      const hp = Math.min(p.mhp, p.hp + Math.ceil(p.mhp * (rest ? REGEN.hpRest : REGEN.hpCombat)));
      const mp = Math.min(p.mmp, p.mp + Math.ceil(p.mmp * (rest ? REGEN.mpRest : REGEN.mpCombat)));
      if (hp !== p.hp || mp !== p.mp) { p.hp = hp; p.mp = mp; this._self(['hp', 'mp']); }
    }
    // buddy: strolls around the well, casts now and then
    const b = this.buddy;
    b.ang += dt * 0.28;
    const bx = Math.cos(b.ang) * 9.5, bz = Math.sin(b.ang) * 9.5;
    b.ry = Math.atan2(bx - b.x, bz - b.z);
    b.x = bx; b.z = bz;
    b.s = STATE.MOVE;
    if (this.tick % 160 === 80) this.send({ t: S2C.FX, k: FX.CAST, src: b.id, ab: 'heal' });
    if (this.tick % 160 === 90) this.send({ t: S2C.FX, k: FX.HEAL, tg: b.id, ab: 'heal' });
    // monsters
    for (const m of this.ents.values()) if (m.k === KIND.MONSTER && m.s !== STATE.DEAD) this._ai(m, dt, now);
    if (this.tick % SNAPSHOT_EVERY === 0) this._snapshot();
  }

  _moveToward(m, tx, tz, speed, dt) {
    let dx = tx - m.x, dz = tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return false;
    const step = Math.min(d, speed * dt, 1);
    dx /= d; dz /= d;
    let nx = m.x + dx * step, nz = m.z + dz * step;
    if (inVillage(nx, nz) && !m.returning) {
      const vd = Math.hypot(nx - VILLAGE.x, nz - VILLAGE.z) || 1;
      nx = VILLAGE.x + ((nx - VILLAGE.x) / vd) * (VILLAGE.r + 0.05);
      nz = VILLAGE.z + ((nz - VILLAGE.z) / vd) * (VILLAGE.r + 0.05);
    }
    const r = this.collision.move(m.x, m.z, nx, nz, MONSTERS[m.mt].radius);
    const moved = Math.hypot(r.x - m.x, r.z - m.z) > 0.001;
    m.x = r.x; m.z = r.z;
    m.ry = Math.atan2(dx, dz);
    return moved;
  }

  _ai(m, dt, now) {
    const p = this.player;
    const def = MONSTERS[m.mt];
    const speed = def.speed * (m.slowUntil > now ? 0.5 : 1);
    m.sl = m.slowUntil > now ? 1 : 0;
    let moved = false;
    const dp = Math.hypot(p.x - m.x, p.z - m.z);
    const playerOk = !p.dead && !inVillage(p.x, p.z);
    if (m.ai === 'idle') {
      if (def.aggro > 0 && playerOk && dp < def.aggro) m.ai = 'chase';
      else {
        if (!m.wp || now > m.wpAt) {
          const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * m.zone.r;
          m.wp = { x: m.home.x + Math.cos(a) * d, z: m.home.z + Math.sin(a) * d };
          m.wpAt = now + 3000 + this.rand() * 5000;
        }
        moved = this._moveToward(m, m.wp.x, m.wp.z, speed * 0.35, dt);
      }
      m.tg = 0;
    }
    if (m.ai === 'chase') {
      const far = Math.hypot(m.x - m.home.x, m.z - m.home.z) > m.zone.r + 18;
      if (!playerOk || far) {
        m.ai = 'return';
        m.returning = true;
      } else {
        m.tg = p.id;
        // [combat-souls] now and then a telegraphed heavy attack (dodge it with a Shift tap)
        const heavy = (def.ai?.attacks || []).filter((a) => a.kind === 'tele' && (!a.phase || a.phase <= 1));
        if (now < (m.busyUntil || 0)) { /* winding up */ } else if (heavy.length && now >= (m.nextHeavy || 0) && dp <= Math.max(...heavy.map((a) => a.max || 4))) {
          if (!m.nextHeavy) m.nextHeavy = now + 2500 + this.rand() * 2500;
          else {
            m.nextHeavy = now + 5000 + this.rand() * 4000;
            this._telegraph(m, heavy[Math.floor(this.rand() * heavy.length)]);
          }
        } else if (dp > def.range) moved = this._moveToward(m, p.x, p.z, speed, dt);
        else {
          m.ry = Math.atan2(p.x - m.x, p.z - m.z);
          if (now >= m.nextAtk) {
            m.nextAtk = now + def.atkCd * 1000;
            this.send({ t: S2C.FX, k: FX.SWING, src: m.id, tg: p.id, ms: 380 });
            this.later(380, () => { if (m.s !== STATE.DEAD && Math.hypot(p.x - m.x, p.z - m.z) <= def.range + 1) this._damagePlayer(m, 1); });
          }
        }
      }
    }
    if (m.ai === 'return') {
      m.tg = 0;
      moved = this._moveToward(m, m.home.x, m.home.z, speed * 1.2, dt);
      if (Math.hypot(m.x - m.home.x, m.z - m.home.z) < 1.5) {
        m.ai = 'idle';
        m.returning = false;
        m.hp = m.mhp;
        m.nextSlam = 0;
      }
    }
    m.s = moved ? STATE.MOVE : STATE.IDLE;
  }

  _snapshot() {
    const p = this.player;
    const ents = [];
    const seen = new Set();
    for (const e of this.ents.values()) {
      if (e !== p && Math.hypot(e.x - p.x, e.z - p.z) > VIEW_RADIUS) continue;
      seen.add(e.id);
      const o = { id: e.id, x: r2(e.x), z: r2(e.z), ry: r3(e.ry), hp: e.hp, mhp: e.mhp, s: e.s };
      if (e.tg) o.tg = e.tg;
      if (e.sl) o.sl = 1;
      const sig = STATIC.map((f) => e[f] ?? '').join('|');
      if (this.known.get(e.id) !== sig) {
        this.known.set(e.id, sig);
        for (const f of STATIC) if (e[f] !== undefined && e[f] !== null) o[f] = e[f];
      }
      ents.push(o);
    }
    const gone = [];
    for (const id of this.known.keys()) if (!seen.has(id)) { gone.push(id); this.known.delete(id); }
    this.send({ t: S2C.SNAP, tick: this.tick, tod: r3(this.tod), on: 2, ents, gone });
  }
}
