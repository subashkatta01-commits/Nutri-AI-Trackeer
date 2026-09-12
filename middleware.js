/**
 * Input Validation Middleware
 */
import {verifyToken as verifyAuthToken } from './authUtils.js';
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

export function validateNutritionGoals(req, res, next) {
  const { dailyCalorieTarget, dailyProteinTarget, dailyCarbsTarget, dailyFatsTarget } = req.body;

  // Validate calorie target
  if (dailyCalorieTarget !== undefined && dailyCalorieTarget !== null) {
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
    if (value !== undefined && value !== null) {
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

export function validateAuthInput(req, res, next) {
  const { email, password, username } = req.body;

  // For signup
  if (req.path.includes('signup')) {
    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters long'
      });
    }
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid email address'
    });
  }

  // Validate password
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
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No authorization token provided'
    });
  }

  const token = authHeader.split(' ')[1];

  const userId = verifyAuthToken(token);

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }

  req.userId = userId;

  next();
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
