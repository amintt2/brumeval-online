// Network protocol shared by client and server.
// Transport: WebSocket at path /ws, JSON text frames. Every message is an object whose `t` field is its type.
// Numbers are plain JS numbers; positions in metres rounded to 2 decimals; angles (ry) in radians rounded to 3.
// Entity ids are positive integers unique for the lifetime of the server process (never reused).

export const PROTOCOL_VERSION = 1;
export const WS_PATH = '/ws';
export const DEFAULT_PORT = 3000;

export const TICK_RATE = 20;            // server simulation ticks per second
export const SNAPSHOT_EVERY = 2;        // a `snap` is sent every 2 ticks (10 Hz)
export const INTERP_DELAY_MS = 200;     // client renders remote entities this far in the past
export const MOVE_SEND_HZ = 15;         // client sends `move` at most this often while moving
export const VIEW_RADIUS = 80;          // area of interest: entities within this distance are sent
export const PLAYER_RADIUS = 0.45;      // collision radius of players
export const INTERACT_RANGE = 5;        // max distance to talk / trade with an NPC
export const CHAT_MAX_LEN = 200;
export const DAY_LENGTH_S = 20 * 60;    // full day/night cycle in real seconds
export const CORPSE_TIME_S = 4;         // dead monsters stay visible this long before `gone`

/** Entity kinds (`k`). */
export const KIND = { PLAYER: 'player', MONSTER: 'monster', NPC: 'npc' };
// [combat-souls] death echo entity (only ever sent to its owner)
KIND.ECHO = 'echo';
/** Entity states (`s`). */
export const STATE = { IDLE: 0, MOVE: 1, DEAD: 2 };

// ------------------------------------------------------------------ client -> server
export const C2S = {
  REGISTER: 'register',       // { name, password, cls }            -> auth_ok | auth_err  ([accounts] see below)
  LOGIN: 'login',             // { name, password }                 -> auth_ok | auth_err  ([accounts] see below)
  MOVE: 'move',               // { x, z, ry }  local player position (client-simulated, server-validated)
  ABILITY: 'ability',         // { slot: 0..7, tg?: entityId, x?, z?, ph? }  (x,z = ground point for aoe_target; [skilltree] see below)
                              //   slot 0 is the class auto-attack: it also (re)starts auto-attacking `tg`.
  STOP: 'stop',               // {}  stop auto-attacking
  CHAT: 'chat',               // { text }  "/w <nom> <message>" whisper, "/who" online list, "/help"
  INTERACT: 'interact',       // { id: npcEntityId }                -> dialog
  QUEST_ACCEPT: 'quest_accept', // { id: npcEntityId, q: questId }
  QUEST_TURNIN: 'quest_turnin', // { id: npcEntityId, q: questId }
  BUY: 'buy',                 // { id: npcEntityId, item: itemId, qty?: 1..20 }
  SELL: 'sell',               // { id: npcEntityId, slot, qty?: default whole stack }
  USE_ITEM: 'use_item',       // { slot }  consumables are used, weapons/armor are equipped
  EQUIP: 'equip',             // { slot }
  UNEQUIP: 'unequip',         // { slot: 'weapon' | 'armor' }
  DROP: 'drop',               // { slot }  destroys the stack
  RESPAWN: 'respawn',         // {}  only while dead
  PING: 'ping',               // { c: clientTimeMs }                -> pong
};
// [combat-souls] stamina actions (shared/combat.js holds the tuning)
C2S.DODGE = 'dodge';          // { dx, dz }  unit direction of a dodge roll (costs STAMINA.roll, i-frames, burst)
C2S.SPRINT = 'sprint';        // { on: boolean }  speed × STAMINA.sprintMult while stamina lasts

