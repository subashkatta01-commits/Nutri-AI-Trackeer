const MACROS = [
  { key: 'protein', label: 'Protein', targetKey: 'protein' },
  { key: 'carbs', label: 'Carbs', targetKey: 'carbs' },
  { key: 'fats', label: 'Fats', targetKey: 'fats' }
];

const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function parseDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildWeeklyInsightSummaries(daily, targets) {
  const periods = [
    { key: 'weekdays', label: 'weekdays', minDays: 3, isPeriod: (date) => date.getDay() >= 1 && date.getDay() <= 5 },
    { key: 'weekends', label: 'weekends', minDays: 2, isPeriod: (date) => date.getDay() === 0 || date.getDay() === 6 }
  ];
  const summaries = [];

  for (const period of periods) {
    const loggedDays = daily.filter((day) => {
      const date = parseDate(day.date);
      return date && day.mealCount > 0 && period.isPeriod(date);
    });

    if (loggedDays.length < period.minDays) continue;

    for (const macro of MACROS) {
      const target = targets[macro.targetKey];
      if (!Number.isFinite(target) || target <= 0) continue;

      const average = loggedDays.reduce((sum, day) => sum + (day[macro.key] || 0), 0) / loggedDays.length;
      if (average >= target * 0.9) continue;

      summaries.push({
        key: `${macro.key}-${period.key}`,
        title: `${macro.label} is low on ${period.label}`,
        detail: `You averaged ${round(average)}g across ${loggedDays.length} logged ${period.label} (target: ${round(target)}g).`,
        shortfall: (target - average) / target
      });
    }
  }

  return summaries
    .sort((a, b) => b.shortfall - a.shortfall)
    .slice(0, 4)
    .map(({ shortfall, ...summary }) => summary);
}

const T_CRITICAL_95 = [
  null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
  2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
  2.042
];

export function buildWeightRegressionForecast(points, daysAhead = 30) {
  const validPoints = points
    .map((point) => ({ date: parseDate(point.date), weight: Number(point.weight) }))
    .filter((point) => point.date && Number.isFinite(point.weight))
    .sort((a, b) => a.date - b.date);

  if (validPoints.length < 3) return null;

  const firstDate = validPoints[0].date;
  const lastDate = validPoints[validPoints.length - 1].date;
  const xValues = validPoints.map((point) => Math.round((point.date - firstDate) / 86400000));
  const spanDays = xValues[xValues.length - 1];
  if (spanDays < 14) return null;

  const yValues = validPoints.map((point) => point.weight);
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const meanY = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  const sumSquaresX = xValues.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  if (sumSquaresX === 0) return null;

  const slope = xValues.reduce((sum, value, index) => (
    sum + (value - meanX) * (yValues[index] - meanY)
  ), 0) / sumSquaresX;
  const intercept = meanY - slope * meanX;
  const forecastX = spanDays + daysAhead;
  const estimate = intercept + slope * forecastX;
  const residualSumSquares = xValues.reduce((sum, value, index) => (
    sum + (yValues[index] - (intercept + slope * value)) ** 2
  ), 0);
  const degreesOfFreedom = validPoints.length - 2;
  // Weight entries are recorded to 0.1 kg; retain measurement noise for exact fits.
  const residualError = Math.max(Math.sqrt(residualSumSquares / degreesOfFreedom), 0.1);
  const predictionError = residualError * Math.sqrt(
    1 + (1 / validPoints.length) + ((forecastX - meanX) ** 2 / sumSquaresX)
  );
  const criticalValue = T_CRITICAL_95[degreesOfFreedom] || 1.96;
  const margin = criticalValue * predictionError;
  const forecastDate = new Date(lastDate);
  forecastDate.setDate(forecastDate.getDate() + daysAhead);

  return {
    forecastDate: [
      forecastDate.getFullYear(),
      String(forecastDate.getMonth() + 1).padStart(2, '0'),
      String(forecastDate.getDate()).padStart(2, '0')
    ].join('-'),
    daysAhead,
    entries: validPoints.length,
    estimateKg: round(estimate),
    lowerKg: round(estimate - margin),
    upperKg: round(estimate + margin),
    confidenceLevel: 95
  };
}
