// Unit tests of the launcher's pure modules (no Electron needed): node --test "test/*.test.cjs"
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const urls = require('../src/main/lib/urls');
const settings = require('../src/main/lib/settings');
const feeds = require('../src/main/lib/feeds');
const { friendlyError } = require('../src/main/lib/updateErrors');

test('normalizeServerUrl accepte les adresses usuelles', () => {
  assert.equal(urls.normalizeServerUrl('https://brumel.mciut.fr'), 'https://brumel.mciut.fr');
  assert.equal(urls.normalizeServerUrl('  https://brumel.mciut.fr/  '), 'https://brumel.mciut.fr');
  assert.equal(urls.normalizeServerUrl('brumel.mciut.fr'), 'https://brumel.mciut.fr');
  assert.equal(urls.normalizeServerUrl('localhost:3205'), 'http://localhost:3205');
  assert.equal(urls.normalizeServerUrl('127.0.0.1:3205/'), 'http://127.0.0.1:3205');
  assert.equal(urls.normalizeServerUrl('HTTPS://Brumel.MCIUT.fr/jeu/?x=1#y'), 'https://brumel.mciut.fr/jeu');
});

test('normalizeServerUrl refuse les adresses dangereuses ou invalides', () => {
  for (const bad of ['', '   ', null, 42, 'javascript:alert(1)', 'file:///C:/Windows', 'ftp://x.fr', 'https://user:pw@x.fr', 'http://', 'x'.repeat(3000)]) {
    assert.equal(urls.normalizeServerUrl(bad), null, String(bad).slice(0, 40));
  }
});

test('isSameOrigin verrouille la navigation sur le serveur configuré', () => {
  const base = 'https://brumel.mciut.fr';
  assert.ok(urls.isSameOrigin('https://brumel.mciut.fr/', base));
  assert.ok(urls.isSameOrigin('https://brumel.mciut.fr/?autologin=x#a', base));
  assert.ok(!urls.isSameOrigin('http://brumel.mciut.fr/', base));
  assert.ok(!urls.isSameOrigin('https://brumel.mciut.fr.evil.com/', base));
  assert.ok(!urls.isSameOrigin('https://evil.com/?https://brumel.mciut.fr', base));
  assert.ok(!urls.isSameOrigin('data:text/html,hi', base));
  assert.ok(!urls.isSameOrigin('not a url', base));
});

test('isSafeExternalUrl ne laisse passer que les liens web', () => {
  assert.ok(urls.isSafeExternalUrl('https://github.com/amintt2/brumeval-online/releases'));
  assert.ok(urls.isSafeExternalUrl('http://example.com'));
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'ms-settings:', 'https://u:p@x.com', '', undefined]) {
    assert.ok(!urls.isSafeExternalUrl(bad), String(bad));
  }
});

test('sanitizeSettings répare un fichier de réglages corrompu ou ancien', () => {
  assert.deepEqual(settings.sanitizeSettings(null), settings.defaultSettings());
  assert.deepEqual(settings.sanitizeSettings('abc'), settings.defaultSettings());
  const s = settings.sanitizeSettings({
    serverUrl: 'javascript:alert(1)',
    fullscreen: 'oui',
    closeOnPlay: true,
    windows: { launcher: { x: 10, y: 20, width: 100, height: 100 }, game: { width: 'x' }, other: {} },
    extra: 1,
  });
  assert.equal(s.serverUrl, urls.DEFAULT_SERVER_URL);
  assert.equal(s.fullscreen, false);
  assert.equal(s.closeOnPlay, true);
  assert.deepEqual(s.windows, { launcher: { x: 10, y: 20, width: 900, height: 580, maximized: false } });
  assert.equal('extra' in s, false);
});

