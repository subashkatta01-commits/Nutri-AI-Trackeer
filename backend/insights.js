/**
 * Insights & Progress Analytics
 *
 * Every figure the Insights screen shows is derived here, from a single
 * per-meal read of the requested date range (see getMealActivity). Deriving the
 * charts and the headline numbers from one dataset is deliberate: the weekly
 * average, the consistency score and the streak counters can never end up
 * describing different sets of meals.
 *
 * All figures are computed here rather than in SQL so the rules stay in one
 * readable place. The range is bounded by the endpoint (max 90 days), which
 * keeps the in-memory work small.
 */

import {
  getMealActivity,
  getWeightLogs,
  getNutritionGoals,
  getUserProfile
} from './db.js';
import { calculateTargets } from './nutritionCalculator.js';

const MACROS = [
  { key: 'protein', label: 'Protein', goalKey: 'protein' },
  { key: 'carbs', label: 'Carbs', goalKey: 'carbs' },
  { key: 'fats', label: 'Fats', goalKey: 'fats' }
];

// A day only counts as hitting the calorie target when intake lands inside this
// band around the target - landing exactly on it by accident is unlikely.
const CALORIE_TOLERANCE = 0.1;

// Eating logged at/after LATE_NIGHT_FROM_HOUR, or before LATE_NIGHT_TO_HOUR, is
// counted as late-night eating.
const LATE_NIGHT_FROM_HOUR = 21;
const LATE_NIGHT_TO_HOUR = 5;

const MEAL_TYPE_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

// Used for the "how many distinct meals" line and to cap the weight chart.
const TOP_MEAL_COUNT = 6;
const WEIGHT_HISTORY_LIMIT = 400;
const WEIGHT_CHART_LIMIT = 180;
const WEIGHT_MOVING_AVERAGE_DAYS = 7;

// Weekly averages are always reported over the trailing 7 days, whatever the
// selected range is.
const WEEKLY_WINDOW_DAYS = 7;

// Weights inside this band (kg/week) count as steady rather than trending.
const STEADY_TREND_THRESHOLD = 0.05;
const STEADY_MAINTENANCE_THRESHOLD = 0.25;

// ========== SMALL NUMERIC HELPERS ==========

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const mean = (values) => (
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
);

const stdDev = (values) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const percentOf = (value, total) => (total > 0 ? (value / total) * 100 : 0);

const roundPercent = (value) => round(clamp(value, 0, 100), 1);

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Midnight-local parse of a YYYY-MM-DD string. */
function parseLocalDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function daysBetween(startDate, endDate) {
  const MS_PER_DAY = 86400000;
  return Math.round((parseLocalDate(endDate) - parseLocalDate(startDate)) / MS_PER_DAY);
}

/** Every calendar date from startDate to endDate inclusive, gaps included. */
function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (cursor <= end) {
    dates.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

/** Monday of the week containing the given YYYY-MM-DD date. */
function weekStartOf(dateString) {
  const date = parseLocalDate(dateString);
  const offsetFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offsetFromMonday);
  return toLocalDateString(date);
}

