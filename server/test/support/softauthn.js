// Minimal software WebAuthn authenticator for tests (ES256, "none" attestation, discoverable credentials).
// It builds the exact JSON a browser returns through @simplewebauthn/browser (RegistrationResponseJSON /
// AuthenticationResponseJSON), so the server's verify paths run the real cryptography.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (buf) => createHash('sha256').update(buf).digest();

// ---- tiny CBOR encoder (unsigned / negative ints, byte strings, text strings, maps)
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) {
    const parts = [head(5, v.size)];
    for (const [k, x] of v) parts.push(cbor(k), cbor(x));
    return Buffer.concat(parts);
  }
  if (v && typeof v === 'object') return cbor(new Map(Object.entries(v)));
  throw new Error('cbor: unsupported value');
}

export class SoftAuthenticator {
  constructor() {
    this.creds = new Map(); // id (base64url) -> { privateKey, rpId, userHandle, counter }
  }

  /** navigator.credentials.create() */
  register(options, { origin, rpId = options.rp.id, flags = 0x45, tamper = null } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = randomBytes(16);
    const id = b64u(credId);
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(credId.length);
    const counter = Buffer.alloc(4);
    const authData = Buffer.concat([sha256(Buffer.from(rpId)), Buffer.from([flags]), counter, Buffer.alloc(16), lenBuf, credId, cose]);
    const clientData = { type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false };
    tamper?.(clientData);
    const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    this.creds.set(id, { privateKey, rpId, userHandle: options.user.id, counter: 0 });
    return {
      id, rawId: id, type: 'public-key',
      response: {
        clientDataJSON: b64u(Buffer.from(JSON.stringify(clientData))),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: { credProps: { rk: true } },
      authenticatorAttachment: 'platform',
    };
  }

  /** navigator.credentials.get() with a discoverable credential (the last one created, or `id`). */
  authenticate(options, { origin, id = [...this.creds.keys()].at(-1), tamper = null, badSignature = false, counter = null } = {}) {
    const c = this.creds.get(id);
    c.counter = counter ?? c.counter + 1;
    const cnt = Buffer.alloc(4);
    cnt.writeUInt32BE(c.counter);
    const authData = Buffer.concat([sha256(Buffer.from(options.rpId || c.rpId)), Buffer.from([0x05]), cnt]);
    const clientData = { type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false };
    tamper?.(clientData);
    const clientDataJSON = Buffer.from(JSON.stringify(clientData));
    let signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), c.privateKey);
    if (badSignature) signature = Buffer.from(signature.map((x, i) => (i === 10 ? x ^ 0xff : x)));
    return {
      id, rawId: id, type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: c.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
