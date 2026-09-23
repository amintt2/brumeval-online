// [accounts] Data of the world map (M), built from shared/world.js and shared/data.js only, so that a future world
// (v0.3 open world) plugs in by providing another descriptor with the same shape:
//   { id, name, half, limit, base(cb) -> canvas covering [-half, half]², regions, pois, npcs, questAreas(self) }
import { WORLD_HALF, WORLD_LIMIT, REGIONS, VILLAGE, NPC_SPAWNS, SPAWN_ZONES } from '@shared/world.js';
import { NPCS, QUESTS, MONSTERS } from '@shared/data.js';
import { getStaticMap } from './minimap.js';

const POI_KIND = { village: 'village', goblins: 'camp', graveyard: 'danger', lair: 'boss' };

export function brumevalMap() {
  return {
    id: 'brumeval',
    name: 'Vallée de Brumeval',
    half: WORLD_HALF,
    limit: WORLD_LIMIT,
    base: getStaticMap,
    /** Named areas: label at the centre, soft outline of radius r. */
    regions: REGIONS.map((r) => ({ id: r.id, name: r.name, x: r.x, z: r.z, r: r.r, safe: !!r.safe })),
    /** Points of interest with an icon: village, camps, dangerous places, boss lairs. */
    pois: [
      { id: 'village', kind: 'village', name: 'Brumeval', x: VILLAGE.x, z: VILLAGE.z },
      ...REGIONS.filter((r) => POI_KIND[r.id] && r.id !== 'village').map((r) => ({ id: r.id, kind: POI_KIND[r.id], name: r.name, x: r.x, z: r.z })),
    ],
    npcs: NPC_SPAWNS.map((n) => ({ key: n.key, name: NPCS[n.key]?.name || n.key, role: NPCS[n.key]?.role || '', x: n.x, z: n.z })),
    /**
     * Objectives of the active quests: kill quests point at the spawn zones of their monster, finished quests
     * (state 'ready') at the NPC who gave them.
     */
    questAreas(self) {
      const out = [];
      for (const [qid, st] of Object.entries(self?.quests || {})) {
        const q = QUESTS[qid];
        if (!q || !st) continue;
        if (st.state === 'active' && q.goal?.kill) {
          for (const z of SPAWN_ZONES.filter((s) => s.monster === q.goal.kill)) {
            out.push({ qid, name: q.name, kind: 'kill', x: z.x, z: z.z, r: z.r, label: `${MONSTERS[q.goal.kill]?.name || ''} ${Math.min(st.n || 0, q.goal.count)}/${q.goal.count}` });
          }
        } else if (st.state === 'ready') {
          const npc = NPC_SPAWNS.find((n) => n.key === q.giver);
          if (npc) out.push({ qid, name: q.name, kind: 'turnin', x: npc.x, z: npc.z, r: 4, label: `Rendre à ${NPCS[q.giver]?.name || ''}` });
        }
      }
      return out;
    },
  };
}
