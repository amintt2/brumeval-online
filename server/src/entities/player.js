// Player entity: live character state built from a persisted account record.
import { CLASSES, ITEMS, playerStats, xpToNext } from '../../../shared/data.js';
import { KIND, STATE } from '../../../shared/protocol.js';
import { SPAWN_POINT } from '../../../shared/world.js';
import { cloneInventory } from '../inventory.js';
import { MoveValidator } from '../movement.js';
import { round2, round3 } from '../util.js';
import { initCombatState, maxSpeedAt } from '../systems/stamina.js'; // [combat-souls]
// [skilltree]
import { buildTree, sanitizeSkills, freshSkills, repairLoadout, resolveAbility } from '../../../shared/skills.js';
import { applyTreeStats, treeField, pointsField, renaissanceField } from '../systems/skills.js';
import { buffStat } from '../systems/buffs.js';

export class Player {
  constructor(id, account, session, now) {
    this.id = id;
    this.kind = KIND.PLAYER;
    this.account = account;
    this.session = session;
    this.name = account.name;
    this.cls = account.cls;
    this.model = CLASSES[account.cls].model;
    this.level = account.level;
    this.xp = account.xp;
    this.gold = account.gold;
    this.inv = cloneInventory(account.inv);
    this.eq = { weapon: account.eq.weapon || null, armor: account.eq.armor || null };
    this.quests = JSON.parse(JSON.stringify(account.quests || {}));
    this.x = account.x;
    this.z = account.z;
    this.ry = SPAWN_POINT.ry;
    this.dead = false;
    this.staticVer = 1;

    this.stats = null;
    this.mhp = 1; this.mmp = 0;
    // [skilltree] tree state (sanitized again: never trust a record) + cache, before the stats that depend on it
    this.skills = sanitizeSkills(account.skills, this.cls, this.level) || freshSkills(this.cls);
    this.tree = buildTree(this.cls, this.skills);
    this.skills.loadout = repairLoadout(this.skills.loadout, this.tree.unlocked, this.cls);
    this.aggroMult = resolveAbility(this.tree, 'sprint', {}).aggroRadiusMult || 1; // Course feutrée
    this.buffs = new Map(); // ability id -> { until, … } (systems/buffs.js)
    this.recomputeStats();
    this.hp = account.hp == null ? this.mhp : Math.max(1, Math.min(this.mhp, account.hp));
    this.mp = account.mp == null ? this.mmp : Math.max(0, Math.min(this.mmp, account.mp));

    // movement validation
    this.mv = new MoveValidator(this.x, this.z, now);
    this.lastCorrectAt = -Infinity;
    this.moveUntil = 0;
    // combat
    this.cds = new Map(); // [skilltree] ability id -> ready time (ms); the bar slots only point at abilities
    this.autoTarget = 0;
    this.lastCombat = -Infinity;
    // npc dialog
    this.dialogNpc = 0;
    // chat rate limiting (timestamps)
    this.chatTimes = [];
    // networking
    this.known = new Map(); // entity id -> { ver, stamp } for snapshot deltas
    this.dirty = new Set(); // SelfState fields to send in the next `self`
    this.sentHp = this.hpShown();
    this.sentMp = this.mpShown();
    // [combat-souls] stamina / dodge / sprint / attack commitment + death echo
    initCombatState(this);
    this.echo = account.echo ? { ...account.echo } : null;
    this.echoEnt = null;
  }

  /** [combat-souls] Movement allowance contract: metres/second allowed at `nowMs`. */
  maxSpeedAt(nowMs) { return maxSpeedAt(this, nowMs); }

  /** [skilltree] v0.2 view of the action bar (first four loadout slots) for older clients. */
  get abilities() { return this.skills.loadout.slice(0, 4); }
  /** [skilltree] 8-slot action bar. */
  get loadout() { return this.skills.loadout; }
  /** Cooldown ready time of an ability (0 = ready). */
  cdOf(id) { return this.cds.get(id) || 0; }

  /** hp as shown to clients: never 0 while alive. */
  hpShown() { return this.dead ? 0 : Math.max(1, Math.ceil(this.hp)); }
  /** mp as shown to clients: never more than really available. */
  mpShown() { return Math.max(0, Math.floor(this.mp)); }

