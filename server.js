import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { PDFDocument } from 'pdfkit';
import { 
  saveMealLog, getDailyLogs, getDailyTotals, deleteMealLog, deleteAllLogs, getMonthlyHistory,
  getMealLogById, updateMealLog,
  getFilteredLogs, getFilteredTotals, formatMealLogDetail,
  createUser, createUserWithPasswordHash, hashPassword, authenticateUser, getUserById,
  emailExists, emailExists as checkEmailExists, usernameExists,
  getPendingSignup, savePendingSignup, pendingSignupUsernameExists,
  incrementPendingSignupAttempts, deletePendingSignup, cleanupExpiredPendingSignups,
  getNutritionGoals, updateNutritionGoals, createNutritionGoals,
  getUserProfile, upsertUserProfile,
  getWeightLogs, saveWeightLog, deleteWeightLog,
  saveWaterLog, getWaterLogForDate, getWaterLogs, deleteWaterLog,
  getExerciseLogs, saveExerciseLog, deleteExerciseLog,
  getSleepLogForDate, getSleepLogs, saveSleepLog, deleteSleepLog,
  changeUserPassword, createPasswordResetToken, resetPasswordWithToken,
  deleteUserAccount, exportUserData, comparePassword, getUserPasswordHash,
  toLocalDateString
} from './backend/db.js';
import { 
  validateMealInput, validateNutritionGoals, validateAuthInput, validateProfileInput,
  validateMealEdit, validateWeightInput, validateWaterInput, verifyToken, errorHandler,
  loginRateLimit, signupRateLimit, verifyEmailRateLimit, resendVerificationRateLimit,
  validateChangePasswordInput, validateForgotPasswordInput, validateResetPasswordInput,
  changePasswordRateLimit, forgotPasswordRateLimit, resetPasswordRateLimit,
  deleteAccountRateLimit, exportRateLimit
} from './backend/middleware.js';
import { generateToken, formatUserResponse, sanitizeInput } from './backend/authUtils.js';
import { calculateTargets } from './backend/nutritionCalculator.js';
import { getInsights } from './backend/insights.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, 'frontend', 'public');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const authSecret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
if (!authSecret || Buffer.byteLength(authSecret) < 32) {
  throw new Error('Set JWT_SECRET (or AUTH_SECRET) to a random secret of at least 32 bytes.');
}

const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASSWORD?.trim();
function missingSmtpVariables() {
  return [
    !smtpHost && 'SMTP_HOST',
    !smtpUser && 'SMTP_USER',
    !smtpPassword && 'SMTP_PASSWORD'
  ].filter(Boolean);
}

const missingSmtpConfig = missingSmtpVariables();
const verificationMailer = missingSmtpConfig.length === 0
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword },
      pool: true,
      maxConnections: 3,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    })
  : null;
const verificationMailFrom = process.env.SMTP_FROM?.trim() || smtpUser;
console.info(`[Email] SMTP configuration: ${missingSmtpConfig.length ? `missing ${missingSmtpConfig.join(', ')}` : 'required variables present'}; sender ${process.env.SMTP_FROM?.trim() ? 'provided' : 'falls back to SMTP_USER'}.`);

if (verificationMailer) {
  verificationMailer.verify((err) => {
    if (err) {
      console.warn(`[Email] SMTP connection warning: ${err.message}. If emails fail, verify SMTP credentials or local network access.`);
    } else {
      console.info('[Email] SMTP Transporter connected and verified ready to send emails.');
    }
  });
}

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

function hashEmailVerificationCode(email, code) {
  return crypto.createHmac('sha256', authSecret).update(`${email}:${code}`).digest('hex');
}

function emailVerificationCodeMatches(email, code, storedHash) {
  const expected = Buffer.from(hashEmailVerificationCode(email, code), 'hex');
  const actual = Buffer.from(storedHash || '', 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function sendEmailVerificationCode(email, code) {
  if (!verificationMailer || !verificationMailFrom) {
    throw new Error('Email verification is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM.');
  }

  await verificationMailer.sendMail({
    from: verificationMailFrom,
    to: email,
    subject: 'Your NutriAI Tracker verification code',
    text: `Your NutriAI Tracker verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this verification code, please ignore this email.`,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your NutriAI Verification Code</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);">
    <h1 style="color: #ff8a5c; margin-top: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">NutriAI Tracker</h1>
    <p style="color: #cbd5e1; font-size: 15px; margin: 16px 0 24px;">Welcome! Please enter this 6-digit verification code to complete your signup:</p>
    <div style="background-color: #0f172a; border: 2px dashed #ff8a5c; border-radius: 10px; padding: 18px 24px; margin: 20px 0; display: inline-block;">
      <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">${code}</span>
    </div>
    <p style="color: #94a3b8; font-size: 14px; margin: 20px 0 0;">This code expires in <strong>10 minutes</strong>.</p>
    <p style="color: #64748b; font-size: 12px; margin: 28px 0 0; border-top: 1px solid #334155; padding-top: 16px;">If you did not request this email, no action is needed.</p>
  </div>
</body>
</html>`
  });
}

const configuredOrigins = (process.env.CORS_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
if (isProduction && configuredOrigins.length === 0) {
  throw new Error('Set CORS_ORIGIN to the comma-separated HTTPS origins allowed to access this app in production.');
}
if (isProduction && configuredOrigins.some(origin => !/^https:\/\//i.test(origin) || origin === '*')) {
  throw new Error('Production CORS_ORIGIN entries must be exact HTTPS origins; wildcards are not allowed.');
}

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];
if (process.env.PORT) {
  defaultOrigins.push(`http://localhost:${process.env.PORT}`);
  defaultOrigins.push(`http://127.0.0.1:${process.env.PORT}`);
}
const allowedOrigins = configuredOrigins.length ? configuredOrigins : [...new Set(defaultOrigins)];

app.set('trust proxy', isProduction || ['true', '1'].includes((process.env.TRUST_PROXY || '').toLowerCase()) ? 1 : false);

// Middleware
app.use((req, res, next) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isProduction && !isSecure) {
    return res.status(426).json({ success: false, error: 'HTTPS is required in production.' });
  }
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))
}));
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

