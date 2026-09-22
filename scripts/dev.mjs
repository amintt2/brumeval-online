#!/usr/bin/env node
// Development: game server (auto-restart on change) + Vite dev server (proxies /ws to the game server).
// Open http://localhost:5173
import { spawn } from 'node:child_process';

const procs = [];
const run = (name, cmd, args, cwd) => {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => { console.log(`[${name}] exited (${code})`); shutdown(); });
  procs.push(p);
};
const shutdown = () => { for (const p of procs) if (!p.killed) p.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', 'node', ['--watch-path=server/src', '--watch-path=shared', 'server/src/index.js'], process.cwd());
run('client', 'npx', ['vite', '--host'], 'client');
