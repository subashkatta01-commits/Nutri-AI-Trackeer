let chartInstance = null;
let currentBase64Image = null;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadDailyData();
  setupAutoMealType();
  fetchMonthlyData(); // Independent call so the monthly chart loads even if daily-history has issues
});

// Auto-select Meal Type based on current hour of the day
function setupAutoMealType() {
  const hour = new Date().getHours();
  const mealSelect = document.getElementById('mealType');
  if (hour >= 5 && hour < 11) mealSelect.value = 'Breakfast';
  else if (hour >= 11 && hour < 16) mealSelect.value = 'Lunch';
  else if (hour >= 16 && hour < 22) mealSelect.value = 'Dinner';
  else mealSelect.value = 'Snack';
}

function setupEventListeners() {
  const imageInput = document.getElementById('imageInput');
  const removeImgBtn = document.getElementById('removeImgBtn');
  const mealForm = document.getElementById('mealForm');
  const calorieGoalInput = document.getElementById('calorieGoalInput');
  const clearAllBtn = document.getElementById('clearAllBtn'); // Clear All button reference

  // Load saved calorie goal if available
  const savedGoal = localStorage.getItem('calorieGoal');
  if (savedGoal) calorieGoalInput.value = savedGoal;

  calorieGoalInput.addEventListener('change', () => {
    localStorage.setItem('calorieGoal', calorieGoalInput.value);
    loadDailyData();
  });

  imageInput.addEventListener('change', handleImageUpload);
  removeImgBtn.addEventListener('click', clearImageUpload);
  mealForm.addEventListener('submit', handleFormSubmit);

  // Attach listener to Clear All button
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', handleClearAll);
  }
}

// Convert uploaded image to Base64 with client-side canvas compression
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 1000;
      let width = img.width;
      let height = img.height;

      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      currentBase64Image = canvas.toDataURL('image/jpeg', 0.8);
      
      document.getElementById('imagePreview').src = currentBase64Image;
      document.getElementById('uploadPlaceholder').classList.add('hidden');
      document.getElementById('previewBox').classList.remove('hidden');
    };
  };
  reader.readAsDataURL(file);
}

function clearImageUpload() {
  currentBase64Image = null;
  document.getElementById('imageInput').value = '';
  document.getElementById('uploadPlaceholder').classList.remove('hidden');
  document.getElementById('previewBox').classList.add('hidden');
}

// Handle Meal Form Submission
async function handleFormSubmit(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('submitBtn');
  const mealType = document.getElementById('mealType').value;
  const category = document.getElementById('fitnessCategory').value;
  const textInput = document.getElementById('textInput').value.trim();

  if (!textInput && !currentBase64Image) {
    alert('Please enter a description or upload an image of your meal.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing with AI...';

  try {
    const response = await fetch('/api/analyze-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealType,
        category,
        textInput,
        imageBase64: currentBase64Image
      })
    });

    const result = await response.json();

    if (result.success) {
      showLatestResult(result.data);
      document.getElementById('textInput').value = '';
      clearImageUpload();
      loadDailyData();
    } else {
      alert('Error: ' + result.error);
    }

  } catch (err) {
    console.error('Submit error:', err);
    alert('Failed to connect to the server.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyze & Log Meal';
  }
}

// Display latest AI response banner


// Load daily logs and totals from server
async function loadDailyData() {
  try {
    const res = await fetch('/api/daily-history');
    const data = await res.json();

    if (data.success) {
      try {
        updateSummaryUI(data.totals);
      } catch (e) { console.error('updateSummaryUI failed:', e); }
      try {
        renderHistoryTable(data.logs);
      } catch (e) { console.error('renderHistoryTable failed:', e); }
      try {
        renderChart(data.totals);
      } catch (e) { console.error('renderChart (macro) failed:', e); }
    }
    fetchMonthlyData(); // Always refresh line chart, regardless of the above
  } catch (err) {
    console.error('Failed to load daily history:', err);
  }
}

function updateSummaryUI(totals) {
  const goal = parseInt(document.getElementById('calorieGoalInput').value) || 2000;
  const totalCal = totals.totalCalories || 0;

  document.getElementById('calorieCountText').innerText = `${totalCal} /${goal} kcal`;
  
  const percentage = Math.min(100, Math.round((totalCal / goal) * 100));
  document.getElementById('calorieProgressBar').style.width = `${percentage}%`;

  document.getElementById('totalProtein').innerText = `${totals.totalProtein || 0}g`;
  document.getElementById('totalCarbs').innerText = `${totals.totalCarbs || 0}g`;
  document.getElementById('totalFats').innerText = `${totals.totalFats || 0}g`;
}