const VALID_CONFIDENCE_LEVELS = new Set(['High', 'Medium', 'Low']);

function normalizeConfidence(value, fallback = 'Medium') {
  const text = String(value || '').trim();
  const capitalized = text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
  return VALID_CONFIDENCE_LEVELS.has(capitalized) ? capitalized : fallback;
}

function normalizeEfficiencyScore(value) {
  const match = String(value || '').trim().match(/^(high|medium|low)\b/i);
  if (!match) return 'Medium';
  return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
}

function normalizeStringList(value) {
  if (!value) return [];
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 300));
}

function normalizeDetectedItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object' && String(item.name || '').trim())
    .slice(0, 40)
    .map((item) => ({
      name: String(item.name).trim().slice(0, 120),
      estimatedPortion: String(item.estimatedPortion || '').trim().slice(0, 120),
      confidence: item.confidence ? normalizeConfidence(item.confidence, '') : ''
    }));
}

function normalizeMealAnalysis(parsed) {
  const summary = parsed?.nutritionalSummary || {};
  const confidenceLevel = normalizeConfidence(parsed?.confidenceLevel, 'Medium');
  const healthierSubstitutions = normalizeStringList(parsed?.healthierSubstitutions);
  const whatToAdd = normalizeStringList(parsed?.whatToAdd || parsed?.additions || parsed?.toAdd);
  const whatToReduce = normalizeStringList(parsed?.whatToReduce || parsed?.reductions || parsed?.toReduce);
  const warnings = normalizeStringList(parsed?.warnings);

  const base = {
    mealName: String(parsed?.mealName || '').trim().slice(0, 160) || 'Logged Meal',
    detectedItems: normalizeDetectedItems(parsed?.detectedItems),
    nutritionalSummary: {
      totalCalories: toNumber(summary.totalCalories),
      proteinGrams: toNumber(summary.proteinGrams),
      carbsGrams: toNumber(summary.carbsGrams),
      fatsGrams: toNumber(summary.fatsGrams),
      fiberGrams: toNumber(summary.fiberGrams || summary.fiber),
      sugarGrams: toNumber(summary.sugarGrams || summary.sugar),
      sodiumMg: toNumber(summary.sodiumMg || summary.sodium)
    },
    efficiencyScore: normalizeEfficiencyScore(parsed?.efficiencyScore),
    efficiencyScoreReason: String(parsed?.efficiencyScoreReason || parsed?.scoreReason || '').trim().slice(0, 300),
    confidenceLevel,
    goalAlignmentReason: String(parsed?.goalAlignmentReason || '').trim().slice(0, 1000),
    suggestedAdjustments: String(parsed?.suggestedAdjustments || '').trim().slice(0, 1000),
    healthierSubstitutions,
    whatToAdd,
    whatToReduce,
    warnings
  };

  base.analysisDetails = {
    confidenceLevel,
    efficiencyScoreReason: base.efficiencyScoreReason,
    healthierSubstitutions,
    whatToAdd,
    whatToReduce,
    warnings,
    goalAlignmentReason: base.goalAlignmentReason,
    suggestedAdjustments: base.suggestedAdjustments
  };

  return base;
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

// ========== INSIGHTS RANGE RESOLUTION ==========

// Insights is computed in memory, so the range is deliberately capped.
const INSIGHTS_RANGES = [7, 30, 90];
const DEFAULT_INSIGHTS_DAYS = 30;
const MAX_WEIGHT_ENTRIES = 400;

/**
 * Turn the requested range into inclusive YYYY-MM-DD bounds ending today.
 */
function resolveInsightsRange(daysInput) {
  const requested = parseInt(daysInput, 10);
  const days = INSIGHTS_RANGES.includes(requested) ? requested : DEFAULT_INSIGHTS_DAYS;

  const end = startOfToday();
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  return { days, startDate: toLocalDateString(start), endDate: toLocalDateString(end) };
}

// ========== AUTHENTICATION ENDPOINTS ==========

/** Begin signup by emailing a short-lived verification code. */
app.post('/api/auth/signup', signupRateLimit, validateAuthInput, async (req, res) => {
  try {
    cleanupExpiredPendingSignups();

    if (!verificationMailer) {
      if (isProduction) {
        return res.status(503).json({
          success: false,
          error: `Email verification is not configured. Missing environment variable(s): ${missingSmtpConfig.join(', ')}.`
        });
      }
      console.warn(`[DEV WARNING] SMTP not configured (missing ${missingSmtpConfig.join(', ')}). Proceeding with dev console codes.`);
    }

    const username = sanitizeInput(req.body.username).trim();
    const email = req.body.email.trim().toLowerCase();

    if (checkEmailExists(email)) {
      return res.status(409).json({ success: false, error: 'Email already registered. Please sign in instead.' });
    }
    if (usernameExists(username) || pendingSignupUsernameExists(username, email)) {
      return res.status(409).json({ success: false, error: 'Username is already in use. Please choose another.' });
    }

    const existingPending = getPendingSignup(email);
    if (existingPending && Date.now() - existingPending.created_at < EMAIL_CODE_RESEND_COOLDOWN_MS) {
      return res.status(429).json({
        success: false,
        error: 'A verification code was just sent. Please check your email or wait a minute before requesting another.',
        cooldownRemaining: Math.ceil((EMAIL_CODE_RESEND_COOLDOWN_MS - (Date.now() - existingPending.created_at)) / 1000)
      });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const passwordHash = await hashPassword(req.body.password);

    if (!isProduction) {
      console.log(`\n========================================\n[SIGNUP VERIFICATION] Code for ${email}: ${code}\n========================================\n`);
    }

    let emailSent = false;
    if (verificationMailer) {
      try {
        await sendEmailVerificationCode(email, code);
        emailSent = true;
      } catch (error) {
        console.error('Signup Verification Email Error:', error.message);
        if (isProduction) {
          return res.status(503).json({ success: false, error: 'Could not send the verification email. Check the email address or try again later.' });
        }
        console.warn(`[DEV WARNING] Email sending failed (${error.message}). Continuing in dev mode using console verification code.`);
      }
    }

    savePendingSignup({
      username,
      email,
      passwordHash,
      codeHash: hashEmailVerificationCode(email, code),
      expiresAt: Date.now() + EMAIL_CODE_TTL_MS
    });

    res.status(202).json({
      success: true,
      verificationRequired: true,
      email,
      message: emailSent
        ? 'A six-digit verification code has been sent to your email. Be sure to check your Inbox and Spam/Junk folder.'
        : 'A six-digit verification code has been generated. (Dev mode: check server console or devCode below).',
      ...(!isProduction ? { devCode: code } : {})
    });
  } catch (error) {
    console.error('Signup Error:', error);
    const isConflict = String(error.code || '').startsWith('SQLITE_CONSTRAINT');
    res.status(isConflict ? 409 : 500).json({
      success: false,
      error: isConflict ? 'Username or email is already in use.' : 'Failed to start signup.'
    });
  }
});

/** Verify the email code and only then create an authenticated account. */
app.post('/api/auth/verify-email', verifyEmailRateLimit, async (req, res) => {
  cleanupExpiredPendingSignups();
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: 'Enter a valid email and six-digit verification code.' });
  }

  const pending = getPendingSignup(email);
  if (!pending) {
    return res.status(400).json({ success: false, error: 'No pending signup was found. Start signup again to request a new code.' });
  }
  if (pending.expires_at <= Date.now()) {
    deletePendingSignup(email);
    return res.status(400).json({ success: false, error: 'That verification code expired. Request a new code.' });
  }
  if (pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    return res.status(429).json({ success: false, error: 'Too many incorrect codes. Request a new code and try again.' });
  }
  if (!emailVerificationCodeMatches(email, code, pending.code_hash)) {
    incrementPendingSignupAttempts(email);
    return res.status(400).json({
      success: false,
      error: `Incorrect verification code. ${EMAIL_CODE_MAX_ATTEMPTS - pending.attempts - 1} attempts remaining.`
    });
  }

  if (checkEmailExists(email) || usernameExists(pending.username)) {
    deletePendingSignup(email);
    return res.status(409).json({ success: false, error: 'That email or username is already registered. Please sign in.' });
  }

  try {
    const userId = createUserWithPasswordHash(pending.username, email, pending.password_hash);
    deletePendingSignup(email);
    const user = getUserById(userId);
    res.status(201).json({
      success: true,
      message: 'Email verified and account created.',
      token: generateToken(userId),
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Email Verification Account Creation Error:', error);
    const isConflict = String(error.code || '').startsWith('SQLITE_CONSTRAINT');
    if (isConflict) deletePendingSignup(email);
    res.status(isConflict ? 409 : 500).json({
      success: false,
      error: isConflict ? 'That email or username is already registered. Please sign in.' : 'Could not create the account.'
    });
  }
});

/** Send a replacement code without revealing whether an email has a pending signup. */
app.post('/api/auth/resend-verification', resendVerificationRateLimit, async (req, res) => {
  cleanupExpiredPendingSignups();
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
  }
  if (!verificationMailer && isProduction) {
    return res.status(503).json({
      success: false,
      error: `Email verification is not configured. Missing environment variable(s): ${missingSmtpConfig.join(', ')}.`
    });
  }

  const pending = getPendingSignup(email);
  if (!pending) {
    return res.json({ success: true, message: 'If a signup is pending, a new verification code will be sent.' });
  }
  if (Date.now() - pending.created_at < EMAIL_CODE_RESEND_COOLDOWN_MS) {
    return res.status(429).json({ success: false, error: 'Please wait a minute before requesting another code.' });
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  if (!isProduction) {
    console.log(`\n========================================\n[RESEND VERIFICATION] Code for ${email}: ${code}\n========================================\n`);
  }

  let emailSent = false;
  if (verificationMailer) {
    try {
      await sendEmailVerificationCode(email, code);
      emailSent = true;
    } catch (error) {
      console.error('Resend Verification Email Error:', error.message);
      if (isProduction) {
        return res.status(503).json({ success: false, error: 'Could not send the verification email. Try again later.' });
      }
      console.warn(`[DEV WARNING] Email sending failed (${error.message}). Continuing in dev mode using console verification code.`);
    }
  }

  savePendingSignup({
    username: pending.username,
    email,
    passwordHash: pending.password_hash,
    codeHash: hashEmailVerificationCode(email, code),
    expiresAt: Date.now() + EMAIL_CODE_TTL_MS
  });

  res.json({
    success: true,
    message: emailSent
      ? 'A new verification code has been sent. Please check your Inbox and Spam/Junk folder.'
      : 'A new verification code has been generated. (Dev mode: check server console or devCode below).',
    ...(!isProduction ? { devCode: code } : {})
  });
});

/**
 * POST /api/auth/login
 * Authenticate user
 */
app.post('/api/auth/login', loginRateLimit, validateAuthInput, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginIdentifier = (username || email || '').trim();

    const user = await authenticateUser(loginIdentifier, password);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: formatUserResponse(getUserById(user.id))
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

/**
 * POST /api/auth/change-password
 * Change the authenticated user's password (requires current password).
 */
app.post('/api/auth/change-password', verifyToken, changePasswordRateLimit, validateChangePasswordInput, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await changeUserPassword(req.userId, currentPassword, newPassword);
    res.json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (error) {
    console.error('Change Password Error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to change password'
    });
  }
});

