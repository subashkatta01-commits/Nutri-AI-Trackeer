/**
 * NutriAI Tracker - Frontend Application
 * Includes authentication, meal logging, and nutrition tracking
 */

const API_URL = 'https://nutri-ai-trackeer.onrender.com';

let chartInstance = null;
let currentBase64Image = null;
let currentUser = null;
let authToken = null;

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  checkAuthentication();
});

// ========== AUTHENTICATION ==========

function checkAuthentication() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('currentUser');
  
  if (token && user) {
    authToken = token;
    currentUser = JSON.parse(user);
    showApp();
    setupEventListeners();
    loadDailyData();
    loadNutritionGoals();
    setupAutoMealType();
  } else {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  setupAuthListeners();
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
}

function setupAuthListeners() {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const toggleToSignup = document.getElementById('toggleToSignup');
  const toggleToLogin = document.getElementById('toggleToLogin');

  loginForm.addEventListener('submit', handleLogin);
  signupForm.addEventListener('submit', handleSignup);
  toggleToSignup.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
  });
  toggleToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');

  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      errorDiv.textContent = data.error || 'Login failed';
      return;
    }

    // Store auth data
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    // Show app
    showApp();
    setupEventListeners();
    loadDailyData();
    loadNutritionGoals();
    setupAutoMealType();
    errorDiv.textContent = '';
  } catch (error) {
    errorDiv.textContent = 'Network error: ' + error.message;
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signupUsername').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const errorDiv = document.getElementById('signupError');

  try {
    const response = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      errorDiv.textContent = data.error || 'Signup failed';
      return;
    }

    // Store auth data
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    // Show app
    showApp();
    setupEventListeners();
    loadDailyData();
    loadNutritionGoals();
    setupAutoMealType();
    errorDiv.textContent = '';
  } catch (error) {
    errorDiv.textContent = 'Network error: ' + error.message;
  }
}

function handleLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  location.reload();
}

// ========== NUTRITION GOALS ==========

async function loadNutritionGoals() {
  try {
    const response = await fetch(`${API_URL}/api/goals`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) return;

    const data = await response.json();
    const goals = data.goals;

    // Update form and input with goals
    document.getElementById('targetCalories').value = goals.daily_calorie_target;
    document.getElementById('targetProtein').value = goals.daily_protein_target;
    document.getElementById('targetCarbs').value = goals.daily_carbs_target;
    document.getElementById('targetFats').value = goals.daily_fats_target;
    document.getElementById('calorieGoalInput').value = goals.daily_calorie_target;

    // Store in localStorage for fallback
    localStorage.setItem('calorieGoal', goals.daily_calorie_target);
  } catch (error) {
    console.error('Failed to load nutrition goals:', error);
  }
}

function openSettingsModal() {
  document.getElementById('settingsModalOverlay').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModalOverlay').classList.add('hidden');
}

async function handleSaveGoals(e) {
  e.preventDefault();
  const messageDiv = document.getElementById('goalsMessage');

  const goals = {
    dailyCalorieTarget: parseInt(document.getElementById('targetCalories').value),
    dailyProteinTarget: parseFloat(document.getElementById('targetProtein').value),
    dailyCarbsTarget: parseFloat(document.getElementById('targetCarbs').value),
    dailyFatsTarget: parseFloat(document.getElementById('targetFats').value)
  };

  try {
    const response = await fetch(`${API_URL}/api/goals`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(goals)
    });

    const data = await response.json();

    if (!response.ok) {
      messageDiv.textContent = data.error || 'Failed to save goals';
      messageDiv.className = 'message error';
      return;
    }

    messageDiv.textContent = 'Goals saved successfully!';
    messageDiv.className = 'message success';
    document.getElementById('calorieGoalInput').value = goals.dailyCalorieTarget;
    loadDailyData();
    
    setTimeout(() => messageDiv.textContent = '', 2000);
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  }
}

// ========== AUTO MEAL TYPE ==========

function setupAutoMealType() {
  const hour = new Date().getHours();
  const mealSelect = document.getElementById('mealType');
  if (hour >= 5 && hour < 11) mealSelect.value = 'Breakfast';
  else if (hour >= 11 && hour < 16) mealSelect.value = 'Lunch';
  else if (hour >= 16 && hour < 22) mealSelect.value = 'Dinner';
  else mealSelect.value = 'Snack';
}

// ========== EVENT LISTENERS ==========

