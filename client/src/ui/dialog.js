// NPC dialog window: greeting, quest list (available → details + rewards + Accepter; active → progress;
// ready → Rendre la quête), shop tab (icon, name, price, Acheter) and "Au revoir".
import { QUESTS, NPCS, ITEMS, RARITY_COLORS, CLASSES, canUse } from '@shared/data.js';
import { h, fmt, frTypo } from './dom.js';
import { iconBox, setIcon, itemIconSpec, glyph } from './icons.js';
import { itemTooltip } from './tooltip.js';
import { createWindow } from './panels/window.js';
import { rewardsView, progressBar, goldView, emptyNote } from './panels/common.js';
import { questProgress, objectiveText, objectiveGoal, questState } from './quests-util.js';

const STATE_LABEL = { available: 'Nouvelle quête', active: 'En cours', ready: 'Terminée — à rendre', done: 'Accomplie' };
const STATE_MARK = { available: '!', active: '?', ready: '?', done: '✓' };
const NPC_ROLE = { quest: 'Ancien du village', shop: 'Marchande' };

export function createDialog(wm, { handlers, tooltip, onOpen, onClose }) {
  let d = null;          // current payload
  let self = null;
  let tab = 'quests';
  let selectedQuest = null;
  let completed = new Set(); // quests turned in during this conversation (shown as done)

  const win = wm.add(createWindow({
    id: 'dialog', title: '', cls: 'bv-win-npc',
    onRequestClose: () => close(true),
  }));

  const portrait = iconBox(null, 'bv-dlg-portrait');
  const greet = h('p', { class: 'bv-dlg-text' });
  const greetBox = h('div', { class: 'bv-dlg-greet' }, h('div', { class: 'bv-dlg-pframe' }, portrait), h('div', { class: 'bv-dlg-bubble' }, greet));
  const tabQuests = h('button', { class: 'bv-tab', type: 'button', role: 'tab', onclick: () => setTab('quests') }, glyph('scroll'), h('span', { text: 'Quêtes' }));
  const tabShop = h('button', { class: 'bv-tab', type: 'button', role: 'tab', onclick: () => setTab('shop') }, glyph('bag'), h('span', { text: 'Boutique' }));
  const tabs = h('div', { class: 'bv-tabs small', role: 'tablist' }, tabQuests, tabShop);
  const view = h('div', { class: 'bv-dlg-view' });
  win.body.append(greetBox, tabs, view);

  const goldEl = goldView(0);
  const goldV = goldEl.querySelector('.bv-gi-v');
  const goldWrap = h('div', { class: 'bv-dlg-gold' }, h('span', { class: 'bv-dlg-gold-l', text: 'Votre bourse' }), goldEl);
  const bye = h('button', { class: 'bv-btn secondary', type: 'button', text: 'Au revoir', onclick: () => close(true) });
  const footLeft = h('div', { class: 'bv-dlg-footl' });
  const footRight = h('div', { class: 'bv-dlg-footr' });
  win.footer.append(footLeft, footRight);
  let footAction = null; // primary action of the current view (Accepter / Rendre la quête)
  let footBack = null;

  function close(notifyCore) {
    if (!win.isOpen && !d) return;
    d = null;
    win.hide();
    onClose?.();
    if (notifyCore) handlers.closeDialog?.();
  }

  function setTab(t) {
    tab = t;
    selectedQuest = null;
    render();
  }

  // ---------------------------------------------------------------- quest data
  function questEntries() {
    if (!d) return [];
    const ids = [];
    const payload = new Map();
    for (const e of Array.isArray(d.quests) ? d.quests : []) {
      if (e && QUESTS[e.q]) {
        payload.set(e.q, e);
        if (!ids.includes(e.q)) ids.push(e.q);
      }
    }
    const npc = npcOf(d);
    if (npc?.quests) {
      for (const q of npc.quests) {
        const st = questState(self, q);
        if ((st === 'available' || st === 'active' || st === 'ready' || completed.has(q)) && !ids.includes(q)) ids.push(q);
      }
      ids.sort((a, b) => npc.quests.indexOf(a) - npc.quests.indexOf(b));
    }
    const out = [];
    for (const q of ids) {
      const mine = self?.quests?.[q];
      let state = mine?.state || payload.get(q)?.state || questState(self, q);
      if (state === 'locked') continue;
      if (state === 'done' && !completed.has(q)) continue;
      const count = QUESTS[q].goal?.count || 1;
      let n = mine ? questProgress(self, q).n : Math.min(count, payload.get(q)?.n || 0);
      if (state === 'ready' || state === 'done') n = count;
      out.push({ q, state, n, count });
    }
    return out;
  }

  // ---------------------------------------------------------------- views
  /** Prevent double clicks while the server answers; re-enable if nothing re-rendered the view. */
  function lock(btn) {
    btn.disabled = true;
    setTimeout(() => {
      if (btn.isConnected) btn.disabled = false;
    }, 1500);
  }

  function questList(entries) {
    const wrap = h('div', { class: 'bv-dlg-qlist' });
    if (!entries.length) {
      wrap.appendChild(emptyNote('Je n\'ai rien d\'autre à vous confier pour le moment. Revenez plus tard, voyageur.'));
      return wrap;
    }
    for (const e of entries) {
      const qd = QUESTS[e.q];
      wrap.appendChild(h('button', {
        class: `bv-dlg-q st-${e.state}`, type: 'button',
        onclick: () => { selectedQuest = e.q; render(); },
      },
        h('span', { class: 'bv-dlg-qmark', text: STATE_MARK[e.state] }),
        h('span', { class: 'bv-dlg-qtexts' },
          h('span', { class: 'bv-dlg-qname', text: qd.name }),
          h('span', { class: 'bv-dlg-qstate', text: e.state === 'active' ? `${STATE_LABEL.active} — ${e.n}/${e.count}` : STATE_LABEL[e.state] })),
        h('span', { class: 'bv-dlg-qlvl', text: `Niv. ${qd.lvl}` })));
    }
    return wrap;
  }

  function questDetail(e) {
    const qd = QUESTS[e.q];
    let action = null;
    if (e.state === 'available') {
      action = h('button', {
        class: 'bv-btn gold', type: 'button', text: 'Accepter',
        onclick: (ev) => { lock(ev.currentTarget); handlers.acceptQuest?.(d.id, e.q); },
      });
    } else if (e.state === 'ready') {
      action = h('button', {
        class: 'bv-btn gold', type: 'button', text: 'Rendre la quête',
        onclick: (ev) => { lock(ev.currentTarget); completed.add(e.q); handlers.turnInQuest?.(d.id, e.q); },
      });
    } else if (e.state === 'active') {
      action = h('button', { class: 'bv-btn', type: 'button', disabled: true, text: 'Quête en cours' });
    }
    footAction = action;
    footBack = h('button', { class: 'bv-btn secondary', type: 'button', text: '‹ Retour', onclick: () => { selectedQuest = null; render(); } });
    const text = e.state === 'ready' || e.state === 'done' ? qd.done : qd.text;
    return h('div', { class: `bv-dlg-qdetail st-${e.state}` },
      h('div', { class: 'bv-qd-head' },
        h('h3', { class: 'bv-qd-title', text: qd.name }),
        h('span', { class: `bv-chip st-${e.state}`, text: STATE_LABEL[e.state] })),
      h('p', { class: 'bv-parchment', text: frTypo(text) }),
      h('div', { class: 'bv-sec-title', text: 'Objectif' }),
      h('div', { class: 'bv-qd-obj' },
        h('div', { text: e.state === 'available' ? objectiveGoal(e.q) : objectiveText(e.q, e.n) }),
        e.state !== 'available' ? progressBar(e.n, e.count, e.state === 'active' ? '' : 'done') : null),
      h('div', { class: 'bv-sec-title', text: e.state === 'done' ? 'Récompenses reçues' : 'Récompenses' }),
      rewardsView(e.q, self, tooltip));
  }

  function shopView() {
    const wrap = h('div', { class: 'bv-shop' });
    const list = Array.isArray(d.shop) ? d.shop.filter((id) => ITEMS[id]) : [];
    if (!list.length) {
      wrap.appendChild(emptyNote('Rien à vendre pour le moment.', 'bag'));
      return wrap;
    }
    for (const id of list) {
      const it = ITEMS[id];
      const price = it.price || 0;
      const afford = (self?.gold || 0) >= price;
      const usable = !self || it.type === 'consumable' || canUse(it, self.cls, self.level);
      const parts = [];
      if (it.atk) parts.push(`+${it.atk} Att.`);
      if (it.def) parts.push(`+${it.def} Déf.`);
      if (it.mp) parts.push(`+${it.mp} Mana`);
      if (it.crit) parts.push(`+${Math.round(it.crit * 100)} % Crit.`);
      if (it.heal) parts.push(`Rend ${it.heal} PV`);
      if (it.mana) parts.push(`Rend ${it.mana} mana`);
      const req = [];
      if (it.cls) req.push(it.cls.map((c) => CLASSES[c]?.name).join('/'));
      if ((it.lvl || 1) > 1) req.push(`Niv. ${it.lvl}`);
      const icon = h('span', { class: 'bv-slot bv-shop-icon', style: { '--rar': RARITY_COLORS[it.rarity] } }, iconBox(itemIconSpec(id)));
      const buy = h('button', {
        class: 'bv-btn small', type: 'button', text: 'Acheter', disabled: !afford,
        title: afford ? `Acheter ${it.name}` : 'Pas assez d\'or',
        onclick: (ev) => {
          const b = ev.currentTarget;
          b.classList.remove('pulse');
          void b.offsetWidth;
          b.classList.add('pulse');
          handlers.buy?.(d.id, id);
        },
      });
      const row = h('div', { class: `bv-shop-row${usable ? '' : ' unusable'}` },
        icon,
        h('div', { class: 'bv-shop-info' },
          h('div', { class: 'bv-shop-name', style: { color: RARITY_COLORS[it.rarity] }, text: it.name }),
          h('div', { class: 'bv-shop-sub' },
            h('span', { text: parts.join(' · ') }),
            req.length ? h('span', { class: usable ? 'bv-shop-req' : 'bv-shop-req bad', text: req.join(' · ') }) : null)),
        h('div', { class: `bv-shop-price${afford ? '' : ' bad'}` }, goldView(price)),
        buy);
      tooltip.bind(icon, () => itemTooltip(id, { self, shop: 'buy' }));
      tooltip.bind(row.querySelector('.bv-shop-info'), () => itemTooltip(id, { self, shop: 'buy' }));
      wrap.appendChild(row);
    }
    wrap.appendChild(h('div', { class: 'bv-shop-hint' }, glyph('bag'), h('span', { text: 'Pour vendre : clic droit sur un objet de votre sac (Maj + clic droit : vente rapide).' })));
    return wrap;
  }

  function render() {
    if (!d) return;
    const hasShop = Array.isArray(d.shop) && d.shop.length > 0;
    const npc = npcOf(d);
    const entries = questEntries();
    const hasQuests = entries.length > 0 || npc?.role === 'quest' || (Array.isArray(d.quests) && d.quests.length > 0);
    if (tab === 'shop' && !hasShop) tab = 'quests';
    if (tab === 'quests' && !hasQuests && hasShop) tab = 'shop';
    tabs.hidden = !(hasShop && hasQuests);
    tabQuests.classList.toggle('active', tab === 'quests');
    tabShop.classList.toggle('active', tab === 'shop');
    goldV.textContent = fmt(self?.gold || 0);
    win.el.classList.toggle('is-shop', tab === 'shop');

    footAction = null;
    footBack = null;
    const scroller = win.body;
    const scroll = scroller.scrollTop;
    view.replaceChildren();
    let detail = false;
    if (tab === 'shop') view.appendChild(shopView());
    else {
      const sel = selectedQuest && entries.find((e) => e.q === selectedQuest);
      if (sel) {
        view.appendChild(questDetail(sel));
        detail = true;
      } else {
        selectedQuest = null;
        view.appendChild(questList(entries));
      }
    }
    greetBox.hidden = detail;
    win.el.classList.toggle('is-detail', detail);
    // footer: back button (quest details) or purse (shop) on the left; action + "Au revoir" on the right
    footLeft.replaceChildren(...[footBack || (hasShop ? goldWrap : null)].filter(Boolean));
    footRight.replaceChildren(...[footAction, bye].filter(Boolean));
    const key = `${tab}|${selectedQuest || ''}`;
    scroller.scrollTop = key === lastViewKey ? scroll : 0;
    lastViewKey = key;
  }
  let lastViewKey = '';
  let lastSelfKey = '';

  return {
    win,
    get isOpen() { return !!d && win.isOpen; },
    get shopOpen() { return !!d && win.isOpen && Array.isArray(d.shop) && d.shop.length > 0; },
    show(payload) {
      if (!payload) {
        close(false);
        return;
      }
      const same = d && d.id === payload.id && win.isOpen;
      const info = npcOf(payload);
      d = payload;
      if (!same) {
        completed = new Set();
        selectedQuest = null;
        const hasShop = Array.isArray(payload.shop) && payload.shop.length > 0;
        const hasQuests = Array.isArray(payload.quests) && payload.quests.length > 0;
        tab = hasShop && (info?.role === 'shop' || (!hasQuests && info?.role !== 'quest')) ? 'shop' : 'quests';
        const name = String(payload.name || info?.name || 'Inconnu');
        win.setTitle(name);
        win.setSubtitle(NPC_ROLE[info?.role] || 'Habitant de Brumeval');
        const letter = name.replace(/^(Ancien|Marchande|Marchand)\s+/, '').charAt(0) || '?';
        portraitSpec(letter, info?.role);
      }
      greet.textContent = frTypo(payload.text || info?.greeting || '');
      render();
      if (!win.isOpen) {
        wm.open('dialog');
        onOpen?.();
      } else wm.front(win);
    },
    update(s) {
      self = s;
      if (!d || !win.isOpen) return;
      // Only rebuild when something the dialog shows changed (hp/mp regen must not recreate the
      // buttons under the cursor, or a click spanning the rebuild would be lost).
      const key = `${s.gold}|${s.level}|${s.cls}|${JSON.stringify(s.quests || {})}`;
      if (key === lastSelfKey) return;
      lastSelfKey = key;
      render();
    },
    close: () => close(false),
  };

  function npcOf(p) {
    return NPCS[p?.npc] || Object.values(NPCS).find((n) => n.name === p?.name) || null;
  }
  function portraitSpec(letter, role) {
    setIcon(portrait, role === 'shop'
      ? { url: null, letter, c1: '#b0543a', c2: '#2a0d06' }
      : { url: null, letter, c1: '#b8862b', c2: '#2a1c08' });
  }
}
