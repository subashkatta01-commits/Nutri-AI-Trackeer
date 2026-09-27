import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { 
  saveMealLog, getDailyLogs, getDailyTotals, deleteMealLog, deleteAllLogs, getMonthlyHistory,
  getMealLogById, updateMealLog,
  getFilteredLogs, getFilteredTotals, formatMealLogDetail,
  createUser, authenticateUser, getUserById, emailExists, emailExists as checkEmailExists,
  getNutritionGoals, updateNutritionGoals, createNutritionGoals,
  getUserProfile, upsertUserProfile
} from './backend/db.js';
import { 
  validateMealInput, validateNutritionGoals, validateAuthInput, validateProfileInput,
  validateMealEdit, verifyToken, errorHandler 
} from './backend/middleware.js';
import { generateToken, formatUserResponse, sanitizeInput } from './backend/authUtils.js';
import { calculateTargets } from './backend/nutritionCalculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, 'frontend', 'public');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(frontendDir));

// Static routes
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ========== AI PROVIDER CONFIGURATION ==========

const SUPPORTED_AI_PROVIDERS = ['groq', 'gemini'];
const DEFAULT_AI_PROVIDER = 'groq';
const GROQ_CHAT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const requestedProvider = (process.env.AI_PROVIDER || DEFAULT_AI_PROVIDER).trim().toLowerCase();
const AI_PROVIDER = SUPPORTED_AI_PROVIDERS.includes(requestedProvider)
  ? requestedProvider
  : DEFAULT_AI_PROVIDER;

if (requestedProvider !== AI_PROVIDER) {
  console.warn(
    `[AI] Unsupported AI_PROVIDER "${requestedProvider}" - falling back to "${DEFAULT_AI_PROVIDER}". ` +
    `Supported providers: ${SUPPORTED_AI_PROVIDERS.join(', ')}.`
  );
}

const dedupeModels = (models) => [...new Set(models.filter(Boolean))];

const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim();
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'qwen/qwen3.8-27b';
// Order matters: vision-capable models first so photo analysis never silently
// degrades to a text-only model. Verified against GET /openai/v1/models.
const GROQ_FALLBACK_MODELS = dedupeModels([
  GROQ_MODEL,
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);
const GROQ_VISION_MODELS = new Set(['qwen/qwen3.8-27b']);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
const GEMINI_FALLBACK_MODELS = dedupeModels([
  GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-1.5-flash'
]);

const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

// ========== AI ERROR CLASSIFICATION ==========

const NETWORK_ERROR_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
];

const errorStatus = (error) => error?.status ?? error?.code;
const errorMessage = (error) => error?.message || '';

const createAiError = (message, status, provider) => {
  const error = new Error(message);
  error.status = status;
  error.provider = provider;
  return error;
};

const isQuotaExceededError = (error) => (
  errorStatus(error) === 429 &&
  /quota|resource.?exhausted|free.?tier|monthly|billing|insufficient.?credit/i.test(errorMessage(error))
);

const isNetworkError = (error) => (
  NETWORK_ERROR_CODES.includes(error?.code) ||
  NETWORK_ERROR_CODES.includes(error?.cause?.code) ||
  /fetch failed|network|socket hang up|dns|getaddrinfo/i.test(errorMessage(error))
);

const isTransientAiError = (error) => {
  const status = errorStatus(error);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /rate.?limit|resource.?exhausted|overloaded|temporar(y|ily)|unavailable|busy|try again/i.test(errorMessage(error));
};

const isModelUnavailableError = (message) => (
  /does not exist|not available|no access|access to it|model_not_found|deprecat|does not support|is not supported|unrecognized model|invalid model/i.test(message || '')
);

// A text-only model rejects an OpenAI-style multimodal content array with a 400.
// That is a "wrong model for this request" signal, not a fatal error, so the
// fallback chain must move on instead of aborting the whole request.
const isTextOnlyModelRejection = (message) => (
  /content must be a string|must be a string|image_url|multimodal|vision|unsupported content type|unrecognized content/i.test(message || '')
);

