/**
 * Authentication Utilities
 */

import crypto from 'crypto';

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function getAuthSecret() {
  const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('Set JWT_SECRET (or AUTH_SECRET) to a random secret of at least 32 bytes.');
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

/** Create a signed HS256 JWT with a 12-hour expiration. */
export function generateToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: String(userId), iat: now, exp: now + TOKEN_TTL_SECONDS }))
    .toString('base64url');
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${sign(unsignedToken)}`;
}

export function verifyJwtToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const expected = Buffer.from(sign(`${encodedHeader}.${encodedPayload}`));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) {
      return null;
    }
    return userId;
  } catch {
    return null;
  }
}

/**
 * Format user response (exclude sensitive data)
 */
export function formatUserResponse(user) {
  if (!user) return null;
  
  const { id, username, email, created_at, onboarding_completed } = user;
  return {
    id,
    username,
    email,
    created_at,
    onboarding_completed: onboarding_completed ? 1 : 0
  };
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize input string
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
