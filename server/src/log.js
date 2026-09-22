// Concise timestamped logger. `quiet` silences info lines (tests) but keeps errors.

const ts = () => new Date().toTimeString().slice(0, 8);

export function createLogger({ quiet = false } = {}) {
  return {
    info: (...a) => { if (!quiet) console.log(`[${ts()}]`, ...a); },
    warn: (...a) => { if (!quiet) console.warn(`[${ts()}] ATTENTION`, ...a); },
    error: (...a) => console.error(`[${ts()}] ERREUR`, ...a),
  };
}