// Groq/OpenAI-compatible models do not reliably honour JSON mode; some still
// wrap the object in prose or markdown. Pull out the first balanced {...} block.
function extractJsonObject(rawText) {
  const text = String(rawText || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // fall through to brace scanning
  }

  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

// Models occasionally return calories/macros as strings, or nonsense values.
// Clamp them so the DB, totals and charts stay numeric and sane.
const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(Math.max(0, num)) : fallback;
};

const VALID_EFFICIENCY_SCORES = new Set(['High', 'Medium', 'Low']);

function normalizeDetectedItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object' && String(item.name || '').trim())
    .slice(0, 40)
    .map((item) => ({
      name: String(item.name).trim().slice(0, 120),
      estimatedPortion: String(item.estimatedPortion || '').trim().slice(0, 120)
    }));
}

function normalizeMealAnalysis(parsed) {
  const summary = parsed?.nutritionalSummary || {};
  const score = String(parsed?.efficiencyScore || '').trim();
  const capitalized = score ? score.charAt(0).toUpperCase() + score.slice(1).toLowerCase() : '';

  return {
    mealName: String(parsed?.mealName || '').trim().slice(0, 160) || 'Logged Meal',
    detectedItems: normalizeDetectedItems(parsed?.detectedItems),
    nutritionalSummary: {
      totalCalories: toNumber(summary.totalCalories),
      proteinGrams: toNumber(summary.proteinGrams),
      carbsGrams: toNumber(summary.carbsGrams),
      fatsGrams: toNumber(summary.fatsGrams)
    },
    efficiencyScore: VALID_EFFICIENCY_SCORES.has(capitalized) ? capitalized : 'Medium',
    goalAlignmentReason: String(parsed?.goalAlignmentReason || '').trim().slice(0, 1000),
    suggestedAdjustments: String(parsed?.suggestedAdjustments || '').trim().slice(0, 1000)
  };
}

const AI_PROVIDER_LABEL = { groq: 'Groq', gemini: 'Google Gemini' };
const providerLabel = (error) => AI_PROVIDER_LABEL[error?.provider] || AI_PROVIDER_LABEL[AI_PROVIDER] || 'the AI service';

// ========== AI REQUEST BUILDING ==========

function contentsIncludeImage(contents) {
  return (contents || []).some((part) => part?.inlineData?.data);
}

// Keep the explicitly configured model first, but prioritise vision models when
// an image is attached so a text-only model is never picked for a meal photo.
function orderModelsForContents(models, contents) {
  if (models.length < 2 || !contentsIncludeImage(contents)) {
    return models;
  }

  const [primary, ...rest] = models;
  return [
    primary,
    ...rest.filter((model) => GROQ_VISION_MODELS.has(model)),
    ...rest.filter((model) => !GROQ_VISION_MODELS.has(model))
  ];
}

function buildGroqUserContent(contents) {
  const text = (contents || [])
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text.trim())
    .join('\n\n');

  const images = (contents || [])
    .filter((part) => part?.inlineData?.data)
    .map((part) => ({
      type: 'image_url',
      image_url: {
        url: `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`
      }
    }));

  if (!text && images.length === 0) {
    return 'Analyze the provided meal.';
  }

  return [...(text ? [{ type: 'text', text }] : []), ...images];
}

function extractChatCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => part?.text || '').join('') || null;
  }

  return null;
}

// ========== AI PROVIDER IMPLEMENTATIONS ==========