test('applyPatch valide les réglages envoyés par l\'interface', () => {
  const cur = settings.defaultSettings();
  const ok = settings.applyPatch(cur, { serverUrl: 'localhost:3205', fullscreen: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.settings.serverUrl, 'http://localhost:3205');
  assert.equal(ok.settings.fullscreen, true);
  assert.equal(cur.fullscreen, false, 'the current settings are not mutated');
  const bad = settings.applyPatch(cur, { serverUrl: 'file:///c:/' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Adresse du serveur invalide/);
  assert.equal(settings.applyPatch(cur, { closeOnPlay: 'yes' }).ok, false);
  assert.equal(settings.applyPatch(cur, null).ok, false);
  // Unknown keys (e.g. an attempt to overwrite saved window bounds) are ignored.
  assert.deepEqual(settings.applyPatch(cur, { windows: { launcher: { x: 1 } } }).settings.windows, {});
});

test('isVisibleOn écarte une fenêtre restée sur un écran débranché', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  assert.ok(settings.isVisibleOn({ x: 100, y: 100, width: 1100, height: 700 }, screens));
  assert.ok(!settings.isVisibleOn({ x: 2000, y: 100, width: 1100, height: 700 }, screens));
  assert.ok(!settings.isVisibleOn({ x: 100, y: -600, width: 1100, height: 700 }, screens), 'title bar above the screen');
  assert.ok(!settings.isVisibleOn({ width: 1100, height: 700 }, screens));
  assert.ok(settings.isVisibleOn({ x: 2000, y: 100, width: 1100, height: 700 }, [...screens, { x: 1920, y: 0, width: 2560, height: 1400 }]));
});

test('parseNews nettoie et trie les nouvelles', () => {
  const r = feeds.parseNews({
    items: [
      { title: 'Ancienne', date: '2026-01-02', body: ['a', 42, ''], url: 'javascript:alert(1)' },
      { title: '  Récente  ', date: '2026-09-23', tag: 'Mise à jour', summary: 'x', url: 'https://github.com/' },
      { title: '', date: '2026-09-24' },
      null,
      { title: 'Sans date', date: 'hier' },
    ],
  });
  assert.deepEqual(r.items.map((i) => i.title), ['Récente', 'Ancienne', 'Sans date']);
  assert.equal(r.items[0].url, 'https://github.com/');
  assert.equal(r.items[1].url, '');
  assert.deepEqual(r.items[1].body, ['a']);
  assert.equal(r.items[2].date, '');
  assert.equal(feeds.parseNews({ nope: 1 }), null);
  assert.equal(feeds.parseNews('<html>'), null);
  assert.equal(feeds.parseNews(Array.from({ length: 50 }, (_, i) => ({ title: `n${i}` }))).items.length, 20);
});

test('le news.json publié par le client est valide', () => {
  const file = path.join(__dirname, '..', '..', 'client', 'public', 'news.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = feeds.parseNews(raw);
  assert.ok(r && r.items.length >= 1);
  assert.equal(r.items.length, raw.items.length, 'no entry is dropped by the parser');
  for (const it of r.items) {
    assert.ok(it.title && it.summary, it.id);
  }
});

test('parseStatus tolère plusieurs formats de /api/status et /health', () => {
  assert.deepEqual(feeds.parseStatus({ ok: true, players: 12, maxPlayers: 100, version: '0.2.0' }),
    { online: true, players: 12, maxPlayers: 100, version: '0.2.0', message: '' });
  assert.equal(feeds.parseStatus({ online: 7 }).players, 7);
  assert.equal(feeds.parseStatus({ players: { online: 3, max: 50 } }).players, 3);
  assert.equal(feeds.parseStatus({ players: { online: 3, max: 50 } }).maxPlayers, 50);
  assert.equal(feeds.parseStatus({ players: ['a', 'b'] }).players, 2);
  assert.equal(feeds.parseStatus({ status: 'ok' }).online, true);
  assert.equal(feeds.parseStatus({ status: 'ok' }).players, null);
  const m = feeds.parseStatus({ status: 'maintenance' });
  assert.equal(m.online, false);
  assert.equal(m.message, 'Maintenance en cours');
  assert.equal(feeds.parseStatus({ ok: false }).online, false);
  assert.equal(feeds.parseStatus('ok').online, true);
  assert.equal(feeds.parseStatus({ players: -3 }).players, null);
});

test('friendlyError traduit les erreurs de mise à jour', () => {
  assert.match(friendlyError(new Error('Could not get code signature for running application')), /macOS non signée/);
  assert.match(friendlyError(new Error('No published versions on GitHub')), /Aucune mise à jour/);
  assert.match(friendlyError(new Error('net::ERR_INTERNET_DISCONNECTED')), /pas de connexion/);
  assert.match(friendlyError(new Error('sha512 checksum mismatch')), /corrompu/);
  assert.match(friendlyError('???'), /a échoué/);
});
