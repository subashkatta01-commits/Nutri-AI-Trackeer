import crypto from 'crypto';

const DEFAULT_SECRET_KEY = 'change-this-secret-in-production';

/**
 * Generate secure signed token
 */
export function generateToken(userId) {
  const payload = JSON.stringify({
    userId: Number(userId),
    createdAt: Date.now()
  });

  const encodedPayload = Buffer
    .from(payload)
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', process.env.AUTH_SECRET || DEFAULT_SECRET_KEY)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

/**
 * Verify token
 */
export function verifyToken(token) {
  try {
    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.AUTH_SECRET || DEFAULT_SECRET_KEY)
      .update(encodedPayload)
      .digest('base64url');

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString()
    );

    return payload.userId;
  } catch (error) {
    return null;
  }
}

/**
 * Format user response
 */
export function formatUserResponse(user) {
  if (!user) return null;

  const { id, username, email, created_at } = user;

  return {
    id,
    username,
    email,
    created_at
  };
}

/**
 * Validate email
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize input
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;

  return input
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}