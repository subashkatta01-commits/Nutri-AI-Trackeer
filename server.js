import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { 
  saveMealLog, getDailyLogs, getDailyTotals, deleteMealLog, deleteAllLogs, getMonthlyHistory,
  getMealLogById, updateMealLog, getLogsInDateRange, getTotalsByDate,
  createUser, authenticateUser, getUserById, emailExists, emailExists as checkEmailExists,
  getNutritionGoals, updateNutritionGoals, createNutritionGoals
} from './db.js';
import { 
  validateMealInput, validateNutritionGoals, validateAuthInput, 
  verifyToken, errorHandler 
} from './middleware.js';
import { generateToken, formatUserResponse, sanitizeInput } from './authUtils.js';

dotenv.config();




const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Static routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ========== AUTHENTICATION ENDPOINTS ==========

/**
 * POST /api/auth/signup
 * Create a new user account
 */
app.post('/api/auth/signup', validateAuthInput, (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if email already exists
    if (checkEmailExists(email)) {
      return res.status(409).json({
        success: false,
        error: 'Email already registered. Please use login instead.'
      });
    }

    // Create user
    const userId = createUser(sanitizeInput(username), email.toLowerCase(), password);
    const token = generateToken(userId);
    const user = getUserById(userId);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create account'
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user
 */
app.post('/api/auth/login', validateAuthInput, (req, res) => {
  try {
    const { email, password } = req.body;

    const user = authenticateUser(email.toLowerCase(), password);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user information
 */
app.get('/api/auth/me', verifyToken, (req, res) => {
  try {
    const user = getUserById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user information'
    });
  }
});

// ========== NUTRITION GOALS ENDPOINTS ==========

/**
 * GET /api/goals
 * Get user's nutrition goals
 */
app.get('/api/goals', verifyToken, (req, res) => {
  try {
    const goals = getNutritionGoals(req.userId);

    if (!goals) {
      return res.status(404).json({
        success: false,
        error: 'Nutrition goals not found'
      });
    }

    res.json({
      success: true,
      goals
    });
  } catch (error) {
    console.error('Fetch Goals Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch nutrition goals'
    });
  }
});

/**
 * PUT /api/goals
 * Update user's nutrition goals
 */
app.put('/api/goals', verifyToken, validateNutritionGoals, (req, res) => {
  try {
    const goalsData = {
      dailyCalorieTarget: req.body.dailyCalorieTarget,
      dailyProteinTarget: req.body.dailyProteinTarget,
      dailyCarbsTarget: req.body.dailyCarbsTarget,
      dailyFatsTarget: req.body.dailyFatsTarget
    };

    updateNutritionGoals(req.userId, goalsData);
    const updatedGoals = getNutritionGoals(req.userId);

    res.json({
      success: true,
      message: 'Nutrition goals updated successfully',
      goals: updatedGoals
    });
  } catch (error) {
    console.error('Update Goals Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update nutrition goals'
    });
  }
});

// ========== MEAL LOGGING ENDPOINTS ==========

/**
 * POST /api/analyze-meal
 * Analyze meal with AI and save to database
 */
app.post('/api/analyze-meal', verifyToken, validateMealInput, async (req, res) => {
  try {
    const { mealType, category, textInput, imageBase64 } = req.body;

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('YOUR_ACTUAL')) {
      return res.status(500).json({ 
        success: false, 
        error: 'Missing API Key! Please paste a valid key into your .env file.' 
      });
    }

    const systemPrompt = `
You are an advanced AI Clinical Dietitian and Sports Nutritionist.
Analyze the provided food description or photo.

User Fitness Category: "${category}"

CRITICAL NUTRITIONAL RULES & SANITY CHECKS:
- 1 Whole Egg ≈ 6g Protein, 5g Fat, 0.5g Carbs (~70 kcal).
- 1 Slice of Bread ≈ 3g-4g Protein, 12g-15g Carbs, 1g Fat (~70-80 kcal).
- Double-check macro values for realism! Never swap total calories (e.g., 188) into proteinGrams!
- Ensure total calories roughly match macronutrients: Calories = (Protein * 4) + (Carbs * 4) + (Fats * 9).

Perform these steps:
1. Identify all distinct food items in the text or photo.
2. Estimate the portion sizes (e.g., in grams or standard bowls/pieces).
3. Calculate accurate total calories and macronutrient breakdown (Protein, Carbs, Fats in grams).
4. Evaluate if this meal aligns well with the user's category goal.
5. Provide concise, actionable advice.

Reply ONLY in raw JSON with no markdown:
{
  "mealName": "Primary name of dish",
  "detectedItems": [
    { "name": "Item Name", "estimatedPortion": "e.g., 150g or 2 pieces" }
  ],
  "nutritionalSummary": {
    "totalCalories": 0,
    "proteinGrams": 0,
    "carbsGrams": 0,
    "fatsGrams": 0
  },
  "efficiencyScore": "High",
  "goalAlignmentReason": "Why this meal fits the goal",
  "suggestedAdjustments": "Clear actionable tweak"
}
`;

    const contents = [];

    if (imageBase64) {
      const mimeType = imageBase64.split(';')[0].split(':')[1];
      const data = imageBase64.split(',')[1];
      contents.push({ inlineData: { mimeType, data } });
    }

    contents.push({ text: `${systemPrompt}\nUser Input: ${textInput || 'Analyze the provided image.'}` });

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    // Clean markdown code blocks if present
    let rawText = response.text || '{}';
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const parsedData = JSON.parse(rawText);

    // Save result into SQLite Database with userId
    const mealId = saveMealLog({
      mealType: mealType || 'Snack',
      category: category,
      mealName: parsedData.mealName || 'Logged Meal',
      calories: parsedData.nutritionalSummary?.totalCalories || 0,
      protein: parsedData.nutritionalSummary?.proteinGrams || 0,
      carbs: parsedData.nutritionalSummary?.carbsGrams || 0,
      fats: parsedData.nutritionalSummary?.fatsGrams || 0,
      efficiencyScore: parsedData.efficiencyScore || 'Medium',
      advice: parsedData.suggestedAdjustments || ''
    }, req.userId);

    res.json({ success: true, data: parsedData, mealId });

  } catch (error) {
    console.error('Meal Analysis Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to process meal with AI model.' 
    });
  }
});

