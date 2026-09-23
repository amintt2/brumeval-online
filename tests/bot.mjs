#!/usr/bin/env node
// End-to-end multiplayer test (SPEC §4.14). Starts the real server on a random port with a temporary
// data directory, drives two headless clients through the core gameplay loop and exits 0 / 1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/src/index.js';
import { NPC_SPAWNS, SPAWN_POINT } from '../shared/world.js';
import { ITEMS, START_GOLD, CLASSES } from '../shared/data.js';
import { Bot, sleep, collisionWorld } from './lib/botClient.mjs';
// [combat-souls]
import { PLAYER_RADIUS } from '../shared/protocol.js';
import { ROLL } from '../shared/combat.js';
import { telegraphs } from '../server/src/systems/telegraph.js';
import { damagePlayer } from '../server/src/systems/players.js';

const T0 = performance.now();
const DEADLINE_MS = 85_000;
const PASSWORD = 'motdepasse';
const NAME_A = 'BotAlpha';
const NAME_B = 'BotBêta';

let step = 0;
const log = (msg) => console.log(`[bot ${((performance.now() - T0) / 1000).toFixed(1).padStart(5)} s] ${msg}`);
function ok(cond, msg) {
  if (!cond) throw new Error(`échec : ${msg}`);
  log(`✔ ${++step}. ${msg}`);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-bot-'));
let server = null;
const bots = [];

const watchdog = setTimeout(() => {
  console.error(`[bot] ÉCHEC : délai global de ${DEADLINE_MS / 1000} s dépassé`);
  process.exit(1);
}, DEADLINE_MS);

const npcId = (bot, key) => [...bot.ents.values()].find((e) => e.k === 'npc' && e.nk === key)?.id;
const invCount = (self, id) => self.inv.reduce((n, s) => n + (s && s.id === id ? s.q : 0), 0);

async function main() {
  server = await startServer({ port: 0, dataDir, staticDir: path.join(dataDir, 'pas-de-client'), quiet: true });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  log(`serveur de test sur le port ${server.port} (données : ${dataDir})`);

  // ---------------------------------------------------------------- connections & auth
  const A = await new Bot(url, 'A').connect(); bots.push(A);
  const B = await new Bot(url, 'B').connect(); bots.push(B);

  // messages before auth are ignored
  A.send({ t: 'chat', text: 'avant connexion' });
  A.send({ t: 'move', x: 50, z: 50 });
  A.send({ t: 'nimportequoi' });
  A.ws.send('{pas du json');
  const pong = await (async () => { const from = A.mark(); A.send({ t: 'ping', c: 42 }); return A.waitType('pong', (m) => m.c === 42, { from }); })();
  ok(pong.c === 42 && typeof pong.s === 'number', 'ping/pong avant authentification, messages non autorisés ignorés');

  const bad = await A.register('x', PASSWORD, 'mage');
  ok(bad.t === 'auth_err' && bad.code === 'bad_name', 'nom invalide refusé (bad_name)');

  const authA = await A.register(NAME_A, PASSWORD, 'mage');
  ok(authA.t === 'auth_ok' && authA.id > 0 && authA.self.name === NAME_A, `A enregistré (auth_ok, id ${authA.id})`);
  const s0 = authA.self;
  ok(s0.level === 1 && s0.gold === START_GOLD && s0.eq.weapon === CLASSES.mage.start.weapon && s0.eq.armor === 'leather_tunic'
    && invCount(s0, 'potion_hp_s') === 2 && invCount(s0, 'potion_mp_s') === 2 && s0.inv.length === 24
    && s0.x === SPAWN_POINT.x && s0.z === SPAWN_POINT.z && s0.dead === false && s0.abilities[0] === 'firebolt',
  'nouveau personnage : niveau 1, or de départ, équipement et objets de classe, position de départ');

  const taken = await B.register('botalpha', PASSWORD, 'warrior');
  ok(taken.t === 'auth_err' && taken.code === 'name_taken', 'nom déjà pris, insensible à la casse (name_taken)');
  const authB = await B.register(NAME_B, PASSWORD, 'warrior');
  ok(authB.t === 'auth_ok' && authB.self.cls === 'warrior', `B enregistré (auth_ok, id ${authB.id})`);

  const C = await new Bot(url, 'C').connect(); bots.push(C);
  const dup = await C.login(NAME_A.toLowerCase(), PASSWORD);
  ok(dup.t === 'auth_err' && dup.code === 'already_online', 'une seule session par compte (already_online)');
  const wrong = await C.login(NAME_A, 'mauvais');
  ok(wrong.t === 'auth_err' && wrong.code === 'wrong_credentials', 'mauvais mot de passe refusé (wrong_credentials)');
  await C.close();

  // ---------------------------------------------------------------- visibility
  await B.waitFor((m) => m.t === 'snap' && m.ents.some((e) => e.id === A.id && e.k === 'player' && e.n === NAME_A && e.c === 'mage' && e.lv === 1),
    { from: 0, timeout: 3000, desc: 'A dans un snap de B' });
  ok(true, 'B voit A dans un snap (champs statiques k/n/c/lv présents)');
  // [netcode-perf] field-level deltas: A moves a little, B's next snap only carries A's changed fields
  const fromMove = B.mark();
  A.x += 0.5;
  A.send({ t: 'move', x: +A.x.toFixed(2), z: +A.z.toFixed(2), ry: 0 });
  const snapB = await B.waitType('snap', (m) => m.ents.some((e) => e.id === A.id), { timeout: 2000, from: fromMove });
  const entA = snapB.ents.find((e) => e.id === A.id);
  ok(entA.k === undefined && entA.n === undefined && typeof entA.x === 'number' && entA.hp === undefined && entA.mhp === undefined,
    'règle delta : champs statiques et dynamiques inchangés absents des snaps suivants');
  const mergedA = B.ents.get(A.id);
  ok(mergedA && mergedA.n === NAME_A && typeof mergedA.hp === 'number' && Math.abs(mergedA.x - A.x) < 0.06, 'fusion champ par champ côté client');
  ok(B.ents.has(B.id) && typeof snapB.tod === 'number' && snapB.on === 2, 'snap : propre entité connue, tod et on=2');

  // ---------------------------------------------------------------- chat
  let from = B.mark();
  A.send({ t: 'chat', text: '  Bonjour à tous !  ' });
  const g = await B.waitType('chat', (m) => m.ch === 'global', { from });
  ok(g.from === NAME_A && g.text === 'Bonjour à tous !', 'chat global reçu par B');

  from = B.mark();
  const fromA = A.mark();
  A.send({ t: 'chat', text: `/w ${NAME_B.toUpperCase()} Salut en privé` });
  const wIn = await B.waitType('chat', (m) => m.ch === 'whisper_in', { from });
  const wOut = await A.waitType('chat', (m) => m.ch === 'whisper_out', { from: fromA });
  ok(wIn.from === NAME_A && wIn.text === 'Salut en privé' && wOut.to === NAME_B, 'chuchotement : whisper_in chez B, whisper_out chez A');

  let fa = A.mark();
  A.send({ t: 'chat', text: '/w Personne coucou' });
  const wErr = await A.waitType('err', () => true, { from: fa });
  ok(wErr.code === 'no_target', 'chuchotement vers un joueur hors ligne : erreur');

  fa = A.mark();
  A.send({ t: 'chat', text: '/who' });
  const who = await A.waitType('chat', (m) => m.ch === 'system' && m.text.includes(NAME_B), { from: fa });
  ok(who.text.startsWith('2 joueurs en ligne'), '/who liste les joueurs en ligne');

  // ---------------------------------------------------------------- elder: quest
  const elder = NPC_SPAWNS.find((n) => n.key === 'elder');
  const elderId = npcId(A, 'elder');
  ok(elderId > 0, `l'ancien est visible (id ${elderId})`);
  fa = A.mark();
  A.send({ t: 'interact', id: elderId });
  const far = await A.waitType('err', () => true, { from: fa });
  ok(far.code === 'too_far', 'interaction hors de portée refusée (too_far)');

  await A.walkPath([[-3, 2.5], [elder.x + 0.5, elder.z + 2.5]]);
  fa = A.mark();
  A.send({ t: 'interact', id: elderId });
  const dlg = await A.waitType('dialog', () => true, { from: fa });
  ok(dlg.id === elderId && dlg.npc === 'elder' && dlg.shop === null && dlg.quests.length === 1
    && dlg.quests[0].q === 'q_slimes' && dlg.quests[0].state === 'available', 'dialogue de l\'ancien : q_slimes disponible');
  fa = A.mark();
  A.send({ t: 'quest_accept', id: elderId, q: 'q_slimes' });
  const qn = await A.waitType('notify', (m) => m.kind === 'quest', { from: fa });
  await A.waitFor(() => A.self.quests.q_slimes?.state === 'active', { from: fa, desc: 'self.quests' });
  ok(qn.text === 'Quête acceptée : Nuisance gluante' && A.self.quests.q_slimes.n === 0, 'quête acceptée (notify + self.quests)');

  // ---------------------------------------------------------------- merchant: buy
  const merchant = NPC_SPAWNS.find((n) => n.key === 'merchant');
  await A.walkPath([[-3, 2.5], [merchant.x - 2.7, merchant.z - 0.9]]);
  const closed = A.history.slice(fa).some((m) => m.t === 'close_dialog');
  ok(closed, 'close_dialog reçu en s\'éloignant de l\'ancien');
  const merchantId = npcId(A, 'merchant');
  fa = A.mark();
  A.send({ t: 'interact', id: merchantId });
  const shop = await A.waitType('dialog', () => true, { from: fa });
  ok(Array.isArray(shop.shop) && shop.shop.includes('potion_hp_s'), 'dialogue de la marchande avec boutique');
  const potionsBefore = invCount(A.self, 'potion_hp_s');
  const goldBefore = A.self.gold;
  fa = A.mark();
  A.send({ t: 'buy', id: merchantId, item: 'potion_hp_s', qty: 1 });
  await A.waitFor(() => A.self.gold === goldBefore - ITEMS.potion_hp_s.price && invCount(A.self, 'potion_hp_s') === potionsBefore + 1,
    { from: fa, desc: 'achat appliqué' });
  ok(true, `potion achetée (or ${goldBefore} → ${A.self.gold})`);
  fa = A.mark();
  A.send({ t: 'buy', id: merchantId, item: 'steel_sword', qty: 1 });
  const noGold = await A.waitType('err', () => true, { from: fa });
  ok(noGold.code === 'no_gold', 'achat trop cher refusé (no_gold)');

  // safe zone
  fa = A.mark();
  A.send({ t: 'ability', slot: 0, tg: [...A.ents.values()].find((e) => e.k === 'monster')?.id ?? 999999 });
  const safe = await A.waitType('err', () => true, { from: fa });
  ok(safe.code === 'safe_zone' || safe.code === 'no_target', `pas de combat dans le village (${safe.code})`);

  // ---------------------------------------------------------------- walk to the east plains
  const correctionsBefore = A.corrections;
  await A.walkPath([[20, 6], [45, 18], [50, 22]]);
  ok(A.corrections === correctionsBefore, `A a marché jusqu'aux Plaines d'Émeraude sans correction (${Math.hypot(A.x, A.z).toFixed(0)} m du centre)`);

  // server position matches
  await sleep(250);
  const selfEnt = A.ents.get(A.id);
  ok(selfEnt && Math.hypot(selfEnt.x - A.x, selfEnt.z - A.z) < 0.6, 'position serveur de A synchronisée');

  // speed hack
  fa = A.mark();
  A.send({ t: 'move', x: A.x + 25, z: A.z + 3, ry: 0 });
  const corr = await A.waitType('correct', () => true, { from: fa, timeout: 2000 });
  ok(Math.hypot(corr.x - A.x, corr.z - A.z) < 0.6, 'déplacement trop rapide (speed-hack) → correct');
  await sleep(300);

  // ---------------------------------------------------------------- fight a slime with the auto-attack
  const xpBefore = A.self.xp;
  let killed = null;
  const tried = new Set();
  for (let attempt = 0; attempt < 5 && !killed; attempt++) {
    const slime = [...A.ents.values()]
      .filter((e) => e.mt === 'slime' && e.s !== 2 && !tried.has(e.id))
      .sort((a, b) => Math.hypot(a.x - A.x, a.z - A.z) - Math.hypot(b.x - A.x, b.z - A.z))[0];
    if (!slime) throw new Error('aucun gluant visible');
    tried.add(slime.id);
    log(`cible : gluant #${slime.id} niv. ${slime.lv} à ${Math.hypot(slime.x - A.x, slime.z - A.z).toFixed(1)} m`);
    killed = await fight(A, slime.id);
  }
  ok(killed, 'gluant tué avec la capacité 0 (auto-attaque)');
  const xpMsg = A.history.slice(killed.index).find((m) => m.t === 'notify' && m.kind === 'xp');
  await A.waitFor(() => A.self.xp > xpBefore, { from: killed.index, desc: 'xp augmentée' });
  ok(xpMsg && /^\+\d+ XP$/.test(xpMsg.text) && A.self.xp > xpBefore, `XP gagnée (${xpMsg?.text}, xp ${xpBefore} → ${A.self.xp})`);
  const qp = await A.waitFor((m) => m.t === 'notify' && m.kind === 'quest' && m.text.startsWith('Gluants éliminés'), { from: killed.index, desc: 'progression de quête' });
  await A.waitFor(() => A.self.quests.q_slimes?.n === 1, { from: killed.index, desc: 'self.quests progress' });
  ok(qp.text === 'Gluants éliminés : 1/8' && A.self.quests.q_slimes.state === 'active', `progression de quête : « ${qp.text} »`);
  const goldAfterKill = A.self.gold;
  ok(A.history.slice(killed.index).some((m) => m.t === 'notify' && m.kind === 'gold'), `or ramassé (${goldAfterKill} po)`);
  await A.waitFor((m) => m.t === 'snap' && m.gone.includes(killed.id), { from: killed.index, timeout: 7000, desc: 'gone du cadavre' });
  ok(true, 'cadavre retiré (gone) après CORPSE_TIME_S');

  // ---------------------------------------------------------------- [combat-souls] telegraphs & dodge roll
  await soulsChecks(A);

  // ---------------------------------------------------------------- relogin keeps progress
  await sleep(150);
  const before = { level: A.self.level, xp: A.self.xp, gold: A.self.gold, quests: JSON.stringify(A.self.quests), inv: JSON.stringify(A.self.inv) };
  const oldId = A.id;
  let fb = B.mark();
  await A.close();
  await B.waitFor((m) => m.t === 'chat' && m.ch === 'system' && m.text.includes(NAME_A) && m.text.includes('quitté'), { from: fb, desc: 'message de départ' });
  // with snapshot deltas an unchanged entity is simply omitted: only `gone` proves the departure
  await B.waitFor((m) => m.t === 'snap' && m.gone.includes(oldId), { from: fb, desc: 'gone de A' });
  ok(!B.ents.has(oldId), 'B reçoit le départ de A (message système + gone)');

  const A2 = await new Bot(url, 'A2').connect(); bots.push(A2);
  const re = await A2.login(NAME_A, PASSWORD);
  ok(re.t === 'auth_ok' && re.id !== oldId, `reconnexion de A (nouvel id ${re.id})`);
  const s = re.self;
  ok(s.level === before.level && s.xp === before.xp && s.gold === before.gold, `progression conservée (niv. ${s.level}, ${s.xp} XP, ${s.gold} po)`);
  ok(JSON.stringify(s.quests) === before.quests && JSON.stringify(s.inv) === before.inv, 'quêtes et inventaire conservés');
  ok(Math.hypot(s.x - A.x, s.z - A.z) < 1.5, 'position conservée');

  // robustness: malformed messages never break the session
  for (const junk of [{ t: 'ability', slot: 'x' }, { t: 'move', x: 'NaN' }, { t: 'use_item', slot: 99 }, { t: 'buy', id: {}, item: [] },
    { t: 'chat', text: 12 }, { t: 'equip', slot: -1 }, { t: 'unequip', slot: 'tete' }, { t: 'quest_accept', id: 1, q: '__proto__' }, { t: 'constructor' }]) A2.send(junk);
  from = A2.mark();
  A2.send({ t: 'ping', c: 7 });
  await A2.waitType('pong', (m) => m.c === 7, { from });
  ok(true, 'messages malformés ignorés, session toujours active');

  await server.store.flush(); // [netcode-perf] one file per account, written in the background
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'accounts', `${NAME_A.toLowerCase()}.json`), 'utf8'));
  ok(persisted.chars[0].xp === before.xp && !('password' in persisted) && typeof persisted.hash === 'string' && !('hash' in persisted.chars[0]),
    'accounts/<nom>.json écrit (xp persistée, mot de passe haché uniquement)');

  await accountsFlow(url, A2);
}

