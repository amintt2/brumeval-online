// UI sandbox: creates the real UI with a fake "core" so every public method can be exercised
// without a server. Open http://localhost:5175/ui-sandbox.html
// URL params: ?scene=login|create|loading|hud|elder|elder-detail|shop|death|zone|level|inventory|character|quests|help|chat|toasts|boss|npc|player|context|confirm
//             &drawer=0 (hide the sandbox drawer)  &walk=0 (freeze the minimap walk)  &cls=warrior|mage|ranger
import { createUI } from './index.js';
import {
  CLASSES, ABILITIES, ITEMS, NPCS, QUESTS, INV_SIZE, playerStats, xpToNext,
} from '@shared/data.js';
import { regionAt, NPC_SPAWNS, SPAWN_ZONES } from '@shared/world.js';

const params = new URLSearchParams(location.search);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ?noassets=1 → every <img> points to a missing file, to check the gradient/glyph fallbacks.
if (params.get('noassets') === '1') {
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, `/__missing__/${String(v).split('/').pop()}`); },
  });
}
// ?hold=1 → freeze transient elements (toasts, zone/level banners) so screenshots can capture them:
// auto-dismiss timers (2.5–5 s) never fire and banner animations are paused in their visible phase.
if (params.get('hold') === '1') {
  const nativeTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => (ms >= 2500 && ms <= 5000 ? 0 : nativeTimeout(fn, ms, ...a));
  const st = document.createElement('style');
  st.textContent = '.bv-zone.show,.bv-lvl.show{animation-delay:-1.4s!important;animation-play-state:paused!important}';
  document.head.appendChild(st);
}
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ fake self state
let self = null;
function makeSelf(cls = 'warrior') {
  const level = 7;
  const weapon = { warrior: 'steel_sword', mage: 'arcane_staff', ranger: 'long_bow' }[cls];
  const armor = cls === 'mage' ? 'mage_robe' : 'chainmail';
  const st = playerStats(cls, level, { weapon, armor });
  const inv = new Array(INV_SIZE).fill(null);
  const put = (i, id, q = 1) => { inv[i] = { id, q }; };
  put(0, 'potion_hp_s', 12);
  put(1, 'potion_hp_l', 3);
  put(2, 'potion_mp_s', 7);
  put(3, 'slime_gel', 23);
  put(4, 'wolf_pelt', 9);
  put(5, 'goblin_trinket', 4);
  put(6, 'ancient_bone', 6);
  put(7, 'golem_core', 1);
  put(8, 'rusty_sword');
  put(9, 'runeblade');
  put(10, 'apprentice_staff');
  put(11, 'ember_staff');
  put(12, 'short_bow');
  put(13, 'elven_bow');
  put(14, 'leather_tunic');
  put(15, 'golem_plate');
  put(16, 'arcane_staff');
  put(17, 'steel_sword');
  put(19, 'slime_gel', 50);
  return {
    id: 42,
    name: 'Aldebrand',
    cls,
    level,
    xp: Math.round(xpToNext(level) * 0.62),
    xpNext: xpToNext(level),
    hp: Math.round(st.mhp * 0.78),
    mhp: st.mhp,
    mp: Math.round(st.mmp * 0.55),
    mmp: st.mmp,
    gold: 342,
    stats: { atk: st.atk, def: st.def, crit: st.crit, speed: st.speed },
    inv,
    eq: { weapon, armor },
    quests: {
      q_slimes: { state: 'done', n: 8 },
      q_wolves: { state: 'ready', n: 6 },
      q_goblins: { state: 'active', n: 3 },
    },
    abilities: [...CLASSES[cls].abilities],
    x: 4, z: 9, ry: 0.6, dead: false,
  };
}
function recompute() {
  const st = playerStats(self.cls, self.level, self.eq);
  self.mhp = st.mhp;
  self.mmp = st.mmp;
  self.hp = Math.min(self.hp, self.mhp);
  self.mp = Math.min(self.mp, self.mmp);
  self.stats = { atk: st.atk, def: st.def, crit: st.crit, speed: st.speed };
  self.xpNext = xpToNext(self.level);
}
function push() {
  recompute();
  ui.setSelf(clone(self));
}
function freeSlot() {
  return self.inv.findIndex((s) => !s);
}
function addItem(id, q = 1) {
  const it = ITEMS[id];
  if (it.stack) {
    const s = self.inv.find((e) => e && e.id === id && e.q < it.stack);
    if (s) { s.q = Math.min(it.stack, s.q + q); return true; }
  }
  const i = freeSlot();
  if (i < 0) { ui.notify('Votre sac est plein.', 'error'); return false; }
  self.inv[i] = { id, q };
  return true;
}

