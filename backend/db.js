import Database from 'better-sqlite3';
import crypto from 'crypto';

const db = new Database('diet_tracker.sqlite');

// Enable WAL mode for better write performance
db.pragma('journal_mode = WAL');

// Step 1: Create basic tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS nutrition_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    daily_calorie_target INTEGER DEFAULT 2000,
    daily_protein_target REAL DEFAULT 150,
    daily_carbs_target REAL DEFAULT 250,
    daily_fats_target REAL DEFAULT 65,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    age INTEGER,
    gender TEXT,
    height_cm REAL,
    weight_kg REAL,
    activity_level TEXT,
    goal TEXT,
    dietary_preferences TEXT DEFAULT '',
    allergies TEXT DEFAULT '',
    onboarding_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS meal_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_type TEXT DEFAULT 'Snack',
    category TEXT NOT NULL,
    meal_name TEXT NOT NULL,
    calories INTEGER NOT NULL,
    protein INTEGER NOT NULL,
    carbs INTEGER NOT NULL,
    fats INTEGER NOT NULL,
    efficiency_score TEXT NOT NULL,
    advice TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- One weight entry per calendar day, so the progress chart never has two
  -- points for the same date to fight over.
  CREATE TABLE IF NOT EXISTS weight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    weight_kg REAL NOT NULL,
    logged_on TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, logged_on),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Water intake, one row per day per user. Same upsert-by-date shape as
  -- weight_logs so a re-log replaces the day instead of adding a second entry.
  CREATE TABLE IF NOT EXISTS water_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    intake_ml INTEGER NOT NULL,
    goal_ml INTEGER NOT NULL DEFAULT 2500,
    logged_on TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, logged_on),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Progress photos are stored as base64 in their own table rather than on
  -- meal_logs: they are large, and they are read one at a time by the
  -- photo-comparison view instead of alongside every list query.
  CREATE TABLE IF NOT EXISTS progress_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    image_base64 TEXT NOT NULL,
    note TEXT,
    weight_kg REAL,
    logged_on TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Step 2: Handle migrations - add columns that did not exist in older databases
const MEAL_LOG_COLUMN_MIGRATIONS = [
  { name: 'user_id', ddl: 'ALTER TABLE meal_logs ADD COLUMN user_id INTEGER' },
  { name: 'detected_items', ddl: "ALTER TABLE meal_logs ADD COLUMN detected_items TEXT DEFAULT '[]'" },
  { name: 'goal_alignment_reason', ddl: 'ALTER TABLE meal_logs ADD COLUMN goal_alignment_reason TEXT' },
  { name: 'image_base64', ddl: 'ALTER TABLE meal_logs ADD COLUMN image_base64 TEXT' },
  { name: 'original_input', ddl: 'ALTER TABLE meal_logs ADD COLUMN original_input TEXT' }
];

try {
  const existingColumns = new Set(
    db.prepare('PRAGMA table_info(meal_logs)').all().map((col) => col.name)
  );

  const pending = MEAL_LOG_COLUMN_MIGRATIONS.filter((migration) => !existingColumns.has(migration.name));

  if (pending.length > 0) {
    console.log(`🔄 Migrating database: adding ${pending.map((m) => m.name).join(', ')} to meal_logs...`);
    for (const migration of pending) {
      db.exec(migration.ddl);
    }
    console.log('✅ Migration complete');
  }
} catch (err) {
  console.error('Migration check failed:', err.message);
}

// Step 3: Create indexes (after migrations to ensure columns exist)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_meal_logs_user_id ON meal_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_meal_logs_created_at ON meal_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_meal_logs_user_name ON meal_logs(user_id, meal_name);
  CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(user_id, logged_on);
  CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, logged_on);
  CREATE INDEX IF NOT EXISTS idx_progress_photos_user_date ON progress_photos(user_id, logged_on);
