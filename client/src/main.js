// Brumeval Online — client bootstrap: renderer + world, asset loading, networking, input, game loop.
import * as THREE from 'three';
import { createUI } from './ui/index.js';
import { C2S, S2C, FX, KIND, CHAT_MAX_LEN } from '@shared/protocol.js';
import { terrainHeight, regionAt, generateWorldObjects, REGIONS } from '@shared/world.js';
import { CollisionWorld } from '@shared/collision.js';
import { URLP, AUTOLOGIN_PASSWORD } from './config.js';
import { Connection } from './net.js';
import { GameState, EntityRecord } from './state.js';
import { createRenderer, createCamera, Environment } from './render/scene.js';
import { Graphics } from './render/graphics.js'; // [render-souls]
import { AssetLibrary } from './render/assets.js';
import { WorldObjects } from './render/worldObjects.js';
import { EntityRenderer } from './render/entities.js';
import { Effects } from './render/effects.js';
import { LabelLayer } from './render/labels.js';
import { updateSeeThrough } from './render/seeThrough.js';
import { Audio } from './audio.js';
import { Input } from './game/input.js';
import { OrbitCamera } from './game/camera.js';
import { LocalPlayer } from './game/player.js';
import { Targeting } from './game/targeting.js';
// [combat-souls]
import { ABILITIES, MONSTERS } from '@shared/data.js';
import { unlockedAbilities } from '@shared/skills.js'; // [skilltree]
import { Telegraphs } from './render/telegraphs.js';
import { EchoRenderer } from './render/echo.js';
// [accounts] accounts, characters, remembered sessions, passkeys (docs/COMPTES.md)
import { store as accountStore, launcherQuit, canQuit } from './account/session.js';
import { passkeysSupported, createPasskey, usePasskey, passkeyErrorText, defaultPasskeyLabel } from './account/passkey.js';
import { CharPreview } from './render/charPreview.js';

const canvas = document.getElementById('game');
const labelsRoot = document.getElementById('labels');
const uiRoot = document.getElementById('ui-root');

const AUTH_ERRORS = {
  bad_token: '', // [accounts] expired / revoked remembered session: back to the login form, no error
  bad_name: 'Nom invalide (3 à 16 lettres, chiffres ou _).',
  bad_password: 'Mot de passe invalide (4 à 64 caractères).',
  bad_class: 'Classe invalide.',
  name_taken: 'Ce nom est déjà pris.',
  wrong_credentials: 'Nom ou mot de passe incorrect.',
  already_online: 'Ce personnage est déjà connecté.',
  server_full: 'Le serveur est plein.',
  bad_request: 'Requête invalide.',
};

function fatal(msg) {
  const el = document.getElementById('fatal');
  const m = document.getElementById('fatal-msg');
  if (m) m.textContent = msg;
  if (el) el.style.display = 'flex';
}

// Yield so the loading screen can paint (rAF), without stalling in a background tab (rAF is paused there).
const nextFrame = () => new Promise((r) => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(go);
  setTimeout(go, 50);
});

// ------------------------------------------------------------------ state shared by the module
const state = new GameState();
if (URLP.tod !== null) state.todFrozen = URLP.tod;
const audio = new Audio();
let renderer, scene, camera, env, water, world, entities, effects, labels, orbit, player, targeting, input, collision, assets;
let telegraphs, echoFx; // [combat-souls]
const bossSeen = new Map(); // [combat-souls] boss id -> last time it fought the local player (ms)
let gfx; // [render-souls] graphics orchestrator (settings, post-processing, terrain, grass…)
let fake = null;
let ping = 0;
let rtt = 0; // smoothed round trip (telegraph lead, see Telegraphs.add)
let fps = 60;
let kickMsg = null;
let autoMode = null;
let pendingAuth = null;
let lastZone = null;
// [accounts]
let account = null;        // last account_ok
let switching = false;     // char_logout sent from the world: the next account_ok leaves it
let pendingPasskey = null; // { purpose: 'login' | 'register', remember }
let charPreview = null;
let autoRelogin = false;   // one silent token login after a lost connection

const conn = new Connection({
  onMessage: (m) => onMessage(m),
  onClose: () => onDisconnect(),
});

function send(msg) {
  return conn.send(msg);
}

function notify(text, kind = 'info') {
  ui.notify(text, kind);
  if (kind === 'error') audio.play('error');
}

