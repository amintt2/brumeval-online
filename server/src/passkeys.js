// Passkeys (WebAuthn) with @simplewebauthn/server — docs/COMPTES.md.
// The challenges are per WebSocket connection (Session.webauthn), single use, and expire after CHALLENGE_TTL_MS.
// Login uses discoverable credentials: the browser offers the passkeys it knows for the RP ID, no name needed.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { GAME_TITLE } from '../../shared/data.js';

export const CHALLENGE_TTL_MS = 3 * 60_000;
const TIMEOUT_MS = 120_000;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

/** Hostname of a Host header / URL host ("[::1]:3000" -> "::1", "jeu.example:443" -> "jeu.example"). */
export function hostnameOf(host) {
  if (typeof host !== 'string' || !host) return '';
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined);
  return h.replace(/:\d+$/, '');
}

const originHost = (origin) => {
  try { return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return ''; }
};

/** A WebAuthn RP ID must be the page's host or one of its registrable parent domains. */
const rpMatchesHost = (rpId, host) => !!rpId && !!host && (host === rpId || host.endsWith(`.${rpId}`));

/**
 * Relying party of one WebSocket connection.
 * - RP ID: env RP_ID, otherwise the request host without port ("localhost" in development). When the page
 *   origin cannot use that RP ID (e.g. behind a proxy rewriting Host), the origin's host is used.
 * - Expected origins: the page origin of this connection (already accepted by the Origin allow-list) plus
 *   ALLOWED_ORIGINS.
 * @returns {{ id: string, origins: string[] } | null} null when passkeys cannot work on this connection
 */
export function relyingParty({ origin, host, env = process.env, allowedOrigins = [] }) {
  const pageHost = typeof origin === 'string' ? originHost(origin) : '';
  let id = (env.RP_ID || '').trim().toLowerCase() || hostnameOf(host);
  if (pageHost && !rpMatchesHost(id, pageHost) && !env.RP_ID) id = pageHost;
  if (!id) return null;
  const origins = new Set();
  if (typeof origin === 'string' && origin && rpMatchesHost(id, pageHost)) origins.add(origin.replace(/\/+$/, ''));
  for (const o of allowedOrigins) if (o && o !== '*' && rpMatchesHost(id, originHost(o))) origins.add(o.replace(/\/+$/, ''));
  if (!origins.size) return null;
  return { id, origins: [...origins] };
}

/** Options for navigator.credentials.create() (sent to the client as JSON). */
export async function registrationOptions(acc, rp) {
  return generateRegistrationOptions({
    rpName: GAME_TITLE,
    rpID: rp.id,
    userName: acc.login,
    userDisplayName: acc.login,
    userID: new Uint8Array(Buffer.from(acc.uid, 'base64url')),
    attestationType: 'none',
    timeout: TIMEOUT_MS,
    excludeCredentials: acc.passkeys.map((k) => ({ id: k.id, transports: k.transports })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
  });
}

/** Options for navigator.credentials.get() with discoverable credentials (no allowCredentials). */
export async function authenticationOptions(rp) {
  return generateAuthenticationOptions({ rpID: rp.id, timeout: TIMEOUT_MS, userVerification: 'preferred', allowCredentials: [] });
}

/** Cheap shape check of a RegistrationResponseJSON / AuthenticationResponseJSON before the crypto. */
export function responseShapeOk(resp, kind) {
  if (!resp || typeof resp !== 'object' || resp.type !== 'public-key') return false;
  if (typeof resp.id !== 'string' || !B64URL_RE.test(resp.id) || resp.id.length > 1400 || resp.rawId !== resp.id) return false;
  const r = resp.response;
  if (!r || typeof r !== 'object' || typeof r.clientDataJSON !== 'string') return false;
  if (kind === 'register') return typeof r.attestationObject === 'string';
  return typeof r.authenticatorData === 'string' && typeof r.signature === 'string';
}

/**
 * Verify a registration. Returns the credential record to store, or throws (message = reason, logged only).
 * @param {{ challenge: string }} ch the challenge issued to this connection
 */
export async function verifyRegistration(resp, ch, rp, label) {
  const v = await verifyRegistrationResponse({
    response: resp,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.id,
    requireUserVerification: false,
  });
  if (!v.verified || !v.registrationInfo) throw new Error('registration not verified');
  const { credential } = v.registrationInfo;
  const transports = (Array.isArray(resp.response?.transports) ? resp.response.transports : credential.transports || [])
    .filter((t) => TRANSPORTS.has(t));
  const now = Date.now();
  return {
    id: credential.id,
    pk: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter || 0,
    transports,
    label: cleanLabel(label) || defaultLabel(transports, v.registrationInfo.credentialDeviceType),
    created: now,
    used: 0,
  };
}

/**
 * Verify a login assertion against the stored credential `key` (found by credential id in the store).
 * Updates key.counter / key.used on success; throws otherwise.
 */
export async function verifyLogin(resp, ch, rp, acc, key) {
  if (resp.response.userHandle && resp.response.userHandle !== acc.uid) throw new Error('user handle mismatch');
  const v = await verifyAuthenticationResponse({
    response: resp,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.id,
    credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.pk, 'base64url')), counter: key.counter, transports: key.transports },
    requireUserVerification: false,
  });
  if (!v.verified) throw new Error('assertion not verified');
  key.counter = v.authenticationInfo.newCounter;
  key.used = Date.now();
  return true;
}

/** Passkey names chosen by the player: 1..40 printable characters. */
export function cleanLabel(label) {
  if (typeof label !== 'string') return '';
  return label.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40);
}

function defaultLabel(transports, deviceType) {
  if (transports.includes('internal')) return deviceType === 'multiDevice' ? 'Passkey synchronisée' : 'Cet appareil';
  if (transports.includes('hybrid')) return 'Téléphone';
  if (transports.includes('usb') || transports.includes('nfc')) return 'Clé de sécurité';
  return 'Clé d’accès';
}