async function generateWithGroq(contents, config = {}) {
  if (!GROQ_API_KEY) {
    throw createAiError('Missing GROQ_API_KEY. Add your Groq API key to the .env file.', 500, 'groq');
  }

  const requestBody = {
    temperature: Number.isFinite(config.temperature) ? config.temperature : 0.1,
    messages: [
      { role: 'system', content: 'You are an advanced AI Clinical Dietitian and Sports Nutritionist.' },
      { role: 'user', content: buildGroqUserContent(contents) }
    ]
  };

  if (config.responseMimeType === 'application/json') {
    requestBody.response_format = { type: 'json_object' };
  }

  let lastError;

  for (const model of orderModelsForContents(GROQ_FALLBACK_MODELS, contents)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(GROQ_CHAT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({ ...requestBody, model })
        });

        const rawText = await response.text();
        let payload = null;

        try {
          payload = JSON.parse(rawText);
        } catch {
          // Non-JSON body - handled by the !response.ok branch below.
        }

        if (!response.ok) {
          const message = payload?.error?.message || rawText || `Groq request failed (HTTP ${response.status}).`;
          const error = createAiError(message, response.status, 'groq');

          // Wrong/unavailable model, text-only model fed an image, or rate limit:
          // move to the next model instead of hammering or aborting.
          if (isModelUnavailableError(message) || isTextOnlyModelRejection(message) || response.status === 429) {
            lastError = error;
            break;
          }

          throw error;
        }

        const text = extractChatCompletionText(payload);

        if (text === null) {
          lastError = createAiError('Groq returned an empty completion.', 502, 'groq');
          break;
        }

        return { text };
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          throw error;
        }

        lastError = error;

        if (!isTransientAiError(error)) {
          throw error;
        }

        if (attempt === 0) {
          await sleep(1500);
        }
      }
    }
  }

  // Every model was rejected. Distinguish "nothing here can read images" from a
  // generic failure so the user gets an actionable message.
  if (contentsIncludeImage(contents) && isTextOnlyModelRejection(errorMessage(lastError))) {
    throw createAiError(
      'The configured Groq model cannot analyze images. Set GROQ_MODEL to a vision-capable model ' +
      '(check GET https://api.groq.com/openai/v1/models) or log the meal as text instead.',
      400,
      'groq'
    );
  }

  throw lastError || createAiError('Groq model request failed.', 502, 'groq');
}

async function generateWithGemini(contents, config = {}) {
  if (!geminiClient) {
    throw createAiError('Missing GEMINI_API_KEY. Add your Gemini API key to the .env file.', 500, 'gemini');
  }

  let lastError;

  for (const model of GEMINI_FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await geminiClient.models.generateContent({ model, contents, config });
      } catch (error) {
        lastError = error;

        if (errorStatus(error) === 404 || isModelUnavailableError(errorMessage(error))) {
          break;
        }

        if (!isTransientAiError(error)) {
          throw error;
        }

        if (attempt === 0) {
          await sleep(1500);
        }
      }
    }
  }

  throw lastError;
}

async function generateMealAnalysis(contents, config = {}) {
  return AI_PROVIDER === 'gemini'
    ? generateWithGemini(contents, config)
    : generateWithGroq(contents, config);
}

// ========== AI CREDENTIAL VALIDATION ==========

const KEY_PLACEHOLDER_PATTERN = /^(your|replace|changeme|xxx|placeholder|todo)|YOUR(_ACTUAL)?_?(API)?_?KEY/i;

function getMissingCredentialError() {
  const key = AI_PROVIDER === 'gemini' ? GEMINI_API_KEY : GROQ_API_KEY;
  const envName = AI_PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'GROQ_API_KEY';

  if (!key) {
    return `Missing ${envName}. Add it to your .env file, or set AI_PROVIDER to a provider you have a key for.`;
  }

  if (KEY_PLACEHOLDER_PATTERN.test(key)) {
    return `${envName} still holds a placeholder value. Replace it with your real API key.`;
  }

  return null;
}

// ========== MEAL HISTORY FILTERING ==========

const HISTORY_RANGES = new Set(['today', 'yesterday', 'week', 'month', 'all', 'custom']);
const DEFAULT_HISTORY_RANGE = 'today';
const MAX_HISTORY_PAGE_SIZE = 100;
const DEFAULT_HISTORY_PAGE_SIZE = 25;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Format a Date as YYYY-MM-DD in *local* time, matching the 'localtime' modifier
// used by every SQL date filter - mixing UTC and local here silently drops meals.
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Resolve a range keyword (or an explicit custom range) into SQL-comparable
 * YYYY-MM-DD bounds. Returns nulls for "all".
 */