// ------------------------------------------------------------------ UI handlers
const handlers = {
  // [accounts] `remember` present = accounts flow (account_ok → character selection); absent = legacy direct entry
  login(name, password, remember) {
    const msg = { t: C2S.LOGIN, name: String(name || '').trim(), password: String(password || '') };
    if (typeof remember === 'boolean') msg.remember = remember;
    startAuth(msg);
  },
  register(name, password, remember, cls) {
    const msg = { t: C2S.REGISTER, name: String(name || '').trim(), password: String(password || '') };
    if (typeof remember === 'boolean') msg.remember = remember;
    if (cls) msg.cls = cls; // legacy: account + first character + direct entry
    startAuth(msg);
  },
  passkeyLogin(remember) {
    if (!passkeysSupported()) {
      ui.setLoginError('Votre navigateur ne prend pas en charge les clés d’accès.');
      return;
    }
    pendingPasskey = { purpose: 'login', remember: !!remember };
    startAuth({ t: C2S.PASSKEY_LOGIN_OPTIONS });
  },
  charSelect(id) {
    ui.setCharSelectBusy(true);
    accountStore.lastChar = id;
    if (!send({ t: C2S.CHAR_SELECT, id })) connectionLost();
  },
  charCreate(name, cls) {
    ui.setCharCreateBusy(true);
    if (!send({ t: C2S.CHAR_CREATE, name: String(name || '').trim(), cls })) connectionLost();
  },
  charDelete(id, confirm) {
    ui.setCharSelectBusy(true);
    if (!send({ t: C2S.CHAR_DELETE, id, confirm })) connectionLost();
  },
  charLogout() {
    if (!state.inGame) return;
    switching = true;
    send({ t: C2S.CHAR_LOGOUT });
  },
  showCharCreate(show) { ui.showCharCreate(show); },
  logout() {
    accountStore.token = null;
    if (!send({ t: C2S.LOGOUT })) backToLogin();
  },
  logoutAll() {
    accountStore.token = null;
    if (!send({ t: C2S.LOGOUT_ALL })) backToLogin();
  },
  openAccount() { ui.openAccount(); send({ t: C2S.ACCOUNT_GET }); },
  openOptions() { ui.openOptions(); },
  openMap() { ui.openMap(); },
  passkeyAdd(password = '') {
    if (!passkeysSupported()) {
      reportAccountError('Votre navigateur ne prend pas en charge les clés d’accès.');
      return;
    }
    pendingPasskey = { purpose: 'register' };
    // the server asks for the password again unless it was typed a few minutes ago (reauth_required)
    send(password ? { t: C2S.PASSKEY_REG_OPTIONS, password } : { t: C2S.PASSKEY_REG_OPTIONS });
  },
  passkeyRename(id, label) { send({ t: C2S.PASSKEY_RENAME, id, label }); },
  passkeyDelete(id) { send({ t: C2S.PASSKEY_DELETE, id }); },
  passwordChange(old, password, revokePasskeys = false) { send({ t: C2S.PASSWORD_CHANGE, old, password, revokePasskeys: !!revokePasskeys }); },
  quit() { launcherQuit(); },
  canQuit: () => canQuit(),
  hasTarget: () => !!targeting?.id,
  getAudio: () => ({ volume: audio.volume, muted: audio.muted }),
  setVolume(v) { audio.setVolume(v); },
  setMuted(m) { audio.setMuted(m); },
  previewAttach(el) {
    if (!assets) return false;
    charPreview ||= new CharPreview(assets);
    return charPreview.attach(el);
  },
  previewChar(ch) { charPreview?.show(ch); },
  chat(text) {
    const t = String(text || '').trim().slice(0, CHAT_MAX_LEN);
    if (t) send({ t: C2S.CHAT, text: t });
  },
  ability(slot) {
    targeting?.useAbility(slot);
  },
  useItem(slot) { send({ t: C2S.USE_ITEM, slot }); },
  equip(slot) { send({ t: C2S.EQUIP, slot }); },
  unequip(eqSlot) { send({ t: C2S.UNEQUIP, slot: eqSlot }); },
  drop(slot) { send({ t: C2S.DROP, slot }); },
  sell(slot) {
    const d = state.dialog;
    if (!d || !d.shop) {
      notify('Parlez à un marchand pour vendre vos objets.', 'error');
      return;
    }
    send({ t: C2S.SELL, id: d.id, slot });
  },
  buy(npcId, itemId) { send({ t: C2S.BUY, id: npcId, item: itemId, qty: 1 }); },
  acceptQuest(npcId, questId) { send({ t: C2S.QUEST_ACCEPT, id: npcId, q: questId }); },
  turnInQuest(npcId, questId) { send({ t: C2S.QUEST_TURNIN, id: npcId, q: questId }); },
  respawn() { send({ t: C2S.RESPAWN }); },
  closeDialog() {
    state.dialog = null;
    ui.showDialog(null);
  },
};

const ui = createUI(uiRoot, handlers);

async function startAuth(msg) {
  if (URLP.offline) return;
  pendingAuth = msg;
  ui.setLoginError(null);
  ui.setLoginBusy(true);
  if (!conn.isOpen()) {
    try {
      await conn.connect();
    } catch {
      ui.setLoading(null);
      ui.setLoginBusy(false);
      if (msg.t === C2S.LOGIN_TOKEN) ui.showLogin(true);
      ui.setLoginError('Impossible de joindre le serveur. Réessayez dans un instant.');
      return;
    }
  }
  kickMsg = null;
  send(msg);
}

// ------------------------------------------------------------------ [accounts] account messages
/** Remembered session: straight to the character selection (last played character pre-selected). */
function tokenLogin() {
  const token = accountStore.token;
  if (!token) return false;
  ui.setLoading(1, 'Reconnexion à votre compte…');
  startAuth({ t: C2S.LOGIN_TOKEN, token });
  return true;
}