/**
 * POST /api/auth/forgot-password
 * Generate a password reset token for the given email.
 */
app.post('/api/auth/forgot-password', forgotPasswordRateLimit, validateForgotPasswordInput, async (req, res) => {
  try {
    const { email } = req.body;
    const result = await createPasswordResetToken(email);

    // Always return a generic success to avoid email enumeration.
    res.json({
      success: true,
      message: 'If an account exists for that email, a password reset token has been generated.',
      // In development, include the token so the flow can be tested without email.
      ...(process.env.NODE_ENV !== 'production' && result.token ? { resetToken: result.token } : {})
    });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process password reset request.'
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using a valid reset token.
 */
app.post('/api/auth/reset-password', resetPasswordRateLimit, validateResetPasswordInput, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    await resetPasswordWithToken(token, newPassword);
    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.'
    });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to reset password'
    });
  }
});

/**
 * DELETE /api/auth/account
 * Delete the authenticated user's account and all associated data.
 * Requires the current password for confirmation.
 */
app.delete('/api/auth/account', verifyToken, deleteAccountRateLimit, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Password is required to confirm account deletion.'
      });
    }

    const storedHash = getUserPasswordHash(req.userId);
    if (!storedHash) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const valid = await comparePassword(password, storedHash);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect password. Account deletion cancelled.'
      });
    }

    deleteUserAccount(req.userId);
    res.clearCookie ? res.clearCookie('authToken') : null;
    res.json({
      success: true,
      message: 'Account and all associated data have been deleted.'
    });
  } catch (error) {
    console.error('Delete Account Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete account'
    });
  }
});