function resolveHistoryRange(rangeInput, startDateInput, endDateInput) {
  const range = HISTORY_RANGES.has(rangeInput) ? rangeInput : DEFAULT_HISTORY_RANGE;

  if (range === 'all') {
    return { range, startDate: null, endDate: null };
  }

  if (range === 'custom') {
    const startDate = DATE_ONLY_PATTERN.test(startDateInput || '') ? startDateInput : null;
    const endDate = DATE_ONLY_PATTERN.test(endDateInput || '') ? endDateInput : null;

    if (!startDate || !endDate) return { range: 'custom', startDate: null, endDate: null, invalid: true };

    // Tolerate a reversed range instead of returning nothing at all.
    return startDate <= endDate
      ? { range, startDate, endDate }
      : { range, startDate: endDate, endDate: startDate };
  }

  const today = startOfToday();

  if (range === 'today') {
    const todayStr = toLocalDateString(today);
    return { range, startDate: todayStr, endDate: todayStr };
  }

  if (range === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateString(yesterday);
    return { range, startDate: yesterdayStr, endDate: yesterdayStr };
  }

  if (range === 'week') {
    // Rolling 7 days including today.
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { range, startDate: toLocalDateString(from), endDate: toLocalDateString(today) };
  }

  // month: rolling 30 days including today
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return { range, startDate: toLocalDateString(from), endDate: toLocalDateString(today) };
}

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
 * GET /api/profile
 * Get a user's onboarding profile
 */
app.get('/api/profile', verifyToken, (req, res) => {
  try {
    const profile = getUserProfile(req.userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found'
      });
    }

    res.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error('Fetch Profile Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    });
  }
});

/**
 * POST /api/profile
 * Save profile and calculate nutrition goals
 */