function onAccount(m) {
  if (m.token) accountStore.token = m.token;
  account = m;
  pendingAuth = null;
  autoRelogin = false;
  ui.setLoading(null);
  ui.setLoginBusy(false);
  ui.setCharSelectBusy(false);
  ui.setCharCreateBusy(false);
  if (m.account?.name) accountStore.login = m.account.name;
  if (m.passkeyAdded) {
    ui.showPasskeyOffer(false);
    accountStore.passkeyOfferDismissed = true;
  }
  if (m.info) {
    if (ui.accountOpen) ui.accountInfo(m.info);
    else if (!state.inGame) ui.setCharSelectInfo(m.info);
    else ui.notify(m.info, 'info');
  }
  if (switching || !state.inGame) {
    if (switching) {
      switching = false;
      leaveGame();
    }
    const preselect = m.created || null;
    ui.showCharCreate(false);
    ui.showCharSelect(true, m, { preselect });
    // after a password login (or a new account) without any passkey: offer one (dismissible, re-offered in Compte)
    if (m.method) {
      const offer = (m.method === 'password' || m.method === 'register') && !(m.account?.passkeys?.length)
        && passkeysSupported() && !accountStore.passkeyOfferDismissed;
      ui.showPasskeyOffer(offer);
    }
    if (m.method && !m.chars?.length) ui.showCharCreate(true); // brand-new account: straight to creation
  } else ui.setAccount(m);
}

function reportAccountError(msg) {
  if (ui.accountOpen) ui.accountError(msg);
  else if (ui.charSelectVisible) ui.setCharSelectError(msg);
  else notify(msg, 'error');
}

function onAccountErr(m) {
  const msg = m.msg || 'Opération refusée.';
  ui.setCharSelectBusy(false);
  ui.setCharCreateBusy(false);
  switch (m.op) {
    case C2S.CHAR_CREATE: ui.setCharCreateError(msg); break;
    case C2S.CHAR_SELECT:
    case C2S.CHAR_DELETE: ui.setCharSelectError(msg); break;
    case C2S.CHAR_LOGOUT: switching = false; notify(msg, 'error'); break;
    case C2S.PASSKEY_REG_OPTIONS:
    case C2S.PASSKEY_REG_VERIFY:
      pendingPasskey = null;
      if (m.code === 'reauth_required' || m.code === 'wrong_credentials') {
        // password needed: the Compte window has the field (the offer on the selection screen leads there)
        if (!ui.accountOpen) handlers.openAccount();
        ui.accountNeedPassword?.();
      }
      reportAccountError(msg);
      break;
    default: reportAccountError(msg);
  }
}

/** Server options for a passkey ceremony: run the browser dialog, send the result. */
async function onPasskeyOptions(m) {
  const pend = pendingPasskey;
  pendingPasskey = null;
  if (!pend || pend.purpose !== m.purpose) return;
  try {
    if (m.purpose === 'login') {
      const resp = await usePasskey(m.options);
      ui.setLoginBusy(true);
      send({ t: C2S.PASSKEY_LOGIN_VERIFY, resp, remember: !!pend.remember });
    } else {
      const resp = await createPasskey(m.options);
      send({ t: C2S.PASSKEY_REG_VERIFY, resp, label: defaultPasskeyLabel() });
    }
  } catch (err) {
    console.info('[passkey]', err?.name || '', err?.message || err);
    const text = passkeyErrorText(err, m.purpose);
    if (m.purpose === 'login') {
      ui.setLoginBusy(false);
      ui.setLoginError(text);
    } else reportAccountError(text);
  }
}

/** Back to the login form (logout, expired session). The socket stays open when it still is. */
function backToLogin(error = null) {
  leaveGame();
  account = null;
  switching = false;
  ui.setLoading(null);
  ui.showLogin(true);
  ui.setLoginError(error);
}

function connectionLost() {
  ui.setCharSelectBusy(false);
  ui.setCharCreateBusy(false);
  backToLogin('Connexion au serveur perdue. Reconnectez-vous.');
}

