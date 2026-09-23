// [accounts] Client helpers without a browser: launcher installer names (must match launcher/electron-builder.yml)
// and OS detection for the « Télécharger le launcher » card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launcherDownloads, detectOs, LATEST_DOWNLOAD } from '../../client/src/account/launcherDownload.js';

const builder = fs.readFileSync(new URL('../../launcher/electron-builder.yml', import.meta.url), 'utf8');
const pattern = (section) => new RegExp(`^${section}:\\s*\\n(?:\\s+.*\\n)*?\\s+artifactName:\\s*(\\S+)`, 'm').exec(builder)?.[1];
/** electron-builder macro expansion (x64 AppImage is named x86_64). */
const expand = (p, version, arch, ext) => p.replace('${version}', version).replace('${arch}', arch).replace('${ext}', ext);

test('launcher download links follow the electron-builder artifact names', () => {
  const v = '9.8.7';
  const win = launcherDownloads('windows', v).files;
  assert.equal(win[0].name, expand(pattern('nsis'), v, 'x64', 'exe'));
  const mac = launcherDownloads('mac', v).files.map((f) => f.name);
  assert.deepEqual(mac, ['arm64', 'x64'].map((a) => expand(pattern('dmg'), v, a, 'dmg')));
  const linux = launcherDownloads('linux', v).files;
  assert.equal(linux[0].name, expand(pattern('appImage'), v, 'x86_64', 'AppImage'));
  for (const f of [...win, ...linux]) assert.equal(f.url, `${LATEST_DOWNLOAD}/${f.name}`);
  assert.deepEqual(launcherDownloads('other', v).files, []);
});

test('OS detection for the launcher card', () => {
  const ua = {
    win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148',
  };
  assert.equal(detectOs({ userAgent: ua.win }), 'windows');
  assert.equal(detectOs({ userAgent: ua.mac }), 'mac');
  assert.equal(detectOs({ userAgent: ua.mac, maxTouchPoints: 5 }), 'other', 'iPadOS');
  assert.equal(detectOs({ userAgent: ua.linux }), 'linux');
  assert.equal(detectOs({ userAgent: ua.android }), 'other');
  assert.equal(detectOs({ userAgent: ua.iphone }), 'other');
  assert.equal(detectOs({ userAgent: '', userAgentData: { platform: 'Windows' } }), 'windows');
});
