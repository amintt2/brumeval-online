// Quest tracker under the minimap: active quests with live progress, "ready" state, and a hint
// when a new quest is available from a quest giver.
import { QUESTS } from '@shared/data.js';
import { h } from './dom.js';
import { questState, questProgress, objectiveText, giverName, QUEST_ORDER } from './quests-util.js';

export function createTracker(parent, { onOpenQuest }) {
  const list = h('div', { class: 'bv-trk-list' });
  const el = h('div', { class: 'bv-tracker is-empty' },
    h('div', { class: 'bv-trk-head' }, h('span', { text: 'Quêtes' })),
    list);
  parent.appendChild(el);
  let lastKey = '';

  return {
    update(self) {
      const rows = [];
      for (const qid of QUEST_ORDER) {
        const st = questState(self, qid);
        if (st === 'active' || st === 'ready') rows.push([qid, st]);
      }
      const avail = QUEST_ORDER.filter((q) => questState(self, q) === 'available');
      const key = JSON.stringify([rows.map(([q, st]) => [q, st, questProgress(self, q).n]), avail]);
      if (key === lastKey) return;
      const prev = lastKey ? JSON.parse(lastKey)[0] : [];
      lastKey = key;
      list.replaceChildren();
      for (const [qid, st] of rows) {
        const { n, count } = questProgress(self, qid);
        const changed = prev.some(([pq, , pn]) => pq === qid && pn !== n);
        const row = h('button', {
          class: `bv-trk-q ${st}${changed ? ' flash' : ''}`, type: 'button',
          onclick: () => onOpenQuest(qid),
        },
          h('div', { class: 'bv-trk-name', text: QUESTS[qid].name }),
          st === 'ready'
            ? h('div', { class: 'bv-trk-obj ready', text: `Terminée — retournez voir ${giverName(qid)}` })
            : h('div', { class: 'bv-trk-obj' },
              h('span', { text: objectiveText(qid, n) }),
              h('span', { class: 'bv-trk-bar' }, h('i', { style: { width: `${Math.round((n / count) * 100)}%` } }))));
        list.appendChild(row);
      }
      if (avail.length) {
        list.appendChild(h('button', {
          class: 'bv-trk-q avail', type: 'button', onclick: () => onOpenQuest(avail[0]),
        },
          h('div', { class: 'bv-trk-name' }, h('b', { class: 'bv-trk-mark', text: '!' }), `Nouvelle quête : ${QUESTS[avail[0]].name}`),
          h('div', { class: 'bv-trk-obj', text: `Parlez à ${giverName(avail[0])} au village.` })));
      }
      el.classList.toggle('is-empty', !list.childNodes.length);
    },
  };
}
