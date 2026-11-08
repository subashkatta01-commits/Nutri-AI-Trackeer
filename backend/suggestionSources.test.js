import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMacroFoodSuggestion } from './suggestionSources.js';

test('returns food suggestions that match each macro', () => {
  assert.match(getMacroFoodSuggestion('protein', 'dinner'), /Salmon|beef|paneer|lentils/);
  assert.match(getMacroFoodSuggestion('carbs', 'dinner'), /vegetables|beans|wrap/);
  assert.match(getMacroFoodSuggestion('fats', 'dinner'), /olive oil|avocado|seeds/);
});

test('returns null for an unsupported macro or meal', () => {
  assert.equal(getMacroFoodSuggestion('fiber', 'dinner'), null);
  assert.equal(getMacroFoodSuggestion('protein', 'dessert'), null);
});
