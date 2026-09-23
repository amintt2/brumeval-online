// Chat moderation: mutes (manual and automatic), flood / repetition / caps / character spam, link filter,
// per-player ignore lists. Text is never HTML-escaped here (the client renders with textContent).
import { nameKey } from '../auth.js';
import { IGNORE_MAX } from './accountFields.js';
import { formatDuration } from './format.js';

const REPEAT_WINDOW_MS = 30_000;
const REPEAT_MAX = 2;            // the same message a 3rd time within 30 s is refused
const STRIKE_WINDOW_MS = 60_000;
const STRIKES_TO_MUTE = 3;
const AUTO_MUTE_MS = [2 * 60_000, 10 * 60_000, 60 * 60_000, 24 * 3_600_000];
const CAPS_MIN_LETTERS = 10;
const CAPS_RATIO = 0.7;
const CHAR_RUN_MAX = 5;

/** Per-player moderation state (not persisted except the mute, which lives on the account). */
const state = new WeakMap();
function stateOf(p) {
  let s = state.get(p);
  if (!s) state.set(p, (s = { recent: [], strikes: [] }));
  return s;
}

// ------------------------------------------------------------------ mute
/** Remaining mute in ms (0 = can talk). Expired mutes are cleared. */
export function muteRemaining(game, p) {
  const until = p.account?.muteUntil;
  if (!until) return 0;
  const left = until - game.security.now();
  if (left > 0) return left;
  delete p.account.muteUntil;
  delete p.account.muteReason;
  game.store?.markDirty();
  return 0;
}

export function mutePlayerAccount(game, account, durationMs, reason) {
  account.muteUntil = game.security.now() + durationMs;
  if (reason) account.muteReason = String(reason).slice(0, 200);
  else delete account.muteReason;
  game.store?.markDirty();
}

export function unmuteAccount(game, account) {
  const was = !!account.muteUntil && account.muteUntil > game.security.now();
  delete account.muteUntil;
  delete account.muteReason;
  game.store?.markDirty();
  return was;
}

export function muteMessage(game, p) {
  const left = muteRemaining(game, p);
  const reason = p.account?.muteReason ? ` (${p.account.muteReason})` : '';
  return `Vous êtes réduit au silence encore ${formatDuration(left)}${reason}.`;
}

// ------------------------------------------------------------------ text checks
// Scheme or "www." links, or bare domains with a common TLD ("site.com", "discord.gg/abc").
const URL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)\S+/gi;
const DOMAIN_RE = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|fr|io|gg|xyz|ru|de|be|ch|ca|uk|eu|me|tv|co|info|biz|app|dev|link|site|online|shop|store|club|top|live|pro|us|cc|to|ly|sh|ws|tk|ml|ga|cf|gq))\b(?:\/\S*)?/gi;
// "discord . gg", "site (point) com": obfuscated separators, for the most abused TLDs only
const OBFUSCATED_RE = /\b([a-z0-9-]{2,63})(?:\s+\.\s*|\.\s+|\s*[([]\s*(?:point|dot)\s*[)\]]\s*)(com|org|gg|io|xyz|ru)\b/gi;