// ------------------------------------------------------------------ network messages
function onMessage(m) {
  const now = performance.now();
  switch (m.t) {
    case S2C.AUTH_OK:
      enterGame(m);
      break;
    case S2C.AUTH_ERR: {
      if (autoMode && autoMode.stage === 'login' && (m.code === 'wrong_credentials' || m.code === 'unknown' || m.code === 'bad_request')) {
        autoMode.stage = 'register';
        handlers.register(autoMode.name, AUTOLOGIN_PASSWORD, undefined, autoMode.cls);
        return;
      }
      autoMode = null;
      pendingAuth = null;
      ui.setLoading(null);
      ui.setLoginBusy(false);
      if (m.code === 'bad_token') { // [accounts] expired / revoked remembered session
        accountStore.token = null;
        ui.showLogin(true);
        ui.setLoginError(autoRelogin ? 'Connexion au serveur perdue. Reconnectez-vous.' : null);
        autoRelogin = false;
        break;
      }
      if (!ui.charSelectVisible) ui.showLogin(true);
      ui.setLoginError(m.msg || AUTH_ERRORS[m.code] || 'Connexion refusée.');
      break;
    }
    // [accounts]
    case S2C.ACCOUNT_OK:
      onAccount(m);
      break;
    case S2C.ACCOUNT_ERR:
      onAccountErr(m);
      break;
    case S2C.PASSKEY_OPTIONS:
      onPasskeyOptions(m);
      break;
    case S2C.LOGGED_OUT:
      if (m.all) accountStore.token = null;
      backToLogin(m.all ? 'Vous êtes déconnecté de tous vos appareils.' : null);
      break;
    case S2C.SNAP:
      if (state.inGame) state.applySnap(m, now);
      break;
    case S2C.SELF:
      if (state.inGame) state.mergeSelf(m);
      break;
    case S2C.CORRECT:
      if (state.inGame && Number.isFinite(m.x) && Number.isFinite(m.z)) player.correct(m.x, m.z);
      break;
    case S2C.FX:
      if (!state.inGame) break;
      effects.fx(m);
      if (m.k === FX.RESPAWN) {
        const v = entities.get(m.src);
        if (v && v.animator.dead) v.animator.revive();
      }
      break;
    case S2C.DMG:
      if (!state.inGame) break;
      effects.damage(m, state.selfId);
      if (m.tg === state.selfId && state.self) {
        state.self.hp = m.hp;
        ui.setSelf(state.self);
        damageDirection(m); // [combat-souls]
      }
      noteBossFight(m, now); // [combat-souls]
      break;
    case S2C.HEAL:
      if (!state.inGame) break;
      effects.heal(m, state.selfId);
      if (m.tg === state.selfId && state.self) {
        state.self.hp = m.hp;
        ui.setSelf(state.self);
      }
      break;
    case S2C.DEATH: {
      if (!state.inGame) break;
      const rec = state.entities.get(m.id);
      if (rec) {
        if (!rec.dead) rec.deadAt = now;
        rec.s = 2;
        rec.hp = 0;
        rec.dirtyLabel = true;
      }
      effects.death(m.id);
      if (m.id === state.selfId) {
        ui.showDeath(true);
        targeting.clear();
      }
      break;
    }
    case S2C.CD:
      if (m.slot >= 0 && m.slot < 4) {
        state.cooldowns[m.slot] = now + (m.ms || 0);
        ui.setCooldown(m.slot, m.ms || 0);
        // [combat-souls] the server swung the auto-attack: same recovery / stamina as the server
        if (m.slot === 0 && state.self) {
          const ab = ABILITIES[state.self.abilities?.[0]];
          if (ab) { player.commit(ab, now); player.spend(ab.st || 0, now); }
        }
      }
      break;
    case S2C.DIALOG:
      state.dialog = m;
      ui.showDialog(m);
      break;
    case S2C.CLOSE_DIALOG:
      state.dialog = null;
      ui.showDialog(null);
      break;
    case S2C.CHAT:
      ui.addChat({ ch: m.ch, from: m.from, to: m.to, text: m.text });
      break;
    case S2C.NOTIFY:
      ui.notify(m.text, m.kind || 'info');
      if (m.kind === 'loot' || m.kind === 'gold') audio.play('loot');
      else if (m.kind === 'quest') audio.play('quest');
      break;
    case S2C.ERR:
      notify(m.msg || 'Action impossible.', 'error');
      if (m.code === 'no_stamina') ui.staminaEmpty(); // [combat-souls]
      break;
    // [combat-souls] telegraphed attacks
    case S2C.TELE:
      if (state.inGame) telegraphs.add(m, now, rtt);
      break;
    case S2C.TELE_END:
      if (state.inGame) telegraphs.cancel(m.id);
      break;
    case S2C.PONG:
      if (Number.isFinite(m.c)) {
        ping = Math.max(0, Math.round(performance.now() - m.c));
        // smoothed, and a lag spike does not shorten every following telegraph at once
        const sample = Math.min(ping, 400);
        rtt = rtt ? rtt * 0.8 + sample * 0.2 : sample;
      }
      break;
    case S2C.KICK:
      kickMsg = m.msg || 'Vous avez été déconnecté.';
      break;
    default:
      break;
  }
}

function enterGame(m) {
  leaveGame();
  const self = m.self;
  state.inGame = true;
  state.setSelf(m.id, self);
  if (typeof m.tod === 'number') state.tod = m.tod;
  if (typeof m.online === 'number') state.online = m.online;
  // the local player's entity exists right away (snapshots then keep hp/level in sync)
  const rec = new EntityRecord(m.id);
  rec.isSelf = true;
  Object.assign(rec, { k: KIND.PLAYER, n: self.name, c: self.cls, lv: self.level, hp: self.hp, mhp: self.mhp, x: self.x, z: self.z, ry: self.ry || 0 });
  if (self.dead) rec.s = 2;
  state.entities.set(m.id, rec);
  state.emit('add', rec);
  player.reset(self.x, self.z, self.ry || 0);
  player.syncStamina(self.st ?? player.mst, self.mst, performance.now()); // [combat-souls]
  echoFx.set(self.echo || null); // [combat-souls]
  orbit.behind(self.ry || 0);
  orbit.update(0, new THREE.Vector3(self.x, terrainHeight(self.x, self.z), self.z), true);
  autoMode = null;
  pendingAuth = null;
  switching = false;
  ui.setLoading(null);
  ui.setLoginBusy(false);
  ui.setLoginError(null);
  ui.setCharSelectBusy(false);
  ui.showLogin(false);
  ui.showCharSelect(false); // [accounts]
  ui.showCharCreate(false);
  charPreview?.show(null);
  ui.setSelf(state.self);
  ui.setTarget(null);
  ui.showDeath(!!self.dead);
  ui.showDialog(null);
  if (m.motd) ui.addChat({ ch: 'system', text: m.motd });
  lastZone = null;
  input.reset();
  // the login form's input may still own the keyboard focus: give it back to the game
  const a = document.activeElement;
  if (a && a !== document.body && a !== canvas && typeof a.blur === 'function') a.blur();
  canvas.focus({ preventScroll: true });
}