`);

// ========== HELPERS ==========

// Used when a water entry predates an explicit goal, and as the fallback when a
// stored goal is somehow zero (which would otherwise divide by zero).
export const DEFAULT_WATER_GOAL_ML = 2500;

/**
 * Format a Date as YYYY-MM-DD in local time, matching the 'localtime' modifier
 * used by every SQL date filter.
 */
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


// ========== USER MANAGEMENT ==========

/**
 * Hash password using SHA-256
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Create a new user
 */
export function createUser(username, email, password) {
  try {
    const passwordHash = hashPassword(password);
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `);
    
    const info = stmt.run(username, email, passwordHash);
    
    // Create default nutrition goals for new user
    createNutritionGoals(info.lastInsertRowid);
    
    return info.lastInsertRowid;
  } catch (error) {
    throw new Error(`User creation failed: ${error.message}`);
  }
}

/**
 * Authenticate user
 */
export function authenticateUser(identifier, password) {
  const normalizedIdentifier = String(identifier || '').trim();
  const passwordHash = hashPassword(password);

  const stmt = db.prepare(`
    SELECT id, username, email FROM users
    WHERE (username = ? OR email = ?) AND password_hash = ?
  `);

  return stmt.get(normalizedIdentifier, normalizedIdentifier.toLowerCase(), passwordHash);
}

/**
 * Get user by ID
 */
export function getUserById(userId) {
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.email, u.created_at,
      IFNULL(p.onboarding_completed, 0) as onboarding_completed
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `);
  return stmt.get(userId);
}

/**
 * Check if email exists
 */
export function emailExists(email) {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM users WHERE email = ?
  `);
  const result = stmt.get(email);
  return result.count > 0;
}

// ========== NUTRITION GOALS ==========

/**
 * Create default nutrition goals for user
 */
export function createNutritionGoals(userId) {
  const stmt = db.prepare(`
    INSERT INTO nutrition_goals (user_id, daily_calorie_target, daily_protein_target, daily_carbs_target, daily_fats_target)
    VALUES (?, 2000, 150, 250, 65)
  `);
  
  return stmt.run(userId).lastInsertRowid;
}

/**
 * Get nutrition goals for user
 */
export function getNutritionGoals(userId) {
  const stmt = db.prepare(`
    SELECT * FROM nutrition_goals WHERE user_id = ?
  `);
  return stmt.get(userId);
}

/**
 * Update nutrition goals
 */
export function updateNutritionGoals(userId, goals) {
  const stmt = db.prepare(`
    UPDATE nutrition_goals 
    SET daily_calorie_target = ?, daily_protein_target = ?, daily_carbs_target = ?, daily_fats_target = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `);
  
  return stmt.run(
    goals.dailyCalorieTarget || 2000,
    goals.dailyProteinTarget || 150,
    goals.dailyCarbsTarget || 250,
    goals.dailyFatsTarget || 65,
    userId
  );
}

// ========== USER PROFILE / ONBOARDING ==========

/**
 * Get a user's onboarding profile
 */
export function getUserProfile(userId) {
  const stmt = db.prepare(`
    SELECT * FROM user_profiles WHERE user_id = ?
  `);
  return stmt.get(userId) || null;
}

/**
 * Insert or update a user's onboarding profile.
 * Marks onboarding as complete once a full profile is saved.
 */
export function upsertUserProfile(userId, profile) {
  const existing = getUserProfile(userId);

  if (existing) {
    db.prepare(`
      UPDATE user_profiles
      SET age = ?, gender = ?, height_cm = ?, weight_kg = ?, activity_level = ?,
          goal = ?, dietary_preferences = ?, allergies = ?, onboarding_completed = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      profile.age,
      profile.gender,
      profile.heightCm,
      profile.weightKg,
      profile.activityLevel,
      profile.goal,
      profile.dietaryPreferences || '',
      profile.allergies || '',
      userId
    );
  } else {
    db.prepare(`
      INSERT INTO user_profiles
        (user_id, age, gender, height_cm, weight_kg, activity_level, goal, dietary_preferences, allergies, onboarding_completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      userId,
      profile.age,
      profile.gender,
      profile.heightCm,
      profile.weightKg,
      profile.activityLevel,
      profile.goal,
      profile.dietaryPreferences || '',
      profile.allergies || ''
    );
  }

  // Seed today's weight from the profile so the progress chart has a starting
  // point on day one. Insert-only: a weight the user checked in themselves for
  // today always wins, even when the profile is edited afterwards.
  db.prepare(`
    INSERT INTO weight_logs (user_id, weight_kg, logged_on)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, logged_on) DO NOTHING
  `).run(userId, profile.weightKg, toLocalDateString(new Date()));

  return getUserProfile(userId);
}

// ========== WEIGHT LOGS ==========

/**
 * Shape a weight row for the API: the column is weight_kg, clients want weightKg.
 */
function formatWeightLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    weightKg: row.weight_kg,
    loggedOn: row.logged_on
  };
}

