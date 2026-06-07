import * as crypto from 'crypto';
import { getGoogleOAuthStateSecret } from '../config';

export type OAuthStatePayload = {
  uid: string;
  eventSlug: string;
  returnPath: string;
  exp: number;
  nonce: string;
};

function signPayload(encoded: string): string {
  return crypto
    .createHmac('sha256', getGoogleOAuthStateSecret())
    .update(encoded)
    .digest('base64url');
}

export function createOAuthState(payload: Omit<OAuthStatePayload, 'exp' | 'nonce'>): string {
  const full: OAuthStatePayload = {
    ...payload,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    return null;
  }

  const expected = signPayload(encoded);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as OAuthStatePayload;

    if (!payload.uid || !payload.eventSlug || !payload.returnPath || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    if (!payload.returnPath.startsWith('/') || payload.returnPath.includes('://')) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