// ------------------------------------------------------------------ fake handlers
let dialogOpen = null;
const handlers = {
  login(name, password) {
    ui.setLoginBusy(true);
    setTimeout(() => {
      ui.setLoginBusy(false);
      if (/^erreur$/i.test(name) || password === 'faux') {
        ui.setLoginError('Nom ou mot de passe incorrect.');
        return;
      }
      self.name = name;
      enterGame();
    }, 900);
  },
  register(name, password, cls) {
    ui.setLoginBusy(true);
    setTimeout(() => {
      ui.setLoginBusy(false);
      if (/^pris$/i.test(name)) {
        ui.setLoginError('Ce nom est déjà pris.');
        return;
      }
      self = makeSelf(cls);
      self.name = name;
      enterGame();
    }, 900);
  },
  chat(text) {
    const w = /^\/w\s+(\S+)\s+(.+)$/i.exec(text);
    if (w) {
      ui.addChat({ ch: 'whisper_out', to: w[1], text: w[2] });
      setTimeout(() => ui.addChat({ ch: 'whisper_in', from: w[1], text: 'Bien reçu, on se retrouve au puits !' }), 1200);
    } else if (/^\/who/i.test(text)) ui.addChat({ ch: 'system', text: 'Joueurs en ligne (4) : Aldebrand, Mirelle, Tobias_7, Ysaline' });
    else if (/^\/help/i.test(text)) ui.addChat({ ch: 'system', text: 'Commandes : /w nom message, /who, /help' });
    else ui.addChat({ ch: 'global', from: self.name, text });
  },
  ability(slot) {
    if (self.dead) return ui.notify('Vous êtes mort.', 'error');
    const id = self.abilities[slot];
    const ab = ABILITIES[id];
    if (cds[slot] > performance.now()) return ui.notify('Capacité en recharge.', 'error');
    if (ab.mp > self.mp) return ui.notify('Pas assez de mana.', 'error');
    self.mp -= ab.mp;
    cds[slot] = performance.now() + ab.cd * 1000;
    ui.setCooldown(slot, ab.cd * 1000);
    if (ab.kind === 'self_heal') self.hp = Math.min(self.mhp, self.hp + Math.round(self.mhp * ab.heal));
    push();
    if (target && target.kind === 'monster' && ab.kind !== 'self_heal') {
      target.hp = Math.max(0, target.hp - Math.round(rnd(20, 60)));
      ui.setTarget({ ...target });
      if (target.hp === 0) {
        ui.notify(`+${Math.round(rnd(25, 60))} XP`, 'xp');
        ui.notify('Butin : Gelée de gluant', 'loot');
      }
    }
  },
  useItem(slot) {
    const e = self.inv[slot];
    if (!e) return;
    const it = ITEMS[e.id];
    if (it.type === 'consumable') {
      if (it.heal) self.hp = Math.min(self.mhp, self.hp + it.heal);
      if (it.mana) self.mp = Math.min(self.mmp, self.mp + it.mana);
      e.q--;
      if (e.q <= 0) self.inv[slot] = null;
      ui.notify(`Vous utilisez : ${it.name}.`, 'info');
      push();
    } else handlers.equip(slot);
  },
  equip(slot) {
    const e = self.inv[slot];
    if (!e) return;
    const it = ITEMS[e.id];
    const eqSlot = it.type === 'weapon' ? 'weapon' : it.type === 'armor' ? 'armor' : null;
    if (!eqSlot) return;
    const prev = self.eq[eqSlot];
    self.eq[eqSlot] = e.id;
    self.inv[slot] = prev ? { id: prev, q: 1 } : null;
    ui.notify(`Équipé : ${it.name}.`, 'info');
    push();
  },
  unequip(eqSlot) {
    const id = self.eq[eqSlot];
    if (!id) return;
    const i = freeSlot();
    if (i < 0) return ui.notify('Votre sac est plein.', 'error');
    self.inv[i] = { id, q: 1 };
    self.eq[eqSlot] = null;
    push();
  },
  drop(slot) {
    const e = self.inv[slot];
    if (!e) return;
    self.inv[slot] = null;
    ui.notify(`${ITEMS[e.id].name} a été détruit.`, 'info');
    push();
  },
  sell(slot) {
    const e = self.inv[slot];
    if (!e || !dialogOpen?.shop) return;
    const gain = (ITEMS[e.id].sell || 0) * e.q;
    self.inv[slot] = null;
    self.gold += gain;
    ui.notify(`Vendu : ${ITEMS[e.id].name}${e.q > 1 ? ` ×${e.q}` : ''} (+${gain} po)`, 'gold');
    push();
  },
  buy(npcId, itemId) {
    const it = ITEMS[itemId];
    if (self.gold < it.price) return ui.notify('Vous n\'avez pas assez d\'or.', 'error');
    if (!addItem(itemId, 1)) return;
    self.gold -= it.price;
    ui.notify(`Acheté : ${it.name} (−${it.price} po)`, 'loot');
    push();
  },
  acceptQuest(npcId, q) {
    self.quests[q] = { state: 'active', n: 0 };
    ui.notify(`Quête acceptée : ${QUESTS[q].name}`, 'quest');
    push();
  },
  turnInQuest(npcId, q) {
    const r = QUESTS[q].reward;
    self.quests[q] = { state: 'done', n: QUESTS[q].goal.count };
    self.gold += r.gold;
    self.xp += r.xp;
    for (const [id, n] of r.items || []) addItem(id, n);
    ui.notify(`Quête terminée : ${QUESTS[q].name}`, 'quest');
    ui.notify(`+${r.xp} XP`, 'xp');
    ui.notify(`+${r.gold} po`, 'gold');
    while (self.xp >= xpToNext(self.level)) {
      self.xp -= xpToNext(self.level);
      self.level++;
      ui.notify(`Vous avez atteint le niveau ${self.level} !`, 'level');
      ui.addChat({ ch: 'system', text: `${self.name} a atteint le niveau ${self.level} !` });
    }
    push();
  },
  respawn() {
    setTimeout(() => {
      self.dead = false;
      self.hp = self.mhp;
      self.mp = self.mmp;
      ui.showDeath(false);
      ui.showZone('Village de Brumeval');
      push();
    }, 500);
  },
  closeDialog() {
    dialogOpen = null;
    ui.showDialog(null);
  },
};
const cds = [0, 0, 0, 0];

