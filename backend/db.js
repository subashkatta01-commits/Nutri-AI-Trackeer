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
`);

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
export function authenticateUser(email, password) {
  const passwordHash = hashPassword(password);
  const stmt = db.prepare(`
    SELECT id, username, email FROM users 
    WHERE email = ? AND password_hash = ?
  `);
  
  return stmt.get(email, passwordHash);
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

  return getUserProfile(userId);
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