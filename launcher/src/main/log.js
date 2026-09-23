// Tiny file logger: <userData>/logs/launcher.log (rotated at 1 MB) + console.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;

function createLog(dir) {
  const file = path.join(dir, 'logs', 'launcher.log');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.statSync(file, { throwIfNoEntry: false })?.size > MAX_BYTES) fs.renameSync(file, file + '.1');
  } catch { /* logging must never break the launcher */ }

  const write = (level, args) => {
    const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
    (level === 'ERROR' ? console.error : console.log)(line);
    try {
      fs.appendFileSync(file, line + '\n');
    } catch { /* ignore */ }
  };
  return {
    file,
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
    debug: () => {},
  };
}

module.exports = { createLog };
