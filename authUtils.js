/**
 * Authentication Utilities
 */

/**
 * Generate a simple token (in production, use JWT)
 */
export function generateToken(userId) {
  // Simple token: just the user ID
  // In production, use a proper JWT library with expiration
  return userId.toString();
}

/**
 * Format user response (exclude sensitive data)
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