/**
 * GET /api/daily-history
 * Fetch daily logs & totals with optional pagination
 */
app.get('/api/daily-history', verifyToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const logs = getDailyLogs(req.userId, limit, offset);
    const totals = getDailyTotals(req.userId);

    res.json({ success: true, logs, totals, count: logs.length });
  } catch (error) {
    console.error('Database Fetch Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve logs.' });
  }
});

/**
 * GET /api/history
 * Fetch logs for a specific date range with optional pagination
 */
app.get('/api/history', verifyToken, (req, res) => {
  try {
    const { startDate, endDate, limit = 50, offset = 0 } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate query parameters are required'
      });
    }

    const logs = getLogsInDateRange(req.userId, startDate, endDate, parseInt(limit), parseInt(offset));
    const totals = getTotalsByDate(req.userId, startDate); // Get totals for start date

    res.json({ success: true, logs, totals, count: logs.length });
  } catch (error) {
    console.error('Date Range Fetch Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve logs.' });
  }
});

/**
 * GET /api/logs/:id
 * Get specific meal log
 */
app.get('/api/logs/:id', verifyToken, (req, res) => {
  try {
    const log = getMealLogById(req.params.id, req.userId);

    if (!log) {
      return res.status(404).json({
        success: false,
        error: 'Meal log not found'
      });
    }

    res.json({ success: true, log });
  } catch (error) {
    console.error('Fetch Log Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve log.' });
  }
});

/**
 * PUT /api/logs/:id
 * Update a meal log
 */
app.put('/api/logs/:id', verifyToken, (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = getMealLogById(id, req.userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Meal log not found'
      });
    }

    const updatedLog = updateMealLog(id, req.userId, req.body);

    res.json({
      success: true,
      message: 'Meal log updated successfully',
      changes: updatedLog.changes
    });
  } catch (error) {
    console.error('Update Log Error:', error);
    res.status(500).json({ success: false, error: 'Failed to update log.' });
  }
});

/**
 * DELETE /api/logs/:id
 * Delete a specific meal log
 */
app.delete('/api/logs/:id', verifyToken, (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = getMealLogById(id, req.userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Meal log not found'
      });
    }

    deleteMealLog(id, req.userId);
    res.json({ success: true, message: 'Meal log deleted successfully' });
  } catch (error) {
    console.error('Delete Log Error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete log.' });
  }
});

/**
 * DELETE /api/daily-history
 * Clear ALL meal logs for user
 */
app.delete('/api/daily-history', verifyToken, (req, res) => {
  try {
    const result = deleteAllLogs(req.userId);
    console.log(`Cleared ${result.changes} log(s) for user ${req.userId}`);
    res.json({ success: true, message: 'All meal logs deleted', deletedCount: result.changes });
  } catch (error) {
    console.error('Clear History Error:', error);
    res.status(500).json({ success: false, error: 'Failed to clear logs.' });
  }
});

/**
 * GET /api/monthly-history
 * Fetch last 30 days of calorie history
 */
app.get('/api/monthly-history', verifyToken, (req, res) => {
  try {
    const history = getMonthlyHistory(req.userId);
    res.json({ success: true, monthlyData: history });
  } catch (err) {
    console.error('Failed to fetch monthly history:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Diet Tracker API with authentication enabled`);
});