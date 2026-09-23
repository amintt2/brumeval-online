// [combat-souls] Telegraph timing on the client (pure, tested in server/test/render.test.js).
// The server resolves a telegraphed hit `ms` after it SENT the telegraph; the client receives it half a round trip
// later, and a roll / step needs another half round trip to reach the server. So the decal must be full one RTT
// before `arrival + ms`: that is the last moment an answer still arrives in time.

/** Client wind-up of a telegraph of `ms` given the smoothed round trip `rtt`: ms - rtt, never under 60 % of ms. */
export function windupMs(ms, rtt = 0) {
  const lead = Number.isFinite(rtt) && rtt > 0 ? rtt : 0;
  return Math.max(ms * 0.6, ms - lead);
}
