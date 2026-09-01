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

// Step 2: Handle migrations - add user_id column if it doesn't exist
try {
  const tableInfo = db.prepare("PRAGMA table_info(meal_logs)").all();
  const hasUserIdColumn = tableInfo.some(col => col.name === 'user_id');
  
  if (!hasUserIdColumn) {
    console.log('🔄 Migrating database: Adding user_id column to meal_logs...');
    db.exec(`ALTER TABLE meal_logs ADD COLUMN user_id INTEGER;`);
    console.log('✅ Migration complete: user_id column added');
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
    SELECT id, username, email, created_at FROM users WHERE id = ?
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

// ========== MEAL LOGS ==========

/**
 * Save a new meal log entry
 */
export function saveMealLog(mealData, userId) {
  const stmt = db.prepare(`
    INSERT INTO meal_logs (user_id, meal_type, category, meal_name, calories, protein, carbs, fats, efficiency_score, advice)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    mealData.advice || ''
  );

  return info.lastInsertRowid;
}

/**
 * Get all logs for today with optional pagination
 */
export function getDailyLogs(userId, limit = 50, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM meal_logs 
    WHERE user_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(userId, limit, offset);
}

/**
 * Get logs for specific date range
 */
export function getLogsInDateRange(userId, startDate, endDate, limit = 50, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM meal_logs 
    WHERE user_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(userId, startDate, endDate, limit, offset);
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
 * Get a specific meal log by ID
 */
export function getMealLogById(id, userId) {
  const stmt = db.prepare(`
    SELECT * FROM meal_logs WHERE id = ? AND user_id = ?
  `);
  return stmt.get(id, userId);
}

/**
 * Update a meal log
 */
export function updateMealLog(id, userId, mealData) {
  const stmt = db.prepare(`
    UPDATE meal_logs 
    SET meal_type = ?, category = ?, meal_name = ?, calories = ?, protein = ?, carbs = ?, fats = ?, efficiency_score = ?, advice = ?
    WHERE id = ? AND user_id = ?
  `);
  
  return stmt.run(
    mealData.mealType || 'Snack',
    mealData.category || 'Maintenance',
    mealData.mealName || 'Logged Meal',
    mealData.calories || 0,
    mealData.protein || 0,
    mealData.carbs || 0,
    mealData.fats || 0,
    mealData.efficiencyScore || 'Medium',
    mealData.advice || '',
    id,
    userId
  );
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