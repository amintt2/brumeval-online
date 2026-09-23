// Persistent moderation fields of an account record (added in v0.2, all optional so v0.1 saves load as is):
//   role: 'admin' | 'gm'           (absent = regular player)
//   muteUntil: epoch ms | null      (chat mute; null or past = not muted), muteReason: string
//   muteCount: number               (automatic mutes so far, escalates the next duration)
//   ignore: string[]                (name keys whose chat is hidden, max 100)
//   lastIp: string                  (last connection address, visible to admins only)

export const ROLES = ['player', 'gm', 'admin'];
export const IGNORE_MAX = 100;

/** Sanitised moderation fields of a raw persisted account (only the fields that are set). */
export function sanitizeSecurityFields(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (raw.role === 'admin' || raw.role === 'gm') out.role = raw.role;
  if (typeof raw.muteUntil === 'number' && Number.isFinite(raw.muteUntil) && raw.muteUntil > 0) out.muteUntil = raw.muteUntil;
  if (typeof raw.muteReason === 'string' && raw.muteReason) out.muteReason = raw.muteReason.slice(0, 200);
  if (Number.isSafeInteger(raw.muteCount) && raw.muteCount > 0) out.muteCount = Math.min(raw.muteCount, 1000);
  if (Array.isArray(raw.ignore)) {
    const list = [...new Set(raw.ignore.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 32))];
    if (list.length) out.ignore = list.slice(0, IGNORE_MAX);
  }
  if (typeof raw.lastIp === 'string' && raw.lastIp.length <= 64) out.lastIp = raw.lastIp;
  return out;
}
