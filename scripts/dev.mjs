#!/usr/bin/env node
// Development: game server + Vite dev server (proxies /ws to the game server). Open http://localhost:5173
// The game server restarts when server/src or shared code REALLY changes (content hash — Windows emits spurious
// watch events), and it is asked to save accounts over IPC first instead of being killed (node --watch would
// terminate it without saving on Windows).
import { spawn, fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WATCHED = ['server/src', 'shared'];
const tag = (name) => (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));

let server = null;
let vite = null;
let restarting = false;
let stopping = false;

function startServer() {
  server = fork(path.join(ROOT, 'server/src/index.js'), [], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  server.stdout.on('data', tag('server'));
  server.stderr.on('data', tag('server'));
  server.on('exit', (code) => {
    server = null;
    if (stopping) return;
    if (restarting) { restarting = false; startServer(); return; }
    console.log(`[server] arrêté (code ${code}) — il redémarrera à la prochaine modification de server/src ou shared`);
  });
}

function restartServer() {
  if (!server) { startServer(); return; }
  if (restarting) return;
  restarting = true;
  console.log('[server] code modifié → sauvegarde des comptes puis redémarrage…');
  const s = server;
  s.send('shutdown');
  setTimeout(() => { if (s.exitCode === null) s.kill(); }, 6000);
}

const hashes = new Map();
const hashOf = (f) => {
  try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return null; }
};
let debounce = null;
for (const dir of WATCHED) {
  const abs = path.join(ROOT, dir);
  for (const f of fs.readdirSync(abs, { recursive: true })) if (String(f).endsWith('.js')) hashes.set(path.join(abs, String(f)), hashOf(path.join(abs, String(f))));
  fs.watch(abs, { recursive: true }, (_event, file) => {
    if (!file || !String(file).endsWith('.js')) return;
    const f = path.join(abs, String(file));
    const h = hashOf(f);
    if (hashes.get(f) === h) return; // touched but not changed
    hashes.set(f, h);
    clearTimeout(debounce);
    debounce = setTimeout(restartServer, 300);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  const done = () => { if (vite && !vite.killed) vite.kill(); process.exit(0); };
  if (!server) return done();
  server.once('exit', done);
  server.send('shutdown');
  setTimeout(done, 6000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
vite = spawn('npx', ['vite', '--host'], { cwd: path.join(ROOT, 'client'), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
vite.stdout.on('data', tag('client'));
vite.stderr.on('data', tag('client'));
vite.on('exit', (code) => { console.log(`[client] exited (${code})`); shutdown(); });