function leaveGame() {
  state.reset();
  entities?.clear();
  effects?.clear();
  labels?.clearTexts();
  if (targeting) targeting.id = 0;
  entities?.setTarget(0);
  // [combat-souls]
  telegraphs?.clear();
  echoFx?.set(null);
  bossSeen.clear();
  ui.setBoss(null);
}

function onDisconnect() {
  const wasInGame = state.inGame;
  const hadAccount = !!account;
  leaveGame();
  autoMode = null;
  account = null;
  switching = false;
  pendingPasskey = null;
  ui.setTarget(null);
  ui.showDeath(false);
  ui.showDialog(null);
  ui.setLoginBusy(false);
  ui.setCharSelectBusy(false);
  ui.setCharCreateBusy(false);
  ui.showLogin(true);
  // [accounts] a dropped connection (server restart, network) with a remembered session: one silent retry
  if (!kickMsg && (wasInGame || hadAccount) && accountStore.token && !autoRelogin) {
    autoRelogin = true;
    pendingAuth = null;
    setTimeout(() => { if (!state.inGame && !conn.isOpen()) tokenLogin(); }, 1500);
    return;
  }
  if (kickMsg) ui.setLoginError(kickMsg);
  else if (wasInGame || pendingAuth || hadAccount) ui.setLoginError('Connexion au serveur perdue. Reconnectez-vous.');
  kickMsg = null;
  pendingAuth = null;
}

// self-state side effects (UI refresh, death overlay, respawn teleport)
state.on('self', (self, changed) => {
  if (!self) return;
  ui.setSelf(self);
  const rec = state.entities.get(state.selfId);
  if (rec) {
    if (rec.lv !== self.level) { rec.lv = self.level; rec.dirtyLabel = true; }
    if (rec.hp !== self.hp || rec.mhp !== self.mhp) { rec.hp = self.hp; rec.mhp = self.mhp; rec.dirtyLabel = true; }
  }
  // [combat-souls] stamina / death echo
  if (changed && ('st' in changed || 'mst' in changed)) player.syncStamina(self.st, self.mst, performance.now());
  if (changed && 'echo' in changed) echoFx?.set(self.echo || null);
  if (changed && 'dead' in changed) {
    ui.showDeath(!!self.dead);
    if (!self.dead) {
      if (rec) rec.s = 0;
      rec?.view?.animator.revive();
      if (Number.isFinite(self.x) && Number.isFinite(self.z) && 'x' in changed) player.correct(self.x, self.z);
    }
  }
});

// ------------------------------------------------------------------ input
function onKey(code, e) {
  if (!state.inGame) return;
  switch (code) {
    case 'Digit1': case 'Numpad1': targeting.useAbility(0); break;
    case 'Digit2': case 'Numpad2': targeting.useAbility(1); break;
    case 'Digit3': case 'Numpad3': targeting.useAbility(2); break;
    case 'Digit4': case 'Numpad4': targeting.useAbility(3); break;
    case 'Digit5': case 'Numpad5': targeting.usePotion(false); break;
    case 'Digit6': case 'Numpad6': targeting.usePotion(true); break;
    case 'Tab': targeting.cycle(); break;
    case 'Escape':
      if (!e.defaultPrevented && targeting.id) {
        targeting.clear();
        send({ t: C2S.STOP });
      }
      break;
    // [accounts] M opens the world map (ui/index.js); the sound is in Options → Son
    default:
      break;
  }
}

// ------------------------------------------------------------------ boot
const bootTimes = {};
window.__boot = bootTimes;
const mark = (k) => { bootTimes[k] = Math.round(performance.now()); };

