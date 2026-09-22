// Quest helpers shared by the NPC dialog, the quest log and the tracker.
import { QUESTS, MONSTERS, NPCS, ITEMS } from '@shared/data.js';
import { plural, fmt } from './dom.js';

/** 'available' | 'active' | 'ready' | 'done' | 'locked' for the given self state. */
export function questState(self, qid) {
  const q = QUESTS[qid];
  if (!q) return 'locked';
  const st = self?.quests?.[qid];
  if (st?.state) return st.state;
  const reqOk = !q.requires || self?.quests?.[q.requires]?.state === 'done';
  return reqOk && (self?.level || 1) >= q.lvl ? 'available' : 'locked';
}

export function questProgress(self, qid) {
  const q = QUESTS[qid];
  const st = self?.quests?.[qid];
  const count = q?.goal?.count || 1;
  const n = st?.state === 'ready' || st?.state === 'done' ? count : Math.min(count, st?.n || 0);
  return { n, count };
}

/** "Gluants éliminés : 3/8" */
export function objectiveText(qid, n) {
  const q = QUESTS[qid];
  if (!q?.goal) return '';
  const m = MONSTERS[q.goal.kill];
  const name = m ? plural(m.name, q.goal.count) : q.goal.kill;
  const verb = q.goal.count > 1 ? 'éliminés' : 'éliminé';
  return `${name} ${verb} : ${n}/${q.goal.count}`;
}

/** "Éliminer 8 Gluants" */
export function objectiveGoal(qid) {
  const q = QUESTS[qid];
  if (!q?.goal) return '';
  const m = MONSTERS[q.goal.kill];
  const name = m ? plural(m.name, q.goal.count) : q.goal.kill;
  return q.goal.count > 1 ? `Éliminer ${q.goal.count} ${name}` : `Terrasser : ${name}`;
}

export function giverName(qid) {
  const g = QUESTS[qid]?.giver;
  return NPCS[g]?.name || '';
}

/** Rewards as a flat list: [{ kind: 'xp'|'gold'|'item', value, id?, qty? }] */
export function questRewards(qid, cls) {
  const r = QUESTS[qid]?.reward;
  if (!r) return [];
  const out = [];
  if (r.xp) out.push({ kind: 'xp', value: r.xp, label: `${fmt(r.xp)} XP` });
  if (r.gold) out.push({ kind: 'gold', value: r.gold, label: `${fmt(r.gold)} po` });
  for (const [id, qty] of r.items || []) if (ITEMS[id]) out.push({ kind: 'item', id, qty });
  const ci = r.classItem?.[cls];
  if (ci && ITEMS[ci]) out.push({ kind: 'item', id: ci, qty: 1 });
  return out;
}

/** Ordered list of all quest ids for the quest log. */
export const QUEST_ORDER = Object.keys(QUESTS);
