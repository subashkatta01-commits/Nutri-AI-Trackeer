/**
 * Input Validation Middleware
 */

import { getUserById } from './db.js';
import { verifyJwtToken } from './authUtils.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateMealInput(req, res, next) {
  const { mealType, category, textInput, imageBase64, loggedOn, notes, imageUrl, portionSizes } = req.body;

  // Check that either text or image is provided
  if (!textInput && !imageBase64 && !imageUrl) {
    return res.status(400).json({
      success: false,
      error: 'Please provide either a meal description, image, or image URL.'
    });
  }

  // Validate mealType
  const validMealTypes = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  if (mealType && !validMealTypes.includes(mealType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid meal type. Must be one of: ${validMealTypes.join(', ')}`
    });
  }

  // Validate category
  if (!category || category.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Category is required.'
    });
  }

  // Validate user-selected meal date/time (ISO 8601)
  if (loggedOn !== undefined && loggedOn !== null && loggedOn !== '') {
    if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(String(loggedOn))) {
      return res.status(400).json({
        success: false,
        error: 'Meal date/time must be in YYYY-MM-DD or ISO 8601 format.'
      });
    }
  }

  // Validate image size (limit to ~5MB base64)
  if (imageBase64 && imageBase64.length > 5242880) {
    return res.status(400).json({
      success: false,
      error: 'Image is too large. Maximum size: 5MB'
    });
  }

  // Validate image URL format
  if (imageUrl && !/^https?:\/\/.+/i.test(String(imageUrl))) {
    return res.status(400).json({
      success: false,
      error: 'Image URL must be a valid HTTP(S) URL.'
    });
  }

  // Validate text input length
  if (textInput && textInput.length > 5000) {
    return res.status(400).json({
      success: false,
      error: 'Description is too long. Maximum: 5000 characters'
    });
  }

  // Validate notes length
  if (notes !== undefined && notes !== null && String(notes).length > 1000) {
    return res.status(400).json({
      success: false,
      error: 'Notes are too long (max 1000 characters).'
    });
  }

  // Validate portion sizes array
  if (portionSizes !== undefined && portionSizes !== null) {
    if (!Array.isArray(portionSizes)) {
      return res.status(400).json({
        success: false,
        error: 'Portion sizes must be an array.'
      });
    }
    if (portionSizes.length > 40) {
      return res.status(400).json({
        success: false,
        error: 'Portion sizes may contain at most 40 entries.'
      });
    }
  }

  next();
}

/**
 * Validate a partial meal-log edit (PUT /api/logs/:id).
 *
 * Only the fields the table editor can change are accepted. Rejecting unknown
 * keys here keeps the endpoint from being used to tamper with `user_id`, `id`
 * or the stored photo.
 */
export function validateMealEdit(req, res, next) {
  const allowed = [
    'mealType',
    'category',
    'mealName',
    'calories',
    'protein',
    'carbs',
    'fats',
    'efficiencyScore',
    'advice',
    'goalAlignmentReason',
    'detectedItems'
  ];

  const body = req.body || {};
  const provided = allowed.filter((key) =>
    Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined && body[key] !== null
  );

  if (provided.length === 0) {
    return res.status(400).json({
      success: false,
      error: `Provide at least one editable field: ${allowed.join(', ')}.`
    });
  }

  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Cannot edit: ${unexpected.join(', ')}.`
    });
  }

  const validMealTypes = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  if ('mealType' in body && !validMealTypes.includes(body.mealType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid meal type. Must be one of: ${validMealTypes.join(', ')}`
    });
  }

  if ('category' in body) {
    const category = String(body.category).trim();
    if (!category || category.length > 120) {
      return res.status(400).json({ success: false, error: 'Category must be 1-120 characters.' });
    }
    body.category = category;
  }

  if ('mealName' in body) {
    const mealName = String(body.mealName).trim();
    if (!mealName || mealName.length > 160) {
      return res.status(400).json({ success: false, error: 'Meal name must be 1-160 characters.' });
    }
    body.mealName = mealName;
  }

  if ('efficiencyScore' in body) {
    const valid = ['High', 'Medium', 'Low'];
    if (!valid.includes(body.efficiencyScore)) {
      return res.status(400).json({ success: false, error: `Efficiency score must be one of: ${valid.join(', ')}` });
    }
  }

  const numericFields = { calories: 10000, protein: 1000, carbs: 1000, fats: 1000 };
  for (const [field, max] of Object.entries(numericFields)) {
    if (!(field in body)) continue;

    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0 || value > max) {
      return res.status(400).json({
        success: false,
        error: `${field} must be a number between 0 and ${max}.`
      });
    }
    body[field] = Math.round(value);
  }

  const textFields = { advice: 1000, goalAlignmentReason: 1000 };
  for (const [field, max] of Object.entries(textFields)) {
    if (!(field in body)) continue;

    const value = String(body[field]);
    if (value.length > max) {
      return res.status(400).json({ success: false, error: `${field} is too long (max ${max} characters).` });
    }
    body[field] = value.trim();
  }

  if ('detectedItems' in body) {
    const items = body.detectedItems;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'detectedItems must be an array.' });
    }
    if (items.length > 40) {
      return res.status(400).json({ success: false, error: 'detectedItems may contain at most 40 entries.' });
    }

    for (const item of items) {
      if (!item || typeof item !== 'object' || !String(item.name || '').trim()) {
        return res.status(400).json({ success: false, error: 'Each detected item needs a name.' });
      }
    }

    body.detectedItems = items.map((item) => ({
      name: String(item.name).trim().slice(0, 120),
      estimatedPortion: String(item.estimatedPortion || '').trim().slice(0, 120)
    }));
  }

  next();
}

/**
 * Validate a water check-in (POST /api/water).
 *
 * Accepts either a full `intakeMl` (set-the-day-total form) or a `deltaMl`
 * increment (quick "+250ml" tap form). `date` is optional - the endpoint
 * defaults to today - but when supplied it must be a real YYYY-MM-DD date so
 * the one-entry-per-day index holds.
 */
export function validateWaterInput(req, res, next) {
  const { intakeMl, deltaMl, goalMl, date } = req.body;

  const hasIntake = intakeMl !== undefined && intakeMl !== null && intakeMl !== '';
  const hasDelta = deltaMl !== undefined && deltaMl !== null && deltaMl !== '';

  if (!hasIntake && !hasDelta) {
    return res.status(400).json({
      success: false,
      error: 'Provide intakeMl (day total) or deltaMl (amount to add).'
    });
  }

  const clampIntake = (value, min, max, label) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < min || num > max) {
      return res.status(400).json({
        success: false,
        error: `${label} must be a number between ${min} and ${max}.`
      });
    }
    return Math.round(num);
  };

  if (hasIntake && hasDelta) {
    return res.status(400).json({
      success: false,
      error: 'Provide either intakeMl or deltaMl, not both.'
    });
  }

  const normalized = {};

  if (hasIntake) {
    // 0 is a legitimate total (a "reset my day" tap), so only reject negatives.
    normalized.intakeMl = clampIntake(intakeMl, 0, 20000, 'intakeMl');
  }

  if (hasDelta) {
    // Deltas are strictly positive: removing water is done with intakeMl=0,
    // and a negative tap is far more likely a mis-parse than an intent.
    normalized.deltaMl = clampIntake(deltaMl, 1, 5000, 'deltaMl');
  }

  if (goalMl !== undefined && goalMl !== null && goalMl !== '') {
    normalized.goalMl = clampIntake(goalMl, 500, 10000, 'goalMl');
  }

  if (date !== undefined && date !== null && date !== '' && !DATE_ONLY_PATTERN.test(String(date))) {
    return res.status(400).json({
      success: false,
      error: 'Date must be in YYYY-MM-DD format.'
    });
  }

  normalized.date = date ? String(date) : null;

  req.waterInput = normalized;
  next();
}

/**
 * Validate a progress photo upload (POST /api/progress-photos).
 *
 * The photo is compressed in the browser before upload, so the ceiling here is
 * deliberately generous but still bounded - the blob is stored inline in SQLite
 * and an unbounded payload would grow the database file without limit.
 */
export function validateProgressPhotoInput(req, res, next) {
  const { imageBase64, note, weightKg, date } = req.body;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'An image is required.'
    });
  }

  // Require a recognisable data URL so a raw/broken string cannot be stored.
  if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(imageBase64)) {
    return res.status(400).json({
      success: false,
      error: 'Image must be a base64 data URL (jpeg, png, webp or gif).'
    });
  }

  // 6MB of base64 is roughly 4.5MB of decoded image.
  const MAX_PROGRESS_PHOTO_BASE64 = 6 * 1024 * 1024;
  if (imageBase64.length > MAX_PROGRESS_PHOTO_BASE64) {
    return res.status(400).json({
      success: false,
      error: 'Image is too large. Maximum size: 6MB'
    });
  }

  if (note !== undefined && note !== null && String(note).length > 280) {
    return res.status(400).json({
      success: false,
      error: 'Note is too long (max 280 characters).'
    });
  }

  let normalizedWeight = null;
  if (weightKg !== undefined && weightKg !== null && weightKg !== '') {
    const weight = Number(weightKg);
    if (!Number.isFinite(weight) || weight < 25 || weight > 400) {
      return res.status(400).json({
        success: false,
        error: 'weightKg must be a number between 25 and 400.'
      });
    }
    normalizedWeight = Math.round(weight * 10) / 10;
  }

  if (date !== undefined && date !== null && date !== '' && !DATE_ONLY_PATTERN.test(String(date))) {
    return res.status(400).json({
      success: false,
      error: 'Date must be in YYYY-MM-DD format.'
    });
  }

  req.progressPhotoInput = {
    imageBase64,
    note: note ? String(note).trim() : null,
    weightKg: normalizedWeight,
    date: date ? String(date) : null
  };

  next();
}

/**
 * Validate a water check-in (POST /api/weight).
 *
 * `date` is optional - the endpoint defaults to today - but when supplied it
 * must be a real YYYY-MM-DD date so the one-entry-per-day index holds.
 */
export function validateWeightInput(req, res, next) {
  const { weightKg, date } = req.body;

  const weight = Number(weightKg);
  if (!Number.isFinite(weight) || weight < 25 || weight > 400) {
    return res.status(400).json({
      success: false,
      error: 'Weight must be a number between 25 and 400 kg.'
    });
  }

  if (date !== undefined && date !== null && !DATE_ONLY_PATTERN.test(String(date))) {
    return res.status(400).json({
      success: false,
      error: 'Date must be in YYYY-MM-DD format.'
    });
  }

  req.weightInput = {
    weightKg: Math.round(weight * 10) / 10,
    date: date ? String(date) : null
  };

  next();
}

export function validateNutritionGoals(req, res, next) {
  const { dailyCalorieTarget, dailyProteinTarget, dailyCarbsTarget, dailyFatsTarget } = req.body;

  // Validate calorie target
  if (dailyCalorieTarget) {
    const cal = parseInt(dailyCalorieTarget);
    if (isNaN(cal) || cal < 500 || cal > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Daily calorie target must be between 500 and 10000'
      });
    }
  }

  // Validate macro targets
  const validateMacro = (value, name) => {
    if (value) {
      const macro = parseFloat(value);
      if (isNaN(macro) || macro < 0 || macro > 500) {
        return `${name} must be between 0 and 500g`;
      }
    }
    return null;
  };

  const proteinError = validateMacro(dailyProteinTarget, 'Protein');
  const carbsError = validateMacro(dailyCarbsTarget, 'Carbs');
  const fatsError = validateMacro(dailyFatsTarget, 'Fats');

  if (proteinError || carbsError || fatsError) {
    return res.status(400).json({
      success: false,
      error: proteinError || carbsError || fatsError
    });
  }

  next();
}

export function validateProfileInput(req, res, next) {
  const { age, gender, heightCm, weightKg, activityLevel, goal, dietaryPreferences, allergies } = req.body;

  const validGender = ['male', 'female', 'other'];
  const validActivity = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
  const validGoal = ['lose', 'maintain', 'gain'];

  if (typeof age === 'undefined' || Number.isNaN(parseInt(age)) || parseInt(age) < 13 || parseInt(age) > 120) {
    return res.status(400).json({ success: false, error: 'Age must be between 13 and 120' });
  }
  if (!validGender.includes(gender)) {
    return res.status(400).json({ success: false, error: 'Gender must be male, female, or other' });
  }
  if (Number.isNaN(parseFloat(heightCm)) || parseFloat(heightCm) < 90 || parseFloat(heightCm) > 250) {
    return res.status(400).json({ success: false, error: 'Height must be between 90 and 250 cm' });
  }
  if (Number.isNaN(parseFloat(weightKg)) || parseFloat(weightKg) < 25 || parseFloat(weightKg) > 400) {
    return res.status(400).json({ success: false, error: 'Weight must be between 25 and 400 kg' });
  }
  if (!validActivity.includes(activityLevel)) {
    return res.status(400).json({ success: false, error: 'Invalid activity level' });
  }
  if (!validGoal.includes(goal)) {
    return res.status(400).json({ success: false, error: 'Primary goal must be lose, maintain, or gain' });
  }
  if (dietaryPreferences && dietaryPreferences.length > 500) {
    return res.status(400).json({ success: false, error: 'Dietary preferences list is too long' });
  }
  if (allergies && String(allergies).length > 1000) {
    return res.status(400).json({ success: false, error: 'Allergies text is too long (max 1000 characters)' });
  }

  req.profileInput = req.body;
  next();
}

const PASSWORD_MAX_BYTES = 128;
const PASSWORD_MIN_LENGTH = 8;

// Commonly abused passwords that must never be allowed, even though they meet
// the structural rules. Keep this small so the check stays O(1).
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  '12345678910', 'qwerty123', 'qwertyuiop', 'abc123456', 'abcd1234',
  'letmein', 'letmein123', 'welcome', 'welcome1', 'monkey', 'monkey123',
  'dragon', 'dragon123', 'admin', 'admin123', 'root1234', 'user', 'user1234',
  '11111111', '22222222', '123321', '654321', 'iloveyou', 'sunshine', 'princess'
]);

export function validateAuthInput(req, res, next) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { email, password, username } = body;

  if (req.path.includes('signup')) {
    if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3-32 characters and use only letters, numbers, dots, underscores, or hyphens.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof email !== 'string' || email.length > 254 || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address (max 254 characters).'
      });
    }
  }

  if (req.path.includes('login')) {
    const loginIdentifier = typeof username === 'string'
      ? username.trim()
      : typeof email === 'string' ? email.trim() : '';

    if (!loginIdentifier || loginIdentifier.length < 3 || loginIdentifier.length > 254) {
      return res.status(400).json({
        success: false,
        error: 'Please provide your username or email'
      });
    }
  }

  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return res.status(400).json({ success: false, error: `Password must be at most ${PASSWORD_MAX_BYTES} bytes.` });
  }

  if (req.path.includes('signup') && password.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
    });
  }

  if (req.path.includes('signup')) {
    // Structural strength: at least one letter and one digit.
    if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must contain at least one letter and one number.'
      });
    }

    // Reject passwords on the common-password list.
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'This password is too easy to guess. Please choose a stronger one.'
      });
    }
  }

  req.body = body;
  next();
}

function createAuthRateLimiter({ limit, windowMs }) {
  const buckets = new Map();
  let requestsSinceCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - bucket.count));
    res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' });
    }

    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 1000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
      requestsSinceCleanup = 0;
    }

    next();
  };
}

export const loginRateLimit = createAuthRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
export const signupRateLimit = createAuthRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

// ========== AUTH RATE LIMITERS ==========

export const changePasswordRateLimit = createAuthRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
export const forgotPasswordRateLimit = createAuthRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 });
export const resetPasswordRateLimit = createAuthRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
export const deleteAccountRateLimit = createAuthRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 });
export const exportRateLimit = createAuthRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });

function isStrongPassword(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) return false;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return false;
  return true;
}

export function validateChangePasswordInput(req, res, next) {
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Current password is required.'
    });
  }

  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'New password is required.'
    });
  }

  if (Buffer.byteLength(newPassword, 'utf8') > PASSWORD_MAX_BYTES) {
    return res.status(400).json({
      success: false,
      error: `New password must be at most ${PASSWORD_MAX_BYTES} bytes.`
    });
  }

  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({
      success: false,
      error: 'New password must be at least 8 characters, contain at least one letter and one number, and not be a commonly used password.'
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      success: false,
      error: 'New password must be different from your current password.'
    });
  }

  next();
}

export function validateForgotPasswordInput(req, res, next) {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (typeof email !== 'string' || email.length > 254 || !emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid email address.'
    });
  }

  next();
}

export function validateResetPasswordInput(req, res, next) {
  const { token, newPassword } = req.body;

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Reset token is required.'
    });
  }

  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'New password is required.'
    });
  }

  if (Buffer.byteLength(newPassword, 'utf8') > PASSWORD_MAX_BYTES) {
    return res.status(400).json({
      success: false,
      error: `New password must be at most ${PASSWORD_MAX_BYTES} bytes.`
    });
  }

  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({
      success: false,
      error: 'New password must be at least 8 characters, contain at least one letter and one number, and not be a commonly used password.'
    });
  }

  next();
}

/**
 * Verify signed HS256 access token and confirm its user still exists.
 */
export function verifyToken(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      error: 'No authorization token provided'
    });
  }

  try {
    const userId = verifyJwtToken(token);
    if (!Number.isInteger(userId) || userId < 1 || !getUserById(userId)) {
      throw new Error('Invalid token');
    }
    req.userId = userId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

/**
 * Error handling middleware
 */
export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  const status = err.status || 500;
  const message = err.message || 'An unexpected error occurred';

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { details: err.stack })
  });
}