async function boot() {
  mark('start');
  ui.setLoading(0.02, 'Préparation du monde…');
  try {
    renderer = createRenderer(canvas);
  } catch (err) {
    console.error(err);
    fatal('Votre navigateur ne prend pas en charge WebGL. Activez l’accélération matérielle ou essayez un autre navigateur.');
    return;
  }
  scene = new THREE.Scene();
  scene.name = 'Brumeval';
  camera = createCamera();
  env = new Environment(scene, renderer);
  gfx = new Graphics({ renderer, scene, camera, env }); // [render-souls]
  labels = new LabelLayer(labelsRoot);
  orbit = new OrbitCamera(camera);
  orbit.setOccluders(generateWorldObjects());

  mark('renderer');
  await nextFrame();
  ui.setLoading(0.06, 'Sculpture du terrain…');
  await nextFrame();
  mark('yield');
  // [render-souls] chunked PBR terrain, water, grass, HDRIs (terrain data computed in a worker)
  ({ water } = await gfx.buildWorld((p, text) => ui.setLoading(0.06 + p * 0.06, text)));
  collision = new CollisionWorld();
  mark('terrain');

  assets = new AssetLibrary();
  assets.anisotropy = gfx.anisotropy; // [render-souls]
  ui.setLoading(0.12, 'Chargement des modèles 3D…');
  await assets.loadAll((done, total) => {
    ui.setLoading(0.12 + 0.72 * (done / total), `Chargement des modèles 3D… (${done}/${total})`);
  });

  mark('models');
  ui.setLoading(0.86, 'Placement des arbres et des maisons…');
  await nextFrame();
  world = new WorldObjects(scene, assets);
  world.build();
  gfx.attachWorld(world); // [render-souls]

  entities = new EntityRenderer({ scene, assets, labels }, state);
  player = new LocalPlayer(collision, send);
  // [skilltree] never predict a roll / sprint the server would refuse (not learnt yet: the movement would be corrected)
  let knownTree = null, known = null;
  player.knows = (id) => {
    const self = state.self;
    if (!self?.tree) return true; // older server: everything as before
    if (self.tree !== knownTree) { knownTree = self.tree; known = unlockedAbilities(self.cls, self.tree.alloc, self.tree.gift); }
    return known.has(id);
  };
  effects = new Effects({
    scene,
    entities,
    labels,
    audio,
    state,
    shake: (a, d) => orbit.shake(a, d),
    selfPos: () => (state.inGame ? player : null),
    onAct: (src, tg) => {
      if (src !== state.selfId) return;
      const t = state.entities.get(tg);
      if (t && !player.moving) player.faceTowards(t.x, t.z);
    },
  });
  // [combat-souls] telegraph decals, death echo, local roll animation
  telegraphs = new Telegraphs({ scene, entities });
  echoFx = new EchoRenderer({ scene, effects });
  player.onRoll = () => entities.playAnim(state.selfId, 'Roll');
  for (const s of world.lampSources) if (s.type === 'campfire') effects.addEmitter(s.x, s.y - 0.5, s.z, 'fire');
  // low mist drifting between the graves
  const grave = REGIONS.find((r) => r.id === 'graveyard');
  if (grave) effects.addEmitter(grave.x, 0, grave.z, 'mist', grave.r * 0.6);
  audio.listener = () => (state.inGame ? player : camera.position);

  input = new Input(canvas, {
    isTyping: () => !!ui.isTyping?.(),
    onKey,
    onDodge: () => { if (state.inGame) roll(); }, // Shift tap = dodge roll (hold = sprint)
    onClick: (button, x, y) => targeting.onClick(button, x, y),
    onDrag: (dx, dy) => orbit.rotate(dx, dy),
    onWheel: (dy) => orbit.zoom(dy),
    onHover: (x, y) => targeting.onHover(x, y),
  });
  targeting = new Targeting({ camera, canvas, state, entities, ui, send, player, notify, input, orbit });

  onResize();
  window.addEventListener('resize', onResize);

  mark('world');
  // [render-souls] first launch: quick benchmark → initial graphics preset
  ui.setLoading(0.9, 'Réglage automatique des graphismes…');
  try {
    await gfx.autoDetect();
  } catch (err) {
    console.info('[render] test de performance impossible', err?.message || err);
  }
  // pre-compile shaders (world + one instance of every character model) to avoid hitches later
  ui.setLoading(0.93, 'Compilation des shaders…');
  const warm = new THREE.Group();
  const warmInst = [];
  for (const key of assets.animated.keys()) {
    const inst = assets.instantiate(key);
    inst.object.position.set(0, -50, 0);
    warm.add(inst.object);
    warmInst.push(inst);
  }
  scene.add(warm);
  gfx.update(0.016, 0, state.tod, new THREE.Vector3(), null); // [render-souls]
  await Promise.race([effects.ready, new Promise((r) => setTimeout(r, 4000))]); // [render-souls] flipbook VFX sheets (warmed up below)
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* compileAsync is only an optimisation */
  }
  mark('compiled');
  scene.remove(warm);
  for (const inst of warmInst) assets.disposeInstance(inst);

  exposeDebug();
  timer.connect(document);
  renderer.setAnimationLoop(frame);
  await nextFrame();
  ui.setLoading(1, 'Bienvenue à Brumeval !');
  await nextFrame();
  if (!accountStore.token || URLP.offline || URLP.autologin) ui.setLoading(null); // [accounts] else: kept until the token login answers

  if (assets.missing.length) console.info(`[assets] modèles de remplacement : ${assets.missing.join(', ')}`);

  if (URLP.offline) {
    const { FakeServer } = await import('./offline/fakeServer.js');
    fake = new FakeServer({ cls: URLP.cls, name: URLP.name || 'Voyageur', tod: URLP.tod });
    window.__game.offline = fake;
    ui.showLogin(false);
    // Offline mode never reaches the server: make it impossible to mistake for the real game.
    const banner = document.createElement('a');
    banner.href = location.pathname;
    banner.textContent = 'MODE HORS LIGNE — progression non sauvegardée · cliquer pour jouer en ligne';
    banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:auto;'
      + 'padding:4px 14px;border-radius:0 0 8px 8px;background:#8b1d1d;color:#fff;font:600 13px system-ui,sans-serif;'
      + 'text-decoration:none;box-shadow:0 2px 8px #0008';
    document.body.appendChild(banner);
    conn.connectFake(fake);
  } else {
    ui.setPasskeySupported(passkeysSupported()); // [accounts]
    if (URLP.autologin) {
      ui.showLogin(true);
      autoMode = { name: URLP.autologin, cls: URLP.cls, stage: 'login' };
      handlers.login(URLP.autologin, AUTOLOGIN_PASSWORD); // legacy flow: straight into the world
    } else if (!tokenLogin()) ui.showLogin(true); // [accounts] « Rester connecté »
  }
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  gfx.resize(); // [render-souls] post-processing targets (dynamic resolution)
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  labels.resize(w, h);
  const bufH = h * renderer.getPixelRatio();
  effects.setViewport(bufH, camera);
  world.setViewport(bufH, camera);
  env.sky.setPixelRatio(renderer.getPixelRatio());
}

