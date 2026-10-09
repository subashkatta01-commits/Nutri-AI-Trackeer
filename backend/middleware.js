/**
 * Input Validation Middleware
 */

import { getUserById } from './db.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateMealInput(req, res, next) {
  const { mealType, category, textInput, imageBase64 } = req.body;

  // Check that either text or image is provided
  if (!textInput && !imageBase64) {
    return res.status(400).json({
      success: false,
      error: 'Please provide either a meal description or image.'
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

  // Validate image size (limit to ~5MB base64)
  if (imageBase64 && imageBase64.length > 5242880) {
    return res.status(400).json({
      success: false,
      error: 'Image is too large. Maximum size: 5MB'
    });
  }

  // Validate text input length
  if (textInput && textInput.length > 5000) {
    return res.status(400).json({
      success: false,
      error: 'Description is too long. Maximum: 5000 characters'
    });
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

export function validateAuthInput(req, res, next) {
  const { email, password, username } = req.body;

  if (req.path.includes('signup')) {
    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters long'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }
  }

  if (req.path.includes('login')) {
    const loginIdentifier = (username || email || '').trim();

    if (!loginIdentifier || loginIdentifier.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Please provide your username or email'
      });
    }
  }

  if (!password || password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters long'
    });
  }

  next();
}

/**
 * Verify JWT Token (session storage based)
 * In production, use a proper JWT library
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
    const userId = parseInt(token);
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
