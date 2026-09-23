/**
 * Nutrition & Macro Calculator
 * Calculates personalized calorie and macro targets from a user profile
 * using the Mifflin-St Jeor equation for BMR.
 */

export const ACTIVITY_LEVELS = {
  sedentary: { label: 'Sedentary', factor: 1.2, description: 'Little or no exercise, desk job' },
  light: { label: 'Lightly Active', factor: 1.375, description: 'Light exercise 1–3 days per week' },
  moderate: { label: 'Moderately Active', factor: 1.55, description: 'Moderate exercise 3–5 days per week' },
  active: { label: 'Very Active', factor: 1.725, description: 'Hard exercise 6–7 days per week' },
  very_active: { label: 'Athlete', factor: 1.9, description: 'Intense training or physical job daily' }
};

export const PRIMARY_GOALS = {
  lose: { label: 'Lose Weight' },
  maintain: { label: 'Maintain Weight' },
  gain: { label: 'Gain Muscle' }
};

const PROTEIN_PER_KG = {
  lose: 1.8,
  maintain: 1.6,
  gain: 2.0
};

/**
 * Calculate Basal Metabolic Rate (kcal/day) via Mifflin-St Jeor.
 */
export function calculateBmr({ gender, weightKg, heightCm, age }) {
  const base = (10 * weightKg) + (6.25 * heightCm) - (5 * age);

  if (gender === 'male') return base + 5;
  if (gender === 'female') return base - 161;

  // Other / unspecified: use the average of the two formulas
  return base + ((5 - 161) / 2);
}

/**
 * Calculate personalized daily calorie + macro targets.
 * Returns snake_case keys matching the nutrition_goals table.
 */
export function calculateTargets({ gender, weightKg, heightCm, age, activityLevel, goal }) {
  const bmr = calculateBmr({ gender, weightKg, heightCm, age });
  const factor = ACTIVITY_LEVELS[activityLevel]?.factor || 1.375;
  const tdee = bmr * factor;

  let calories;
  if (goal === 'lose') {
    calories = tdee * 0.8;            // ~20% deficit
    calories = Math.max(calories, bmr); // never below maintenance-of-vitals
  } else if (goal === 'gain') {
    calories = tdee * 1.1;            // ~10% surplus
  } else {
    calories = tdee;                  // maintenance
  }

  calories = Math.round(calories / 10) * 10;
  calories = Math.min(Math.max(calories, 1200), 8000);

  const protein = Math.min(Math.round((PROTEIN_PER_KG[goal] || 1.6) * weightKg), 400);
  const fats = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(Math.round((calories - (protein * 4) - (fats * 9)) / 4), 20);

  return {
    dailyCalorieTarget: calories,
    dailyProteinTarget: protein,
    dailyCarbsTarget: carbs,
    dailyFatsTarget: fats,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee)
  };
}