// ------------------------------------------------------------------ main loop
const timer = new THREE.Timer();
const axes = { fx: 0, fz: 0 };
const fwd = { x: 0, z: 1 };
const focus = new THREE.Vector3();
let fpsFrames = 0, fpsAcc = 0, slowAcc = 0;
let miniAcc = 0, statusAcc = 0, pingAcc = 1.5, zoneAcc = 0;

let simTime = 0;

function frame(ts) {
  if (gfx.skipFrame(ts)) return; // [render-souls] FPS limit
  timer.update(ts);
  step(Math.min(timer.getDelta(), 0.1), performance.now());
}

/** One simulation + render step (also driven manually by __game.advance() for headless debugging). */
function step(dt, now) {
  simTime += dt;
  const time = simTime;

  // fps + adaptive resolution
  fpsFrames++;
  fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsFrames / fpsAcc);
    fpsFrames = 0;
    fpsAcc = 0;
    if (fps < 30 && renderer.getPixelRatio() > 1 && !gfx.settings.dynres) { // [render-souls] dynres handles it
      slowAcc += 0.5;
      if (slowAcc > 4) {
        renderer.setPixelRatio(1);
        onResize();
        console.info('[render] faible fréquence d’images : résolution réduite');
      }
    } else slowAcc = 0;
  }

  state.tickTod(dt);
  const self = state.self;
  if (state.inGame && self) {
    input.axes(axes);
    orbit.forward(fwd);
    player.update(dt, axes, fwd, self.stats?.speed || 6, !self.dead, now, input.sprinting); // [combat-souls] + sprint
    ui.setStamina(player.st, player.mst); // [combat-souls]
    const rec = state.entities.get(state.selfId);
    if (rec) { rec.x = player.x; rec.z = player.z; rec.ry = player.ry; }
    focus.set(player.x, terrainHeight(player.x, player.z), player.z);
    orbit.update(dt, focus);
    updateSeeThrough(camera.position, orbit.focus, orbit.curDist > 2.6 ? 1.45 : 0, time);
  } else {
    orbit.attract(dt);
    focus.set(0, 1.2, 0);
    updateSeeThrough(camera.position, orbit.lookAt, 0, time);
  }

  entities.update(dt * effects.timeScale(now), now, camera, time); // [combat-souls] hitstop
  telegraphs.update(dt, time, now); // [combat-souls]
  echoFx.update(dt, time, state.inGame ? player : null); // [combat-souls]
  if (state.inGame) targeting.syncUi();
  effects.update(dt, time, camera);
  gfx.update(dt, time, state.tod, focus, state.entities); // [render-souls] env, wind, terrain LOD, grass, water
  effects.setAmbient(1 - env.night * 0.72);
  world.update(dt, time, focus, env.night, camera.position);
  gfx.render(time); // [render-souls] HDR post-processing pipeline (or direct rendering)
  labels.update(camera, dt);

  // periodic UI feeds
  if (state.inGame) {
    miniAcc += dt;
    if (miniAcc >= 0.2) { miniAcc = 0; pushMinimap(); updateBossBar(performance.now()); }
    zoneAcc += dt;
    if (zoneAcc >= 0.5) {
      zoneAcc = 0;
      const r = regionAt(player.x, player.z);
      if (r.name !== lastZone) { lastZone = r.name; ui.showZone(r.name); }
    }
    pingAcc += dt;
    if (pingAcc >= 2) { pingAcc = 0; send({ t: C2S.PING, c: Math.round(performance.now()) }); }
  }
  statusAcc += dt;
  if (statusAcc >= 1) {
    statusAcc = 0;
    ui.setStatus({ ping: state.inGame ? ping : 0, fps, online: state.online });
  }
}

function pushMinimap() {
  const ents = [];
  for (const rec of state.entities.values()) {
    if (rec.isSelf || !rec.k || rec.k === KIND.ECHO) continue;
    if (rec.dead && rec.k === KIND.MONSTER) continue;
    ents.push({ x: rec.x, z: rec.z, k: rec.k, boss: !!rec.b });
  }
  ui.updateMinimap({ x: player.x, z: player.z, ry: player.ry, ents, echo: state.self?.echo || null }); // [combat-souls] + echo
}

