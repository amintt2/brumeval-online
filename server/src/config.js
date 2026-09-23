// Server-only tuning constants. Everything shared with the client lives in shared/.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Repository root (…/mmorpg), used to resolve relative data/static directories. */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MAX_PLAYERS = Math.max(1, Number.parseInt(process.env.MAX_PLAYERS || '', 10) || 100); // [netcode-perf] env override (load tests)
export const SAVE_INTERVAL_MS = 10_000; // dev restarts (node --watch) kill the process without a graceful save
export const MAX_PAYLOAD = 8 * 1024;           // ws maxPayload (bytes)
export const MSG_RATE_PER_S = 60;              // more than this per second -> kick
export const CHAT_RATE = { count: 5, windowMs: 5000 };
export const MAX_AUTH_ATTEMPTS = 12;           // per connection
export const HEARTBEAT_MS = 15_000;            // ws ping; dead sockets are terminated
export const STATUS_LOG_MS = 5 * 60_000;       // periodic one-line status in the log
export const MAX_BUFFERED_BYTES = 2 * 1024 * 1024; // slow consumer protection

// Movement validation (SPEC §4.6)
export const MOVE_SPEED_FACTOR = 1.35;
export const MOVE_SLACK_M = 0.6;
export const MOVE_MAX_ELAPSED_S = 1;
export const MAX_PENETRATION = 0.15;
export const CORRECT_MIN_INTERVAL_MS = 250;
export const MOVE_STATE_MS = 250;

// Combat / world
export const RANGE_TOLERANCE = 0.5;            // ability range slack (server position lag)
export const INTERACT_TOLERANCE = 1.0;         // NPC interaction slack
export const DIALOG_CLOSE_DIST = 8;            // close_dialog when farther than this from the NPC
export const LEASH_EXTRA = 18;                 // monsters leash when > zone.r + this from the zone centre
export const AOI_EXIT_MARGIN = 5;              // hysteresis so entities do not flicker at the AOI border
export const MULTI_HIT_INTERVAL_MS = 250;      // spacing of `hits > 1` projectiles
export const NPC_LEVEL = 10;
export const NPC_HP = 1000;
export const START_TOD = 0.3;                  // server boots in the morning

export const MOTD = 'Bienvenue sur Brumeval Online ! Tapez /help pour la liste des commandes.';