// ========== DATA EXPORT ENDPOINTS ==========

/**
 * GET /api/export/csv
 * Export the authenticated user's data as CSV (nutrition history, profile, goals, etc.).
 */
app.get('/api/export/csv', verifyToken, exportRateLimit, (req, res) => {
  try {
    const data = exportUserData(req.userId);

    const lines = [];
    lines.push('NutriAI Tracker - Data Export');
    lines.push(`User: ${data.user.username} (${data.user.email})`);
    lines.push(`Exported: ${data.exportedAt}`);
    lines.push('');

    // Profile
    lines.push('=== PROFILE ===');
    if (data.profile) {
      lines.push(`Age,${data.profile.age}`);
      lines.push(`Gender,${data.profile.gender}`);
      lines.push(`Height (cm),${data.profile.height_cm}`);
      lines.push(`Weight (kg),${data.profile.weight_kg}`);
      lines.push(`Activity level,${data.profile.activity_level}`);
      lines.push(`Goal,${data.profile.goal}`);
      lines.push(`Dietary preferences,${data.profile.dietary_preferences}`);
      lines.push(`Allergies,${data.profile.allergies}`);
    } else {
      lines.push('No profile data.');
    }
    lines.push('');

    // Goals
    lines.push('=== NUTRITION GOALS ===');
    if (data.goals) {
      lines.push(`Daily calorie target,${data.goals.daily_calorie_target}`);
      lines.push(`Daily protein target (g),${data.goals.daily_protein_target}`);
      lines.push(`Daily carbs target (g),${data.goals.daily_carbs_target}`);
      lines.push(`Daily fats target (g),${data.goals.daily_fats_target}`);
    } else {
      lines.push('No goals set.');
    }
    lines.push('');

    // Meal logs
    lines.push('=== MEAL HISTORY ===');
    lines.push('Date,Meal Type,Category,Meal Name,Calories,Protein (g),Carbs (g),Fats (g),Fiber (g),Sugar (g),Sodium (mg),Efficiency,Notes');
    for (const log of data.mealLogs || []) {
      lines.push([
        log.created_at,
        log.meal_type,
        log.category,
        `"${String(log.meal_name).replace(/"/g, '""')}"`,
        log.calories,
        log.protein,
        log.carbs,
        log.fats,
        log.fiber,
        log.sugar,
        log.sodium,
        log.efficiency_score,
        `"${String(log.notes || '').replace(/"/g, '""')}"`
      ].join(','));
    }

    // Weight logs
    lines.push('');
    lines.push('=== WEIGHT LOGS ===');
    lines.push('Date,Weight (kg)');
    for (const log of data.weightLogs || []) {
      const date = log.loggedOn || log.logged_on || '';
      const weight = log.weightKg ?? log.weight_kg ?? '';
      lines.push(`${date},${weight}`);
    }

    // Water logs
    lines.push('');
    lines.push('=== WATER LOGS ===');
    lines.push('Date,Intake (ml),Goal (ml)');
    for (const log of data.waterLogs || []) {
      const date = log.date || log.logged_on || '';
      const intake = log.intakeMl ?? log.intake_ml ?? '';
      const goal = log.goalMl ?? log.goal_ml ?? '';
      lines.push(`${date},${intake},${goal}`);
    }

    // Exercise logs
    lines.push('');
    lines.push('=== EXERCISE LOGS ===');
    lines.push('Date,Activity,Duration (min),Calories Burned');
    for (const log of data.exerciseLogs || []) {
      const date = log.date || log.logged_on || '';
      const activity = `"${String(log.activity || '').replace(/"/g, '""')}"`;
      const duration = log.durationMin ?? log.duration_min ?? '';
      const calories = log.caloriesBurned ?? log.calories_burned ?? '';
      lines.push(`${date},${activity},${duration},${calories}`);
    }

    // Sleep logs
    lines.push('');
    lines.push('=== SLEEP LOGS ===');
    lines.push('Date,Hours,Quality');
    for (const log of data.sleepLogs || []) {
      const date = log.date || log.logged_on || '';
      const hours = log.sleepHours ?? log.sleep_hours ?? '';
      const quality = log.quality || log.sleep_quality || '';
      lines.push(`${date},${hours},${quality}`);
    }

    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nutriai-export-${data.user.username}-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export CSV Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to export data.'
    });
  }
});

