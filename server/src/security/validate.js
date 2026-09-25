// Strict validation of every client -> server message before it reaches the game.
// Generic rules apply to all messages (size, depth, forbidden keys); known types also get a field schema.
// Unknown types pass the generic rules only, so new gameplay messages added by other modules keep working.
import { CHAT_MAX_LEN } from '../../../shared/protocol.js';
import { INV_SIZE } from '../../../shared/data.js';
import { LOADOUT_SLOTS, MAX_ALLOC_BATCH } from '../../../shared/skills.js';

/** Keys that could pollute prototypes when an object is merged/spread somewhere. */
export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_KEYS = 16;
const MAX_DEPTH = 3;
const MAX_ARRAY = 32;
const MAX_STRING = 256;
/** Coordinates are metres; anything beyond this is garbage (the world is ±180 m). */
const COORD_LIMIT = 10_000;

/** [skilltree] v0.3 action bar: keys 1-8 send `ability { slot: 0..7 }` (shared/skills.js LOADOUT_SLOTS). */
const ABILITY_SLOTS = LOADOUT_SLOTS;
/** [skilltree] Attaque chargée: `ability { ph }` phases of the held base attack (systems/fundamentals.js handleCharge). */
const CHARGE_PHASES = new Set(['start', 'release']);
/**
 * [skilltree] top-level arrays allowed beyond MAX_ARRAY, per message type: the tree screen's « Confirmer » sends one
 * entry per pending rank (≤ MAX_ALLOC_BATCH). Every other array, in these messages too, keeps the generic cap.
 */
const WIDE_ARRAYS = { skill_alloc_batch: { nodes: MAX_ALLOC_BATCH } };

// ---------------------------------------------------------------- field validators
export const isFiniteNum = (v, lim = COORD_LIMIT) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
export const isIntIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const isStrMax = (v, max) => typeof v === 'string' && v.length <= max;
export const isEntityId = (v) => Number.isSafeInteger(v) && v > 0;