// ------------------------------------------------------------------ [combat-souls]
const rollAxes = { fx: 0, fz: 0 };
const rollFwd = { x: 0, z: 1 };
/** Shift tap: dodge roll in the movement direction (backwards without input). */
function roll() {
  const self = state.self;
  if (!self || self.dead) return;
  input.axes(rollAxes);
  orbit.forward(rollFwd);
  const now = performance.now();
  if (player.tryRoll(rollAxes, rollFwd, now)) return;
  if (!player.knows('roulade')) {
    const t = performance.now();
    if (t - (roll.hintAt || 0) > 4000) { roll.hintAt = t; notify('Apprenez la Roulade dans l\'arbre des compétences (dès le niveau 2).', 'info'); }
    return;
  }
  if (!player.rolling && player.st < 30) ui.staminaEmpty();
}

/** Red arc on the screen edge pointing to the attacker (relative to the camera). */
function damageDirection(m) {
  const src = state.entities.get(m.src);
  const self = state.self;
  if (!self) return;
  const heavy = self.mhp > 0 && m.v >= self.mhp * 0.15;
  if (!src || src.isSelf) { ui.damageTaken(null, heavy); return; }
  const dx = src.x - player.x, dz = src.z - player.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.05) { ui.damageTaken(null, heavy); return; }
  orbit.forward(rollFwd);
  const front = (dx * rollFwd.x + dz * rollFwd.z) / l;
  const side = (-dx * rollFwd.z + dz * rollFwd.x) / l;
  ui.damageTaken(Math.atan2(side, front), heavy);
}

/** Remember bosses that fight the local player (boss bar). */
function noteBossFight(m, now) {
  if (m.src !== state.selfId && m.tg !== state.selfId) return;
  const other = state.entities.get(m.src === state.selfId ? m.tg : m.src);
  if (other && other.k === KIND.MONSTER && (other.b || MONSTERS[other.mt]?.boss)) bossSeen.set(other.id, now);
}

/** Show the big health bar of the boss we are fighting (targeting us or recently hit / hitting us). */
function updateBossBar(now) {
  let best = null, bestD = 55;
  for (const rec of state.entities.values()) {
    if (rec.k !== KIND.MONSTER || rec.dead || !(rec.b || MONSTERS[rec.mt]?.boss)) continue;
    const d = Math.hypot(rec.x - player.x, rec.z - player.z);
    const engaged = rec.tg === state.selfId || now - (bossSeen.get(rec.id) || -1e9) < 15_000;
    if (engaged && d < bestD) { best = rec; bestD = d; }
  }
  if (!best || state.self?.dead) { ui.setBoss(null); return; }
  const marks = MONSTERS[best.mt]?.ai?.phases || [];
  const ratio = best.mhp > 0 ? best.hp / best.mhp : 1;
  let phase = 1;
  marks.forEach((t, i) => { if (ratio <= t) phase = i + 2; });
  ui.setBoss({ id: best.id, name: best.n, hp: best.hp, mhp: best.mhp, phase, marks });
}

/**
 * Wait about `ms` (debug helpers only). Hidden tabs throttle chained setTimeout to ~1 Hz after a few minutes,
 * so there the wait yields through MessageChannel, which is never throttled.
 */
function debugPause(ms) {
  return new Promise((resolve) => {
    if (!document.hidden) { setTimeout(resolve, ms); return; }
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      if (performance.now() >= end) { ch.port1.close(); resolve(); } else ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  });
}

function exposeDebug() {
  window.__game = {
    state, scene, camera, renderer, entities, effects, labels, env, world, assets, player, orbit, targeting, ui, net: conn,
    get account() { return account; }, accountStore, handlers, get charPreview() { return charPreview; }, // [accounts]
    telegraphs, echo: echoFx, roll, input, // [combat-souls]
    bootTimes,
    get fps() { return fps; },
    get ping() { return ping; },
    send,
    pause: debugPause,
    setTod(v) { state.todFrozen = v === null ? null : ((Number(v) % 1) + 1) % 1; },
    /** Run the game loop manually for `sec` seconds (useful when rAF is paused in a hidden tab). */
    async advance(sec = 1) {
      const end = performance.now() + sec * 1000;
      let last = performance.now();
      while (performance.now() < end) {
        await debugPause(16);
        const now = performance.now();
        step(Math.min(0.1, (now - last) / 1000), now);
        last = now;
      }
    },
    /** Walk (simulated W key, camera steering) to (x, z); runs the loop manually. */
    async walkTo(x, z, stop = 2) {
      for (let k = 0; k < 80; k++) {
        const dx = x - player.x, dz = z - player.z;
        const d = Math.hypot(dx, dz);
        if (d < stop) break;
        orbit.yaw = Math.atan2(-dx, -dz);
        input.held.add('KeyW');
        await this.advance(Math.min(0.5, (d - stop) / Math.max(1, state.self?.stats?.speed || 6) + 0.05));
        input.held.delete('KeyW');
      }
      await this.advance(0.2);
    },
    teleport(x, z) {
      if (!URLP.offline || state.self?.dead) return;
      player.correct(x, z);
      player.sentX = NaN;
      player._send(performance.now(), true);
    },
    stats() {
      const info = renderer.info;
      return { fps, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length, entities: state.entities.size, ...gfx.stats() };
    },
    gfx, // [render-souls]
    offline: null,
  };
}

boot().catch((err) => {
  console.error(err);
  fatal('Une erreur est survenue au démarrage du jeu. Rechargez la page.');
});

// [launcher] installable web app: manifest + service worker (skipped by the Vite dev server)
import('./pwa.js').then((m) => m.setupPwa()).catch(() => {});