const formatClock = (minutes) => {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return null;
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/**
 * Average clock time and spread for a set of minutes-past-midnight.
 *
 * A plain average of 23:50 and 00:10 would report 12:00, so this averages on
 * the unit circle instead. For a normal meal type it reduces to the arithmetic
 * mean, and for anything crossing midnight it stays correct.
 */
function clockStats(minutesList) {
  if (minutesList.length === 0) return { average: null, spread: 0 };

  const FULL_TURN = Math.PI * 2;
  const toAngle = (minutes) => (minutes / 1440) * FULL_TURN;

  const sin = mean(minutesList.map((minutes) => Math.sin(toAngle(minutes))));
  const cos = mean(minutesList.map((minutes) => Math.cos(toAngle(minutes))));
  const average = ((Math.atan2(sin, cos) / FULL_TURN) * 1440 + 1440) % 1440;

  // Shortest distance from each entry to the average, so a 23:50 next to a
  // 00:10 mean of 00:00 is 10 minutes away, not 23 hours.
  const deviations = minutesList.map((minutes) => {
    const direct = Math.abs(minutes - average);
    return direct > 720 ? 1440 - direct : direct;
  });

  return { average, spread: stdDev(deviations) };
}

function regularityLabel(spreadMinutes) {
  if (spreadMinutes <= 45) return 'Consistent';
  if (spreadMinutes <= 90) return 'Somewhat variable';
  return 'Irregular';
}

const isLateNight = (hour) => hour >= LATE_NIGHT_FROM_HOUR || hour < LATE_NIGHT_TO_HOUR;

// ========== DAILY TOTALS ==========

function emptyDay(date) {
  return { date, mealCount: 0, calories: 0, protein: 0, carbs: 0, fats: 0 };
}

/**
 * Collapse the per-meal rows into one entry per calendar day, including days
 * with no meals (zeroed) so the charts and the streak maths share one timeline.
 */
function buildDailySeries(meals, startDate, endDate) {
  const byDate = new Map();

  for (const meal of meals) {
    if (!byDate.has(meal.log_date)) {
      byDate.set(meal.log_date, emptyDay(meal.log_date));
    }

    const day = byDate.get(meal.log_date);
    day.mealCount += 1;
    day.calories += meal.calories || 0;
    day.protein += meal.protein || 0;
    day.carbs += meal.carbs || 0;
    day.fats += meal.fats || 0;
  }

  return enumerateDates(startDate, endDate).map((date) => byDate.get(date) || emptyDay(date));
}

// ========== SHARED DAILY METRICS ==========

/** Fraction of a target met, capped at 1 - eating more is not more "complete". */
function fulfillment(value, target) {
  if (!Number.isFinite(target) || target <= 0) return null;
  return clamp((value || 0) / target, 0, 1);
}

function isOnTargetCalories(day, targets) {
  if (day.mealCount === 0 || targets.calories <= 0) return false;
  return Math.abs(day.calories - targets.calories) / targets.calories <= CALORIE_TOLERANCE;
}

/** A day's progress toward all four targets, averaged and capped at 100%. */
function dayCompletionPercent(day, targets) {
  if (day.mealCount === 0) return 0;

  const ratios = [
    fulfillment(day.calories, targets.calories),
    ...MACROS.map((macro) => fulfillment(day[macro.key], targets[macro.goalKey]))
  ].filter((ratio) => ratio !== null);

  return ratios.length > 0 ? mean(ratios) * 100 : 0;
}

// ========== 1. WEEKLY CALORIE AVERAGE ==========

/**
 * Average daily calories over the trailing 7 days, measured only on days the
 * user actually logged - an untracked day is missing data, not a zero-calorie
 * day, and averaging it in would understate intake.
 */
function buildWeeklyCalories(daily, targets) {
  const window = daily.slice(-WEEKLY_WINDOW_DAYS);
  const loggedDays = window.filter((day) => day.mealCount > 0);
  const averageCalories = loggedDays.length > 0
    ? Math.round(mean(loggedDays.map((day) => day.calories)))
    : 0;
  const onTargetDays = loggedDays.filter((day) => isOnTargetCalories(day, targets)).length;

  const status = loggedDays.length === 0 || targets.calories <= 0
    ? 'no-data'
    : isOnTargetCalories({ calories: averageCalories, mealCount: 1 }, targets) ? 'on-target'
    : averageCalories < targets.calories ? 'under' : 'over';

  return {
    windowDays: window.length,
    loggedDays: loggedDays.length,
    averageCalories,
    totalCalories: loggedDays.reduce((sum, day) => sum + day.calories, 0),
    target: targets.calories,
    deltaCalories: averageCalories - targets.calories,
    deltaPct: targets.calories > 0
      ? round(((averageCalories - targets.calories) / targets.calories) * 100, 1)
      : 0,
    onTargetDays,
    onTargetPct: roundPercent(percentOf(onTargetDays, loggedDays.length)),
    status,
    days: window.map((day) => ({
      date: day.date,
      calories: day.calories,
      mealCount: day.mealCount,
      onTarget: isOnTargetCalories(day, targets)
    }))
  };
}

// ========== 2. MACRO CONSISTENCY SCORE ==========

const consistencyGrade = (score) => {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'On track';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Needs work';
  return 'Off track';
};

/**
 * How close each logged day landed to its macro target, scored 100 - deviation.
 *
 * Averaging the absolute deviation keeps the score a measure of accuracy rather
 * than luck: a day that overshoots protein by 40g scores the same as one that
 * undershoots by 40g, which is the behaviour this score is trying to encourage.
 */
function buildMacroConsistency(daily, targets) {
  const loggedDays = daily.filter((day) => day.mealCount > 0);

  const macros = MACROS.map(({ key, label, goalKey }) => {
    const target = targets[goalKey];
    const values = loggedDays.map((day) => day[key]);

    if (loggedDays.length === 0 || target <= 0) {
      return { key, label, target, average: 0, deviationPct: 0, dayToDayPct: 0, score: 0 };
    }

    const deviationPct = mean(loggedDays.map((day) => Math.abs(day[key] - target) / target)) * 100;
    const dayToDayPct = percentOf(stdDev(values), target);

    return {
      key,
      label,
      target: round(target),
      average: round(mean(values)),
      deviationPct: round(deviationPct, 1),
      // How much each macro swings day to day, as a share of the target.
      dayToDayPct: round(dayToDayPct, 1),
      score: Math.round(clamp(100 - deviationPct, 0, 100))
    };
  });

  const scored = macros.filter((macro) => macro.target > 0 && loggedDays.length > 0);
  const score = scored.length > 0
    ? Math.round(mean(scored.map((macro) => macro.score)))
    : 0;

  return {
    score,
    grade: loggedDays.length === 0 ? 'No data' : consistencyGrade(score),
    daysAnalysed: loggedDays.length,
    macros
  };
}

// ========== 3. GOAL COMPLETION ==========

/**
 * Average share of the four daily targets actually hit, over the range.
 * Overshooting a target does not add credit, so every metric caps at 100%.
 */
function buildGoalCompletion(daily, targets) {
  const loggedDays = daily.filter((day) => day.mealCount > 0);
  const onTargetDays = loggedDays.filter((day) => isOnTargetCalories(day, targets)).length;
  const proteinTargetDays = loggedDays.filter(
    (day) => (fulfillment(day.protein, targets.protein) ?? 0) >= 0.999
  ).length;

  const perMetric = [
    { key: 'calories', label: 'Calories', target: targets.calories, valueOf: (day) => day.calories },
    ...MACROS.map((macro) => ({
      key: macro.key,
      label: macro.label,
      target: targets[macro.goalKey],
      valueOf: (day) => day[macro.key]
    }))
  ].map((metric) => {
    const ratio = loggedDays.length > 0
      ? mean(loggedDays.map((day) => fulfillment(metric.valueOf(day), metric.target) ?? 0))
      : 0;

    return {
      key: metric.key,
      label: metric.label,
      target: round(metric.target),
      average: loggedDays.length > 0
        ? round(mean(loggedDays.map((day) => metric.valueOf(day))))
        : 0,
      percentage: roundPercent(ratio * 100)
    };
  });

  return {
    percentage: loggedDays.length > 0
      ? roundPercent(mean(loggedDays.map((day) => dayCompletionPercent(day, targets))))
      : 0,
    loggedDays: loggedDays.length,
    onTargetDays,
    onTargetPct: roundPercent(percentOf(onTargetDays, loggedDays.length)),
    proteinTargetDays,
    proteinTargetPct: roundPercent(percentOf(proteinTargetDays, loggedDays.length)),
    perMetric,
    days: daily.map((day) => ({
      date: day.date,
      percentage: roundPercent(dayCompletionPercent(day, targets)),
      onTarget: isOnTargetCalories(day, targets),
      mealCount: day.mealCount
    }))
  };
}

// ========== 4. STREAKS ==========

/**
 * Count back from the end of the range.
 *
 * A single leading day with no meals (today, before the first log of the day)
 * is tolerated, so the streak does not read as broken from midnight until the
 * user actually eats.
 */
function trailingStreak(daily, predicate) {
  let streak = 0;

  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (predicate(daily[i])) {
      streak += 1;
      continue;
    }
    if (i === daily.length - 1 && daily[i].mealCount === 0) continue;
    break;
  }

  return streak;
}