/**
 * [accounts] Account -> character -> play -> char_logout -> second character of another class -> play ->
 * reconnect with the remembered-session token (docs/COMPTES.md).
 */
async function accountsFlow(url, watcher) {
  const D = await new Bot(url, 'D').connect(); bots.push(D);
  let r = await D.req({ t: 'register', name: 'CompteBot', password: PASSWORD, remember: true });
  ok(r.t === 'account_ok' && r.chars.length === 0 && /^[A-Za-z0-9_-]{43}$/.test(r.token || ''), 'compte créé sans personnage, jeton « Rester connecté » reçu');
  let token = r.token;
  r = await D.req({ t: 'char_create', name: 'BotGuerrier', cls: 'warrior' });
  ok(r.t === 'account_ok' && r.chars.length === 1 && r.created === r.chars[0].id && r.chars[0].level === 1, 'premier personnage créé (guerrier)');
  const warriorId = r.created;
  r = await D.req({ t: 'char_select', id: warriorId });
  ok(r.t === 'auth_ok' && r.self.name === 'BotGuerrier' && r.self.cls === 'warrior', 'char_select → auth_ok, le guerrier entre dans le monde');
  const firstId = r.id;
  await watcher.waitType('snap', (m) => m.ents.some((e) => e.id === firstId), { timeout: 4000 });
  await D.walkTo(D.x + 3, D.z + 1.5, { stop: 0.2 });
  const walked = { x: D.x, z: D.z };
  ok(D.corrections === 0, `le guerrier marche (${walked.x.toFixed(1)}, ${walked.z.toFixed(1)}) sans correction`);
  let from = watcher.mark();
  r = await D.req({ t: 'char_logout' });
  ok(r.t === 'account_ok' && r.account.lastChar === warriorId, 'char_logout → retour à la sélection (account_ok)');
  await watcher.waitType('snap', (m) => m.gone.includes(firstId), { from, timeout: 4000 });
  ok(!server.game.players.has(firstId), 'le guerrier a quitté le monde (entité retirée pour les autres)');

  r = await D.req({ t: 'char_create', name: 'BotRodeuse', cls: 'ranger' });
  ok(r.t === 'account_ok' && r.chars.length === 2, 'deuxième personnage créé sur le même compte (rôdeuse)');
  const rangerId = r.created;
  r = await D.req({ t: 'char_select', id: rangerId });
  ok(r.t === 'auth_ok' && r.self.cls === 'ranger' && r.self.abilities[0] !== 'firebolt' && r.self.level === 1, 'la rôdeuse joue (autre classe, autres compétences)');
  from = D.mark();
  D.send({ t: 'chat', text: 'Bonjour de la rôdeuse' });
  await watcher.waitType('chat', (m) => m.from === 'BotRodeuse', { timeout: 4000 });
  ok(true, 'la rôdeuse parle dans le chat global');
  r = await D.req({ t: 'char_select', id: 'zzzzzzzz' }, ['account_err']);
  ok(r.code === 'not_found', 'identifiant de personnage étranger refusé');
  await D.close();

  const E = await new Bot(url, 'E').connect(); bots.push(E);
  r = await E.req({ t: 'login_token', token });
  ok(r.t === 'account_ok' && r.method === 'token' && r.chars.length === 2 && r.account.lastChar === rangerId && r.token && r.token !== token,
    'reconnexion par jeton : sélection des personnages, dernier joué retenu, jeton renouvelé');
  const stale = await new Bot(url, 'F').connect(); bots.push(stale);
  ok((await stale.req({ t: 'login_token', token })).code === 'bad_token', 'l’ancien jeton ne fonctionne plus');
  token = r.token;
  r = await E.req({ t: 'char_select', id: warriorId });
  ok(r.t === 'auth_ok' && Math.hypot(r.self.x - walked.x, r.self.z - walked.z) < 1.5, 'le guerrier retrouve sa position');
  r = await E.req({ t: 'logout' });
  ok(r.t === 'logged_out' && (await stale.req({ t: 'login_token', token })).code === 'bad_token', 'déconnexion : jeton révoqué');
}