/**
 * GET /api/export/pdf
 * Export the authenticated user's data as a PDF report.
 */
app.get('/api/export/pdf', verifyToken, exportRateLimit, async (req, res) => {
  try {
    const data = exportUserData(req.userId);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="nutriai-export-${data.user.username}-${new Date().toISOString().slice(0,10)}.pdf"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).fillColor('#ff8a5c').text('NutriAI Tracker', { align: 'center' });
    doc.fontSize(12).fillColor('#6b748d').text('Personal Nutrition Data Export', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).fillColor('#b4bcd0').text(`User: ${data.user.username} (${data.user.email})`);
    doc.text(`Exported: ${data.exportedAt}`);
    doc.moveDown();

    // Profile section
    doc.fontSize(14).fillColor('#eef1f8').text('Profile', { underline: true });
    doc.fontSize(10);
    if (data.profile) {
      doc.text(`Age: ${data.profile.age}`);
      doc.text(`Gender: ${data.profile.gender}`);
      doc.text(`Height: ${data.profile.height_cm} cm`);
      doc.text(`Weight: ${data.profile.weight_kg} kg`);
      doc.text(`Activity Level: ${data.profile.activity_level}`);
      doc.text(`Goal: ${data.profile.goal}`);
      doc.text(`Dietary Preferences: ${data.profile.dietary_preferences || 'None'}`);
      doc.text(`Allergies: ${data.profile.allergies || 'None'}`);
    } else {
      doc.text('No profile data available.');
    }
    doc.moveDown();

    // Goals section
    doc.fontSize(14).fillColor('#eef1f8').text('Nutrition Goals', { underline: true });
    doc.fontSize(10);
    if (data.goals) {
      doc.text(`Daily Calorie Target: ${data.goals.daily_calorie_target} kcal`);
      doc.text(`Daily Protein Target: ${data.goals.daily_protein_target} g`);
      doc.text(`Daily Carbs Target: ${data.goals.daily_carbs_target} g`);
      doc.text(`Daily Fats Target: ${data.goals.daily_fats_target} g`);
    } else {
      doc.text('No nutrition goals set.');
    }
    doc.moveDown();

    // Meal history section
    doc.fontSize(14).fillColor('#eef1f8').text('Meal History', { underline: true });
    doc.fontSize(9);
    if (data.mealLogs && data.mealLogs.length > 0) {
      for (const log of data.mealLogs.slice(0, 50)) {
        doc.text(
          `${log.created_at} | ${log.meal_type} | ${log.meal_name} | ` +
          `${log.calories} kcal | P:${log.protein}g C:${log.carbs}g F:${log.fats}g | ` +
          `Fiber:${log.fiber}g Sugar:${log.sugar}g Sodium:${log.sodium}mg | ${log.efficiency_score}`
        );
        if (log.notes) doc.text(`  Notes: ${log.notes}`);
      }
      if (data.mealLogs.length > 50) {
        doc.text(`... and ${data.mealLogs.length - 50} more meals.`);
      }
    } else {
      doc.text('No meal history.');
    }

    doc.end();
  } catch (error) {
    console.error('Export PDF Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to export PDF.'
      });
    }
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
    const { mealType, category, textInput, imageBase64, loggedOn, notes, imageUrl, imageMetadata, portionSizes } = req.body;

    const credentialError = getMissingCredentialError();
    if (credentialError) {
      return res.status(500).json({ success: false, error: credentialError });
    }

    const systemPrompt = `
You are an advanced AI Clinical Dietitian and Sports Nutritionist.
Analyze the provided food description or photo.

User Meal Type: "${mealType || 'Snack'}"
User Fitness Category: "${category}"

CRITICAL NUTRITIONAL RULES & SANITY CHECKS:
- 1 Whole Egg ≈ 6g Protein, 5g Fat, 0.5g Carbs (~70 kcal).
- 1 Slice of Bread ≈ 3g-4g Protein, 12g-15g Carbs, 1g Fat (~70-80 kcal).
- Double-check macro values for realism! Never swap total calories (e.g., 188) into proteinGrams!
- Ensure total calories roughly match macronutrients: Calories = (Protein * 4) + (Carbs * 4) + (Fats * 9).

MEAL QUALITY SCORE (separate from confidence):
- High: the portion is reasonably sized, the meal broadly supports the selected fitness goal, and it provides useful nutrition for its role. A simple snack can be High when it is a suitable snack; do not require every meal to contain vegetables.
- Medium: the meal has useful qualities but also one notable gap/trade-off, or available details do not justify High or Low.
- Low: use only when there is clear evidence of a substantial issue, such as a meal dominated by added sugar/refined ingredients, a clearly excessive portion that conflicts with the selected goal, or a strongly unbalanced complete meal.
- Do not rate Low just because an ingredient, portion, vegetable, or macro is unknown. Keep uncertainty in confidenceLevel. Judge the described meal, not the user's whole-day diet.
- Pick the closest supported rating, not the strictest one. Explain the rating in one short, specific sentence in efficiencyScoreReason.

Perform these steps:
1. Identify all distinct food items in the text or photo.
2. Estimate the portion sizes (e.g., in grams or standard bowls/pieces).
3. Calculate accurate total calories and macronutrient breakdown (Protein, Carbs, Fats in grams).
4. Evaluate the meal against both its meal type and the user's fitness category.
5. Make every substitution, addition, and reduction appropriate to the selected meal type and a realistic portion for that occasion. Keep the food format similar when suggesting a substitution.
6. For Snack, recommend snack-sized, easy-to-eat options; do not suggest a bowl of rice, a full meal, or a side dish as the snack substitution unless the user explicitly describes that item as the snack. Examples can include fruit, yogurt, eggs, nuts, or roasted legumes only when suitable to the described diet and known restrictions.
7. For Breakfast, prefer breakfast-appropriate options; for Lunch and Dinner, suggest meal-sized foods or sides that fit that meal. Do not turn a snack into a full meal or a main meal into a snack.
8. Give no more than two specific additions and two reductions. Do not force a suggestion when the meal is already suitable; return an empty list when there is nothing useful to add or reduce.
9. Provide concise, actionable advice.
10. Rate your confidence in the analysis (High/Medium/Low) based on description/photo clarity and portion certainty.
11. Suggest concrete healthier substitutions for less healthy items, keeping them appropriate to the meal type.
12. List what to add or reduce only when it would make this particular meal more suitable.
13. Add warnings for missing protein, fiber, or vegetables when applicable to a complete meal; do not warn that a snack lacks vegetables unless that is relevant to the snack itself.

Reply ONLY in raw JSON with no markdown:
{
  "mealName": "Primary name of dish",
  "detectedItems": [
    { "name": "Item Name", "estimatedPortion": "e.g., 150g or 2 pieces", "confidence": "High" }
  ],
  "nutritionalSummary": {
    "totalCalories": 0,
    "proteinGrams": 0,
    "carbsGrams": 0,
    "fatsGrams": 0,
    "fiberGrams": 0,
    "sugarGrams": 0,
    "sodiumMg": 0
  },
  "efficiencyScore": "High",
  "efficiencyScoreReason": "Brief reason for this meal-quality rating",
  "confidenceLevel": "High",
  "goalAlignmentReason": "Why this meal fits the goal",
  "suggestedAdjustments": "Clear actionable tweak",
  "healthierSubstitutions": ["A concrete healthier swap that fits the selected meal type; empty array if none is useful"],
  "whatToAdd": ["A suitable, portion-appropriate food to add; empty array if none is useful"],
  "whatToReduce": ["A specific ingredient or portion to reduce; empty array if none is useful"],
  "warnings": ["Warnings about missing protein, fiber, or vegetables; empty array if none"]
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
      fiber: parsedData.nutritionalSummary.fiberGrams,
      sugar: parsedData.nutritionalSummary.sugarGrams,
      sodium: parsedData.nutritionalSummary.sodiumMg,
      efficiencyScore: parsedData.efficiencyScore,
      advice: parsedData.suggestedAdjustments,
      notes: notes || null,
      detectedItems: parsedData.detectedItems,
      portionSizes: portionSizes || parsedData.detectedItems?.map((item) => item.estimatedPortion || null) || [],
      goalAlignmentReason: parsedData.goalAlignmentReason,
      // Stored so the details modal can show the photo. It is deliberately kept
      // out of list responses - see formatMealLogSummary().
      imageBase64: imageBase64 || null,
      imageUrl: imageUrl || null,
      imageMetadata: imageMetadata || null,
      originalInput: (textInput || '').trim().slice(0, 2000) || null,
      loggedOn: loggedOn || null,
      analysisDetails: parsedData.analysisDetails
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

// ========== INSIGHTS & WEIGHT ENDPOINTS ==========

/**
 * GET /api/insights
 * Everything the Insights screen renders: weekly calorie average, macro
 * consistency, goal completion, streaks, most common meals, meal timing and
 * weight progress.
 *
 * Query params:
 *   days  7 | 30 | 90  (default 30)
 */
app.get('/api/insights', verifyToken, (req, res) => {
  try {
    const { days, startDate, endDate } = resolveInsightsRange(req.query.days);
    const insights = getInsights(req.userId, { startDate, endDate });

    res.json({ success: true, insights });
  } catch (error) {
    console.error('Insights Error:', error);
    res.status(500).json({ success: false, error: 'Failed to build insights.' });
  }
});

/**
 * GET /api/weight
 * Weight check-ins, newest first.
 */
app.get('/api/weight', verifyToken, (req, res) => {
  try {
    res.json({ success: true, logs: getWeightLogs(req.userId, MAX_WEIGHT_ENTRIES) });
  } catch (error) {
    console.error('Fetch Weight Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve weight history.' });
  }
});

/**
 * POST /api/weight
 * Log today's weight. Re-posting the same day corrects that day's entry rather
 * than adding a second point, so the progress chart stays one-per-day.
 */
app.post('/api/weight', verifyToken, validateWeightInput, (req, res) => {
  try {
    const today = toLocalDateString(startOfToday());
    const loggedOn = req.weightInput.date || today;

    if (loggedOn > today) {
      return res.status(400).json({
        success: false,
        error: 'Cannot log a weight for a future date.'
      });
    }

    const log = saveWeightLog(req.userId, req.weightInput.weightKg, loggedOn);

    res.status(201).json({ success: true, log });
  } catch (error) {
    console.error('Save Weight Error:', error);
    res.status(500).json({ success: false, error: 'Failed to save weight.' });
  }
});

/**
 * DELETE /api/weight/:id
 * Remove a single weight check-in.
 */
app.delete('/api/weight/:id', verifyToken, (req, res) => {
  try {
    const result = deleteWeightLog(req.params.id, req.userId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Weight entry not found' });
    }

    res.json({ success: true, message: 'Weight entry deleted' });
  } catch (error) {
    console.error('Delete Weight Error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete weight entry.' });
  }
});

// ========== WATER INTAKE ENDPOINTS ==========
app.get('/api/water', verifyToken, (req, res) => {
  try {
    if (req.query.startDate || req.query.endDate) {
      const { startDate, endDate } = req.query;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(startDate || '') || !datePattern.test(endDate || '') || startDate > endDate) {
        return res.status(400).json({ success: false, error: 'Provide a valid startDate and endDate range.' });
      }
      return res.json({ success: true, logs: getWaterLogs(req.userId, startDate, endDate, 31) });
    }

    const date = req.query.date || toLocalDateString(new Date());
    res.json({ success: true, log: getWaterLogForDate(req.userId, date) });
  } catch (error) {
    console.error('Get Water Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve water log.' });
  }
});

app.post('/api/water', verifyToken, validateWaterInput, (req, res) => {
  try {
    const loggedOn = req.waterInput.date || toLocalDateString(new Date());
    let intakeMl;
    if (Object.prototype.hasOwnProperty.call(req.waterInput, 'intakeMl')) {
      intakeMl = req.waterInput.intakeMl;
    } else {
      const existing = getWaterLogForDate(req.userId, loggedOn);
      intakeMl = (existing?.intakeMl || 0) + (req.waterInput.deltaMl || 0);
    }
    const log = saveWaterLog(req.userId, intakeMl, loggedOn, req.waterInput.goalMl);
    res.json({ success: true, log });
  } catch (error) {
    console.error('Save Water Error:', error);
    res.status(500).json({ success: false, error: 'Failed to save water log.' });
  }
});

app.delete('/api/water/:id', verifyToken, (req, res) => {
  try {
    const result = deleteWaterLog(req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Water entry not found' });
    res.json({ success: true, message: 'Water entry deleted' });
  } catch (error) {
    console.error('Delete Water Error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete water entry.' });
  }
});

// ========== EXERCISE ENDPOINTS ==========
app.get('/api/exercise', verifyToken, (req, res) => {
  try {
    const logs = getExerciseLogs(req.userId, req.query.startDate || null, req.query.endDate || null);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Get Exercise Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve exercise logs.' });
  }
});

app.post('/api/exercise', verifyToken, (req, res) => {
  try {
    const { activity, durationMin, caloriesBurned, date } = req.body;
    if (!activity || !String(activity).trim()) return res.status(400).json({ success: false, error: 'Activity is required.' });
    const loggedOn = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : toLocalDateString(new Date());
    const log = saveExerciseLog(req.userId, String(activity).trim().slice(0, 120), Number(durationMin) || 0, Number(caloriesBurned) || 0, loggedOn);
    res.json({ success: true, log });
  } catch (error) {
    console.error('Save Exercise Error:', error);
    res.status(500).json({ success: false, error: 'Failed to save exercise log.' });
  }
});

app.delete('/api/exercise/:id', verifyToken, (req, res) => {
  try {
    const result = deleteExerciseLog(req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Exercise entry not found' });
    res.json({ success: true, message: 'Exercise entry deleted' });
  } catch (error) {
    console.error('Delete Exercise Error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete exercise entry.' });
  }
});

// ========== SLEEP ENDPOINTS ==========
app.get('/api/sleep', verifyToken, (req, res) => {
  try {
    if (req.query.date) {
      const log = getSleepLogForDate(req.userId, req.query.date);
      return res.json({ success: true, log });
    }
    const logs = getSleepLogs(req.userId, req.query.startDate || null, req.query.endDate || null);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Get Sleep Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve sleep logs.' });
  }
});

app.post('/api/sleep', verifyToken, (req, res) => {
  try {
    const { sleepHours, quality, date } = req.body;
    const hours = Number(sleepHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return res.status(400).json({ success: false, error: 'Sleep hours must be between 0 and 24.' });
    const loggedOn = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : toLocalDateString(new Date());
    const log = saveSleepLog(req.userId, hours, quality ? String(quality).trim().slice(0, 40) : null, loggedOn);
    res.json({ success: true, log });
  } catch (error) {
    console.error('Save Sleep Error:', error);
    res.status(500).json({ success: false, error: 'Failed to save sleep log.' });
  }
});

app.delete('/api/sleep/:id', verifyToken, (req, res) => {
  try {
    const result = deleteSleepLog(req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Sleep entry not found' });
    res.json({ success: true, message: 'Sleep entry deleted' });
  } catch (error) {
    console.error('Delete Sleep Error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete sleep entry.' });
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
    const suggestedPort = Number.isInteger(Number(PORT)) ? Number(PORT) + 1 : 3002;
    console.error(`Port ${PORT} is already in use. Stop the existing server or run with a different port:`);
    console.error(`$env:PORT=${suggestedPort}; npm start`);
    process.exit(1);
  }
  throw error;
}); 