function longestStreak(daily, predicate) {
  let best = 0;
  let current = 0;

  for (const day of daily) {
    if (predicate(day)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return best;
}

function buildWeeklyBreakdown(daily, targets) {
  const weeks = new Map();

  for (const day of daily) {
    const key = weekStartOf(day.date);
    if (!weeks.has(key)) {
      weeks.set(key, {
        weekStart: key,
        loggedDays: 0,
        onTargetDays: 0,
        calories: 0,
        completionTotal: 0
      });
    }

    const week = weeks.get(key);
    week.loggedDays += 1;
    week.calories += day.calories;
    week.completionTotal += dayCompletionPercent(day, targets);
    if (isOnTargetCalories(day, targets)) week.onTargetDays += 1;
  }

  return Array.from(weeks.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week) => ({
      weekStart: week.weekStart,
      loggedDays: week.loggedDays,
      onTargetDays: week.onTargetDays,
      averageCalories: week.loggedDays > 0 ? Math.round(week.calories / week.loggedDays) : 0,
      completionPct: week.loggedDays > 0 ? roundPercent(week.completionTotal / week.loggedDays) : 0,
      onTarget: week.onTargetDays > 0
    }));
}

function buildStreaks(daily, targets) {
  const hasLogged = (day) => day.mealCount > 0;
  const hitGoal = (day) => isOnTargetCalories(day, targets);

  const weeks = buildWeeklyBreakdown(daily, targets);

  // A week counts towards the streak as soon as it contains one on-target day.
  let weekStreak = 0;
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    if (weeks[i].onTarget) {
      weekStreak += 1;
      continue;
    }
    // The current week is still in progress, so it does not break the streak.
    if (i === weeks.length - 1) continue;
    break;
  }

  return {
    currentLogStreak: trailingStreak(daily, hasLogged),
    longestLogStreak: longestStreak(daily, hasLogged),
    currentGoalStreak: trailingStreak(daily, hitGoal),
    longestGoalStreak: longestStreak(daily, hitGoal),
    loggedDays: daily.filter(hasLogged).length,
    weekStreak,
    weeksOnTarget: weeks.filter((week) => week.onTarget).length,
    weeks
  };
}

