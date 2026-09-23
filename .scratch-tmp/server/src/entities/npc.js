// Non-player character (quest giver / merchant). NPCs never die and never move.
import { NPCS } from '../../../shared/data.js';
import { KIND, STATE } from '../../../shared/protocol.js';
import { NPC_LEVEL, NPC_HP } from '../config.js';
import { round2, round3 } from '../util.js';

export class Npc {
  constructor(id, key, x, z, ry) {
    const def = NPCS[key];
    this.id = id;
    this.kind = KIND.NPC;
    this.key = key;
    this.def = def;
    this.name = def.name;
    this.model = def.model;
    this.role = def.role;
    this.level = NPC_LEVEL;
    this.hp = NPC_HP;
    this.mhp = NPC_HP;
    this.x = x; this.z = z; this.ry = ry;
    this.dead = false;
    this.staticVer = 1;
  }

  get isShop() { return Array.isArray(this.def.shop) && this.def.shop.length > 0; }

  entState() {
    return { id: this.id, x: round2(this.x), z: round2(this.z), ry: round3(this.ry), hp: this.hp, mhp: this.mhp, s: STATE.IDLE, tg: 0 };
  }

  staticState() {
    return { k: this.kind, n: this.name, m: this.model, lv: this.level, nk: this.key };
  }
}