function setupEventListeners() {
  const imageInput = document.getElementById('imageInput');
  const removeImgBtn = document.getElementById('removeImgBtn');
  const mealForm = document.getElementById('mealForm');
  const calorieGoalInput = document.getElementById('calorieGoalInput');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const goalsForm = document.getElementById('goalsForm');

  imageInput.addEventListener('change', handleImageUpload);
  removeImgBtn.addEventListener('click', clearImageUpload);
  mealForm.addEventListener('submit', handleFormSubmit);
  calorieGoalInput.addEventListener('change', () => {
    localStorage.setItem('calorieGoal', calorieGoalInput.value);
    loadDailyData();
  });

  if (clearAllBtn) clearAllBtn.addEventListener('click', handleClearAll);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
  if (goalsForm) goalsForm.addEventListener('submit', handleSaveGoals);

  // Monthly chart modal
  const monthlyChartBtn = document.getElementById('monthlyChartBtn');
  const monthlyModalOverlay = document.getElementById('monthlyModalOverlay');
  const closeMonthlyBtn = document.getElementById('closeMonthlyBtn');

  if (monthlyChartBtn) monthlyChartBtn.addEventListener('click', openMonthlyModal);
  if (closeMonthlyBtn) closeMonthlyBtn.addEventListener('click', closeMonthlyModal);
  if (monthlyModalOverlay) {
    monthlyModalOverlay.addEventListener('click', (e) => {
      if (e.target === monthlyModalOverlay) closeMonthlyModal();
    });
  }

  // Settings modal
  const settingsModalOverlay = document.getElementById('settingsModalOverlay');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');

  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
  if (settingsModalOverlay) {
    settingsModalOverlay.addEventListener('click', (e) => {
      if (e.target === settingsModalOverlay) closeSettingsModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMonthlyModal();
      closeSettingsModal();
    }
  });
}

// ========== IMAGE HANDLING ==========

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const canvas = document.createElement('canvas');
    const img = new Image();

    img.onload = () => {
      const ctx = canvas.getContext('2d');
      const maxWidth = 800;
      const maxHeight = 600;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round(width * (maxHeight / height));
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      currentBase64Image = canvas.toDataURL('image/jpeg', 0.85);

      const imagePreview = document.getElementById('imagePreview');
      const uploadPlaceholder = document.getElementById('uploadPlaceholder');
      const previewBox = document.getElementById('previewBox');

      imagePreview.src = currentBase64Image;
      uploadPlaceholder.classList.add('hidden');
      previewBox.classList.remove('hidden');
    };

    img.src = event.target.result;
  };

  reader.readAsDataURL(file);
}

function clearImageUpload() {
  currentBase64Image = null;
  document.getElementById('imageInput').value = '';
  document.getElementById('uploadPlaceholder').classList.remove('hidden');
  document.getElementById('previewBox').classList.add('hidden');
}

// ========== FORM SUBMISSION ==========

