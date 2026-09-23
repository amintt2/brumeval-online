// [accounts] Passkeys (WebAuthn) in the browser, through @simplewebauthn/browser.
// The server sends the options (passkey_options) over the WebSocket; the challenge is bound to the connection.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

/** WebAuthn is available (secure context + API). */
export function passkeysSupported() {
  try {
    return !!window.isSecureContext && browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** French message for a WebAuthn failure (the user closed the dialog, no passkey, unsupported…). */
export function passkeyErrorText(err, purpose) {
  const name = err?.name || err?.cause?.name || '';
  const code = err?.code || '';
  if (name === 'NotAllowedError' || code === 'ERROR_CEREMONY_ABORTED') {
    return purpose === 'login'
      ? 'Connexion par clé d’accès annulée ou aucune clé trouvée pour ce site.'
      : 'Ajout de la clé d’accès annulé.';
  }
  if (name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'Cette clé d’accès est déjà enregistrée sur votre compte.';
  if (name === 'SecurityError') return 'Les clés d’accès ne fonctionnent pas sur cette adresse (HTTPS requis).';
  if (name === 'NotSupportedError') return 'Votre navigateur ou appareil ne prend pas en charge les clés d’accès.';
  return 'La clé d’accès n’a pas pu être utilisée. Réessayez.';
}

/** navigator.credentials.create() from server options; resolves with RegistrationResponseJSON. */
export function createPasskey(options) {
  return startRegistration({ optionsJSON: options });
}

/** navigator.credentials.get() with discoverable credentials; resolves with AuthenticationResponseJSON. */
export function usePasskey(options) {
  return startAuthentication({ optionsJSON: options });
}

/** A readable default name for a new passkey ("Chrome sur Windows"). */
export function defaultPasskeyLabel() {
  const ua = navigator.userAgent || '';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? (/(iPhone|iPad)/.test(ua) ? 'iOS' : 'macOS')
    : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /(iPhone|iPad)/.test(ua) ? 'iOS' : 'appareil';
  const br = /BrumevalLauncher/.test(ua) ? 'Launcher' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  return `${br} sur ${os}`;
}