// ------------------------------------------------------------------ create the UI
self = makeSelf(CLASSES[params.get('cls')] ? params.get('cls') : 'warrior');
const ui = createUI(document.getElementById('ui-root'), handlers);
window.__ui = ui;

// ------------------------------------------------------------------ scenario helpers
let target = null;
const TARGETS = {
  monster: { id: 101, name: 'Loup gris', level: 6, hp: 118, mhp: 150, kind: 'monster', boss: false, hostile: true },
  high: { id: 102, name: 'Squelette', level: 11, hp: 260, mhp: 305, kind: 'monster', boss: false, hostile: true },
  low: { id: 103, name: 'Gluant', level: 2, hp: 40, mhp: 52, kind: 'monster', boss: false, hostile: true },
  boss: { id: 104, name: 'Golem ancien', level: 14, hp: 1890, mhp: 2600, kind: 'monster', boss: true, hostile: true },
  npc: { id: 105, name: 'Marchande Élise', level: 10, hp: 500, mhp: 500, kind: 'npc', boss: false, hostile: false },
  player: { id: 106, name: 'Mirelle', level: 9, hp: 96, mhp: 184, kind: 'player', boss: false, hostile: false },
};
function setTarget(k) {
  target = k ? clone(TARGETS[k]) : null;
  ui.setTarget(target);
}