// ========== 5. MOST COMMON MEALS ==========

/**
 * Most-logged meals in the range.
 *
 * Grouping is case- and whitespace-insensitive so "Chicken Bowl" and
 * "chicken bowl " are one meal, and each group keeps the spelling from its most
 * recent log (rows arrive oldest first, so the last write wins).
 */
function buildMostCommonMeals(meals) {
  const byMeal = new Map();

  for (const meal of meals) {
    const key = meal.name_key || String(meal.meal_name || '').trim().toLowerCase();
    if (!key) continue;

    const entry = byMeal.get(key) || {
      name: meal.meal_name,
      times: 0,
      calories: 0,
      lastLogged: meal.log_date,
      types: new Map()
    };

    entry.name = meal.meal_name;
    entry.times += 1;
    entry.calories += meal.calories || 0;
    entry.lastLogged = meal.log_date;
    entry.types.set(meal.meal_type, (entry.types.get(meal.meal_type) || 0) + 1);

    byMeal.set(key, entry);
  }

  const items = Array.from(byMeal.values())
    .sort((a, b) => b.times - a.times || b.lastLogged.localeCompare(a.lastLogged))
    .slice(0, TOP_MEAL_COUNT)
    .map((entry) => ({
      name: entry.name,
      times: entry.times,
      sharePct: roundPercent(percentOf(entry.times, meals.length)),
      averageCalories: Math.round(entry.calories / entry.times),
      lastLogged: entry.lastLogged,
      topType: Array.from(entry.types.entries())
        .sort((a, b) => b[1] - a[1])[0][0]
    }));

  return {
    totalMeals: meals.length,
    uniqueMeals: byMeal.size,
    items
  };
}

// ========== 6. MEAL TIMING ANALYSIS ==========

/**
 * When the user eats: average clock time and regularity per meal type, the
 * typical eating window, and how much eating happens late at night.
 */