async function handleFormSubmit(e) {
  e.preventDefault();

  const mealType = document.getElementById('mealType').value;
  const category = document.getElementById('fitnessCategory').value;
  const textInput = document.getElementById('textInput').value;
  const submitBtn = document.getElementById('submitBtn');

  if (!textInput && !currentBase64Image) {
    alert('Please provide either a meal description or image.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';

  try {
    const response = await fetch(`${API_URL}/api/analyze-meal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        mealType,
        category,
        textInput,
        imageBase64: currentBase64Image
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Failed to analyze meal');
      return;
    }

    displayAnalysisResult(data.data);
    showDashboardPanel();
    loadDailyData();
    clearForm();
  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyze & Log Meal';
  }
}

function clearForm() {
  document.getElementById('mealForm').reset();
  clearImageUpload();
  setupAutoMealType();
}

// ========== DASHBOARD DISPLAY ==========

function showDashboardPanel() {
  const panel = document.getElementById('dashboardPanel');
  const grid = document.getElementById('dashboardGrid');
  if (panel) panel.classList.remove('hidden');
  if (grid) grid.classList.remove('single-column');
}

function hideDashboardPanel() {
  const panel = document.getElementById('dashboardPanel');
  const grid = document.getElementById('dashboardGrid');
  if (panel) panel.classList.add('hidden');
  if (grid) grid.classList.add('single-column');
}

function displayAnalysisResult(data) {
  const resultCard = document.getElementById('latestResultCard');
  const mealName = document.getElementById('resultMealName');
  const scoreBadge = document.getElementById('resultScoreBadge');
  const advice = document.getElementById('resultAdvice');
  const plateItemsContainer = document.getElementById('plateItemsContainer');
  const plateItemsList = document.getElementById('plateItemsList');

  mealName.textContent = data.mealName;
  scoreBadge.textContent = data.efficiencyScore;
  scoreBadge.className = `badge ${data.efficiencyScore.toLowerCase()}`;
  advice.textContent = data.suggestedAdjustments || data.goalAlignmentReason;

  plateItemsList.innerHTML = '';
  if (data.detectedItems && data.detectedItems.length > 0) {
    data.detectedItems.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${item.name}</strong> — ${item.estimatedPortion}`;
      plateItemsList.appendChild(li);
    });
    plateItemsContainer.classList.remove('hidden');
  } else {
    plateItemsContainer.classList.add('hidden');
  }

  resultCard.classList.remove('hidden');
}

async function loadDailyData() {
  try {
    const response = await fetch(`${API_URL}/api/daily-history`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) return;

    const data = await response.json();
    updateDailyDisplay(data.totals, data.logs);
    updateHistoryTable(data.logs);
  } catch (error) {
    console.error('Failed to load daily data:', error);
  }
}

function updateDailyDisplay(totals, logs) {
  const calorieGoal = parseInt(document.getElementById('calorieGoalInput').value) || 2000;
  const calorieCount = totals.totalCalories || 0;

  document.getElementById('calorieCountText').textContent = `${calorieCount} / ${calorieGoal} kcal`;
  document.getElementById('totalProtein').textContent = (totals.totalProtein || 0) + 'g';
  document.getElementById('totalCarbs').textContent = (totals.totalCarbs || 0) + 'g';
  document.getElementById('totalFats').textContent = (totals.totalFats || 0) + 'g';

  const progressPercent = Math.min((calorieCount / calorieGoal) * 100, 100);
  document.getElementById('calorieProgressBar').style.width = progressPercent + '%';

  updateMacroChart(totals);

  if (logs.length === 0) {
    hideDashboardPanel();
  }
}

function updateMacroChart(totals) {
  const ctx = document.getElementById('macroChart')?.getContext('2d');
  if (!ctx) return;

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Protein', 'Carbs', 'Fats'],
      datasets: [{
        data: [totals.totalProtein || 0, totals.totalCarbs || 0, totals.totalFats || 0],
        backgroundColor: ['#fb7185', '#fbbf24', '#a78bfa'],
        borderColor: ['#0a0e17', '#0a0e17', '#0a0e17'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: { color: '#eef1f8', font: { size: 12 } }
        }
      }
    }
  });
}

function updateHistoryTable(logs) {
  const tbody = document.getElementById('historyTableBody');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No meals logged yet.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const time = new Date(log.created_at).toLocaleTimeString();
    return `
      <tr>
        <td>${time}</td>
        <td>${log.meal_type}</td>
        <td>${log.meal_name}</td>
        <td>${log.calories} kcal</td>
        <td>${log.protein}g</td>
        <td>${log.carbs}g</td>
        <td>${log.fats}g</td>
        <td><span class="badge ${log.efficiency_score.toLowerCase()}">${log.efficiency_score}</span></td>
        <td>
          <button class="btn-icon" onclick="deleteMeal(${log.id})" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteMeal(id) {
  if (!confirm('Delete this meal log?')) return;

  try {
    const response = await fetch(`${API_URL}/api/logs/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (response.ok) {
      loadDailyData();
    } else {
      alert('Failed to delete meal log');
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

async function handleClearAll() {
  if (!confirm('Delete ALL meal logs? This cannot be undone.')) return;

  try {
    const response = await fetch(`${API_URL}/api/daily-history`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const data = await response.json();
    if (response.ok) {
      alert(`Deleted ${data.deletedCount} meal logs`);
      hideDashboardPanel();
      loadDailyData();
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

// ========== MONTHLY CHART ==========

function openMonthlyModal() {
  const overlay = document.getElementById('monthlyModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  fetchMonthlyData();
}

function closeMonthlyModal() {
  const overlay = document.getElementById('monthlyModalOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

async function fetchMonthlyData() {
  try {
    const response = await fetch(`${API_URL}/api/monthly-history`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) return;

    const data = await response.json();
    displayMonthlyChart(data.monthlyData);
  } catch (error) {
    console.error('Failed to fetch monthly data:', error);
  }
}

function displayMonthlyChart(data) {
  const ctx = document.getElementById('monthlyChart')?.getContext('2d');
  if (!ctx) return;

  if (chartInstance) chartInstance.destroy();

  const labels = data.map(d => new Date(d.log_date).toLocaleDateString());
  const calories = data.map(d => d.totalCalories);

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Daily Calories',
        data: calories,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: '#38bdf8'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#eef1f8' } }
      },
      scales: {
        y: { ticks: { color: '#eef1f8' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
        x: { ticks: { color: '#eef1f8' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }
      }
    }
  });
}