function dialogPayload(npcKey) {
  const npc = NPCS[npcKey];
  const sp = NPC_SPAWNS.find((n) => n.key === npcKey);
  const quests = [];
  if (npc.quests) {
    for (const q of npc.quests) {
      const st = self.quests[q];
      if (st && st.state !== 'done') quests.push({ q, state: st.state, n: st.n });
      else if (!st) {
        const qd = QUESTS[q];
        const req = !qd.requires || self.quests[qd.requires]?.state === 'done';
        if (req && self.level >= qd.lvl) quests.push({ q, state: 'available', n: 0 });
      }
    }
  }
  return { id: sp ? 900 + NPC_SPAWNS.indexOf(sp) : 900, npc: npcKey, name: npc.name, text: npc.greeting, quests, shop: npc.shop || null };
}
function openElder(state) {
  // make sure every quest state is represented: available (q_skeletons needs lvl 8), active, ready
  if (state === 'all') {
    self.level = Math.max(self.level, 8);
    self.quests.q_goblins = { state: 'done', n: 8 };
    self.quests.q_wolves = { state: 'ready', n: 6 };
    self.quests.q_skeletons = undefined;
    delete self.quests.q_skeletons;
    push();
  }
  dialogOpen = dialogPayload('elder');
  ui.showDialog(dialogOpen);
}
function openShop() {
  dialogOpen = dialogPayload('merchant');
  ui.showDialog(dialogOpen);
}

