// Fingerprint unlock via WebAuthn with the phone's built-in authenticator.
// There is no server, so the app stores the credential's public key in its own
// settings and checks each signed unlock locally. Unlocking with a fingerprint is only
// allowed from 9am to 7pm, Monday to Friday, by the device's clock.

import * as db from './db.js';

const SETTING = 'fingerprint'; // JSON { id, key }: credential id and SPKI public key, base64url

let supported = false;
let pending = null; // AbortController for an open prompt

const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

export async function detect() {
  supported = !!window.PublicKeyCredential
    && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
}

export const isSupported = () => supported;
export const isEnrolled = () => supported && !!db.getSetting(SETTING);

export function inWindow(d = new Date()) {
  const day = d.getDay();
  const h = d.getHours();
  return day >= 1 && day <= 5 && h >= 9 && h < 19;
}

export const canUnlock = () => isEnrolled() && inWindow();

export async function enroll() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Nuggets' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'nuggets', displayName: 'Nuggets' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  const key = cred.response.getPublicKey?.();
  if (!key) throw new Error('No public key');
  db.setSetting(SETTING, JSON.stringify({ id: b64e(cred.rawId), key: b64e(key) }));
}

export const disable = () => db.setSetting(SETTING, '');

export function cancel() {
  pending?.abort();
  pending = null;
}

// Resolves true only for a fresh, user-verified signature from the enrolled credential.
export async function verify() {
  if (!canUnlock() || pending) return false;
  const fp = JSON.parse(db.getSetting(SETTING));
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  pending = new AbortController();
  try {
    const { response: r } = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: b64d(fp.id) }],
        userVerification: 'required',
        timeout: 60000,
      },
      signal: pending.signal,
    });
    const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
    if (client.type !== 'webauthn.get' || client.challenge !== b64e(challenge) || client.origin !== location.origin) return false;
    const auth = new Uint8Array(r.authenticatorData);
    const rpHash = await sha256(new TextEncoder().encode(location.hostname));
    if (!rpHash.every((b, i) => b === auth[i]) || !(auth[32] & 0x04)) return false; // RP id, user-verified flag
    const key = await crypto.subtle.importKey('spki', b64d(fp.key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signed = new Uint8Array([...auth, ...await sha256(r.clientDataJSON)]);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(r.signature)), signed);
    return ok && inWindow(); // the window may have closed while the prompt was open
  } catch {
    return false;
  } finally {
    pending = null;
  }
}

// WebAuthn returns a DER-encoded ECDSA signature; WebCrypto wants raw r || s.
function derToRaw(der) {
  const out = new Uint8Array(64);
  let i = 2;
  for (const off of [0, 32]) {
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    out.set(v, off + 32 - v.length);
    i += 2 + len;
  }
  return out;
}
