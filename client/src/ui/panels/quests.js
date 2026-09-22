// Quest log: active / ready / available / done lists + detail view with objective and rewards.
import { QUESTS } from '@shared/data.js';
import { h, append, frTypo } from '../dom.js';
import { createWindow } from './window.js';
import { rewardsView, progressBar, emptyNote } from './common.js';
import { questState, questProgress, objectiveText, objectiveGoal, giverName, QUEST_ORDER } from '../quests-util.js';

const STATE_LABEL = { active: 'En cours', ready: 'À rendre', available: 'Disponible', done: 'Terminée', locked: 'Verrouillée' };

export function createQuestPanel(wm, { tooltip, onToggle }) {
  const win = wm.add(createWindow({
    id: 'quests', title: 'Journal de quêtes', keyHint: 'L',
    onShow: () => { onToggle?.(true); render(); },
    onHide: () => onToggle?.(false),
  }));
  let self = null;
  let selected = null;
  let lastKey = '';
  const list = h('div', { class: 'bv-ql-list' });
  const detail = h('div', { class: 'bv-ql-detail' });
  win.body.append(h('div', { class: 'bv-ql' }, list, detail));
  const countEl = h('span', { class: 'bv-foot-hint' });
  win.footer.append(countEl);

  function groups() {
    const g = { current: [], available: [], done: [] };
    for (const q of QUEST_ORDER) {
      const st = questState(self, q);
      if (st === 'active' || st === 'ready') g.current.push([q, st]);
      else if (st === 'available') g.available.push([q, st]);
      else if (st === 'done') g.done.push([q, st]);
    }
    return g;
  }

  function render(force) {
    if (!self) return;
    const g = groups();
    const key = JSON.stringify([g, selected, QUEST_ORDER.map((q) => questProgress(self, q).n), self.level]);
    if (!force && key === lastKey) return;
    lastKey = key;
    const all = [...g.current, ...g.available, ...g.done];
    if (!selected || !all.some(([q]) => q === selected)) selected = all[0]?.[0] || null;

    list.replaceChildren();
    const section = (title, rows) => {
      if (!rows.length) return;
      list.appendChild(h('div', { class: 'bv-ql-sec', text: title }));
      for (const [q, st] of rows) {
        const { n, count } = questProgress(self, q);
        const mark = st === 'available' ? '!' : st === 'ready' ? '?' : st === 'active' ? '•' : '✓';
        list.appendChild(h('button', {
          class: `bv-ql-item st-${st}${q === selected ? ' sel' : ''}`, type: 'button',
          onclick: () => { selected = q; render(true); },
        },
          h('span', { class: 'bv-ql-mark', text: mark }),
          h('span', { class: 'bv-ql-name', text: QUESTS[q].name }),
          st === 'active' ? h('span', { class: 'bv-ql-n', text: `${n}/${count}` }) : h('span', { class: 'bv-ql-lvl', text: `Niv. ${QUESTS[q].lvl}` })));
      }
    };
    section('En cours', g.current);
    section('Disponibles', g.available);
    section('Terminées', g.done);
    if (!all.length) list.appendChild(emptyNote('Aucune quête pour le moment.'));

    detail.replaceChildren();
    if (!selected) {
      detail.appendChild(emptyNote('Parlez à l\'Ancien Aldric, au centre du village, pour recevoir votre première quête.'));
    } else {
      const q = QUESTS[selected];
      const st = questState(self, selected);
      const { n, count } = questProgress(self, selected);
      append(detail, [
        h('div', { class: 'bv-qd-head' },
          h('h3', { class: 'bv-qd-title', text: q.name }),
          h('span', { class: `bv-chip st-${st}`, text: STATE_LABEL[st] })),
        h('div', { class: 'bv-qd-meta', text: `Niveau ${q.lvl} · Donnée par ${giverName(selected)}` }),
        h('p', { class: 'bv-qd-text', text: frTypo(q.text) }),
        h('div', { class: 'bv-sec-title', text: 'Objectif' }),
        h('div', { class: 'bv-qd-obj' },
          h('div', { text: st === 'available' ? objectiveGoal(selected) : objectiveText(selected, n) }),
          st !== 'available' ? progressBar(n, count, st === 'ready' || st === 'done' ? 'done' : '') : null),
        st === 'ready' ? h('div', { class: 'bv-qd-note ready', text: `Objectif accompli ! Retournez voir ${giverName(selected)} pour recevoir votre récompense.` }) : null,
        st === 'available' ? h('div', { class: 'bv-qd-note', text: `Rendez-vous auprès de ${giverName(selected)} pour accepter cette quête.` }) : null,
        st === 'done' ? h('p', { class: 'bv-qd-done', text: frTypo(`« ${q.done} »`) }) : null,
        h('div', { class: 'bv-sec-title', text: st === 'done' ? 'Récompenses reçues' : 'Récompenses' }),
        rewardsView(selected, self, tooltip)]);
    }
    const done = g.done.length;
    countEl.textContent = `${done} / ${QUEST_ORDER.length} quêtes accomplies`;
  }

  return {
    win,
    update(s) {
      self = s;
      if (win.isOpen) render();
    },
    select(qid) {
      selected = qid;
      if (win.isOpen) render(true);
    },
  };
}