function buildMealTiming(meals) {
  const byType = new Map(MEAL_TYPE_ORDER.map((type) => [type, []]));
  const byDate = new Map();

  let lateNightMeals = 0;
  let lateNightCalories = 0;
  let totalCalories = 0;

  for (const meal of meals) {
    const minutes = (meal.log_hour || 0) * 60 + (meal.log_minute || 0);
    const type = MEAL_TYPE_ORDER.includes(meal.meal_type) ? meal.meal_type : 'Other';

    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ minutes, calories: meal.calories || 0 });

    if (!byDate.has(meal.log_date)) {
      byDate.set(meal.log_date, { earliest: minutes, latest: minutes });
    } else {
      const day = byDate.get(meal.log_date);
      day.earliest = Math.min(day.earliest, minutes);
      day.latest = Math.max(day.latest, minutes);
    }

    totalCalories += meal.calories || 0;
    if (isLateNight(meal.log_hour || 0)) {
      lateNightMeals += 1;
      lateNightCalories += meal.calories || 0;
    }
  }

  const typeStats = Array.from(byType.entries())
    .filter(([, entries]) => entries.length > 0)
    .map(([type, entries]) => {
      const minutes = entries.map((entry) => entry.minutes);
      const { average, spread } = clockStats(minutes);

      return {
        type,
        count: entries.length,
        averageTime: formatClock(average),
        spreadMinutes: Math.round(spread),
        regularity: regularityLabel(spread),
        averageCalories: Math.round(mean(entries.map((entry) => entry.calories))),
        earliest: formatClock(Math.min(...minutes)),
        latest: formatClock(Math.max(...minutes))
      };
    })
    .sort((a, b) => {
      const aIndex = MEAL_TYPE_ORDER.indexOf(a.type);
      const bIndex = MEAL_TYPE_ORDER.indexOf(b.type);
      return (aIndex === -1 ? MEAL_TYPE_ORDER.length : aIndex) - (bIndex === -1 ? MEAL_TYPE_ORDER.length : bIndex);
    });

  const days = Array.from(byDate.values());
  const firstMeals = days.map((day) => day.earliest);
  const lastMeals = days.map((day) => day.latest);
  const windowHours = days
    .map((day) => {
      const span = day.latest - day.earliest;
      return span < 0 ? span + 1440 : span;
    })
    .filter((minutes) => minutes > 0);

  return {
    mealsAnalysed: meals.length,
    daysCovered: byDate.size,
    mealsPerDay: byDate.size > 0 ? round(meals.length / byDate.size, 1) : 0,
    averageFirstMeal: formatClock(clockStats(firstMeals).average),
    averageLastMeal: formatClock(clockStats(lastMeals).average),
    eatingWindowHours: windowHours.length > 0 ? round(mean(windowHours) / 60, 1) : null,
    lateNight: {
      meals: lateNightMeals,
      mealsPct: roundPercent(percentOf(lateNightMeals, meals.length)),
      caloriesPct: roundPercent(percentOf(lateNightCalories, totalCalories))
    },
    byType: typeStats
  };
}

// ========== 7. WEIGHT PROGRESS ==========

function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    return round(mean(values.slice(start, index + 1)), 2);
  });
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Healthy';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

/**
 * Weight trend over the whole stored history (independent of the selected
 * insight range, since weight moves slowly and a 7-day window is noise).
 */
