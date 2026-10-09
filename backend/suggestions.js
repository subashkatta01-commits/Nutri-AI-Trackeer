/**
 * Meal Suggestions
 *
 * Turns the user's goals and recent eating into a short, prioritised list of
 * concrete next actions. This is deliberately deterministic rather than an AI
 * call: the signals it reads (macro gaps, meal-type efficiency, repetition) are
 * all already stored, and deriving them locally means the panel is instant,
 * costs nothing, and always agrees with the numbers on the dashboard.
 *
 * Suggestions are ranked by urgency - a macro the user has not touched in days
 * outranks a meal they ate once - so the top of the list is the thing most
 * worth acting on.
 */

import {
  getDailyMacroTotals,
  getMealTypePerformance,
  getFrequentMeals,
  getNutritionGoals,
  getUserProfile,
  getWeightLogs
} from './db.js';

// A macro is only "short" by an amount worth acting on. Suggesting a 3g carb
// top-up reads as noise.
const IGNORABLE_MACRO_GAP_GRAMS = 5;

// Meal types scored "Low" this many times before they are called out.
const LOW_SCORE_THRESHOLD = 2;

// Repeating the same meal this many times in the window is worth rotating.
const REPETITION_THRESHOLD = 4;

// Calories outside this band of the target count as meaningfully off.
const CALORIE_TOLERANCE = 0.1;

// Below this many logged days the data is too thin to draw conclusions from.
const MIN_DAYS_FOR_PATTERN_SUGGESTIONS = 3;

const MACROS = [
  { key: 'protein', label: 'Protein', goalKey: 'daily_protein_target', unit: 'g' },
  { key: 'carbs', label: 'Carbs', goalKey: 'daily_carbs_target', unit: 'g' },
  { key: 'fats', label: 'Fats', goalKey: 'daily_fats_target', unit: 'g' }
];

/** Concrete, macro-aware fixes for a protein shortfall. */
const PROTEIN_SOURCES = {
  breakfast: 'Greek yogurt, eggs or a protein shake',
  lunch: 'Grilled chicken, tuna or tofu with a legume side',
  dinner: 'Salmon, lean beef or paneer with lentils',
  snack: 'Cottage cheese, edamame or a handful of almonds'
};

const CARB_SOURCES = {
  breakfast: 'whole-grain toast, oats or a banana',
  lunch: 'brown rice, sweet potato or quinoa',
  dinner: 'roasted vegetables, beans or a whole-wheat wrap',
  snack: 'fruit, a handful of oats or a rice cake'
};

const FAT_SOURCES = {
  breakfast: 'avocado, nuts or a drizzle of olive oil',
  lunch: 'a drizzle of olive oil or a spoon of nuts',
  dinner: 'olive oil, avocado or a handful of seeds',
  snack: 'nuts, seeds or a small portion of dark chocolate'
};

// ============================================================
// HELPERS
// ============================================================

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

