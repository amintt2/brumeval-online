// Automated end-to-end check of the launcher, with no visible window:
//   1. starts a local game server (temporary DATA_DIR, port SMOKE_PORT or 3205) serving client/dist
//   2. runs the launcher with LAUNCHER_SMOKE=1 (hidden windows, temporary profile) against it
//   3. the launcher checks isolation, CSP, news, server status, the game page title, navigation lock,
//      cache clearing and closing, then exits with code 0 (or 1 with the reason).
// Usage (from launcher/):  npm run smoke            (development build)
//                          npm run smoke:packaged   (the app unpacked by electron-builder in dist/)
// LAUNCHER_SMOKE_URL=https://… skips the local server and targets that server instead.
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const LAUNCHER = path.resolve(__dirname, '..');
const ROOT = path.resolve(LAUNCHER, '..');
const PORT = Number(process.env.SMOKE_PORT || 3205);
const packaged = process.argv.includes('--packaged');

function packagedBinary() {
  const dist = path.join(LAUNCHER, 'dist');
  const candidates = {
    win32: [path.join(dist, 'win-unpacked', 'Brumeval Launcher.exe')],
    darwin: [
      path.join(dist, 'mac-arm64', 'Brumeval Launcher.app', 'Contents', 'MacOS', 'Brumeval Launcher'),
      path.join(dist, 'mac', 'Brumeval Launcher.app', 'Contents', 'MacOS', 'Brumeval Launcher'),
    ],
    linux: [path.join(dist, 'linux-unpacked', 'brumeval-launcher')],
  }[process.platform] || [];
  return candidates.find((p) => fs.existsSync(p));
}

function waitForHttp(url, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > end) reject(new Error(`serveur injoignable : ${url}`));
        else setTimeout(tryOnce, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tryOnce();
  });
}

/** Syntax-checks the launcher sources first: a load error in Electron would open an error dialog on screen. */
function checkSyntax() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(LAUNCHER, 'src'));
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(r.stderr);
      process.exit(1);
    }
  }
}

async function main() {
  if (!packaged) checkSyntax();
  let server = null;
  let dataDir = null;
  let target = process.env.LAUNCHER_SMOKE_URL;
  const cleanup = () => {
    if (server && server.exitCode === null) server.kill();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  process.on('exit', cleanup);

  if (!target) {
    if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) {
      console.error('client/dist introuvable : lancez « npm run build » à la racine du projet avant le test.');
      process.exit(1);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-smoke-data-'));
    target = `http://127.0.0.1:${PORT}`;
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });
    server.on('exit', (code) => {
      if (code !== null && code !== 0) console.error(`le serveur de jeu s'est arrêté (${code}) :\n${serverLog}`);
    });
    await waitForHttp(`${target}/`, 20000);
    console.log(`serveur de jeu local prêt sur ${target}`);
  }

  let bin;
  let args;
  if (packaged) {
    bin = packagedBinary();
    if (!bin) {
      console.error('Application empaquetée introuvable dans launcher/dist : lancez « npm run dist:win » (ou mac / linux).');
      process.exit(1);
    }
    args = [];
  } else {
    bin = require('electron');
    args = [LAUNCHER];
  }
  console.log(`launcher : ${path.relative(ROOT, bin) || bin}`);

  const env = { ...process.env, LAUNCHER_SMOKE: '1', LAUNCHER_SMOKE_URL: target };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
  child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
  const killer = setTimeout(() => {
    console.error('délai dépassé : arrêt du launcher');
    child.kill();
  }, 150000);
  const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
  clearTimeout(killer);
  cleanup();
  // The launcher exits 0 only after every check passed (a packaged GUI app may not forward its stdout on Windows).
  const passed = code === 0 && !out.includes('"smoke":"fail"');
  console.log(passed ? 'TEST DU LAUNCHER RÉUSSI' : `TEST DU LAUNCHER ÉCHOUÉ (code ${code})`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