function buildWeightProgress(weightLogs, profile) {
  const points = weightLogs
    .map((log) => ({ date: log.loggedOn, weight: log.weightKg }))
    .reverse()
    .slice(-WEIGHT_CHART_LIMIT);

  if (points.length === 0) {
    return {
      hasEntries: false,
      entries: 0,
      points: [],
      goal: profile?.goal || null,
      // Lets the form start from the weight already on the profile instead of
      // an empty box for users who have never checked in.
      profileWeight: profile?.weight_kg ?? null,
      suggestedTargets: null,
      targetsOutdated: false
    };
  }

  const first = points[0];
  const latest = points[points.length - 1];
  const changeKg = round(latest.weight - first.weight, 1);
  const spanDays = Math.max(daysBetween(first.date, latest.date), 1);
  const weeklyRate = points.length > 1
    ? round((changeKg / spanDays) * 7, 2)
    : null;

  const trend = changeKg === 0 ? 'steady'
    : weeklyRate !== null && Math.abs(weeklyRate) < STEADY_TREND_THRESHOLD ? 'steady'
    : changeKg < 0 ? 'down' : 'up';

  // Whether the change so far moves in the direction the user picked at onboarding.
  const goal = profile?.goal || null;
  const onTrack = goal === 'lose' ? changeKg < 0
    : goal === 'gain' ? changeKg > 0
    : goal === 'maintain' ? Math.abs(weeklyRate ?? 0) <= STEADY_MAINTENANCE_THRESHOLD
    : null;

  const heightM = profile?.height_cm ? profile.height_cm / 100 : null;
  const bmi = heightM ? round(latest.weight / heightM ** 2, 1) : null;

  const smoothed = movingAverage(points.map((point) => point.weight), WEIGHT_MOVING_AVERAGE_DAYS);

  // Targets are calculated from the profile weight, so once the user has
  // logged a different weight the suggestion is worth surfacing - applying it
  // stays a deliberate, user-initiated action.
  const canSuggest = Boolean(
    profile?.age && profile?.gender && profile?.height_cm && profile?.activity_level && profile?.goal
  );
  const suggested = canSuggest
    ? calculateTargets({
      gender: profile.gender,
      weightKg: latest.weight,
      heightCm: profile.height_cm,
      age: profile.age,
      activityLevel: profile.activity_level,
      goal: profile.goal
    })
    : null;

  return {
    hasEntries: true,
    entries: points.length,
    latestWeight: latest.weight,
    latestDate: latest.date,
    firstWeight: first.weight,
    firstDate: first.date,
    changeKg,
    changePct: first.weight > 0 ? round((changeKg / first.weight) * 100, 1) : 0,
    weeklyRate,
    trend,
    onTrack,
    goal,
    highestWeight: round(Math.max(...points.map((point) => point.weight)), 1),
    lowestWeight: round(Math.min(...points.map((point) => point.weight)), 1),
    bmi,
    bmiCategory: bmi === null ? null : bmiCategory(bmi),
    points: points.map((point, index) => ({ ...point, average: smoothed[index] })),
    suggestedTargets: suggested
      ? {
        dailyCalorieTarget: suggested.dailyCalorieTarget,
        dailyProteinTarget: suggested.dailyProteinTarget,
        dailyCarbsTarget: suggested.dailyCarbsTarget,
        dailyFatsTarget: suggested.dailyFatsTarget
      }
      : null
  };
}

// ========== PUBLIC API ==========

/**
 * Build the full Insights payload for a user over an inclusive date range.
 */
export function getInsights(userId, { startDate, endDate }) {
  const goalsRow = getNutritionGoals(userId);

  const targets = {
    calories: goalsRow?.daily_calorie_target || 0,
    protein: goalsRow?.daily_protein_target || 0,
    carbs: goalsRow?.daily_carbs_target || 0,
    fats: goalsRow?.daily_fats_target || 0
  };

  const profile = getUserProfile(userId);
  const meals = getMealActivity(userId, startDate, endDate);
  const daily = buildDailySeries(meals, startDate, endDate);

  const weight = buildWeightProgress(getWeightLogs(userId, WEIGHT_HISTORY_LIMIT), profile);

  // The saved targets still reflect the weight from onboarding, so flag it when
  // logging a new weight has moved them off.
  weight.targetsOutdated = Boolean(
    weight.suggestedTargets && (
      weight.suggestedTargets.dailyCalorieTarget !== targets.calories ||
      weight.suggestedTargets.dailyProteinTarget !== targets.protein ||
      weight.suggestedTargets.dailyCarbsTarget !== targets.carbs ||
      weight.suggestedTargets.dailyFatsTarget !== targets.fats
    )
  );

  return {
    range: {
      startDate,
      endDate,
      days: daily.length,
      loggedDays: daily.filter((day) => day.mealCount > 0).length,
      mealsAnalysed: meals.length
    },
    targets,
    weeklyCalories: buildWeeklyCalories(daily, targets),
    macroConsistency: buildMacroConsistency(daily, targets),
    goalCompletion: buildGoalCompletion(daily, targets),
    streaks: buildStreaks(daily, targets),
    mostCommonMeals: buildMostCommonMeals(meals),
    mealTiming: buildMealTiming(meals),
    weight
  };
}
