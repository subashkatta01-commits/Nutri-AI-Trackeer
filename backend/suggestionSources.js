const MACRO_FOOD_SOURCES = {
  protein: {
    breakfast: 'Greek yogurt, eggs or a protein shake',
    lunch: 'Grilled chicken, tuna or tofu with a legume side',
    dinner: 'Salmon, lean beef or paneer with lentils',
    snack: 'Cottage cheese, edamame or a handful of almonds'
  },
  carbs: {
    breakfast: 'whole-grain toast, oats or a banana',
    lunch: 'brown rice, sweet potato or quinoa',
    dinner: 'roasted vegetables, beans or a whole-wheat wrap',
    snack: 'fruit, a handful of oats or a rice cake'
  },
  fats: {
    breakfast: 'avocado, nuts or a drizzle of olive oil',
    lunch: 'a drizzle of olive oil or a spoon of nuts',
    dinner: 'olive oil, avocado or a handful of seeds',
    snack: 'nuts, seeds or a small portion of dark chocolate'
  }
};

export function getMacroFoodSuggestion(macro, meal) {
  return MACRO_FOOD_SOURCES[macro]?.[meal] ?? null;
}