function renderChart(totals) {
  const ctx = document.getElementById('macroChart').getContext('2d');

  const protein = totals.totalProtein || 0;
  const carbs = totals.totalCarbs || 0;
  const fats = totals.totalFats || 0;

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Protein (g)', 'Carbs (g)', 'Fats (g)'],
      datasets: [{
        data: [protein, carbs, fats],
        backgroundColor: ['#ef4444', '#3b82f6', '#eab308'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      cutout: '70%'
    }
  });
}

function renderHistoryTable(logs) {
  const tbody = document.getElementById('historyTableBody');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">No meals logged today yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const timeStr = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const scoreClass = (log.efficiency_score || 'medium').toLowerCase();

    return `
      <tr>
        <td>${timeStr}</td>
        <td><strong>${log.meal_type}</strong></td>
        <td>${log.meal_name}</td>
        <td><strong>${log.calories}</strong></td>
        <td>${log.protein}g</td>
        <td>${log.carbs}g</td>
        <td>${log.fats}g</td>
        <td><span class="badge ${scoreClass}">${log.efficiency_score}</span></td>
        <td>
          <button class="btn-delete" onclick="deleteLog(${log.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteLog(id) {
  if (!confirm('Are you sure you want to delete this log?')) return;

  try {
    const res = await fetch(`/api/logs/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadDailyData();
    }
  } catch (err) {
    console.error('Failed to delete log:', err);
  }
}
window.deleteLog = deleteLog;

// Clear all meal logs handler
async function handleClearAll() {
  if (!confirm('Are you sure you want to delete all logged meals for today?')) return;

  try {
    const res = await fetch('/api/daily-history', { method: 'DELETE' });
    const data = await res.json();

    if (data.success) {
      const latestCard = document.getElementById('latestResultCard');
      if (latestCard) latestCard.classList.add('hidden');
      loadDailyData();
    } else {
      alert('Failed to clear logs: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Failed to clear history:', err);
    alert('Failed to connect to the server.');
  }
}
let monthlyChartInstance = null;

async function fetchMonthlyData() {
  console.log('fetchMonthlyData() called');
  try {
    const res = await fetch('/api/monthly-history');
    const data = await res.json();
    
    // Log response to inspect data structure
    console.log("Monthly API Response:", data);

    if (data.success) {
      renderMonthlyChart(data.monthlyData || []);
    } else {
      console.error('Monthly history request returned success:false', data);
    }
  } catch (err) {
    console.error('Failed to load monthly data:', err);
  }
}

function renderMonthlyChart(monthlyData = []) {
  console.log('renderMonthlyChart() called with', monthlyData.length, 'data points');
  const canvas = document.getElementById('monthlyChart');
  if (!canvas) {
    console.error('monthlyChart canvas element not found in DOM!');
    return;
  }
  
  const ctx = canvas.getContext('2d');

  let labels = [];
  let calories = [];

  if (Array.isArray(monthlyData) && monthlyData.length > 0) {
    labels = monthlyData.map(d => {
      if (!d.log_date) return 'Today';
      const date = new Date(d.log_date);
      return isNaN(date.getTime()) ? d.log_date : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });
    calories = monthlyData.map(d => Number(d.totalCalories) || 0);
  } else {
    // Fallback display so axes remain visible on Day 1
    const today = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
    labels = [today];
    calories = [0];
  }

  // Safely destroy any existing chart on this canvas, whether or not
  // our tracked reference is stale (guards against overlapping calls)
  if (monthlyChartInstance) {
    monthlyChartInstance.destroy();
    monthlyChartInstance = null;
  }
  const existingChart = Chart.getChart(canvas);
  if (existingChart) {
    existingChart.destroy();
  }

  try {
    monthlyChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Daily Calories (kcal)',
          data: calories,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#38bdf8',
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8' }
          },
          y: {
            beginAtZero: true,
            suggestedMax: 2000,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8' }
          }
        }
      }
    });
    console.log('Monthly chart rendered successfully');
  } catch (e) {
    console.error('Chart.js failed to render monthly chart:', e);
  }
}