  /** Recompute derived stats from class/level/equipment and clamp hp/mp. */
  recomputeStats() {
    // [skilltree] gear above the character's level (kept after a Renaissance) gives nothing until the level is regained
    const eq = {};
    for (const k of ['weapon', 'armor']) eq[k] = this.eq[k] && this.level >= (ITEMS[this.eq[k]]?.lvl || 1) ? this.eq[k] : null;
    const s = playerStats(this.cls, this.level, eq);
    applyTreeStats(this, s); // [skilltree] passives (PV, mana, défense, critique, vitesse, endurance…)
    // [skilltree] active buffs (Rage, Bastion, Armure de givre…)
    if (this.buffs?.size) {
      s.def = Math.max(0, Math.round(s.def * (1 + buffStat(this, 'defPct'))));
      s.speed = +(s.speed * Math.max(0.2, 1 + buffStat(this, 'speedPct'))).toFixed(3);
    }
    this.mhp = s.mhp;
    this.mmp = s.mmp;
    this.stats = { atk: s.atk, def: s.def, crit: s.crit, speed: s.speed };
    if (this.st !== undefined && this.st > this.mst) this.st = this.mst;
    if (this.hp !== undefined) {
      this.hp = Math.min(this.hp, this.mhp);
      this.mp = Math.min(this.mp, this.mmp);
    }
    this.markDirty('stats', 'mhp', 'mmp', 'hp', 'mp');
  }

  markDirty(...fields) {
    if (!this.dirty) return; // during construction
    for (const f of fields) this.dirty.add(f);
  }

  selfField(f) {
    switch (f) {
      case 'hp': return this.hpShown();
      case 'mp': return this.mpShown();
      case 'xpNext': return xpToNext(this.level);
      case 'stats': return { ...this.stats };
      case 'inv': return cloneInventory(this.inv);
      case 'eq': return { ...this.eq };
      case 'quests': return JSON.parse(JSON.stringify(this.quests));
      case 'abilities': return [...this.abilities];
      case 'x': return round2(this.x);
      case 'z': return round2(this.z);
      case 'ry': return round3(this.ry);
      case 'st': return Math.floor(this.st); // [combat-souls]
      case 'echo': return this.echo ? { ...this.echo } : null; // [combat-souls]
      // [skilltree]
      case 'tree': return treeField(this);
      case 'points': return pointsField(this);
      case 'loadout': return [...this.skills.loadout];
      case 'renaissance': return renaissanceField(this);
      default: return this[f];
    }
  }

  /** Full SelfState (see shared/protocol.js). */
  selfState() {
    const out = {};
    for (const f of SELF_FIELDS) out[f] = this.selfField(f);
    return out;
  }

  /** Partial SelfState of the dirty fields (or null) and clears the dirty set. */
  takeDirty() {
    if (this.dirty.size === 0) return null;
    const out = {};
    for (const f of this.dirty) out[f] = this.selfField(f);
    this.dirty.clear();
    if ('hp' in out) this.sentHp = out.hp;
    if ('mp' in out) this.sentMp = out.mp;
    return out;
  }

  entState(now) {
    return {
      id: this.id, x: round2(this.x), z: round2(this.z), ry: round3(this.ry),
      hp: this.hpShown(), mhp: this.mhp,
      s: this.dead ? STATE.DEAD : now < this.moveUntil ? STATE.MOVE : STATE.IDLE,
      tg: this.autoTarget || 0,
      ac: this.actionFlags(now), // [skilltree]
    };
  }

  /** [skilltree] EntState.ac: 1 guard, 2 airborne, 4 charging, 8 casting / channelling, 16 staggered. */
  actionFlags(now) {
    let f = 0;
    if (this.guardUp) f |= 1;
    if (now < (this.airUntil || 0)) f |= 2;
    if (this.charging) f |= 4;
    if (this.casting) f |= 8;
    if (now < (this.staggerUntil || 0)) f |= 16;
    return f;
  }

  staticState() {
    const s = { k: this.kind, n: this.name, m: this.model, lv: this.level, c: this.cls };
    if (this.skills.rb > 0) s.rb = this.skills.rb; // [skilltree] Renaissance aura + title
    return s;
  }

  /** Copy live state back into the account record (for saving). */
  syncAccount() {
    const a = this.account;
    a.level = this.level;
    a.xp = this.xp;
    a.gold = this.gold;
    a.inv = cloneInventory(this.inv);
    a.eq = { ...this.eq };
    a.quests = JSON.parse(JSON.stringify(this.quests));
    a.skills = JSON.parse(JSON.stringify(this.skills)); // [skilltree]
    if (this.dead) {
      a.hp = null; a.mp = null;
      a.x = SPAWN_POINT.x; a.z = SPAWN_POINT.z;
    } else {
      a.hp = Math.max(1, Math.round(this.hp));
      a.mp = Math.max(0, Math.round(this.mp));
      a.x = round2(this.x); a.z = round2(this.z);
    }
    a.lastSeen = Date.now();
  }
}

export const SELF_FIELDS = [
  'id', 'name', 'cls', 'level', 'xp', 'xpNext', 'hp', 'mhp', 'mp', 'mmp', 'gold',
  'stats', 'inv', 'eq', 'quests', 'abilities', 'x', 'z', 'ry', 'dead',
];
SELF_FIELDS.push('st', 'mst', 'echo'); // [combat-souls]
SELF_FIELDS.push('tree', 'points', 'loadout', 'renaissance'); // [skilltree]