/**
 * [combat-souls] A telegraphed attack is resolved at impact against the positions of that moment:
 * rolling out of it avoids the damage (and the roll is never corrected by the server), staying in it hurts.
 */
async function soulsChecks(A) {
  const game = server.game;
  A.send({ t: 'stop' });
  await sleep(1600); // stamina back to full, auto-attack stopped
  const cw = collisionWorld();
  // a free direction for a full 5 m roll
  let dir = null;
  for (let i = 0; i < 16 && !dir; i++) {
    const a = (i / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    let x = A.x, z = A.z;
    for (let k = 0; k < 10; k++) { const r = cw.move(x, z, x + dx * 0.5, z + dz * 0.5, PLAYER_RADIUS); x = r.x; z = r.z; }
    if (Math.hypot(x - A.x, z - A.z) > ROLL.dist - 0.05) dir = { dx, dz };
  }
  ok(dir, 'direction de roulade libre trouvée');
  const src = [...game.monsters.values()].find((m) => !m.dead && !m.invulnerable);
  const serverA = game.players.get(A.id);
  const startTele = (x, z) => telegraphs(game).start(src, { shape: 'circle', x, z, r: 2.2 }, 900, {
    ab: 'bot_test', onHit: (p) => damagePlayer(game, p, src, 7, false, 'bot_test'),
  });
  // 1) roll out of the circle
  const corr0 = A.corrections;
  let fa = A.mark();
  startTele(A.x, A.z);
  const tele = await A.waitType('tele', (m) => m.ab === 'bot_test', { from: fa });
  ok(tele.shape === 'circle' && tele.ms === 900, 'télégraphe reçu (cercle, 900 ms)');
  await sleep(250);
  await A.roll(dir.dx, dir.dz);
  await sleep(900);
  ok(!A.history.slice(fa).some((m) => m.t === 'dmg' && m.tg === A.id && m.ab === 'bot_test'), 'roulade hors de la zone : aucun dégât');
  ok(A.corrections === corr0, 'la roulade ne provoque aucune correction de position');
  ok(Math.hypot(serverA.x - A.x, serverA.z - A.z) < 0.6, 'position serveur après la roulade synchronisée');
  // 2) stay in it
  await sleep(1200);
  fa = A.mark();
  startTele(A.x, A.z);
  const hit = await A.waitType('dmg', (m) => m.tg === A.id && m.ab === 'bot_test', { from: fa, timeout: 3000 });
  ok(hit.v === 7, 'rester dans la zone : touché à l\'impact');
  ok(typeof A.self.st === 'number' && A.self.mst === 100, `endurance dans SelfState (${A.self.st}/${A.self.mst})`);
}

/** Engage a slime with slot 0 only; returns { id, index } on death, null if lost. */
async function fight(A, targetId) {
  const range = 16; // firebolt range 18
  const from = A.mark();
  let started = false;
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    const death = A.history.slice(from).findIndex((m) => m.t === 'death' && m.id === targetId);
    if (death >= 0) return { id: targetId, index: from + death };
    const e = A.ents.get(targetId);
    if (!e) return null;
    const d = Math.hypot(e.x - A.x, e.z - A.z);
    if (d > range) {
      const k = (d - range + 1) / d;
      try {
        await A.walkTo(A.x + (e.x - A.x) * k, A.z + (e.z - A.z) * k, { stop: 0.2, maxMs: 8000 });
      } catch (err) {
        log(`approche impossible (${err.message}), autre cible`);
        A.send({ t: 'stop' });
        return null;
      }
    } else if (!started) {
      A.send({ t: 'ability', slot: 0, tg: targetId });
      started = true;
      log(`auto-attaque lancée sur #${targetId}`);
    }
    await sleep(100);
  }
  return null;
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`[bot] ÉCHEC : ${err.stack || err.message}`);
} finally {
  for (const b of bots) await Promise.race([b.close(), sleep(500)]);
  if (server) await server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  clearTimeout(watchdog);
}
const secs = ((performance.now() - T0) / 1000).toFixed(1);
if (failed) {
  console.error(`[bot] ÉCHEC après ${secs} s`);
  process.exit(1);
}
console.log(`[bot] SUCCÈS : ${step} vérifications en ${secs} s`);
process.exit(0);