const num = (lim = COORD_LIMIT) => (v) => isFiniteNum(v, lim);
const int = (lo, hi) => (v) => isIntIn(v, lo, hi);
const str = (max) => (v) => isStrMax(v, max);
const id = () => isEntityId;
const bool = () => (v) => typeof v === 'boolean';
/** Optional field: undefined or null accepted. */
const opt = (f) => (v) => v === undefined || v === null || f(v);
const either = (...fs) => (v) => fs.some((f) => f(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (set) => (v) => set.has(v);
const arrOf = (f, max) => (v) => Array.isArray(v) && v.length <= max && v.every(f);

/**
 * Field schemas of the known C2S messages (shared/protocol.js). Extra fields are tolerated (they are only
 * subject to the generic limits) so that additive protocol changes do not break old servers.
 */
export const SCHEMAS = {
  register: { name: str(64), password: str(256), cls: opt(str(32)), remember: opt(bool()) },
  login: { name: str(64), password: str(256), remember: opt(bool()) },
  move: { x: num(), z: num(), ry: opt(num(1000)) },
  ability: { slot: int(0, ABILITY_SLOTS - 1), tg: opt(either(id(), (v) => v === 0)), x: opt(num()), z: opt(num()), ph: opt(oneOf(CHARGE_PHASES)) },
  stop: {},
  chat: { text: str(CHAT_MAX_LEN * 4) },
  interact: { id: id() },
  quest_accept: { id: id(), q: str(64) },
  quest_turnin: { id: id(), q: str(64) },
  buy: { id: id(), item: str(64), qty: opt(int(1, 999)) },
  sell: { id: id(), slot: int(0, INV_SIZE - 1), qty: opt(int(1, 99_999)) },
  use_item: { slot: int(0, INV_SIZE - 1) },
  equip: { slot: int(0, INV_SIZE - 1) },
  unequip: { slot: str(16) },
  drop: { slot: int(0, INV_SIZE - 1) },
  respawn: {},
  ping: { c: num(1e15) },
  // wave 1 additions (combat-souls): validated when present, harmless otherwise
  dodge: { dx: opt(num(2)), dz: opt(num(2)) },
  sprint: { on: opt(bool()) },
  // [accounts] accounts & characters (docs/COMPTES.md)
  login_token: { token: str(64) },
  char_create: { name: str(64), cls: str(32) },
  char_delete: { id: str(32), confirm: str(64) },
  char_select: { id: str(32) },
  char_logout: {},
  logout: {},
  logout_all: {},
  account_get: {},
  password_change: { old: str(256), password: str(256), revokePasskeys: opt(bool()) },
  passkey_reg_options: { password: opt(str(256)) },
  passkey_reg_verify: { resp: isObj, label: opt(str(64)) },
  passkey_login_options: {},
  passkey_login_verify: { resp: isObj, remember: opt(bool()) },
  passkey_rename: { id: str(1400), label: str(64) },
  passkey_delete: { id: str(1400) },
  // [skilltree] tree screen « Confirmer » (the game logic re-checks every node: systems/skills.js)
  skill_alloc_batch: { nodes: arrOf(str(64), MAX_ALLOC_BATCH) },
};

/**
 * [accounts] WebAuthn responses are deeper and carry long base64url strings (attestation object, signature,
 * credential id): these message types get their own structural limits instead of the generic ones.
 */
const LARGE_TYPES = new Set(['passkey_reg_verify', 'passkey_login_verify', 'passkey_rename', 'passkey_delete']);
const LARGE_LIMITS = { depth: 6, keys: 24, array: 16, string: 6000 };
const DEFAULT_LIMITS = null;

/**
 * Generic structural checks. Returns null or a reason. `wide`: at depth 0, { key: max length } of the top-level arrays
 * allowed beyond the array cap (WIDE_ARRAYS); internally, the max length of the array being checked.
 */
export function checkStructure(value, depth = 0, lim = DEFAULT_LIMITS, wide = null) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string') return value.length > (lim ? lim.string : CHAT_MAX_LEN * 4) ? 'string_too_long' : null;
  if (t === 'number') return Number.isFinite(value) ? null : 'bad_number';
  if (t === 'boolean') return null;
  if (t !== 'object') return 'bad_type';
  if (depth >= (lim ? lim.depth : MAX_DEPTH)) return 'too_deep';
  if (Array.isArray(value)) {
    if (value.length > (typeof wide === 'number' ? wide : lim ? lim.array : MAX_ARRAY)) return 'array_too_long';
    for (const v of value) {
      const r = checkStructure(v, depth + 1, lim);
      if (r) return r;
    }
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length > (lim ? lim.keys : MAX_KEYS)) return 'too_many_keys';
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) return 'forbidden_key';
    if (k.length > 32) return 'key_too_long';
    const v = value[k];
    if (typeof v === 'string' && v.length > (lim ? lim.string : MAX_STRING) && !(depth === 0 && k === 'text')) return 'string_too_long';
    const cap = depth === 0 && wide && typeof wide === 'object' && Object.prototype.hasOwnProperty.call(wide, k) ? wide[k] : null;
    const r = checkStructure(v, depth + 1, lim, cap);
    if (r) return r;
  }
  return null;
}

/**
 * Validate a decoded client message. Returns null when acceptable, otherwise a short reason
 * ('forbidden_key', 'bad_field:x', 'too_many_keys'…).
 */
export function validateC2S(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'not_object';
  if (typeof msg.t !== 'string' || msg.t.length > 32) return 'bad_type';
  const wide = Object.prototype.hasOwnProperty.call(WIDE_ARRAYS, msg.t) ? WIDE_ARRAYS[msg.t] : null;
  const s = checkStructure(msg, 0, LARGE_TYPES.has(msg.t) ? LARGE_LIMITS : DEFAULT_LIMITS, wide);
  if (s) return s;
  if (!Object.prototype.hasOwnProperty.call(SCHEMAS, msg.t)) return null;
  const schema = SCHEMAS[msg.t];
  for (const field of Object.keys(schema)) {
    if (!schema[field](msg[field])) return `bad_field:${field}`;
  }
  return null;
}