/**
 * Store a weight for a given day, replacing any existing entry for that day so
 * re-checking in on the same morning corrects the number instead of adding a
 * second point. Returns the stored row.
 */
export function saveWeightLog(userId, weightKg, loggedOn) {
  db.prepare(`
    INSERT INTO weight_logs (user_id, weight_kg, logged_on)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, logged_on) DO UPDATE SET weight_kg = excluded.weight_kg
  `).run(userId, weightKg, loggedOn);

  return formatWeightLog(
    db.prepare('SELECT id, weight_kg, logged_on FROM weight_logs WHERE user_id = ? AND logged_on = ?')
      .get(userId, loggedOn)
  );
}

/**
 * Most recent weight entries, newest first.
 */
export function getWeightLogs(userId, limit = 400) {
  return db.prepare(`
    SELECT id, weight_kg, logged_on
    FROM weight_logs
    WHERE user_id = ?
    ORDER BY logged_on DESC
    LIMIT ?
  `).all(userId, limit).map(formatWeightLog);
}

/**
 * Delete a single weight entry.
 */
export function deleteWeightLog(id, userId) {
  return db.prepare('DELETE FROM weight_logs WHERE id = ? AND user_id = ?').run(id, userId);
}

// ========== WATER INTAKE ==========

/**
 * Shape a water row for the API: columns are intake_ml/goal_ml, clients want
 * camelCase. Percentages are derived here so every consumer reports progress
 * the same way.
 */
function formatWaterLog(row) {
  if (!row) return null;

  const goal = row.goal_ml > 0 ? row.goal_ml : DEFAULT_WATER_GOAL_ML;
  const percent = Math.min(Math.round((row.intake_ml / goal) * 100), 100);

  return {
    id: row.id,
    date: row.logged_on,
    intakeMl: row.intake_ml,
    goalMl: goal,
    percent,
    goalReached: row.intake_ml >= goal
  };
}

/**
 * Store today's water intake, replacing any existing entry for that day so a
 * corrected number does not stack up on the day already logged.
 */
export function saveWaterLog(userId, intakeMl, loggedOn, goalMl = DEFAULT_WATER_GOAL_ML) {
  db.prepare(`
    INSERT INTO water_logs (user_id, intake_ml, goal_ml, logged_on)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, logged_on) DO UPDATE SET
      intake_ml = excluded.intake_ml,
      goal_ml = excluded.goal_ml
  `).run(userId, intakeMl, goalMl, loggedOn);

  return formatWaterLog(
    db.prepare('SELECT id, intake_ml, goal_ml, logged_on FROM water_logs WHERE user_id = ? AND logged_on = ?')
      .get(userId, loggedOn)
  );
}

/**
 * Read the water log for a single day, or null when nothing is logged yet.
 */
export function getWaterLogForDate(userId, date) {
  return formatWaterLog(
    db.prepare(`
      SELECT id, intake_ml, goal_ml, logged_on
      FROM water_logs
      WHERE user_id = ? AND logged_on = ?
    `).get(userId, date)
  );
}