// ------------------------------------------------------------------ server -> client
export const S2C = {
  AUTH_OK: 'auth_ok',   // { id, self: SelfState, tod, online, motd }
  AUTH_ERR: 'auth_err', // { code, msg }  codes: bad_name | bad_password | bad_class | name_taken |
                        //                  wrong_credentials | already_online | server_full | bad_request
  SNAP: 'snap',         // { tick, tod, on, ents: EntState[], gone: id[] }
  SELF: 'self',         // Partial<SelfState> — merge into local copy (arrays/objects are sent whole)
  CORRECT: 'correct',   // { x, z }  server rejected the last move(s): snap local player here
  FX: 'fx',             // { k, src, tg?, x?, z?, ab?, ms?, r? }  visual event, see FX below
  DMG: 'dmg',           // { src, tg, v, crit, hp, ab? }  v = damage dealt, hp = target hp after
  HEAL: 'heal',         // { tg, v, hp }
  DEATH: 'death',       // { id, by }  entity died (by = killer id or 0)
  CD: 'cd',             // { slot, ms }  ability slot is on cooldown for ms from now
  DIALOG: 'dialog',     // { id, npc, name, text, quests: [{ q, state, n }], shop: itemId[] | null }
                        //   state: 'available' | 'active' | 'ready' ; n = kill progress
  CLOSE_DIALOG: 'close_dialog', // {}  e.g. player walked away from the NPC
  CHAT: 'chat',         // { ch: 'global'|'whisper_in'|'whisper_out'|'system', from?, to?, text }
  NOTIFY: 'notify',     // { kind: 'info'|'error'|'xp'|'loot'|'quest'|'level'|'gold', text }  (French text)
  ERR: 'err',           // { code, msg }  action refused (French msg). codes: out_of_range | no_mana |
                        //   cooldown | no_target | bad_target | safe_zone | dead | inv_full | no_gold |
                        //   cant_use | too_far | rate_limit | bad_request
  PONG: 'pong',         // { c, s }  c = echoed client time, s = server time
  KICK: 'kick',         // { msg }  server closes the socket right after
};
// [combat-souls] telegraphed attacks
S2C.TELE = 'tele';         // { id, src, shape: 'circle'|'cone'|'line'|'ring', x, z, r, r2?, a, arc?, w?, len?, ms, ab?, clip? }
                           //   ground indicator of an attack landing after `ms`; resolved at impact against the
                           //   positions of the targets then (players in i-frames are unaffected).
                           //   ab = attack id (visual style), clip = animation to play on src, synced to the impact.
S2C.TELE_END = 'tele_end'; // { id }  telegraph cancelled (attacker died / staggered)