/** Domains (lowercase) contained in the text. */
export function findLinks(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    const host = m[0].replace(/^(?:(?:https?|ftp):\/\/)/i, '').split(/[/?#:]/)[0].toLowerCase();
    out.push(host);
  }
  for (const m of text.matchAll(DOMAIN_RE)) out.push(m[1].toLowerCase());
  for (const m of text.matchAll(OBFUSCATED_RE)) out.push(`${m[1]}.${m[2]}`.toLowerCase());
  return out;
}

function whitelisted(host, list) {
  const h = host.replace(/^www\./, '');
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/** True when the text contains a link to a non-whitelisted site. */
export function hasForbiddenLink(text, whitelist) {
  return findLinks(text).some((h) => !whitelisted(h, whitelist));
}

/** Messages SHOUTED in capitals are lowered (first letter kept). */
export function calmCaps(text) {
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < CAPS_MIN_LETTERS) return text;
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  if (upper / letters.length < CAPS_RATIO) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "noooooooooon" -> "nooooon" (runs of the same character capped at 5). */
export function collapseRuns(text) {
  return text.replace(/(.)\1{5,}/gsu, (m, c) => c.repeat(CHAR_RUN_MAX));
}

const normalizeForRepeat = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// ------------------------------------------------------------------ strikes & automatic mutes
/** Record a spam strike; three within a minute mute the player automatically (escalating). */
export function chatStrike(game, p, code) {
  const now = game.now();
  const s = stateOf(p);
  s.strikes = s.strikes.filter((t) => now - t < STRIKE_WINDOW_MS);
  s.strikes.push(now);
  game.security?.flag?.(p, code, 1);
  if (s.strikes.length < STRIKES_TO_MUTE) return false;
  s.strikes = [];
  const n = p.account.muteCount || 0;
  const dur = AUTO_MUTE_MS[Math.min(n, AUTO_MUTE_MS.length - 1)];
  p.account.muteCount = n + 1;
  mutePlayerAccount(game, p.account, dur, 'spam');
  game.security?.seclog.write({ type: 'chat', action: 'auto_mute', name: p.name, ms: dur, code });
  game.security?.flag?.(p, 'chat_spam', 3, { mute: dur });
  game.log.info(`${p.name} réduit au silence automatiquement pour ${formatDuration(dur)} (spam)`);
  game.systemChat(`Vous êtes réduit au silence pendant ${formatDuration(dur)} pour spam.`, { to: p });
  return true;
}

/**
 * Moderate the body of a global message or whisper. Rate limiting (5 / 5 s) is done by the caller.
 * @returns {{ ok: true, text: string } | { ok: false, code: string, msg: string }}
 */
export function moderateMessage(game, p, text) {
  if (muteRemaining(game, p) > 0) return { ok: false, code: 'muted', msg: muteMessage(game, p) };
  const wl = game.security?.cfg.chatLinkWhitelist || [];
  if (hasForbiddenLink(text, wl)) {
    chatStrike(game, p, 'chat_link');
    return { ok: false, code: 'link', msg: 'Les liens ne sont pas autorisés dans le chat.' };
  }
  const now = game.now();
  const s = stateOf(p);
  s.recent = s.recent.filter((r) => now - r.t < REPEAT_WINDOW_MS);
  const norm = normalizeForRepeat(text);
  if (norm && s.recent.filter((r) => r.n === norm).length >= REPEAT_MAX) {
    chatStrike(game, p, 'chat_repeat');
    return { ok: false, code: 'repeat', msg: 'Évitez de répéter le même message.' };
  }
  s.recent.push({ t: now, n: norm });
  if (s.recent.length > 20) s.recent.shift();
  return { ok: true, text: calmCaps(collapseRuns(text)) };
}

// ------------------------------------------------------------------ ignore lists
export function ignoreSet(p) {
  const list = p.account?.ignore;
  return Array.isArray(list) ? list : [];
}

/** Does `listener` ignore `speaker`? */
export function ignores(listener, speaker) {
  const list = listener.account?.ignore;
  return Array.isArray(list) && list.length > 0 && list.includes(nameKey(speaker.name));
}

/** Add `name` to p's ignore list. Returns an error message or null. */
export function addIgnore(game, p, displayName) {
  const k = nameKey(displayName);
  if (k === nameKey(p.name)) return 'Vous ne pouvez pas vous ignorer vous-même.';
  const list = ignoreSet(p);
  if (list.includes(k)) return `${displayName} est déjà ignoré.`;
  if (list.length >= IGNORE_MAX) return `Votre liste d'ignorés est pleine (${IGNORE_MAX}).`;
  p.account.ignore = [...list, k];
  game.store?.markDirty();
  return null;
}

export function removeIgnore(game, p, name) {
  const k = nameKey(name);
  const list = ignoreSet(p);
  if (!list.includes(k)) return false;
  p.account.ignore = list.filter((x) => x !== k);
  if (!p.account.ignore.length) delete p.account.ignore;
  game.store?.markDirty();
  return true;
}