/**
 * Water totals for an inclusive date range, oldest first, for the 7-day strip.
 * Days with no entry are omitted rather than zero-filled: the client only draws
 * bars for days the user actually tracked, so an untracked day is not shown as
 * a day they drank nothing.
 */
export function getWaterLogs(userId, startDate, endDate, limit = 31) {
  return db.prepare(`
    SELECT id, intake_ml, goal_ml, logged_on
    FROM water_logs
    WHERE user_id = ? AND logged_on BETWEEN ? AND ?
    ORDER BY logged_on ASC
    LIMIT ?
  `).all(userId, startDate, endDate, limit).map(formatWaterLog);
}

/**
 * Delete a single water entry.
 */
export function deleteWaterLog(id, userId) {
  return db.prepare('DELETE FROM water_logs WHERE id = ? AND user_id = ?').run(id, userId);
}

// ========== PROGRESS PHOTOS ==========

/**
 * Shape a progress-photo row. The base64 blob is only included when
 * `includeImage` is set: the list endpoint omits it so the gallery renders from
 * metadata alone, and the single-photo endpoint includes it.
 */
function formatProgressPhoto(row, { includeImage = false } = {}) {
  if (!row) return null;

  return {
    id: row.id,
    date: row.logged_on,
    note: row.note || null,
    weightKg: row.weight_kg ?? null,
    ...(includeImage ? { imageBase64: row.image_base64 } : {})
  };
}

/**
 * Store a progress photo. Photos are compressed client-side before upload, and
 * `loggedOn` is explicit so a back-dated entry can be attached to the right
 * point on the weight chart.
 */
