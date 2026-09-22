// Pure quest logic. `pq` = a player's quest map { [questId]: { state: 'active'|'ready'|'done', n } }.
import { QUESTS, NPCS, MONSTERS } from '../../shared/data.js';
import { has } from './util.js';

/** French progress labels used in notifications: "Gluants éliminés : 3/8". */
export const KILL_LABELS = {
  slime: 'Gluants éliminés',
  wolf: 'Loups gris éliminés',
  goblin: 'Gobelins éliminés',
  skeleton: 'Squelettes éliminés',
  golem: 'Golem ancien vaincu',
};
export const killLabel = (type) => KILL_LABELS[type] || `${MONSTERS[type]?.name || type} éliminés`;

export const isQuest = (qid) => has(QUESTS, qid);

/**
 * Status of a quest for a player:
 * 'done' | 'ready' | 'active' | 'available' (requirements met & level high enough) | 'locked'.
 */
export function questStatus(pq, qid, level) {
  if (!isQuest(qid)) return 'locked';
  const st = pq[qid];
  if (st) return st.state;
  const q = QUESTS[qid];
  if (q.requires && pq[q.requires]?.state !== 'done') return 'locked';
  if (level < q.lvl) return 'locked';
  return 'available';
}

/** Quest list shown in an NPC dialog (done and locked quests are omitted). */
export function dialogQuests(pq, level, npcKey) {
  const npc = has(NPCS, npcKey) ? NPCS[npcKey] : null;
  if (!npc?.quests) return [];
  const out = [];
  for (const qid of npc.quests) {
    const state = questStatus(pq, qid, level);
    if (state === 'available') out.push({ q: qid, state, n: 0 });
    else if (state === 'active' || state === 'ready') out.push({ q: qid, state, n: pq[qid].n });
  }
  return out;
}

/** Accept a quest offered by `npcKey`. Returns null on success or a French error message. */
export function acceptQuest(pq, level, npcKey, qid) {
  if (!isQuest(qid) || QUESTS[qid].giver !== npcKey) return 'Cette quête n\'est pas proposée ici.';
  const status = questStatus(pq, qid, level);
  if (status === 'active' || status === 'ready') return 'Vous avez déjà cette quête.';
  if (status === 'done') return 'Vous avez déjà terminé cette quête.';
  if (status !== 'available') {
    const q = QUESTS[qid];
    if (q.requires && pq[q.requires]?.state !== 'done') return 'Vous devez d\'abord terminer la quête précédente.';
    return `Niveau ${q.lvl} requis pour cette quête.`;
  }
  pq[qid] = { state: 'active', n: 0 };
  return null;
}

/**
 * Record a kill of `monsterType` for every matching active quest.
 * Returns [{ qid, n, count, ready }] for each quest that progressed.
 */
export function recordKill(pq, monsterType) {
  const out = [];
  for (const qid of Object.keys(pq)) {
    const st = pq[qid];
    if (!isQuest(qid) || st.state !== 'active') continue;
    const goal = QUESTS[qid].goal;
    if (goal.kill !== monsterType) continue;
    st.n = Math.min(goal.count, st.n + 1);
    const ready = st.n >= goal.count;
    if (ready) st.state = 'ready';
    out.push({ qid, n: st.n, count: goal.count, ready });
  }
  return out;
}

/** Items granted by a quest reward for class `cls`: [[itemId, qty], …]. */
export function rewardItems(qid, cls) {
  const r = QUESTS[qid].reward;
  const list = (r.items || []).map(([id, q]) => [id, q]);
  if (r.classItem && r.classItem[cls]) list.push([r.classItem[cls], 1]);
  return list;
}

/** Validate a turn-in. Returns null if allowed or a French error message. Does not mutate. */
export function checkTurnIn(pq, npcKey, qid) {
  if (!isQuest(qid) || QUESTS[qid].giver !== npcKey) return 'Cette quête n\'est pas rendue ici.';
  const st = pq[qid];
  if (!st || st.state === 'done') return 'Vous n\'avez pas cette quête en cours.';
  if (st.state !== 'ready') {
    const g = QUESTS[qid].goal;
    return `Quête inachevée : ${killLabel(g.kill)} ${st.n}/${g.count}.`;
  }
  return null;
}

/** Mark a ready quest as done (call after rewards were granted). */
export function completeQuest(pq, qid) {
  pq[qid] = { state: 'done', n: QUESTS[qid].goal.count };
}

/** Sanitise a persisted quest map. */
export function sanitizeQuests(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const qid of Object.keys(raw)) {
    if (!isQuest(qid)) continue;
    const st = raw[qid];
    if (!st || !['active', 'ready', 'done'].includes(st.state)) continue;
    const count = QUESTS[qid].goal.count;
    let n = Math.max(0, Math.min(count, Math.floor(Number(st.n) || 0)));
    let state = st.state;
    if (state === 'done') n = count;
    else state = n >= count ? 'ready' : 'active';
    out[qid] = { state, n };
  }
  return out;
}