function chatBurst() {
  ui.addChat({ ch: 'system', text: 'Bienvenue sur Brumeval Online ! Tapez /help pour la liste des commandes.' });
  ui.addChat({ ch: 'system', text: 'Mirelle a rejoint le monde.' });
  ui.addChat({ ch: 'global', from: 'Mirelle', text: 'Quelqu\'un pour le golem ce soir ? Il faut au moins trois héros.' });
  ui.addChat({ ch: 'global', from: 'Tobias_7', text: 'Je vends des fourrures de loup, faites-moi signe.' });
  ui.addChat({ ch: 'whisper_in', from: 'Ysaline', text: 'Salut ! Tu as encore besoin d\'aide pour les gobelins ?' });
  ui.addChat({ ch: 'whisper_out', to: 'Ysaline', text: 'Oui volontiers, rendez-vous au camp à l\'ouest.' });
  ui.addChat({ ch: 'global', from: 'Hacker', text: '<img src=x onerror=alert(1)> <b>pas de HTML</b> — texte brut uniquement' });
  ui.addChat({ ch: 'system', text: 'Tobias_7 a atteint le niveau 8 !' });
}
function toastsBurst() {
  const list = [
    ['Quête acceptée : Menace gobeline', 'quest'],
    ['Butin : Fourrure de loup ×2', 'loot'],
    ['+45 XP', 'xp'],
    ['+12 po', 'gold'],
    ['Trop loin', 'error'],
    ['Le golem ancien s\'est réveillé…', 'info'],
  ];
  list.forEach(([t, k], i) => setTimeout(() => ui.notify(t, k), i * 350));
  setTimeout(() => ui.notify('Trop loin', 'error'), list.length * 350 + 100);
  setTimeout(() => ui.notify('Trop loin', 'error'), list.length * 350 + 300);
}
function levelUp() {
  self.level++;
  self.xp = 0;
  recompute();
  self.hp = self.mhp;
  self.mp = self.mmp;
  push();
  ui.notify(`Vous avez atteint le niveau ${self.level} !`, 'level');
  ui.addChat({ ch: 'system', text: `${self.name} a atteint le niveau ${self.level} !` });
}
function die() {
  self.dead = true;
  self.hp = 0;
  push();
  ui.showDeath(true);
  ui.notify('Vous avez été tué par Golem ancien.', 'error');
}
function cooldownsDemo() {
  const ab = self.abilities.map((id) => ABILITIES[id]);
  ab.forEach((a, i) => {
    cds[i] = performance.now() + a.cd * 1000;
    ui.setCooldown(i, a.cd * 1000);
  });
}
function damage(v) {
  self.hp = Math.max(1, self.hp - v);
  push();
}
function fillInventory() {
  const ids = Object.keys(ITEMS);
  for (let i = 0; i < INV_SIZE; i++) {
    const id = ids[i % ids.length];
    self.inv[i] = { id, q: ITEMS[id].stack ? Math.min(ITEMS[id].stack, 1 + ((i * 7) % 19)) : 1 };
  }
  push();
}
function enterGame() {
  ui.showLogin(false);
  push();
  ui.setStatus({ ping: 42, fps: 60, online: 12 });
  ui.showZone(regionAt(self.x, self.z).name);
  ui.addChat({ ch: 'system', text: `Bienvenue, ${self.name} ! ${12} joueurs en ligne.` });
}
function showLoading(done) {
  let p = 0;
  ui.setLoading(0, 'Chargement des modèles…');
  const models = ['warrior', 'mage', 'ranger', 'goblin', 'skeleton', 'slime', 'wolf', 'golem', 'tree_pine', 'house', 'well'];
  const t = setInterval(() => {
    p += 0.06;
    const i = Math.min(models.length - 1, Math.floor(p * models.length));
    ui.setLoading(Math.min(1, p), `Chargement des modèles… ${models[i]}.glb (${i + 1}/${models.length})`);
    if (p >= 1.05) {
      clearInterval(t);
      ui.setLoading(null);
      done?.();
    }
  }, 180);
}

// ------------------------------------------------------------------ minimap simulation
const walk = params.get('walk') !== '0';
const fakeEnts = [];
for (const z of SPAWN_ZONES) {
  for (let i = 0; i < Math.min(z.count, 8); i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * z.r;
    fakeEnts.push({ x: z.x + Math.cos(a) * d, z: z.z + Math.sin(a) * d, k: 'monster', boss: z.monster === 'golem', vx: rnd(-1, 1), vz: rnd(-1, 1) });
  }
}
for (const n of NPC_SPAWNS) fakeEnts.push({ x: n.x, z: n.z, k: 'npc', boss: false, vx: 0, vz: 0 });
for (let i = 0; i < 3; i++) fakeEnts.push({ x: rnd(-15, 15), z: rnd(-15, 15), k: 'player', boss: false, vx: rnd(-2, 2), vz: rnd(-2, 2) });
let t0 = performance.now();
let lastRegion = null;
function tickMinimap() {
  const t = (performance.now() - t0) / 1000;
  if (walk) {
    const a = t * 0.05;
    const nx = 26 + Math.cos(a) * 30;
    const nz = 12 + Math.sin(a) * 22;
    self.ry = Math.atan2(nx - self.x, nz - self.z);
    self.x = nx;
    self.z = nz;
    for (const e of fakeEnts) {
      if (e.k === 'npc') continue;
      e.x += e.vx * 0.2;
      e.z += e.vz * 0.2;
      if (Math.random() < 0.05) { e.vx = rnd(-1.5, 1.5); e.vz = rnd(-1.5, 1.5); }
    }
    const r = regionAt(self.x, self.z).name;
    if (lastRegion && r !== lastRegion && !ui._dev.wm.isOpen('dialog')) ui.showZone(r);
    lastRegion = r;
  }
  ui.updateMinimap({ x: self.x, z: self.z, ry: self.ry, ents: fakeEnts.map(({ x, z, k, boss }) => ({ x, z, k, boss })) });
}
setInterval(tickMinimap, 200);
setInterval(() => ui.setStatus({ ping: Math.round(rnd(28, 95)), fps: Math.round(rnd(57, 61)), online: 12 }), 2000);
// slow regen so bars move
setInterval(() => {
  if (!self || self.dead) return;
  const before = `${self.hp}|${self.mp}`;
  self.hp = Math.min(self.mhp, self.hp + 2);
  self.mp = Math.min(self.mmp, self.mp + 3);
  if (`${self.hp}|${self.mp}` !== before && !document.querySelector('.bv-login:not(.bv-hidden)')) push();
}, 1000);