// ------------------------------------------------------------------ [accounts] v0.2 accounts & characters (docs/COMPTES.md)
// An ACCOUNT (login + password, remembered sessions, passkeys) owns up to MAX_CHARS characters. The flow is:
//   register | login | login_token | passkey_login_verify  ->  account_ok (character selection)
//   char_create / char_delete                              ->  account_ok (updated list)
//   char_select                                            ->  auth_ok   (unchanged: the game flow is identical)
//   char_logout (in game)                                  ->  account_ok (back to the character selection)
// Account messages are accepted in the world too (account panel: passkeys, password, logout everywhere).
// Legacy clients (v0.1 / wave 1): `register { name, password, cls }` creates the account AND its first character
// (same name) and selects it; `login { name, password }` WITHOUT a `remember` field selects the last played
// character. Both answer auth_ok directly, exactly like before.
export const MAX_CHARS = 5;
C2S.LOGIN_TOKEN = 'login_token';     // { token }  remembered session (256-bit, 30 days, ROTATED: account_ok.token replaces it)
C2S.CHAR_CREATE = 'char_create';     // { name, cls }                 -> account_ok { created: charId } | account_err
C2S.CHAR_DELETE = 'char_delete';     // { id, confirm: <character name> } -> account_ok | account_err
C2S.CHAR_SELECT = 'char_select';     // { id }  (a character of THIS account) -> auth_ok | account_err
C2S.CHAR_LOGOUT = 'char_logout';     // {}  leave the world (saved)   -> account_ok
C2S.LOGOUT = 'logout';               // {}  revoke this connection's remembered session -> logged_out
C2S.LOGOUT_ALL = 'logout_all';       // {}  revoke every remembered session, disconnect the account's other connections -> logged_out
C2S.ACCOUNT_GET = 'account_get';     // {}  -> account_ok (refresh)
C2S.PASSWORD_CHANGE = 'password_change'; // { old, password, revokePasskeys? }  -> account_ok { info } | account_err (other sessions revoked + kicked; passkeys too when revokePasskeys)
C2S.PASSKEY_REG_OPTIONS = 'passkey_reg_options';     // { password? }  (logged in) -> passkey_options { purpose: 'register', options } | account_err reauth_required (password needed: last password/passkey proof > 10 min, or token login)
C2S.PASSKEY_REG_VERIFY = 'passkey_reg_verify';       // { resp: RegistrationResponseJSON, label? } -> account_ok { info } | account_err
C2S.PASSKEY_LOGIN_OPTIONS = 'passkey_login_options'; // {}  (not logged in) -> passkey_options { purpose: 'login', options }
C2S.PASSKEY_LOGIN_VERIFY = 'passkey_login_verify';   // { resp: AuthenticationResponseJSON, remember? } -> account_ok | auth_err
C2S.PASSKEY_RENAME = 'passkey_rename'; // { id, label } -> account_ok
C2S.PASSKEY_DELETE = 'passkey_delete'; // { id }        -> account_ok
// Additive fields of existing messages:
//   register { name, password, remember?, cls? }  without cls: account only -> account_ok (token when remember)
//   login    { name, password, remember }         -> account_ok (token when remember); name = account login
//   auth_err codes + bad_token (unknown / expired / revoked token), passkey_failed, banned, rate_limit, no_character

S2C.ACCOUNT_OK = 'account_ok';
//   { account: { name, lastChar, maxChars, created, passkeys: [{ id, label, created, used }], sessions, role? },
//     chars: [{ id, name, cls, level, zone, lastPlayed, eq: { weapon, armor } }],
//     token?,   new remembered-session token (store it, replaces the previous one)
//     method?,  'password' | 'token' | 'passkey' | 'register' on a fresh login (the client offers a passkey after 'password')
//     created?, id of the character just created
//     info? }   French confirmation to display (password changed, passkey added…)
S2C.ACCOUNT_ERR = 'account_err'; // { op, code, msg }  an account operation was refused (French msg). codes: bad_name |
                                 //   name_taken | bad_class | too_many_chars | not_found | bad_confirm | already_online |
                                 //   in_world | server_full | banned | bad_password | wrong_credentials | passkey_failed |
                                 //   too_many_passkeys | unavailable | rate_limit | bad_request
S2C.PASSKEY_OPTIONS = 'passkey_options'; // { purpose: 'register' | 'login', options }  options = PublicKeyCredential*OptionsJSON
S2C.LOGGED_OUT = 'logged_out';           // { all?: boolean }  the connection is back to the login screen (still open)

// ------------------------------------------------------------------ [skilltree] v0.3 L'Arbre des Brumes
// (docs/design/ARBRE_COMPETENCES.md, DECISIONS.md; rules in shared/skills.js, everything validated server-side)
// Level 1 = base attack only. Every level gives points (1, +1 every 5 levels) spent in the tree; no respec:
// the Renaissance (level 30) gives everything back with permanent bonuses.
C2S.SKILL_ALLOC = 'skill_alloc';             // { node } one rank of a node — or { add: [{ id, r? }] } (all or nothing)
                                             //   -> self { tree, points, loadout } + notify | err tree_* (see TREE_ERRORS)
C2S.SKILL_ALLOC_BATCH = 'skill_alloc_batch'; // { nodes: [nodeId, …] } (≤ 64, one rank each, all or nothing: the tree
                                             //   screen's « Valider (n points) »)
