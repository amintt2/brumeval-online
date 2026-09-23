// Parsing of what the game server publishes for the launcher (pure, unit-tested):
//   <server>/news.json             patch notes / announcements
//   <server>/api/status, /health   server status (optional endpoints — any shape is tolerated)
'use strict';

const { isSafeExternalUrl } = require('./urls');

const MAX_ITEMS = 20;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * news.json → { items: [{ id, date, tag, title, summary, body: string[], url }] }.
 * Anything malformed is dropped rather than rejected, so a typo never blanks the launcher.
 */
function parseNews(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : null;
  if (!list) return null;
  const items = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const title = str(it.title, 140);
    if (!title) continue;
    const date = typeof it.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : '';
    const body = Array.isArray(it.body) ? it.body.map((l) => str(l, 400)).filter(Boolean).slice(0, 40) : [];
    items.push({
      id: str(it.id, 64) || `${date}-${items.length}`,
      date,
      tag: str(it.tag, 32),
      title,
      summary: str(it.summary, 600),
      body,
      url: isSafeExternalUrl(it.url) ? it.url : '',
    });
    if (items.length >= MAX_ITEMS) break;
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { items };
}

const count = (v) => {
  if (Array.isArray(v)) return v.length;
  if (Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (v && typeof v === 'object') return count(v.online ?? v.count ?? v.current);
  return null;
};

/**
 * Normalises a status/health JSON body (shape decided by the server team; unknown fields ignored).
 * Returns { online, players, maxPlayers, version, message }.
 */
function parseStatus(raw) {
  const out = { online: true, players: null, maxPlayers: null, version: '', message: '' };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.ok === false || raw.online === false || raw.status === 'down' || raw.status === 'maintenance') out.online = false;
  out.players = count(raw.players ?? raw.playersOnline ?? raw.onlinePlayers ?? raw.connected ?? (typeof raw.online === 'number' ? raw.online : undefined));
  const max = raw.maxPlayers ?? raw.max ?? raw.capacity ?? (raw.players && typeof raw.players === 'object' ? raw.players.max : undefined);
  out.maxPlayers = Number.isFinite(max) && max > 0 ? Math.floor(max) : null;
  out.version = str(raw.version, 32);
  out.message = str(raw.motd ?? raw.message, 200);
  if (raw.status === 'maintenance' && !out.message) out.message = 'Maintenance en cours';
  return out;
}

module.exports = { parseNews, parseStatus };
