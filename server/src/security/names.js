// Character name filter for NEW accounts: reserved words (staff impersonation), a small FR/EN insult list and
// look-alike names ("Élodie" vs "Elodie", "Bob_1" vs "B0b1"). Existing accounts are never affected.

/** Lowercase, strip accents. */
export function foldAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

/** Folded form used for word matching: accents stripped, leet digits mapped, only letters kept. */
export function matchForm(name) {
  return foldAccents(name).replace(/[0-9]/g, (d) => LEET[d] || '').replace(/[^a-z]/g, '');
}

/**
 * Skeleton for impersonation checks: two names with the same skeleton look alike.
 * Case, accents and underscores are ignored; l/1/i and o/0 are confused.
 */
export function confusableKey(name) {
  return foldAccents(name).replace(/_/g, '').replace(/[l1|]/g, 'i').replace(/0/g, 'o').replace(/5/g, 's');
}

/** Split "GM_Bob42", "AdminBob", "BobADMIN" into lowercase word tokens ["gm", "bob"]… */
export function nameTokens(name) {
  return name
    .replace(/([a-zà-öø-ÿ])([A-ZÀ-ÖØ-Þ])/g, '$1 $2')        // camelCase boundary
    .replace(/([A-ZÀ-ÖØ-Þ]+)([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ])/g, '$1 $2') // "GMBob" -> "GM Bob"
    .split(/[\s_0-9]+/)
    .map((t) => foldAccents(t))
    .filter(Boolean);
}

// Matched anywhere in the folded name.
const RESERVED_SUBSTRINGS = [
  'admin', 'administrat', 'moderat', 'brumeval', 'systeme', 'system', 'serveur', 'server',
  'staff', 'support', 'officiel', 'official', 'maitredujeu', 'gamemaster',
];
// Matched as a whole word token only (they appear inside ordinary names: "Sigmund", "Hamjo"…).
const RESERVED_TOKENS = ['gm', 'mj', 'mod', 'mods', 'modo', 'modos', 'dev', 'root', 'sys', 'console', 'annonce'];
// Internal keys that must never become account names.
const FORBIDDEN_EXACT = ['__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof'];

// Insults / hate (folded, leet-mapped). Substrings: long enough not to appear inside ordinary names.
const OFFENSIVE_SUBSTRINGS = [
  'connard', 'connass', 'salope', 'salaud', 'encule', 'enfoire', 'batard', 'merdeux', 'niquer', 'niquez',
  'tamere', 'tagueule', 'pouffiasse', 'grosseput', 'fuck', 'motherf', 'bitch', 'asshole', 'nigger', 'nigga',
  'faggot', 'whore', 'retard', 'hitler', 'pedophil', 'pedoph', 'violeur', 'kkk', 'penis', 'couille', 'pussy',
  'slut',
];
// Short words matched as whole tokens only ("pute" is inside "député", "computer").
const OFFENSIVE_TOKENS = [
  'pute', 'putes', 'pd', 'fdp', 'ntm', 'tg', 'con', 'cons', 'conne', 'cul', 'bite', 'nique', 'shit', 'dick', 'fag',
  'cunt', 'negro', 'nazi', 'nazis', 'rapist', 'sex', 'sexe', 'porn', 'porno', 'merde', 'vagin',
];

/**
 * Why a new character name is refused, or null when acceptable.
 * @returns {null | 'reserved' | 'offensive'}
 */
export function nameProblem(name) {
  if (typeof name !== 'string') return 'reserved';
  const folded = foldAccents(name);
  if (FORBIDDEN_EXACT.includes(folded)) return 'reserved';
  const form = matchForm(name);
  const tokens = nameTokens(name);
  const leetTokens = nameTokens(name.replace(/[0-9]/g, (d) => LEET[d] || ' '));
  const allTokens = new Set([...tokens, ...leetTokens]);
  for (const w of RESERVED_SUBSTRINGS) if (form.includes(w)) return 'reserved';
  for (const w of RESERVED_TOKENS) if (allTokens.has(w)) return 'reserved';
  for (const w of OFFENSIVE_SUBSTRINGS) if (form.includes(w)) return 'offensive';
  for (const w of OFFENSIVE_TOKENS) if (allTokens.has(w)) return 'offensive';
  return null;
}

export const NAME_PROBLEM_MESSAGES = {
  reserved: 'Ce nom est réservé, choisissez-en un autre.',
  offensive: 'Ce nom n\'est pas autorisé, choisissez-en un autre.',
  lookalike: 'Ce nom ressemble trop à celui d\'un personnage existant.',
};