// ------------------------------------------------------------------ drawer
const panel = document.getElementById('sb-panel');
const sb = document.getElementById('sb');
function section(title, buttons) {
  const hdr = document.createElement('h4');
  hdr.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  for (const [label, fn] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.currentTarget.blur(); fn(); });
    row.appendChild(b);
  }
  panel.append(hdr, row);
}
section('Écrans', [
  ['Connexion', () => ui.showLogin(true)],
  ['Chargement', () => showLoading()],
  ['Erreur login', () => { ui.showLogin(true); ui.setLoginError('Ce personnage est déjà connecté.'); }],
  ['Occupé', () => { ui.showLogin(true); ui.setLoginBusy(true); setTimeout(() => ui.setLoginBusy(false), 2000); }],
  ['Entrer en jeu', () => enterGame()],
]);
section('Cible', [
  ['Loup', () => setTarget('monster')], ['Squelette (dur)', () => setTarget('high')], ['Gluant (facile)', () => setTarget('low')],
  ['Boss', () => setTarget('boss')], ['PNJ', () => setTarget('npc')], ['Joueur', () => setTarget('player')],
  ['Cible morte', () => { setTarget('monster'); target.hp = 0; ui.setTarget({ ...target }); }], ['Aucune', () => setTarget(null)],
]);
section('Personnage', [
  ['−40 PV', () => damage(40)], ['PV bas', () => { self.hp = Math.round(self.mhp * 0.15); push(); }], ['Mana 0', () => { self.mp = 0; push(); }],
  ['Recharges', cooldownsDemo], ['+ XP', () => { self.xp = Math.min(self.xpNext - 1, self.xp + 90); push(); }], ['Niveau +1', levelUp],
  ['+100 po', () => { self.gold += 100; push(); }],
]);
section('Classe', [
  ['Guerrier', () => { self = makeSelf('warrior'); push(); }],
  ['Mage', () => { self = makeSelf('mage'); push(); }],
  ['Rôdeur', () => { self = makeSelf('ranger'); push(); }],
]);
section('Social', [['Chat (tous canaux)', chatBurst], ['Notifications', toastsBurst]]);
section('Fenêtres', [
  ['Ancien (quêtes)', () => openElder('all')], ['Marchande', openShop], ['Sac plein', () => { fillInventory(); ui._dev.wm.open('inventory'); }],
  ['Personnage', () => ui._dev.wm.open('character')], ['Journal', () => ui._dev.wm.open('quests')], ['Aide', () => ui._dev.wm.open('help')],
  ['Fermer tout', () => { ui._dev.wm.closeAll(); ui.showDialog(null); }],
]);
section('Événements', [
  ['Mort', die], ['Réapparition', () => handlers.respawn()], ['Zone', () => ui.showZone('Forêt des Murmures')],
  ['Zone sûre', () => ui.showZone('Village de Brumeval')],
]);
const keys = document.createElement('div');
keys.className = 'keys';
keys.textContent = 'Touche ² ou ` : afficher/masquer ce panneau. Jeu simulé : 1-4 capacités, 5/6 potions, Tab cible.';
panel.appendChild(keys);
document.getElementById('sb-toggle').addEventListener('click', () => sb.classList.toggle('open'));
if (params.get('drawer') === '0') sb.style.display = 'none';

