import Database from 'better-sqlite3';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

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

  CREATE TABLE IF NOT EXISTS pending_signups (
    email TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
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
    user_id INTEGER,
    meal_type TEXT DEFAULT 'Snack',
    category TEXT NOT NULL,
    meal_name TEXT NOT NULL,
    calories INTEGER NOT NULL DEFAULT 0,
    protein INTEGER NOT NULL DEFAULT 0,
    carbs INTEGER NOT NULL DEFAULT 0,
    fats INTEGER NOT NULL DEFAULT 0,
    fiber REAL DEFAULT 0,
    sugar REAL DEFAULT 0,
    sodium REAL DEFAULT 0,
    efficiency_score TEXT NOT NULL DEFAULT 'Medium',
    advice TEXT,
    notes TEXT,
    detected_items TEXT DEFAULT '[]',
    portion_sizes TEXT,
    image_base64 TEXT,
    image_url TEXT,
    image_metadata TEXT,
    goal_alignment_reason TEXT,
    original_input TEXT,
    analysis_details TEXT DEFAULT '{}',
    logged_on TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

  -- Exercise sessions. A user can log multiple sessions per day, so no unique constraint.
  CREATE TABLE IF NOT EXISTS exercise_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    activity TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 0,
    calories_burned INTEGER NOT NULL DEFAULT 0,
    logged_on TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Sleep entries, one per calendar day so a re-log corrects that night.
  CREATE TABLE IF NOT EXISTS sleep_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sleep_hours REAL NOT NULL,
    sleep_quality TEXT,
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
  { name: 'image_url', ddl: 'ALTER TABLE meal_logs ADD COLUMN image_url TEXT' },
  { name: 'image_metadata', ddl: 'ALTER TABLE meal_logs ADD COLUMN image_metadata TEXT' },
  { name: 'portion_sizes', ddl: 'ALTER TABLE meal_logs ADD COLUMN portion_sizes TEXT' },
  { name: 'notes', ddl: 'ALTER TABLE meal_logs ADD COLUMN notes TEXT' },
  { name: 'original_input', ddl: 'ALTER TABLE meal_logs ADD COLUMN original_input TEXT' },
  { name: 'analysis_details', ddl: "ALTER TABLE meal_logs ADD COLUMN analysis_details TEXT DEFAULT '{}'" },
  { name: 'fiber', ddl: "ALTER TABLE meal_logs ADD COLUMN fiber REAL DEFAULT 0" },
  { name: 'sugar', ddl: "ALTER TABLE meal_logs ADD COLUMN sugar REAL DEFAULT 0" },
  { name: 'sodium', ddl: "ALTER TABLE meal_logs ADD COLUMN sodium REAL DEFAULT 0" },
  { name: 'logged_on', ddl: 'ALTER TABLE meal_logs ADD COLUMN logged_on TEXT' }
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
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_signups_username_lower ON pending_signups(LOWER(username));
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
export function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


// ========== PASSWORD RESET TOKENS TABLE ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
`);

// ========== USER MANAGEMENT ==========

// bcrypt only ever reads the first 72 bytes of a password. Truncate inputs to
// that so hashing (signup) and verification (login) always agree, while the
// route-level validation still rejects absurdly long passwords as a DoS guard.
const BCRYPT_SALT_ROUNDS = 10;
const BCRYPT_MAX_PASSWORD_BYTES = 72;

function truncatePassword(password) {
  return Buffer.from(password, 'utf8').subarray(0, BCRYPT_MAX_PASSWORD_BYTES).toString('utf8');
}

/**
 * Hash a password with bcrypt - a slow, salted algorithm suitable for storing
 * credentials. Replaces the previous plain SHA-256 hash.
 */
export async function hashPassword(password) {
  return bcrypt.hash(truncatePassword(password), BCRYPT_SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored bcrypt hash.
 */
export async function comparePassword(password, storedHash) {
  return bcrypt.compare(truncatePassword(password), storedHash);
}

/**
 * Create a new user
 */
export async function createUser(username, email, password) {
  try {
    const passwordHash = await hashPassword(password);
    return createUserWithPasswordHash(username, email, passwordHash);
  } catch (error) {
    throw new Error(`User creation failed: ${error.message}`);
  }
}

/** Create a user from a previously hashed password and seed default goals atomically. */
export function createUserWithPasswordHash(username, email, passwordHash) {
  const createUserTransaction = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `);
    
    const info = stmt.run(username, email, passwordHash);
    
    // Create default nutrition goals for new user
    createNutritionGoals(info.lastInsertRowid);
    return info.lastInsertRowid;
  });

  return createUserTransaction(username, email, passwordHash);
}

