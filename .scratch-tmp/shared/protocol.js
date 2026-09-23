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
/** Entity states (`s`). */
export const STATE = { IDLE: 0, MOVE: 1, DEAD: 2 };

// ------------------------------------------------------------------ client -> server
export const C2S = {
  REGISTER: 'register',       // { name, password, cls }            -> auth_ok | auth_err
  LOGIN: 'login',             // { name, password }                 -> auth_ok | auth_err
  MOVE: 'move',               // { x, z, ry }  local player position (client-simulated, server-validated)
  ABILITY: 'ability',         // { slot: 0..3, tg?: entityId, x?, z? }  (x,z = ground point for aoe_target)
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
