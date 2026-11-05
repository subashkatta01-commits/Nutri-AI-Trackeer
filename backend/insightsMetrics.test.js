import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWeeklyInsightSummaries, buildWeightRegressionForecast } from './insightsMetrics.js';

test('summarizes low protein intake across logged weekdays', () => {
  const weekdays = [
    { date: '2026-11-02', mealCount: 2, protein: 60, carbs: 200, fats: 50 },
    { date: '2026-11-03', mealCount: 2, protein: 70, carbs: 200, fats: 50 },
    { date: '2026-11-04', mealCount: 2, protein: 65, carbs: 200, fats: 50 }
  ];

  const summaries = buildWeeklyInsightSummaries(weekdays, {
    protein: 120,
    carbs: 220,
    fats: 60
  });

  assert.equal(summaries[0].title, 'Protein is low on weekdays');
  assert.match(summaries[0].detail, /You averaged 65g across 3 logged weekdays/);
});

test('does not make macro claims from too few logged days', () => {
  const summaries = buildWeeklyInsightSummaries([
    { date: '2026-11-02', mealCount: 1, protein: 10, carbs: 10, fats: 10 },
    { date: '2026-11-03', mealCount: 1, protein: 10, carbs: 10, fats: 10 }
  ], { protein: 100, carbs: 100, fats: 100 });

  assert.deepEqual(summaries, []);
});

test('forecasts weight using regression and provides a prediction range', () => {
  const forecast = buildWeightRegressionForecast([
    { date: '2026-10-01', weight: 80 },
    { date: '2026-10-11', weight: 79.5 },
    { date: '2026-10-21', weight: 79 }
  ]);

  assert.equal(forecast.forecastDate, '2026-11-20');
  assert.equal(forecast.entries, 3);
  assert.equal(forecast.estimateKg, 77.5);
  assert.ok(forecast.lowerKg < forecast.estimateKg);
  assert.ok(forecast.upperKg > forecast.estimateKg);
});

test('does not forecast with insufficient weight history', () => {
  assert.equal(buildWeightRegressionForecast([
    { date: '2026-10-01', weight: 80 },
    { date: '2026-10-10', weight: 79 }
  ]), null);
});