/** Every calendar date from startDate to endDate inclusive. */
function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (cursor <= end) {
    dates.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

/**
 * Average intake per *logged* day.
 *
 * Only days with calories count: averaging in an untracked day would understate
 * intake and make every macro look like a shortfall.
 */
function averagePerLoggedDay(dailyRows, key) {
  const logged = dailyRows.filter((row) => row.totalCalories > 0);
  if (logged.length === 0) return 0;
  return logged.reduce((sum, row) => sum + (row[key] || 0), 0) / logged.length;
}

// ============================================================
// SUGGESTION BUILDERS
// ============================================================

function buildMacroSuggestions(dailyRows, targets, days) {
  const suggestions = [];

  for (const macro of MACROS) {
    const target = targets[macro.goalKey];
    if (!Number.isFinite(target) || target <= 0) continue;

    const average = averagePerLoggedDay(dailyRows, `total${macro.key.charAt(0).toUpperCase()}${macro.key.slice(1)}`);
    const gap = target - average;

    // Over is as actionable as under for the macros a goal cares about.
    if (Math.abs(gap) <= IGNORABLE_MACRO_GAP_GRAMS) continue;

    const direction = gap > 0 ? 'short' : 'over';
    const magnitude = round(Math.abs(gap));

    if (direction === 'short') {
      suggestions.push({
        id: `macro-${macro.key}-short`,
        priority: 1,
        kind: 'macro-gap',
        icon: 'fa-dumbbell',
        tone: macro.key,
        title: `${macro.label} is ${magnitude}${macro.unit} short on a typical day`,
        detail:
          `You average ${round(average)}${macro.unit} against a ${round(target)}${macro.unit} target over ` +
          `${days} days. Add a ${macro.key}-forward option - try ${PROTEIN_SOURCES.dinner}.`,
        metric: { label: macro.label, average: round(average), target: round(target), gap: -magnitude }
      });
    } else {
      suggestions.push({
        id: `macro-${macro.key}-over`,
        priority: 2,
        kind: 'macro-gap',
        icon: 'fa-arrow-trend-down',
        tone: macro.key,
        title: `${macro.label} runs ${magnitude}${macro.unit} over target`,
        detail:
          `You average ${round(average)}${macro.unit} against a ${round(target)}${macro.unit} target over ` +
          `${days} days. Ease off by shifting one portion to a lower-${macro.key} option.`,
        metric: { label: macro.label, average: round(average), target: round(target), gap: magnitude }
      });
    }
  }

  return suggestions;
}

function buildCalorieSuggestion(dailyRows, targets) {
  const target = targets.daily_calorie_target;
  if (!Number.isFinite(target) || target <= 0 || dailyRows.length === 0) return null;

  const logged = dailyRows.filter((row) => row.totalCalories > 0);
  if (logged.length === 0) return null;

  const average = logged.reduce((sum, row) => sum + row.totalCalories, 0) / logged.length;
  const delta = average - target;

  if (Math.abs(delta) / target <= CALORIE_TOLERANCE) return null;

  const over = delta > 0;

  return {
    id: 'calories-drift',
    priority: over ? 1 : 2,
    kind: 'calorie-gap',
    icon: over ? 'fa-fire-flame-curved' : 'fa-battery-half',
    tone: 'calories',
    title: over
      ? `You average ${Math.round(average).toLocaleString()} kcal - ${Math.round(delta).toLocaleString()} over target`
      : `You average ${Math.round(average).toLocaleString()} kcal - ${Math.round(-delta).toLocaleString()} under target`,
    detail: over
      ? 'Trimming a portion or swapping one fried side for vegetables closes this gap without dropping protein.'
      : 'You are logging below your target on most days. Add one extra protein-led snack to close it.',
    metric: { label: 'Calories', average: round(average), target: round(target), gap: round(delta) }
  };
}

function buildRepetitionSuggestion(frequentMeals, days) {
  const repeat = frequentMeals.find((meal) => meal.timesLogged >= REPETITION_THRESHOLD);

  if (!repeat) return null;

  return {
    id: 'meal-repetition',
    priority: 3,
    kind: 'repetition',
    icon: 'fa-rotate',
    tone: 'carbs',
    title: `"${repeat.mealName}" appears in ${repeat.timesLogged} of the last ${days} days`,
    detail:
      `It averages ${repeat.averageCalories} kcal and ${repeat.averageProtein}g protein. Rotating in one ` +
      'different meal would widen the nutrient range without dropping the calories you are used to.',
    metric: { label: 'Most repeated', average: repeat.timesLogged, target: REPETITION_THRESHOLD, gap: repeat.timesLogged }
  };
}

function buildMealTypeSuggestions(mealTypes) {
  return mealTypes
    // Only flag a type the user logs regularly - one off meal is not a pattern.
    .filter((entry) => entry.timesLogged >= LOW_SCORE_THRESHOLD && entry.lowScores >= entry.timesLogged / 2)
    .slice(0, 2)
    .map((entry) => ({
      id: `meal-type-${entry.mealType.toLowerCase()}`,
      priority: 2,
      kind: 'meal-type',
      icon: 'fa-triangle-exclamation',
      tone: 'fats',
      title: `${entry.mealType} scores "Low" on goal alignment ${entry.lowScores} of ${entry.timesLogged} times`,
      detail:
        `That meal type averages ${Math.round(entry.totalCalories / entry.timesLogged)} kcal. Rebuild it with ` +
        'a leaner protein source and more vegetables, or swap the timing.',
      metric: { label: entry.mealType, average: entry.lowScores, target: entry.timesLogged, gap: entry.lowScores }
    }));
}

/**
 * A prompt for the user to run through the AI analyser, built from the largest
 * remaining macro gap. Uses the existing analyze endpoint rather than a second
 * AI path, so the user confirms the log themselves.
 */
function buildNextMealPrompt(targets, macros) {
  const weakest = macros
    .map((macro) => ({ macro, gap: (targets[macro.goalKey] || 0) - macro.average }))
    .filter((entry) => Number.isFinite(entry.gap) && entry.gap > IGNORABLE_MACRO_GAP_GRAMS)
    .sort((a, b) => b.gap - a.gap)[0];

  if (!weakest) return null;

  const { macro } = weakest;
  const sources = macro.key === 'protein' ? PROTEIN_SOURCES : CARB_SOURCES;

  return {
    id: 'next-meal-prompt',
    priority: 4,
    kind: 'next-meal',
    icon: 'fa-wand-magic-sparkles',
    tone: 'protein',
    title: `Aim for ${weakest.macro.label.toLowerCase()} on your next meal`,
    detail:
      `That is the biggest remaining gap today. A good pick: ${sources.lunch}. Log it and the dashboard ` +
      'updates against your targets.',
    metric: null
  };
}

function buildPhotoSuggestion(weightLogs, profile) {
  const points = weightLogs.slice(0, 30);
  if (points.length < 2) return null;

  const latest = points[0];
  const earliest = points[points.length - 1];

  // Only celebrate a change once there is enough elapsed time for it to be
  // real rather than day-to-day noise.
  const spanDays = Math.max(
    Math.round((new Date(`${latest.loggedOn}T00:00:00`) - new Date(`${earliest.loggedOn}T00:00:00`)) / 86400000),
    1
  );
  if (spanDays < 14) return null;

  const change = round(latest.weightKg - earliest.weightKg, 1);
  if (change === 0) return null;

  const goal = profile?.goal;
  const onTrack = goal === 'lose' ? change < 0
    : goal === 'gain' ? change > 0
    : goal === 'maintain' ? Math.abs(change) <= 1.5
    : null;

  return {
    id: 'progress-checkin',
    priority: 5,
    kind: 'check-in',
    icon: 'fa-camera',
    tone: onTrack === false ? 'fats' : 'success',
    title: `Add a progress photo to make ${Math.abs(change)}kg visible`,
    detail:
      `Your weight has moved ${change > 0 ? '+' : ''}${change} kg since ${earliest.loggedOn}. A photo from today ` +
      'gives you a baseline worth comparing against in a month.',
    metric: { label: 'Weight change', average: change, target: 0, gap: change }
  };
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build the ranked suggestion list for a user over a trailing window.
 *
 * `days` is clamped by the endpoint. Every figure comes from stored meals and
 * the saved targets, so the output can never contradict the dashboard.
 */
export function getSuggestions(userId, { days = 7 } = {}) {
  const goalsRow = getNutritionGoals(userId);
  const profile = getUserProfile(userId);

  const targets = {
    daily_calorie_target: goalsRow?.daily_calorie_target || 0,
    daily_protein_target: goalsRow?.daily_protein_target || 0,
    daily_carbs_target: goalsRow?.daily_carbs_target || 0,
    daily_fats_target: goalsRow?.daily_fats_target || 0
  };

  const endDate = toLocalDateString(new Date());
  const startDate = shiftDays(endDate, -(days - 1));

  const dailyRows = getDailyMacroTotals(userId, startDate, endDate);
  const mealTypes = getMealTypePerformance(userId, startDate, endDate);
  const frequentMeals = getFrequentMeals(userId, startDate, endDate);
  const weightLogs = getWeightLogs(userId, 60);

  const loggedDays = dailyRows.filter((row) => row.totalCalories > 0).length;

  const macroAverages = MACROS.map((macro) => ({
    key: macro.key,
    label: macro.label,
    goalKey: macro.goalKey,
    average: round(averagePerLoggedDay(dailyRows, `total${macro.key.charAt(0).toUpperCase()}${macro.key.slice(1)}`)),
    target: round(targets[macro.goalKey] || 0)
  }));

  const items = [
    buildCalorieSuggestion(dailyRows, targets),
    ...buildMacroSuggestions(dailyRows, targets, days),
    ...(loggedDays >= MIN_DAYS_FOR_PATTERN_SUGGESTIONS
      ? [
        buildRepetitionSuggestion(frequentMeals, days),
        ...buildMealTypeSuggestions(mealTypes)
      ]
      : []),
    buildNextMealPrompt(targets, macroAverages),
    buildPhotoSuggestion(weightLogs, profile)
  ].filter(Boolean);

  // Priority first, then the largest absolute macro gap, so the list reads as
  // a to-do list rather than an unordered set of observations.
  items.sort((a, b) => a.priority - b.priority || Math.abs(b.metric?.gap ?? 0) - Math.abs(a.metric?.gap ?? 0));

  return {
    range: { startDate, endDate, days, loggedDays },
    targets,
    macroAverages,
    suggestions: items
  };
}