C2S.LOADOUT = 'loadout';                     // { slots: [abilityId | 'item:<consumableId>' | null] × 8 }  action bar,
                                             //   saved per character. Slot 0 = an unlocked base attack (auto-attack);
                                             //   abilities must be unlocked; Fondamentaux have their own keys (not slotted)
                                             //   -> self { loadout } | err loadout_bad
C2S.RENAISSANCE = 'renaissance';             // { confirm: true, affinity?: cls }  level 30, alive, 10 s out of combat;
                                             //   affinity required at the 2nd and 4th Renaissance -> self + fx renaissance
C2S.JUMP = 'jump';                           // { dx, dz }  Saut (needs the Fondamental): direction of travel (unit, or
                                             //   0,0 on the spot). Airborne `airMs`: ground shockwaves (`lo`) miss.
C2S.GUARD = 'guard';                         // { on: boolean }  Garde held (needs the Fondamental)
// ability (additive fields): { slot: 0..7, tg?, x?, z?, ph?: 'start' | 'release' }
//   slot indexes the LOADOUT (0..7; v0.2 clients send 0..3, the same first four slots). An 'item:' entry uses the
//   consumable. ph: 'start' on the base attack (slot 0) begins an Attaque chargée (Fondamental), 'release' fires it
//   (released before 0.4 s = normal attack; auto-release at 2 s). While airborne the base attack is the Attaque sautée.
// dodge / sprint (existing) now need the Roulade / Sprint Fondamentaux (offered to v0.2 characters).
// SelfState (additive):
//   tree:        { alloc: { nodeId: rank }, gift: [nodeId], affinity: [cls] }
//   points:      { total, spent, free, floor }   (floor = v0.2 migration floor, see shared/skills.js)
//   loadout:     [abilityId | 'item:<id>' | null] × 8
//   renaissance: { n, max, title, available, xpPct, needsAffinity }
//   abilities:   loadout[0..3] (v0.2 view, kept for older clients)
// S2C cd (additive): { slot, ms, ab }  ab = ability id (every loadout slot holding it gets its own `cd`)
// S2C tele (additive): lo?: 1 (rasant: jump it) · nb?: 1 (imblocable) · mag?: 1 (sort: only the Égide blocks it)
// EntState (additive): players `ac` = action flags (1 guard, 2 airborne, 4 charging, 8 casting / channelling,
//   16 staggered); static `rb` = Renaissances (aura + title). Monsters `stt` = status flags (1 brûlure, 2 froid,
//   4 gel, 8 enraciné, 16 empoisonné, 32 saignement, 64 marqué, 128 étourdi, 256 aveuglé).

