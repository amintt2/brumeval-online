// Player entity: live character state built from a persisted account record.
import { CLASSES, playerStats, xpToNext } from '../../../shared/data.js';
import { KIND, STATE } from '../../../shared/protocol.js';
import { SPAWN_POINT } from '../../../shared/world.js';
import { cloneInventory } from '../inventory.js';
import { MoveValidator } from '../movement.js';
import { round2, round3 } from '../util.js';

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
    this.recomputeStats();
    this.hp = account.hp == null ? this.mhp : Math.max(1, Math.min(this.mhp, account.hp));
    this.mp = account.mp == null ? this.mmp : Math.max(0, Math.min(this.mmp, account.mp));

    // movement validation
    this.mv = new MoveValidator(this.x, this.z, now);
    this.lastCorrectAt = -Infinity;
    this.moveUntil = 0;
    // combat
    this.cooldowns = [0, 0, 0, 0];
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
  }

  get abilities() { return CLASSES[this.cls].abilities; }

  /** hp as shown to clients: never 0 while alive. */
  hpShown() { return this.dead ? 0 : Math.max(1, Math.ceil(this.hp)); }
  /** mp as shown to clients: never more than really available. */
  mpShown() { return Math.max(0, Math.floor(this.mp)); }

  /** Recompute derived stats from class/level/equipment and clamp hp/mp. */
  recomputeStats() {
    const s = playerStats(this.cls, this.level, this.eq);
    this.mhp = s.mhp;
    this.mmp = s.mmp;
    this.stats = { atk: s.atk, def: s.def, crit: s.crit, speed: s.speed };
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
    };
  }

  staticState() {
    return { k: this.kind, n: this.name, m: this.model, lv: this.level, c: this.cls };
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
