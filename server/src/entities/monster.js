// Monster entity. AI lives in systems/ai.js, combat in systems/combat.js.
import { MONSTERS, monsterStats } from '../../../shared/data.js';
import { KIND, STATE } from '../../../shared/protocol.js';
import { round2, round3 } from '../util.js';
import { statusFlags } from '../systems/status.js'; // [skilltree]

export class Monster {
  constructor(id, type, level, zone, x, z, ry, now) {
    const def = MONSTERS[type];
    const st = monsterStats(type, level);
    this.id = id;
    this.kind = KIND.MONSTER;
    this.type = type;
    this.def = def;
    this.zone = zone;
    this.name = def.name;
    this.model = def.model;
    this.scale = def.scale ?? 1;
    this.boss = !!def.boss;
    this.radius = def.radius;
    this.level = level;
    this.mhp = st.mhp;
    this.hp = st.mhp;
    this.atk = st.atk;
    this.defense = st.def;
    this.crit = st.crit;
    this.speed = st.speed;
    this.x = x; this.z = z; this.ry = ry;
    this.homeX = x; this.homeZ = z;
    this.staticVer = 1;

    this.dead = false;
    this.deadAt = 0;
    this.ai = 'idle';          // idle | wander | chase | return
    this.aiUntil = now;        // next wander decision
    this.wanderX = x; this.wanderZ = z;
    this.target = 0;           // current target player id
    this.threat = new Map();   // player id -> damage dealt
    this.atkReady = 0;
    this.slamReady = 0;
    this.slowUntil = 0;
    this.moveUntil = 0;
    this.lastCombat = -Infinity;
    this.stuck = 0;            // seconds without progress (return/wander)
  }

  get invulnerable() { return this.ai === 'return'; }
  isSlowed(now) { return now < this.slowUntil; }

  entState(now) {
    return {
      id: this.id, x: round2(this.x), z: round2(this.z), ry: round3(this.ry),
      hp: this.dead ? 0 : Math.max(1, Math.ceil(this.hp)), mhp: this.mhp,
      s: this.dead ? STATE.DEAD : now < this.moveUntil ? STATE.MOVE : STATE.IDLE,
      tg: this.target || 0,
      sl: !this.dead && now < this.slowUntil ? 1 : 0,
      stt: this.dead ? 0 : statusFlags(this, now), // [skilltree] brûlure, froid, gel, poison… (protocol.js)
    };
  }

  staticState() {
    const s = { k: this.kind, n: this.name, m: this.model, lv: this.level, mt: this.type, sc: this.scale };
    if (this.boss) s.b = 1;
    if (this.elite) s.el = 1; // [combat-souls]
    if (this.variant) s.vr = this.variant; // [combat-souls]
    return s;
  }
}