/** FX kinds (`fx.k`). Pure visuals: the client plays animations / particles. */
export const FX = {
  SWING: 'swing',       // { src, tg, ab }       melee swing (play Attack on src)
  CAST: 'cast',         // { src, ab }           spell / bow draw (play Cast on src; Attack for bows is ok)
  PROJ: 'proj',         // { src, tg, ab, ms }   projectile from src to tg lasting ms
  AOE: 'aoe',           // { src, x, z, r, ab }  area effect centred on (x, z) with radius r
  HEAL: 'heal',         // { tg, ab }            healing sparkles
  LEVEL: 'level',       // { src }               level-up burst on src
  HIT: 'hit',           // { tg }                (optional) generic hit flash
  RESPAWN: 'respawn',   // { src }               entity appeared / respawned
};
// [combat-souls]
FX.ROLL = 'roll';         // { src, dx, dz }        dodge roll (play Roll on src)
FX.DODGE = 'dodge';       // { tg }                 an attack was negated by i-frames ("Esquive")
FX.STAGGER = 'stagger';   // { src, ms }            monster poise broken (play Hit, telegraph cancelled)
FX.PHASE = 'phase';       // { src, ph }            boss enters phase ph (2, 3…): play Special, roar
FX.HOWL = 'howl';         // { src, r }             pack call: nearby allies join the fight
FX.GUARD = 'guard';       // { src, tg }            frontal guard absorbed part of a hit
FX.ECHO = 'echo';         // { src, v }             death echo recovered by its owner (v = XP)
FX.NOTICE = 'notice';     // { src }                a monster noticed a player ("!" above its head)
// [skilltree] (all optional visuals)
FX.SKILL = 'skill';             // { src }                 a node was learnt (sparkle)
FX.RENAISSANCE = 'renaissance'; // { src, n }              Renaissance ritual
FX.JUMP = 'jump';               // { src, dx, dz, ms }     jump take-off (airborne for ms)
FX.LAND = 'land';               // { src, r? }             landing (r = jump attack area)
FX.BLOCK = 'block';             // { src, tg, v }          src blocked a hit from tg (v = damage let through)
FX.PARRY = 'parry';             // { src, tg }             perfect parry
FX.GUARD_BREAK = 'guard_break'; // { src, ms }             guard broken (stamina 0)
FX.PERFECT = 'perfect';         // { src, ms }             « Contre parfait » granted (perfect dodge / parry)
FX.CHARGE = 'charge';           // { src, ab, ms }         charged attack started (full after ms)
FX.CHARGED = 'charged';         // { src, ab, lvl }        charged attack released (lvl 0..1)
FX.VACILLE = 'vacille';         // { src, ms }             player staggered by a telegraphed hit
FX.DASH = 'dash';               // { src, x, z, ms, ab }   ability movement (leap, lunge, blink…) to (x, z)
FX.ZONE = 'zone';               // { id, src, ab, shape, x, z, r?, a?, len?, w?, ms, delay? }  ground zone (wall of fire,
                                //   toxic cloud, blizzard, meteor mark…): lasts ms (after delay ms)
FX.ZONE_END = 'zone_end';       // { id }
FX.BUFF = 'buff';               // { src, ab, ms }         buff / shield on src
FX.CHANNEL = 'channel';         // { src, ab, ms }         channelling / casting started (ms = max duration)
FX.CHANNEL_END = 'channel_end'; // { src, ab }             channelling / casting ended or cancelled
FX.STATUS = 'status';           // { tg, st, n?, ms }      status applied (st = brulure | froid | gel | …)
FX.TRAP = 'trap';               // { id, src, x, z, ab }   trap / summon / wall placed (removed with ZONE_END)
// Monster projectiles use FX.PROJ without `tg`: { src, x, z, ab, ms } flies to the ground point (x, z) and is
// resolved there at arrival (dodgeable).

/**
 * EntState (inside snap.ents). Always present: id, x, z, ry, hp, mhp, s.
 * Present on first sight of an entity by this client, and again whenever one of them changes:
 *   k  : KIND
 *   n  : display name
 *   m  : model key (GLB at /models/<m>.glb)
 *   lv : level
 *   c  : class id (players only)
 *   sc : model scale (monsters, optional, default 1)
 *   b  : 1 if boss
 *   mt : monster type id (monsters only, e.g. 'slime')
 *   nk : npc key (npcs only, e.g. 'elder')
 * Optional: tg (current target id, 0 = none), sl (1 if slowed).
 * The local player also appears in ents (use it for hp/mhp); its x/z must be ignored unless a `correct` arrives.
 *
 * SelfState (auth_ok.self, merged by `self` messages):
 *   { id, name, cls, level, xp, xpNext, hp, mhp, mp, mmp, gold,
 *     stats: { atk, def, crit, speed },
 *     inv: (null | { id: itemId, q: qty })[INV_SIZE],
 *     eq: { weapon: itemId|null, armor: itemId|null },
 *     quests: { [questId]: { state: 'active'|'ready'|'done', n } },
 *     abilities: [abilityId, abilityId, abilityId, abilityId],
 *     x, z, ry, dead: boolean }
 *   [combat-souls] + st (stamina), mst (max stamina, 100), echo: { x, z, xp } | null (own death echo)
 * [combat-souls] EntState (monsters) may carry static `el` (1 = elite) and `vr` (variant key, e.g. 'thrower').
 */

export const encode = (msg) => JSON.stringify(msg);
export function decode(raw) {
  try {
    const m = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
