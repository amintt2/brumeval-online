// Circle-vs-circle collision against static world objects, shared by client (local player movement)
// and server (movement validation + monster movement). Deterministic and allocation-light.
import { generateWorldObjects, isWalkable, WORLD_LIMIT } from './world.js';
import { clamp } from './noise.js';

const CELL = 8;
const key = (cx, cz) => cx * 100003 + cz;

export class CollisionWorld {
  constructor(objects = generateWorldObjects()) {
    this.grid = new Map();
    for (const o of objects) {
      if (!(o.r > 0)) continue;
      const x0 = Math.floor((o.x - o.r) / CELL), x1 = Math.floor((o.x + o.r) / CELL);
      const z0 = Math.floor((o.z - o.r) / CELL), z1 = Math.floor((o.z + o.r) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(o);
      }
    }
  }

  /** Static obstacles whose circle may touch the circle (x, z, r). */
  query(x, z, r) {
    const res = [];
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const cell = this.grid.get(key(cx, cz));
      if (cell) for (const o of cell) if (!res.includes(o)) res.push(o);
    }
    return res;
  }

  /** Max penetration depth of circle (x, z, r) into any obstacle (0 = free). */
  penetration(x, z, r) {
    let worst = 0;
    for (const o of this.query(x, z, r)) {
      const d = Math.hypot(x - o.x, z - o.z);
      worst = Math.max(worst, o.r + r - d);
    }
    return worst;
  }

  /** Push the circle out of obstacles (a few relaxation passes). Returns {x, z}. */
  pushOut(x, z, r) {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const o of this.query(x, z, r)) {
        const dx = x - o.x, dz = z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + r;
        if (d < min) {
          const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
          x = o.x + nx * (min + 1e-4);
          z = o.z + nz * (min + 1e-4);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /**
   * Move a circle from (x0, z0) towards (x1, z1), sliding along obstacles, staying inside the world
   * limit and out of deep water. Returns the resolved {x, z}. Callers should keep steps small
   * (<= ~1 m); split larger moves into several calls.
   */
  move(x0, z0, x1, z1, r) {
    let x = clamp(x1, -WORLD_LIMIT, WORLD_LIMIT), z = clamp(z1, -WORLD_LIMIT, WORLD_LIMIT);
    ({ x, z } = this.pushOut(x, z, r));
    if (isWalkable(x, z) && this.penetration(x, z, r) < 0.01) return { x, z };
    // try sliding on each axis separately
    for (const [tx, tz] of [[x1, z0], [x0, z1]]) {
      let p = this.pushOut(clamp(tx, -WORLD_LIMIT, WORLD_LIMIT), clamp(tz, -WORLD_LIMIT, WORLD_LIMIT), r);
      if (isWalkable(p.x, p.z) && this.penetration(p.x, p.z, r) < 0.01) return p;
    }
    return { x: x0, z: z0 };
  }
}