export function saveProgressPhoto(userId, { imageBase64, note, weightKg, loggedOn }) {
  const info = db.prepare(`
    INSERT INTO progress_photos (user_id, image_base64, note, weight_kg, logged_on)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    imageBase64,
    note || null,
    weightKg ?? null,
    loggedOn
  );

  return getProgressPhotoById(info.lastInsertRowid, userId, { includeImage: true });
}

/**
 * Progress photos newest first, without the base64 payloads.
 */
export function getProgressPhotos(userId, limit = 60) {
  return db.prepare(`
    SELECT id, note, weight_kg, logged_on
    FROM progress_photos
    WHERE user_id = ?
    ORDER BY logged_on DESC, id DESC
    LIMIT ?
  `).all(userId, limit).map((row) => formatProgressPhoto(row));
}

/**
 * A single photo including its image. Only the before/after comparison view
 * reads the two payloads it actually needs, rather than loading the whole
 * gallery's worth of base64.
 */
export function getProgressPhotoById(id, userId) {
  const row = db.prepare(`
    SELECT id, note, weight_kg, logged_on, image_base64
    FROM progress_photos
    WHERE id = ? AND user_id = ?
  `).get(id, userId);

  return formatProgressPhoto(row, { includeImage: true });
}

/**
 * The oldest and newest photos, used as the before/after pair.
 */
export function getProgressPhotoEndpoints(userId) {
  const first = db.prepare(`
    SELECT id, note, weight_kg, logged_on, image_base64
    FROM progress_photos
    WHERE user_id = ?
    ORDER BY logged_on ASC, id ASC
    LIMIT 1
  `).get(userId);

  const last = db.prepare(`
    SELECT id, note, weight_kg, logged_on, image_base64
    FROM progress_photos
    WHERE user_id = ?
    ORDER BY logged_on DESC, id DESC
    LIMIT 1
  `).get(userId);

  return {
    first: formatProgressPhoto(first, { includeImage: true }),
    last: formatProgressPhoto(last, { includeImage: true })
  };
}

/**
 * Delete a single progress photo.
 */
export function deleteProgressPhoto(id, userId) {
  return db.prepare('DELETE FROM progress_photos WHERE id = ? AND user_id = ?').run(id, userId);
}

// ========== MEAL SUGGESTIONS ==========

/**
 * Per-macro totals for a single day, for the suggestions engine.
 *
 * Reads one day at a time so the engine can compare consecutive days and spot a
 * repeated meal the user could rotate out.
 */
export function getDailyMacroTotals(userId, startDate, endDate) {
  return db.prepare(`
    SELECT
      DATE(created_at, 'localtime') as log_date,
      IFNULL(SUM(calories), 0) as totalCalories,
      IFNULL(SUM(protein), 0) as totalProtein,
      IFNULL(SUM(carbs), 0) as totalCarbs,
      IFNULL(SUM(fats), 0) as totalFats
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY DATE(created_at, 'localtime')
    ORDER BY log_date ASC
  `).all(userId, startDate, endDate);
}

/**
 * Meal-type breakdown over a range: how many of each type were logged and how
 * many hit a "High" efficiency score. Rotating a meal type the user consistently
 * rates "Low" is the main lever the suggestions engine pulls.
 */
export function getMealTypePerformance(userId, startDate, endDate) {
  return db.prepare(`
    SELECT
      meal_type as mealType,
      COUNT(*) as timesLogged,
      IFNULL(SUM(calories), 0) as totalCalories,
      SUM(CASE WHEN efficiency_score = 'High' THEN 1 ELSE 0 END) as highScores,
      SUM(CASE WHEN efficiency_score = 'Low' THEN 1 ELSE 0 END) as lowScores
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY meal_type
  `).all(userId, startDate, endDate);
}

/**
 * Most frequently logged meal names in a range, with their average macros.
 * Used to suggest rotating out a meal the user eats on autopilot.
 */
export function getFrequentMeals(userId, startDate, endDate, limit = 5) {
  return db.prepare(`
    SELECT
      meal_name as mealName,
      COUNT(*) as timesLogged,
      ROUND(IFNULL(AVG(calories), 0)) as averageCalories,
      ROUND(IFNULL(AVG(protein), 0)) as averageProtein
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY LOWER(TRIM(meal_name))
    ORDER BY timesLogged DESC, mealName ASC
    LIMIT ?
  `).all(userId, startDate, endDate, limit);
}

// ========== MEAL LOGS ==========

// The photo can be ~200KB of base64. Keep it out of list/aggregate responses and
// only expose it on the single-log endpoint that feeds the details modal.
const MEAL_LOG_SUMMARY_COLUMNS = `
  id, meal_type, category, meal_name, calories, protein, carbs, fats,
  efficiency_score, advice, goal_alignment_reason, detected_items, created_at
`;

/**
 * Parse the JSON-encoded detected_items column, never throwing on bad data.
 */
function parseDetectedItems(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Shape a row for the history table: dates localised, JSON parsed, photo removed.
 */
function formatMealLogSummary(row) {
  if (!row) return null;

  const {
    image_base64: _omittedImage,
    detected_items,
    created_at: createdAt,
    ...rest
  } = row;

  return {
    ...rest,
    detectedItems: parseDetectedItems(detected_items),
    created_at: createdAt
  };
}

/**
 * Shape a row for the details modal - identical to the summary plus the photo
 * and the original text the user typed.
 */
export function formatMealLogDetail(row) {
  if (!row) return null;
  return {
    ...formatMealLogSummary(row),
    imageBase64: row.image_base64 || null,
    originalInput: row.original_input || null
  };
}

/**
 * Save a new meal log entry
 */
export function saveMealLog(mealData, userId) {
  const stmt = db.prepare(`
    INSERT INTO meal_logs (
      user_id, meal_type, category, meal_name, calories, protein, carbs, fats,
      efficiency_score, advice, detected_items, goal_alignment_reason, image_base64, original_input
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    userId,
    mealData.mealType || 'Snack',
    mealData.category || 'Maintenance',
    mealData.mealName || 'Logged Meal',
    mealData.calories || 0,
    mealData.protein || 0,
    mealData.carbs || 0,
    mealData.fats || 0,
    mealData.efficiencyScore || 'Medium',
    mealData.advice || '',
    JSON.stringify(mealData.detectedItems || []),
    mealData.goalAlignmentReason || '',
    mealData.imageBase64 || null,
    mealData.originalInput || null
  );

  return info.lastInsertRowid;
}

/**
 * Escape LIKE wildcards so a user searching for "50%" does not match everything.
 */
const escapeLike = (term) => term.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Build the shared WHERE clause for filtered/paginated history queries.
 */
function buildHistoryFilter(userId, { startDate, endDate, search }) {
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (startDate) {
    conditions.push("DATE(created_at, 'localtime') >= ?");
    params.push(startDate);
  }

  if (endDate) {
    conditions.push("DATE(created_at, 'localtime') <= ?");
    params.push(endDate);
  }

  if (search) {
    conditions.push("meal_name LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(search)}%`);
  }

  return { where: conditions.join(' AND '), params };
}

/**
 * Get logs matching a date range / search term, with the total match count so the
 * client can render "Load more" and "showing X of Y".
 */
export function getFilteredLogs(userId, { startDate, endDate, search, limit = 25, offset = 0 } = {}) {
  const { where, params } = buildHistoryFilter(userId, { startDate, endDate, search });

  const rows = db.prepare(`
    SELECT ${MEAL_LOG_SUMMARY_COLUMNS} FROM meal_logs
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const { total } = db.prepare(`
    SELECT COUNT(*) as total FROM meal_logs WHERE ${where}
  `).get(...params);

  return { logs: rows.map(formatMealLogSummary), total, hasMore: offset + rows.length < total };
}

/**
 * Aggregate totals across the same filters, so switching date range or search
 * updates the summary cards too instead of only the table.
 */
export function getFilteredTotals(userId, { startDate, endDate, search } = {}) {
  const { where, params } = buildHistoryFilter(userId, { startDate, endDate, search });

  return db.prepare(`
    SELECT
      IFNULL(SUM(calories), 0) as totalCalories,
      IFNULL(SUM(protein), 0) as totalProtein,
      IFNULL(SUM(carbs), 0) as totalCarbs,
      IFNULL(SUM(fats), 0) as totalFats
    FROM meal_logs
    WHERE ${where}
  `).get(...params);
}

/**
 * Get all logs for today with optional pagination
 */
export function getDailyLogs(userId, limit = 50, offset = 0) {
  const stmt = db.prepare(`
    SELECT ${MEAL_LOG_SUMMARY_COLUMNS} FROM meal_logs 
    WHERE user_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(userId, limit, offset).map(formatMealLogSummary);
}

/**
 * Get logs for specific date range
 */
export function getLogsInDateRange(userId, startDate, endDate, limit = 50, offset = 0) {
  const stmt = db.prepare(`
    SELECT ${MEAL_LOG_SUMMARY_COLUMNS} FROM meal_logs 
    WHERE user_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(userId, startDate, endDate, limit, offset).map(formatMealLogSummary);
}

/**
 * Get total nutritional stats for today
 */
export function getDailyTotals(userId) {
  const stmt = db.prepare(`
    SELECT 
      IFNULL(SUM(calories), 0) as totalCalories,
      IFNULL(SUM(protein), 0) as totalProtein,
      IFNULL(SUM(carbs), 0) as totalCarbs,
      IFNULL(SUM(fats), 0) as totalFats
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')
  `);
  return stmt.get(userId);
}

/**
 * Get total nutritional stats for specific date
 */
export function getTotalsByDate(userId, date) {
  const stmt = db.prepare(`
    SELECT 
      IFNULL(SUM(calories), 0) as totalCalories,
      IFNULL(SUM(protein), 0) as totalProtein,
      IFNULL(SUM(carbs), 0) as totalCarbs,
      IFNULL(SUM(fats), 0) as totalFats
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') = ?
  `);
  return stmt.get(userId, date);
}

/**
 * Get last 30 days of daily totals (for the monthly line chart)
 */
export function getMonthlyHistory(userId) {
  const stmt = db.prepare(`
    SELECT
      DATE(created_at, 'localtime') as log_date,
      IFNULL(SUM(calories), 0) as totalCalories,
      IFNULL(SUM(protein), 0) as totalProtein,
      IFNULL(SUM(carbs), 0) as totalCarbs,
      IFNULL(SUM(fats), 0) as totalFats
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') >= DATE('now', 'localtime', '-30 days')
    GROUP BY DATE(created_at, 'localtime')
    ORDER BY log_date ASC
  `);
  return stmt.all(userId);
}

/**
 * Get a specific meal log by ID, including the stored photo and detected items.
 */
export function getMealLogById(id, userId) {
  const stmt = db.prepare(`
    SELECT * FROM meal_logs WHERE id = ? AND user_id = ?
  `);
  return stmt.get(id, userId);
}

const EDITABLE_MEAL_FIELDS = new Map([
  ['mealType', 'meal_type'],
  ['category', 'category'],
  ['mealName', 'meal_name'],
  ['calories', 'calories'],
  ['protein', 'protein'],
  ['carbs', 'carbs'],
  ['fats', 'fats'],
  ['efficiencyScore', 'efficiency_score'],
  ['advice', 'advice'],
  ['goalAlignmentReason', 'goal_alignment_reason']
]);

/**
 * Update a meal log. Accepts a partial patch so the table editor can change a
 * single field without having to resend the whole record. Unknown keys are
 * ignored so the endpoint cannot be used to reassign ownership or edit ids.
 */
export function updateMealLog(id, userId, mealData = {}) {
  const assignments = [];
  const params = [];

  for (const [key, column] of EDITABLE_MEAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(mealData, key)) continue;
    if (mealData[key] === undefined || mealData[key] === null) continue;

    assignments.push(`${column} = ?`);
    params.push(mealData[key]);
  }

  if (Object.prototype.hasOwnProperty.call(mealData, 'detectedItems')) {
    assignments.push('detected_items = ?');
    params.push(JSON.stringify(parseDetectedItems(
      typeof mealData.detectedItems === 'string'
        ? mealData.detectedItems
        : JSON.stringify(mealData.detectedItems || [])
    )));
  }

  if (assignments.length === 0) {
    return { changes: 0 };
  }

  const stmt = db.prepare(`
    UPDATE meal_logs
    SET ${assignments.join(', ')}
    WHERE id = ? AND user_id = ?
  `);

  return stmt.run(...params, id, userId);
}

/**
 * Delete a specific log by ID
 */
export function deleteMealLog(id, userId) {
  const stmt = db.prepare('DELETE FROM meal_logs WHERE id = ? AND user_id = ?');
  return stmt.run(id, userId);
}

/**
 * Delete ALL logs for a user
 */
export function deleteAllLogs(userId) {
  const stmt = db.prepare('DELETE FROM meal_logs WHERE user_id = ?');
  return stmt.run(userId);
}

// ========== INSIGHTS DATA ==========

// The insights endpoint bounds the range to 90 days, so this ceiling is a
// safety net for pathological data rather than a normal limit.
const MAX_MEAL_ACTIVITY_ROWS = 5000;

/**
 * Raw per-meal rows for a date range, consumed by the insights analytics.
 *
 * Daily totals, streaks, meal frequency and meal timing are all derived from
 * this single read, so every figure on the Insights screen describes the same
 * set of meals. Hours and minutes are extracted in SQL because created_at is
 * stored in UTC while the analytics must report the user's local clock.
 */
export function getMealActivity(userId, startDate, endDate) {
  const stmt = db.prepare(`
    SELECT
      DATE(created_at, 'localtime') as log_date,
      CAST(strftime('%H', created_at, 'localtime') AS INTEGER) as log_hour,
      CAST(strftime('%M', created_at, 'localtime') AS INTEGER) as log_minute,
      meal_type,
      meal_name,
      LOWER(TRIM(meal_name)) as name_key,
      calories, protein, carbs, fats, efficiency_score
    FROM meal_logs
    WHERE user_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    ORDER BY created_at ASC
    LIMIT ?
  `);

  return stmt.all(userId, startDate, endDate, MAX_MEAL_ACTIVITY_ROWS);
}