app.post('/api/profile', verifyToken, validateProfileInput, (req, res) => {
  try {
    const profile = upsertUserProfile(req.userId, req.profileInput);
    const calculated = calculateTargets({
      gender: req.profileInput.gender,
      weightKg: req.profileInput.weightKg,
      heightCm: req.profileInput.heightCm,
      age: req.profileInput.age,
      activityLevel: req.profileInput.activityLevel,
      goal: req.profileInput.goal
    });

    updateNutritionGoals(req.userId, calculated);

    res.json({
      success: true,
      profile,
      goals: {
        daily_calorie_target: calculated.dailyCalorieTarget,
        daily_protein_target: calculated.dailyProteinTarget,
        daily_carbs_target: calculated.dailyCarbsTarget,
        daily_fats_target: calculated.dailyFatsTarget
      },
      targets: {
        bmr: calculated.bmr,
        tdee: calculated.tdee
      }
    });
  } catch (error) {
    console.error('Profile Save Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save profile'
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

    res.json({
      success: true,
      message: 'Nutrition goals updated successfully',
      goals: getNutritionGoals(req.userId)
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

    const credentialError = getMissingCredentialError();
    if (credentialError) {
      return res.status(500).json({ success: false, error: credentialError });
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

    const response = await generateMealAnalysis(contents, {
      responseMimeType: 'application/json',
      temperature: 0.1
    });

    // Models may wrap the JSON in prose or markdown, so parse defensively.
    const parsedData = normalizeMealAnalysis(extractJsonObject(response.text));

    if (!parsedData) {
      throw createAiError(
        `${providerLabel({ provider: AI_PROVIDER })} returned a response that could not be read as JSON. Try logging the meal again.`,
        502,
        AI_PROVIDER
      );
    }

    // Save result into SQLite Database with userId
    const mealId = saveMealLog({
      mealType: mealType || 'Snack',
      category: category,
      mealName: parsedData.mealName,
      calories: parsedData.nutritionalSummary.totalCalories,
      protein: parsedData.nutritionalSummary.proteinGrams,
      carbs: parsedData.nutritionalSummary.carbsGrams,
      fats: parsedData.nutritionalSummary.fatsGrams,
      efficiencyScore: parsedData.efficiencyScore,
      advice: parsedData.suggestedAdjustments,
      detectedItems: parsedData.detectedItems,
      goalAlignmentReason: parsedData.goalAlignmentReason,
      // Stored so the details modal can show the photo. It is deliberately kept
      // out of list responses - see formatMealLogSummary().
      imageBase64: imageBase64 || null,
      originalInput: (textInput || '').trim().slice(0, 2000) || null
    }, req.userId);

    res.json({ success: true, data: parsedData, mealId });

  } catch (error) {
    console.error('Meal Analysis Error:', error);

    const label = providerLabel(error);
    const status = errorStatus(error);
    const isQuotaExceeded = isQuotaExceededError(error);
    const isNetwork = isNetworkError(error);
    const isTransient = !isQuotaExceeded && !isNetwork && isTransientAiError(error);
    const isAuthFailure = status === 401 || status === 403;
    const statusCode = isQuotaExceeded ? 429
      : isNetwork ? 502
      : isTransient ? 503
      : isAuthFailure ? 502
      : 500;

    res.status(statusCode).json({
      success: false,
      retryAfterSeconds: isTransient ? 5 : undefined,
      error: isQuotaExceeded
        ? `${label} API quota is exhausted. Wait for the quota reset, top up your account, or switch to another model/provider.`
        : isTransient
        ? `${label} is temporarily busy. Please try again shortly.`
        : isNetwork
        ? `Cannot reach ${label} from this computer. Check your internet connection, firewall, VPN, or proxy settings, then try again.`
        : isAuthFailure
        ? `${label} rejected the API key. Check the key in your .env file is correct and active.`
        : (error.message || 'Failed to process meal with AI model.')
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
 * Fetch logs filtered by date range and/or meal name, with pagination.
 *
 * Query params:
 *   range     today | yesterday | week | month | all | custom   (default: today)
 *   startDate YYYY-MM-DD  (required when range=custom)
 *   endDate   YYYY-MM-DD  (required when range=custom)
 *   search    case-insensitive substring of the meal name
 *   limit     page size, 1-100 (default 25)
 *   offset    rows to skip, >= 0 (default 0)
 */
app.get('/api/history', verifyToken, (req, res) => {
  try {
    const { range: rangeInput, startDate: startInput, endDate: endInput, search, limit, offset } = req.query;

    const resolved = resolveHistoryRange(rangeInput, startInput, endInput);

    if (resolved.invalid) {
      return res.status(400).json({
        success: false,
        error: 'A custom range needs both startDate and endDate in YYYY-MM-DD format.'
      });
    }

    const searchTerm = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    const limitParam = parseInt(limit, 10);
    const offsetParam = parseInt(offset, 10);

    const pageSize = Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_HISTORY_PAGE_SIZE)
      : DEFAULT_HISTORY_PAGE_SIZE;
    const pageOffset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;

    const filter = {
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      search: searchTerm
    };

    const { logs, total, hasMore } = getFilteredLogs(req.userId, { ...filter, limit: pageSize, offset: pageOffset });

    res.json({
      success: true,
      logs,
      totals: getFilteredTotals(req.userId, filter),
      count: logs.length,
      total,
      hasMore,
      limit: pageSize,
      offset: pageOffset,
      range: resolved.range,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      search: searchTerm
    });
  } catch (error) {
    console.error('History Fetch Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve logs.' });
  }
});

/**
 * GET /api/logs/:id
 * Full detail for a single meal log - detected foods, advice and the photo.
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

    res.json({ success: true, log: formatMealLogDetail(log) });
  } catch (error) {
    console.error('Fetch Log Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve log.' });
  }
});

/**
 * PUT /api/logs/:id
 * Update a meal log. Accepts a partial patch (any subset of the editable fields).
 */
app.put('/api/logs/:id', verifyToken, validateMealEdit, (req, res) => {
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

    const result = updateMealLog(id, req.userId, req.body);

    if (result.changes === 0) {
      return res.status(400).json({
        success: false,
        error: 'No editable fields were provided.'
      });
    }

    res.json({
      success: true,
      message: 'Meal log updated successfully',
      changes: result.changes,
      log: formatMealLogDetail(getMealLogById(id, req.userId))
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

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Diet Tracker API with authentication enabled`);
  console.log(`🤖 AI provider: ${AI_PROVIDER_LABEL[AI_PROVIDER]} (model: ${AI_PROVIDER === 'gemini' ? GEMINI_MODEL : GROQ_MODEL})`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing server or run with a different port:`);
    console.error('$env:PORT=3001; npm start');
    process.exit(1);
  }
  throw error;
});