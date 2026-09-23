// [combat-souls] Death echo: the XP a player lost by dying, waiting at the death spot. Only its owner sees it.
import { KIND, STATE } from '../../../shared/protocol.js';
import { round2 } from '../util.js';

export class Echo {
  constructor(id, owner, x, z, xp) {
    this.id = id;
    this.kind = KIND.ECHO;
    this.ownerId = owner.id;      // snapshots only send it to this player
    this.name = `Écho de ${owner.name}`;
    this.level = owner.level;
    this.xp = xp;
    this.x = x; this.z = z; this.ry = 0;
    this.hp = 1; this.mhp = 1;
    this.dead = false;
    this.staticVer = 1;
  }

  entState() {
    return { id: this.id, x: round2(this.x), z: round2(this.z), ry: 0, hp: 1, mhp: 1, s: STATE.IDLE, tg: 0 };
  }

  staticState() {
    return { k: this.kind, n: this.name, lv: this.level };
  }
}
