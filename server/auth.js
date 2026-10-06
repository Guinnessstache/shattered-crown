// Accounts: username + password (scrypt) and Google sign-in. Sessions are signed tokens
// the browser keeps and sends when it connects.
import { scrypt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const TOKEN_DAYS = 60;

export function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, 'secret.txt');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(f, s);
  return s;
}

export function hashPassword(pw) {
  return new Promise((res, rej) => {
    const salt = randomBytes(16);
    scrypt(pw, salt, 64, (err, key) => (err ? rej(err) : res(`s1$${salt.toString('hex')}$${key.toString('hex')}`)));
  });
}

export function checkPassword(pw, stored) {
  return new Promise((res) => {
    const [v, saltHex, keyHex] = String(stored || '').split('$');
    if (v !== 's1' || !saltHex) return res(false);
    scrypt(pw, Buffer.from(saltHex, 'hex'), 64, (err, key) => {
      if (err) return res(false);
      const want = Buffer.from(keyHex, 'hex');
      res(want.length === key.length && timingSafeEqual(want, key));
    });
  });
}

export function signToken(secret, accountId) {
  const body = `${accountId}.${Date.now() + TOKEN_DAYS * 864e5}`;
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const want = createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(id);
}

export function validUsername(u) { return typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u); }
export function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 100; }

// Google sign-in: the browser gets an ID token from Google; we ask Google to check it.
export async function verifyGoogleToken(idToken, clientId) {
  if (!clientId) throw new Error('Google sign-in is not set up on this server');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!r.ok) throw new Error('Google could not verify that sign-in');
  const t = await r.json();
  if (t.aud !== clientId) throw new Error('Sign-in was for a different app');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) throw new Error('Bad token issuer');
  if (Number(t.exp) * 1000 < Date.now()) throw new Error('Sign-in expired, try again');
  return { sub: t.sub, email: t.email_verified === 'true' || t.email_verified === true ? t.email : null, name: t.given_name || t.name || '' };
}

// Tiny per-IP rate limiter for login attempts.
const hits = new Map();
export function rateLimited(ip, max = 12, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, t: now };
  if (now - h.t > windowMs) { h.n = 0; h.t = now; }
  h.n++;
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > max;
}