// simulate the core's game keys (1-6, Tab, Escape clears target)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') { sb.classList.toggle('open'); return; }
  if (ui.isTyping() || !self || document.querySelector('.bv-login:not(.bv-hidden)')) return;
  const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
  if (m) {
    const n = Number(m[1]);
    if (n <= 4) handlers.ability(n - 1);
    else {
      const ids = n === 5 ? ['potion_hp_l', 'potion_hp_s'] : ['potion_mp_s'];
      const slot = ids.map((id) => self.inv.findIndex((s) => s && s.id === id)).find((i) => i >= 0);
      if (slot != null && slot >= 0) handlers.useItem(slot);
      else ui.notify(n === 5 ? 'Aucune potion de soin.' : 'Aucune potion de mana.', 'error');
    }
  } else if (e.code === 'Tab') {
    e.preventDefault();
    const order = ['low', 'monster', 'high', 'boss'];
    const i = target ? order.indexOf(Object.keys(TARGETS).find((k) => TARGETS[k].id === target.id)) : -1;
    setTarget(order[(i + 1) % order.length]);
  } else if (e.code === 'Escape') setTarget(null);
});

// ------------------------------------------------------------------ initial scene
const scene = params.get('scene') || 'login';
function inGame() {
  enterGame();
  setTarget('monster');
  chatBurst();
}
switch (scene) {
  case 'login': ui.showLogin(true); setTimeout(() => document.querySelectorAll('.bv-login .bv-tab')[0]?.click(), 50); break;
  case 'login-error': ui.showLogin(true); setTimeout(() => { document.querySelectorAll('.bv-login .bv-tab')[0]?.click(); ui.setLoginError('Nom ou mot de passe incorrect.'); }, 80); break;
  case 'login-busy': ui.showLogin(true); setTimeout(() => { document.querySelectorAll('.bv-login .bv-tab')[0]?.click(); ui.setLoginBusy(true); }, 80); break;
  case 'create': ui.showLogin(true); setTimeout(() => document.querySelectorAll('.bv-login .bv-tab')[1]?.click(), 50); break;
  case 'loading': ui.setLoading(0.62, 'Chargement des modèles… golem.glb (14/24)'); break;
  case 'loading-anim': showLoading(() => ui.showLogin(true)); break;
  case 'hud': inGame(); break;
  case 'boss': inGame(); setTarget('boss'); break;
  case 'npc': inGame(); setTarget('npc'); break;
  case 'player': inGame(); setTarget('player'); break;
  case 'elder': inGame(); setTarget('npc'); openElder('all'); break;
  case 'elder-detail': inGame(); openElder('all'); setTimeout(() => document.querySelector('.bv-dlg-q')?.click(), 50); break;
  case 'shop': inGame(); setTarget('npc'); openShop(); break;
  case 'death': inGame(); die(); break;
  case 'zone': inGame(); ui.showZone('Forêt des Murmures'); break;
  case 'level': inGame(); levelUp(); break;
  case 'inventory': inGame(); ui._dev.wm.open('inventory'); break;
  case 'character': inGame(); ui._dev.wm.open('character'); break;
  case 'quests': inGame(); ui._dev.wm.open('quests'); break;
  case 'help': inGame(); ui._dev.wm.open('help'); break;
  case 'chat': inGame(); setTimeout(() => ui._dev.chat.open('/w Ysaline '), 50); break;
  case 'toasts': inGame(); toastsBurst(); break;
  case 'events': inGame(); toastsBurst(); ui.showZone('Forêt des Murmures'); levelUp(); break;
  case 'cooldowns': inGame(); cooldownsDemo(); break;
  case 'context': inGame(); ui._dev.wm.open('inventory'); openShop(); break;
  default: ui.showLogin(true);
}
