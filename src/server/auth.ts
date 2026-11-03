import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const SESSION_COOKIE = 'battlebots_session';
const SESSION_AGE_SECONDS = 12 * 60 * 60;

export interface AuthConfig {
  password: string;
  secret: string;
  production: boolean;
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const production = env.NODE_ENV === 'production';
  const password = env.DEMO_PASSWORD || (production ? '' : 'let-the-bots-battle');
  const secret = env.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  if (!password || secret.length < 32) {
    throw new Error('Set DEMO_PASSWORD and a SESSION_SECRET of at least 32 characters before production startup.');
  }
  return { password, secret, production };
}

export function passwordsEqual(candidate: string, expected: string): boolean {
  // HMAC produces fixed-size digests, so comparison does not reveal password length.
  const first = createHmac('sha256', 'battlebots-password-comparison').update(candidate).digest();
  const second = createHmac('sha256', 'battlebots-password-comparison').update(expected).digest();
  return timingSafeEqual(first, second);
}

export function issueSession(config: AuthConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ expires: now + SESSION_AGE_SECONDS * 1_000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  const signature = createHmac('sha256', config.secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function sessionValid(token: string, config: AuthConfig, now = Date.now()): boolean {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', config.secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof parsed === 'object' && parsed !== null && 'expires' in parsed &&
      typeof parsed.expires === 'number' && parsed.expires > now && parsed.expires <= now + SESSION_AGE_SECONDS * 1_000 &&
      'nonce' in parsed && typeof parsed.nonce === 'string';
  } catch {
    return false;
  }
}

export function cookieToken(headers: IncomingMessage['headers']): string {
  const entry = headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return entry?.slice(SESSION_COOKIE.length + 1) ?? '';
}

export function isAuthenticated(request: IncomingMessage, config: AuthConfig): boolean {
  return sessionValid(cookieToken(request.headers), config);
}

export function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

export function sessionCookie(token: string, config: AuthConfig): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE_SECONDS}${config.production ? '; Secure' : ''}`;
}