export function cleanupExpiredPendingSignups() {
  return db.prepare('DELETE FROM pending_signups WHERE expires_at <= ?').run(Date.now());
}

export function usernameExists(username) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username));
}

export function pendingSignupUsernameExists(username, exceptEmail = '') {
  cleanupExpiredPendingSignups();
  return Boolean(db.prepare(`
    SELECT 1 FROM pending_signups
    WHERE username = ? COLLATE NOCASE AND email <> ? AND expires_at > ?
  `).get(username, exceptEmail, Date.now()));
}

export function savePendingSignup({ username, email, passwordHash, codeHash, expiresAt, createdAt = Date.now() }) {
  cleanupExpiredPendingSignups();
  // Clear any existing pending record for this email or username to prevent index collisions
  db.prepare('DELETE FROM pending_signups WHERE email = ? OR username = ? COLLATE NOCASE').run(email, username);
  db.prepare(`
    INSERT INTO pending_signups (email, username, password_hash, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(email, username, passwordHash, codeHash, expiresAt, createdAt);
}

export function getPendingSignup(email) {
  cleanupExpiredPendingSignups();
  return db.prepare('SELECT * FROM pending_signups WHERE email = ? AND expires_at > ?').get(email, Date.now()) || null;
}

export function incrementPendingSignupAttempts(email) {
  return db.prepare('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?').run(email);
}

export function deletePendingSignup(email) {
  return db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
}

/**
 * Authenticate user.
 *
 * Supports two hash formats so existing accounts keep working:
 * - bcrypt hashes (prefix `$2`) created after this upgrade
 * - legacy SHA-256 hashes (64 hex chars) from before the upgrade; a successful
 *   legacy login transparently re-hashes the password with bcrypt so the user
 *   never has to reset it.
 */
export async function authenticateUser(identifier, password) {
  const normalizedIdentifier = String(identifier || '').trim();

  const stmt = db.prepare(`
    SELECT id, username, email, password_hash FROM users
    WHERE (username = ? OR email = ?)
  `);

  const user = stmt.get(normalizedIdentifier, normalizedIdentifier.toLowerCase());
  if (!user) return null;

  let valid = false;
  const storedHash = user.password_hash;

  if (typeof storedHash === 'string' && storedHash.startsWith('$2')) {
    // Current algorithm: bcrypt.
    valid = await comparePassword(password, storedHash);
  } else if (typeof storedHash === 'string' && /^[0-9a-f]{64}$/.test(storedHash)) {
    // Legacy algorithm: SHA-256. Verify, then transparently re-hash with bcrypt.
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    valid = crypto.timingSafeEqual(
      Buffer.from(legacyHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
    if (valid) {
      try {
        const newHash = await hashPassword(password);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
        console.log(`🔐 Transparently re-hashed legacy password for user ${user.id} with bcrypt.`);
      } catch (rehashError) {
        console.error(`Transparent re-hash failed for user ${user.id}:`, rehashError.message);
      }
    }
  }

  if (!valid) return null;

  const { password_hash: _omitted, ...userWithoutHash } = user;
  return userWithoutHash;
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

/**
 * Get a user's stored password hash by ID (for password verification without
 * exposing the hash in the normal user response).
 */
export function getUserPasswordHash(userId) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  return row?.password_hash || null;
}

/**
 * Change a user's password. Verifies the current password first, then replaces
 * it with a new bcrypt hash.
 */
export async function changeUserPassword(userId, currentPassword, newPassword) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found.');

  // We need the stored hash to verify the current password. getUserById omits
  // password_hash, so fetch it directly.
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found.');

  const valid = await comparePassword(currentPassword, row.password_hash);
  if (!valid) throw new Error('Current password is incorrect.');

  const newHash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
  return { success: true };
}

/**
 * Create a password reset token for a user (forgot password flow).
 * Returns the plain token so it can be delivered (e.g. by email).
 * In this app the token is returned to the caller; in production it should be
 * sent via email and never exposed in an API response to an unauthenticated user.
 */
export async function createPasswordResetToken(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (!row) {
    // Do not reveal whether the email exists. Return a generic success marker.
    return { emailExists: false, token: null };
  }

  // Invalidate any existing unused tokens for this user.
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(row.id);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO password_reset_tokens (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(row.id, token, expiresAt);

  return { emailExists: true, token };
}

/**
 * Verify a password reset token is valid and not expired/used.
 * Returns the user id if valid, null otherwise.
 */
export function verifyPasswordResetToken(token) {
  const row = db.prepare(`
    SELECT prt.user_id, prt.expires_at, prt.used, u.id as userId
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.token = ? AND prt.used = 0
  `).get(token);

  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) return null;
  return row.userId;
}

/**
 * Reset a user's password using a valid reset token. Marks the token as used.
 */
export async function resetPasswordWithToken(token, newPassword) {
  const userId = verifyPasswordResetToken(token);
  if (!userId) throw new Error('Invalid or expired reset token.');

  const newHash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?').run(token);
  return { success: true };
}

/**
 * Delete a user account and all associated data (cascades via foreign keys).
 */
export function deleteUserAccount(userId) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found.');

  // Invalidate any pending reset tokens for this user.
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(userId);

  // Delete the user (cascades to profiles, goals, meal logs, etc. via ON DELETE CASCADE).
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return { success: true };
}

/**
 * Gather all of a user's data for export (CSV / PDF / download).
 */
export function exportUserData(userId) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found.');

  const profile = getUserProfile(userId) || null;
  const goals = getNutritionGoals(userId) || null;
  const mealLogs = getMealLogsForExport(userId);
  const weightLogs = getWeightLogs(userId, 10000);
  const waterLogs = getWaterLogs(userId, null, null, 10000);
  const exerciseLogs = getExerciseLogs(userId, null, null);
  const sleepLogs = getSleepLogs(userId, null, null);

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at
    },
    profile,
    goals,
    mealLogs,
    weightLogs,
    waterLogs,
    exerciseLogs,
    sleepLogs,
    exportedAt: new Date().toISOString()
  };
}

/**
 * Get all meal logs for a user (full detail including detected items etc.)
 * for export purposes.
 */
export function getMealLogsForExport(userId) {
  return db.prepare(`
    SELECT * FROM meal_logs WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
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
  const args = [userId];
  let where = 'user_id = ?';
  if (startDate) { where += ' AND logged_on >= ?'; args.push(startDate); }
  if (endDate) { where += ' AND logged_on <= ?'; args.push(endDate); }
  args.push(limit);
  return db.prepare(`
    SELECT id, intake_ml, goal_ml, logged_on
    FROM water_logs
    WHERE ${where}
    ORDER BY logged_on ASC
    LIMIT ?
  `).all(...args).map(formatWaterLog);
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
  id, meal_type, category, meal_name, calories, protein, carbs, fats, fiber, sugar, sodium,
  efficiency_score, advice, notes, goal_alignment_reason, detected_items, portion_sizes,
  image_url, image_metadata, analysis_details, logged_on, created_at
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

function parseAnalysisDetails(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
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
    analysis_details,
    created_at: createdAt,
    logged_on,
    portion_sizes,
    image_url,
    image_metadata,
    ...rest
  } = row;

  return {
    ...rest,
    detectedItems: parseDetectedItems(detected_items),
    portionSizes: parseDetectedItems(portion_sizes),
    imageUrl: image_url || null,
    imageMetadata: parseAnalysisDetails(image_metadata),
    loggedOn: logged_on || null,
    analysisDetails: parseAnalysisDetails(analysis_details),
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
      user_id, meal_type, category, meal_name, calories, protein, carbs, fats, fiber, sugar, sodium,
      efficiency_score, advice, notes, detected_items, portion_sizes, goal_alignment_reason,
      image_base64, image_url, image_metadata, original_input, logged_on, analysis_details
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    mealData.fiber || 0,
    mealData.sugar || 0,
    mealData.sodium || 0,
    mealData.efficiencyScore || 'Medium',
    mealData.advice || '',
    mealData.notes || null,
    JSON.stringify(mealData.detectedItems || []),
    JSON.stringify(mealData.portionSizes || []),
    mealData.goalAlignmentReason || '',
    mealData.imageBase64 || null,
    mealData.imageUrl || null,
    mealData.imageMetadata ? JSON.stringify(mealData.imageMetadata) : null,
    mealData.originalInput || null,
    mealData.loggedOn || null,
    JSON.stringify(mealData.analysisDetails || {})
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
      IFNULL(SUM(fats), 0) as totalFats,
      IFNULL(SUM(fiber), 0) as totalFiber,
      IFNULL(SUM(sugar), 0) as totalSugar,
      IFNULL(SUM(sodium), 0) as totalSodium
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
      IFNULL(SUM(fats), 0) as totalFats,
      IFNULL(SUM(fiber), 0) as totalFiber,
      IFNULL(SUM(sugar), 0) as totalSugar,
      IFNULL(SUM(sodium), 0) as totalSodium
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
      IFNULL(SUM(fats), 0) as totalFats,
      IFNULL(SUM(fiber), 0) as totalFiber,
      IFNULL(SUM(sugar), 0) as totalSugar,
      IFNULL(SUM(sodium), 0) as totalSodium
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
  ['fiber', 'fiber'],
  ['sugar', 'sugar'],
  ['sodium', 'sodium'],
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
// ========== EXERCISE LOGS ==========
export function getExerciseLogs(userId, startDate, endDate) {
  const args = [userId];
  let where = 'user_id = ?';
  if (startDate) { where += ' AND logged_on >= ?'; args.push(startDate); }
  if (endDate) { where += ' AND logged_on <= ?'; args.push(endDate); }
  return db.prepare(`SELECT id, activity, duration_min, calories_burned, logged_on, created_at FROM exercise_logs WHERE ${where} ORDER BY logged_on DESC, id DESC`).all(...args).map((row) => ({
    id: row.id,
    activity: row.activity,
    durationMin: row.duration_min,
    caloriesBurned: row.calories_burned,
    date: row.logged_on,
    createdAt: row.created_at
  }));
}

export function saveExerciseLog(userId, activity, durationMin, caloriesBurned, loggedOn) {
  const info = db.prepare(`
    INSERT INTO exercise_logs (user_id, activity, duration_min, calories_burned, logged_on)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, activity, durationMin || 0, caloriesBurned || 0, loggedOn);
  const row = db.prepare('SELECT id, activity, duration_min, calories_burned, logged_on, created_at FROM exercise_logs WHERE id = ?').get(info.lastInsertRowid);
  return {
    id: row.id,
    activity: row.activity,
    durationMin: row.duration_min,
    caloriesBurned: row.calories_burned,
    date: row.logged_on,
    createdAt: row.created_at
  };
}

export function deleteExerciseLog(id, userId) {
  return db.prepare('DELETE FROM exercise_logs WHERE id = ? AND user_id = ?').run(id, userId);
}

// ========== SLEEP LOGS ==========
export function getSleepLogForDate(userId, date) {
  const row = db.prepare('SELECT id, sleep_hours, sleep_quality, logged_on, created_at FROM sleep_logs WHERE user_id = ? AND logged_on = ?').get(userId, date);
  if (!row) return null;
  return { id: row.id, sleepHours: row.sleep_hours, quality: row.sleep_quality, date: row.logged_on, createdAt: row.created_at };
}

export function getSleepLogs(userId, startDate, endDate) {
  const args = [userId];
  let where = 'user_id = ?';
  if (startDate) { where += ' AND logged_on >= ?'; args.push(startDate); }
  if (endDate) { where += ' AND logged_on <= ?'; args.push(endDate); }
  return db.prepare(`SELECT id, sleep_hours, sleep_quality, logged_on, created_at FROM sleep_logs WHERE ${where} ORDER BY logged_on DESC`).all(...args).map((row) => ({
    id: row.id,
    sleepHours: row.sleep_hours,
    quality: row.sleep_quality,
    date: row.logged_on,
    createdAt: row.created_at
  }));
}

export function saveSleepLog(userId, sleepHours, quality, loggedOn) {
  db.prepare(`
    INSERT INTO sleep_logs (user_id, sleep_hours, sleep_quality, logged_on)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, logged_on) DO UPDATE SET sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality
  `).run(userId, sleepHours, quality || null, loggedOn);
  const row = db.prepare('SELECT id, sleep_hours, sleep_quality, logged_on, created_at FROM sleep_logs WHERE user_id = ? AND logged_on = ?').get(userId, loggedOn);
  return { id: row.id, sleepHours: row.sleep_hours, quality: row.sleep_quality, date: row.logged_on, createdAt: row.created_at };
}

export function deleteSleepLog(id, userId) {
  return db.prepare('DELETE FROM sleep_logs WHERE id = ? AND user_id = ?').run(id, userId);
}
