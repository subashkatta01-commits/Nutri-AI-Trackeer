/**
 * NutriAI Tracker - Frontend Application
 * Includes authentication, meal logging, and nutrition tracking
 */

let chartInstance = null;
let monthlyChartInstance = null;
let currentBase64Image = null;
let currentUser = null;
let authToken = null;
let authListenersInitialized = false;
let appListenersInitialized = false;
let loginInProgress = false;

let currentGoals = { calories: 2000, protein: 150, carbs: 250, fats: 65 };
let lastTotals = { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFats: 0 };

let currentProfile = null;
let onboardingStep = 1;
let onboardingEditMode = false;
let onboardingInitialized = false;

const TOTAL_ONBOARDING_STEPS = 4;

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

const ACTIVITY_LABELS = {
  sedentary: 'Sedentary',
  light: 'Lightly Active',
  moderate: 'Moderately Active',
  active: 'Very Active',
  very_active: 'Athlete'
};

const GOAL_LABELS = {
  lose: 'Lose Weight',
  maintain: 'Maintain Weight',
  gain: 'Gain Muscle'
};

const GOAL_CATEGORY_MAP = {
  lose: 'Fat Loss / Caloric Deficit',
  maintain: 'Maintenance & Energy',
  gain: 'Muscle Gain / Hypertrophy'
};

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  checkAuthentication();
});

// ========== AUTHENTICATION ==========

async function checkAuthentication() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('currentUser');
  
  if (token && user && /^\d+$/.test(token)) {
    try {
      authToken = token;
      currentUser = JSON.parse(user);
    } catch (error) {
      clearAuthentication();
      showAuthScreen();
      return;
    }
    showApp();
    setupEventListeners();
    loadDailyData();
    loadNutritionGoals();
    setupAutoMealType();
    const profile = await loadProfile();
    if (profile === null && !(currentUser.onboarding_completed || 0)) {
      openOnboarding(false);
    }
  } else {
    showAuthScreen();
  }
}

function clearAuthentication() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
}

function handleUnauthorized(response) {
  if (response.status !== 401) return false;

  clearAuthentication();
  alert('Your session has expired. Please sign in again.');
  window.location.reload();
  return true;
}

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  setupAuthListeners();
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  updateGreeting();
}

function setupAuthListeners() {
  if (authListenersInitialized) return;

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
  authListenersInitialized = true;
}

async function handleLogin(e) {
  e.preventDefault();
  if (loginInProgress) return;

  loginInProgress = true;
  const submitButton = document.querySelector('#loginForm button[type="submit"]');
  const submitLabel = submitButton?.textContent;
  const errorDiv = document.getElementById('loginError');
  errorDiv.textContent = '';
  if (submitButton) submitButton.disabled = true;
  if (submitButton) submitButton.textContent = 'Signing in...';

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      errorDiv.textContent = response.status === 401
        ? "No account matched those sign-in details, or the password was incorrect. Try again or sign up."
        : data.error || 'Unable to sign in. Please try again.';
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
    const profile = await loadProfile();
    if (profile === null && !(currentUser.onboarding_completed || 0)) {
      openOnboarding(false);
    }
    errorDiv.textContent = '';
  } catch (error) {
    errorDiv.textContent = 'Network error: ' + error.message;
  } finally {
    loginInProgress = false;
    if (submitButton) submitButton.disabled = false;
    if (submitButton && submitLabel !== undefined) submitButton.textContent = submitLabel;
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signupUsername').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const errorDiv = document.getElementById('signupError');

  try {
    const response = await fetch('/api/auth/signup', {
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
    await loadProfile();
    openOnboarding(false);
    errorDiv.textContent = '';
  } catch (error) {
    errorDiv.textContent = 'Network error: ' + error.message;
  }
}

function handleLogout() {
  clearAuthentication();
  location.reload();
}

// ========== USER PROFILE / ONBOARDING ==========

function setupOnboarding() {
  if (onboardingInitialized) return;
  onboardingInitialized = true;

  document.getElementById('onboardingNext').addEventListener('click', goOnboardingNext);
  document.getElementById('onboardingBack').addEventListener('click', goOnboardingBack);
  document.getElementById('onboardingClose').addEventListener('click', () => {
    closeOnboarding();
    showApp();
  });

  document.getElementById('onboardingDietChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const isNoRestrictions = chip.dataset.value === 'No Restrictions';
    chip.classList.toggle('selected');

    if (isNoRestrictions && chip.classList.contains('selected')) {
      document.querySelectorAll('#onboardingDietChips .chip[data-value]:not([data-value="No Restrictions"])')
        .forEach(c => c.classList.remove('selected'));
    } else if (!isNoRestrictions && chip.classList.contains('selected')) {
      const noRestrictionChip = document.querySelector('#onboardingDietChips .chip[data-value="No Restrictions"]');
      if (noRestrictionChip) noRestrictionChip.classList.remove('selected');
    }
  });

  document.getElementById('onboardingAllergyChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const term = chip.dataset.value;
    const input = document.getElementById('onboardingAllergyInput');
    const tokens = input.value.split(',').map(s => s.trim()).filter(Boolean);

    if (chip.classList.contains('selected')) {
      chip.classList.remove('selected');
      input.value = tokens.filter(t => t !== term).join(', ');
    } else {
      chip.classList.add('selected');
      if (!tokens.includes(term)) input.value = [...tokens, term].join(', ');
    }
  });
}

function openOnboarding(editMode = false) {
  onboardingEditMode = editMode;
  onboardingStep = 1;

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('onboardingScreen').classList.remove('hidden');
  document.getElementById('onboardingClose').classList.toggle('hidden', !editMode);

  if (editMode) {
    if (currentProfile) {
      refillOnboarding(currentProfile);
    } else {
      // Profile not fetched yet — prefill in the background (screen is already shown)
      loadProfile();
    }
  }

  showOnboardingStep(1);
  const msg = document.getElementById('onboardingMessage');
  msg.textContent = '';
  msg.className = 'message';
}

function closeOnboarding() {
  onboardingEditMode = false;
  document.getElementById('onboardingScreen').classList.add('hidden');
}

function showOnboardingStep(step) {
  onboardingStep = step;

  document.querySelectorAll('.onboarding-step').forEach((section) => {
    section.classList.toggle('hidden', parseInt(section.dataset.step) !== step);
  });

  document.getElementById('onboardingProgressBar').style.width = ((step / TOTAL_ONBOARDING_STEPS) * 100) + '%';

  const backBtn = document.getElementById('onboardingBack');
  backBtn.classList.toggle('hidden', step === 1 || step === TOTAL_ONBOARDING_STEPS);

  const nextBtn = document.getElementById('onboardingNext');
  if (step === TOTAL_ONBOARDING_STEPS) {
    nextBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Start Tracking';
  } else if (step === 3) {
    nextBtn.innerHTML = 'Get My Plan <i class="fa-solid fa-wand-magic-sparkles"></i>';
  } else {
    nextBtn.innerHTML = 'Next <i class="fa-solid fa-arrow-right"></i>';
  }
}

function goOnboardingBack() {
  if (onboardingStep <= 1) return;
  setOnboardingMessage('', '');
  showOnboardingStep(onboardingStep - 1);
}

function setOnboardingMessage(text, type) {
  const msg = document.getElementById('onboardingMessage');
  msg.textContent = text;
  msg.className = type ? `message ${type}` : 'message';
}

function goOnboardingNext() {
  setOnboardingMessage('', '');

  if (onboardingStep === 1) {
    const age = parseInt(document.getElementById('onboardingAge').value);
    const heightCm = parseFloat(document.getElementById('onboardingHeightCm').value);
    const weightKg = parseFloat(document.getElementById('onboardingWeightKg').value);

    if (Number.isNaN(age) || age < 13 || age > 120) {
      setOnboardingMessage('Please enter your age (13–120).', 'error');
      return;
    }
    if (Number.isNaN(heightCm) || heightCm < 90 || heightCm > 250) {
      setOnboardingMessage('Please enter your height in cm (90–250).', 'error');
      return;
    }
    if (Number.isNaN(weightKg) || weightKg < 25 || weightKg > 400) {
      setOnboardingMessage('Please enter your weight in kg (25–400).', 'error');
      return;
    }
    showOnboardingStep(2);
  } else if (onboardingStep === 2) {
    showOnboardingStep(3);
  } else if (onboardingStep === 3) {
    submitOnboarding();
  } else if (onboardingStep === 4) {
    completeOnboarding();
  }
}

function gatherOnboardingData() {
  return {
    age: parseInt(document.getElementById('onboardingAge').value),
    gender: document.getElementById('onboardingGender').value,
    heightCm: parseFloat(document.getElementById('onboardingHeightCm').value),
    weightKg: parseFloat(document.getElementById('onboardingWeightKg').value),
    activityLevel: document.getElementById('onboardingActivity').value,
    goal: document.getElementById('onboardingGoal').value,
    dietaryPreferences: Array.from(document.querySelectorAll('#onboardingDietChips .chip.selected'))
      .map(chip => chip.dataset.value),
    allergies: document.getElementById('onboardingAllergyInput').value.trim()
  };
}

function refillOnboarding(profile) {
  document.getElementById('onboardingAge').value = profile.age || '';
  document.getElementById('onboardingGender').value = profile.gender || 'female';
  document.getElementById('onboardingHeightCm').value = profile.height_cm || '';
  document.getElementById('onboardingWeightKg').value = profile.weight_kg || '';
  document.getElementById('onboardingActivity').value = profile.activity_level || 'moderate';
  document.getElementById('onboardingGoal').value = profile.goal || 'maintain';

  const prefs = (profile.dietary_preferences || '').split(',').map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('#onboardingDietChips .chip').forEach((chip) => {
    chip.classList.toggle('selected', prefs.includes(chip.dataset.value));
  });
  if (prefs.length === 0) {
    const none = document.querySelector('#onboardingDietChips .chip[data-value="No Restrictions"]');
    if (none) none.classList.add('selected');
  }

  const allergies = (profile.allergies || '').split(',').map(s => s.trim()).filter(Boolean);
  const input = document.getElementById('onboardingAllergyInput');
  input.value = allergies.join(', ');
  document.querySelectorAll('#onboardingAllergyChips .chip').forEach((chip) => {
    chip.classList.toggle('selected', allergies.includes(chip.dataset.value));
  });
}

async function submitOnboarding() {
  const data = gatherOnboardingData();
  const btn = document.getElementById('onboardingNext');
  btn.disabled = true;

  try {
    const response = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      setOnboardingMessage(result.error || 'Failed to save your profile. Please try again.', 'error');
      return;
    }

    currentProfile = result.profile;
    applyGoalToMealForm(currentProfile.goal);
    currentGoals = {
      calories: result.goals.daily_calorie_target,
      protein: result.goals.daily_protein_target,
      carbs: result.goals.daily_carbs_target,
      fats: result.goals.daily_fats_target
    };

    showTargets(result);
    showOnboardingStep(4);
  } catch (error) {
    setOnboardingMessage('Network error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function showTargets(result) {
  document.getElementById('onboardResultCalories').textContent = result.goals.daily_calorie_target.toLocaleString();
  document.getElementById('onboardResultProtein').textContent = result.goals.daily_protein_target;
  document.getElementById('onboardResultCarbs').textContent = result.goals.daily_carbs_target;
  document.getElementById('onboardResultFats').textContent = result.goals.daily_fats_target;

  document.getElementById('onboardResultBmr').textContent = result.targets.bmr.toLocaleString();
  document.getElementById('onboardResultTdee').textContent = result.targets.tdee.toLocaleString();
  document.getElementById('onboardResultGoal').textContent = GOAL_LABELS[result.profile.goal] || result.profile.goal;
}

function completeOnboarding() {
  currentUser.onboarding_completed = 1;
  localStorage.setItem('currentUser', JSON.stringify(currentUser));

  closeOnboarding();
  showApp();

  // Sync all target inputs with the freshly calculated goals
  document.getElementById('targetCalories').value = currentGoals.calories;
  document.getElementById('targetProtein').value = currentGoals.protein;
  document.getElementById('targetCarbs').value = currentGoals.carbs;
  document.getElementById('targetFats').value = currentGoals.fats;
  document.getElementById('calorieGoalInput').value = currentGoals.calories;

  localStorage.setItem('calorieGoal', currentGoals.calories);

  if (currentProfile && currentProfile.goal) {
    applyGoalToMealForm(currentProfile.goal);
  }

  loadDailyData();
  loadNutritionGoals();
  renderProfileSummary(currentProfile);
}

function applyGoalToMealForm(goal) {
  const category = GOAL_CATEGORY_MAP[goal];
  const select = document.getElementById('fitnessCategory');
  if (select && category && Array.from(select.options).some(o => o.value === category)) {
    select.value = category;
    select.disabled = true;
  }
}

async function loadProfile() {
  try {
    const response = await fetch('/api/profile', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return undefined;

    if (response.status === 404) {
      currentProfile = null;
      renderProfileSummary(null);
      return null;
    }

    if (!response.ok) {
      throw new Error(`Profile request failed with status ${response.status}`);
    }

    const data = await response.json();
    currentProfile = data.profile;
    renderProfileSummary(currentProfile);
    if (currentProfile && currentProfile.goal) {
      applyGoalToMealForm(currentProfile.goal);
    }

    // Prefill the wizard if it's currently visible (initial or edit mode)
    const onboardingScreen = document.getElementById('onboardingScreen');
    if (onboardingScreen && !onboardingScreen.classList.contains('hidden')) {
      refillOnboarding(currentProfile);
    }
    return currentProfile;
  } catch (error) {
    console.error('Failed to load profile:', error);
    return undefined;
  }
}

function renderProfileSummary(profile) {
  const container = document.getElementById('profileSummary');
  if (!container) return;

  if (!profile) {
    container.innerHTML = '<span class="ps-item">Complete onboarding to personalize your targets.</span>';
    return;
  }

  const gender = profile.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : '—';
  const prefs = profile.dietary_preferences || 'No restrictions';
  const allergies = profile.allergies || 'None listed';

  container.innerHTML = [
    psItem('Age', profile.age),
    psItem('Sex', gender),
    psItem('Height', `${profile.height_cm} cm`),
    psItem('Weight', `${profile.weight_kg} kg`),
    psItem('Activity', ACTIVITY_LABELS[profile.activity_level] || profile.activity_level),
    psItem('Goal', GOAL_LABELS[profile.goal] || profile.goal),
    psItem('Diet', prefs),
    psItem('Allergies', allergies)
  ].join('');
}

function psItem(label, value) {
  return `<span class="ps-item"><span class="ps-label">${label}</span><span class="ps-value">${escapeHtml(String(value ?? '—'))}</span></span>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ========== NUTRITION GOALS ==========

async function loadNutritionGoals() {
  try {
    const response = await fetch('/api/goals', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) return;

    const data = await response.json();
    const goals = data.goals;

    currentGoals = {
      calories: goals.daily_calorie_target,
      protein: goals.daily_protein_target,
      carbs: goals.daily_carbs_target,
      fats: goals.daily_fats_target
    };

    // Update form and input with goals
    document.getElementById('targetCalories').value = goals.daily_calorie_target;
    document.getElementById('targetProtein').value = goals.daily_protein_target;
    document.getElementById('targetCarbs').value = goals.daily_carbs_target;
    document.getElementById('targetFats').value = goals.daily_fats_target;
    document.getElementById('calorieGoalInput').value = goals.daily_calorie_target;

    // Store in localStorage for fallback
    localStorage.setItem('calorieGoal', goals.daily_calorie_target);

    // Goals may arrive after the daily totals — refresh the summary cards
    updateSummary();
  } catch (error) {
    console.error('Failed to load nutrition goals:', error);
  }
}

function openSettingsModal() {
  switchView('accounts');
  renderProfileSummary(currentProfile);
}

function closeSettingsModal() {
  if (currentView === 'accounts') switchView('log');
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
    const response = await fetch('/api/goals', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(goals)
    });

    const data = await response.json();

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      messageDiv.textContent = data.error || 'Failed to save goals';
      messageDiv.className = 'message error';
      return;
    }

    messageDiv.textContent = 'Goals saved successfully!';
    messageDiv.className = 'message success';
    currentGoals = {
      calories: goals.dailyCalorieTarget,
      protein: goals.dailyProteinTarget,
      carbs: goals.dailyCarbsTarget,
      fats: goals.dailyFatsTarget
    };
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

// ========== VIEWS / SIDEBAR NAVIGATION ==========

let currentView = 'log';

function switchView(name) {
  const view = document.getElementById('view-' + name);
  if (!view) return;
  currentView = name;

  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  view.classList.remove('hidden');

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  // Charts rendered while their view was display:none have no size yet.
  requestAnimationFrame(() => {
    const charts = [];
    if (name === 'log' && chartInstance) charts.push(chartInstance);
    if (name === 'weight' && weightChartInstance) charts.push(weightChartInstance);
    if (name === 'weekly' && weeklyChartInstance) charts.push(weeklyChartInstance);
    charts.forEach((c) => { try { c.resize(); } catch (e) { /* ignore */ } });
  });
}

// ========== EVENT LISTENERS ==========

function setupEventListeners() {
  if (appListenersInitialized) return;

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

  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

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

  // Onboarding
  setupOnboarding();
  setupInsightsControls();

  const editProfileBtn = document.getElementById('editProfileBtn');
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => {
      closeSettingsModal();
      openOnboarding(true);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeConfirmDeleteModal();
      closeMealDetails();
      closeMonthlyModal();
      closeSettingsModal();
    }
  });

  setupHistoryControls();
  appListenersInitialized = true;
}

// ========== MEAL HISTORY ==========

const HISTORY_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const historyState = {
  range: 'today',
  startDate: '',
  endDate: '',
  search: '',
  offset: 0,
  total: 0,
  hasMore: false,
  logs: [],
  loading: false,
  // Guards against a slow first page overwriting a newer filter result.
  requestId: 0
};

let searchDebounceTimer = null;

function setupHistoryControls() {
  const rangeSelect = document.getElementById('historyRange');
  const searchInput = document.getElementById('historySearch');
  const customRange = document.getElementById('historyCustomRange');
  const startInput = document.getElementById('historyStartDate');
  const endInput = document.getElementById('historyEndDate');
  const applyBtn = document.getElementById('historyApplyRange');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const closeDetailsBtn = document.getElementById('closeMealDetailsBtn');
  const detailsOverlay = document.getElementById('mealDetailsOverlay');
  const closeConfirmBtn = document.getElementById('closeConfirmDeleteBtn');
  const cancelConfirmBtn = document.getElementById('cancelConfirmDeleteBtn');
  const acceptConfirmBtn = document.getElementById('acceptConfirmDeleteBtn');
  const confirmOverlay = document.getElementById('confirmDeleteOverlay');

  // Default the custom range to the last 7 days so the inputs are never blank.
  if (startInput && endInput) {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    endInput.value = toInputDate(today);
    startInput.value = toInputDate(weekAgo);
  }

  if (rangeSelect) {
    rangeSelect.addEventListener('change', () => {
      historyState.range = rangeSelect.value;
      if (customRange) {
        customRange.classList.toggle('hidden', rangeSelect.value !== 'custom');
      }
      if (rangeSelect.value === 'custom') {
        historyState.startDate = startInput ? startInput.value : '';
        historyState.endDate = endInput ? endInput.value : '';
      }
      loadHistory({ reset: true });
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      historyState.startDate = startInput ? startInput.value : '';
      historyState.endDate = endInput ? endInput.value : '';

      if (!historyState.startDate || !historyState.endDate) {
        alert('Please pick both a start and end date.');
        return;
      }
      loadHistory({ reset: true });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        historyState.search = searchInput.value.trim();
        loadHistory({ reset: true });
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => loadHistory({ reset: false }));
  }

  if (closeDetailsBtn) closeDetailsBtn.addEventListener('click', closeMealDetails);
  if (detailsOverlay) {
    detailsOverlay.addEventListener('click', (e) => {
      if (e.target === detailsOverlay) closeMealDetails();
    });
  }

  if (closeConfirmBtn) closeConfirmBtn.addEventListener('click', closeConfirmDeleteModal);
  if (cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', closeConfirmDeleteModal);
  if (acceptConfirmBtn) acceptConfirmBtn.addEventListener('click', async () => {
    const id = pendingDeleteId;
    closeConfirmDeleteModal();
    if (id) await deleteMeal(id);
  });
  if (confirmOverlay) {
    confirmOverlay.addEventListener('click', (e) => {
      if (e.target === confirmOverlay) closeConfirmDeleteModal();
    });
  }
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildHistoryQuery(offset) {
  const params = new URLSearchParams();
  params.set('range', historyState.range);
  params.set('limit', String(HISTORY_PAGE_SIZE));
  params.set('offset', String(offset));

  if (historyState.range === 'custom') {
    params.set('startDate', historyState.startDate);
    params.set('endDate', historyState.endDate);
  }
  if (historyState.search) params.set('search', historyState.search);

  return params.toString();
}

async function loadHistory({ reset = true } = {}) {
  const offset = reset ? 0 : historyState.offset + HISTORY_PAGE_SIZE;
  const requestId = historyState.requestId + 1;
  historyState.requestId = requestId;
  // Deliberately not blocked by an in-flight request: a filter change must win
  // over a slow previous request, and the requestId check discards the stale one.
  historyState.loading = true;

  if (reset) renderHistoryLoading();

  try {
    const response = await fetch(`/api/history?${buildHistoryQuery(offset)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;
    if (requestId !== historyState.requestId) return;

    if (!response.ok) {
      renderHistoryRows([], { emptyMessage: 'Could not load meal history. Please try again.' });
      return;
    }

    const data = await response.json();

    if (requestId !== historyState.requestId) return;

    historyState.logs = reset ? data.logs : historyState.logs.concat(data.logs);
    historyState.total = data.total;
    historyState.hasMore = data.hasMore;
    historyState.offset = offset;

    renderHistoryRows(historyState.logs);
    updateHistoryFooter(data);
    updateHistorySummary(data.totals, data.total, data);
  } catch (error) {
    if (requestId !== historyState.requestId) return;
    console.error('Failed to load history:', error);
    renderHistoryRows([], { emptyMessage: 'Could not reach the server.' });
  } finally {
    if (requestId === historyState.requestId) {
      historyState.loading = false;
      setHistoryLoadingState(false);
    }
  }
}
function setHistoryLoadingState(isLoading) {
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.disabled = isLoading;
    loadMoreBtn.innerHTML = isLoading
      ? '<i class="fa-solid fa-spinner fa-spin"></i> Loading...'
      : '<i class="fa-solid fa-arrow-down"></i> Load more';
  }
}

function renderHistoryLoading() {
  const tbody = document.getElementById('historyTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center"><i class="fa-solid fa-spinner fa-spin"></i> Loading meal history...</td></tr>';
  }
}

function historyEmptyMessage() {
  if (historyState.search) {
    return historyState.range === 'all'
      ? `No meals match "${historyState.search}".`
      : `No meals match "${historyState.search}" in the selected range.`;
  }
  if (historyState.range === 'today') return "You haven't logged any meals today yet.";
  if (historyState.range === 'yesterday') return 'No meals logged yesterday.';
  return 'No meals logged in the selected date range.';
}

function renderHistoryRows(logs, { emptyMessage } = {}) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">${emptyMessage || historyEmptyMessage()}</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map((log) => {
    const score = String(log.efficiency_score || 'medium').toLowerCase();
    const hasItems = Array.isArray(log.detectedItems) && log.detectedItems.length > 0;
    const searchTerm = historyState.search;

    return `
      <tr data-id="${log.id}">
        <td>
          <span class="cell-primary">${formatLogDateTime(log.created_at)}</span>
        </td>
        <td>${escapeHtml(log.meal_type)}</td>
        <td>
          <span class="cell-primary">${highlightMatch(escapeHtml(log.meal_name), searchTerm)}</span>
          ${hasItems ? `<span class="cell-sub">${log.detectedItems.length} item${log.detectedItems.length === 1 ? '' : 's'}</span>` : ''}
        </td>
        <td><strong>${log.calories}</strong> kcal</td>
        <td>${log.protein}g</td>
        <td>${log.carbs}g</td>
        <td>${log.fats}g</td>
        <td><span class="badge ${score}">${escapeHtml(log.efficiency_score)}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" onclick="openMealDetails(${log.id})" title="View details">
              <i class="fa-solid fa-eye"></i>
            </button>
            <button class="btn-icon" onclick="startEditMeal(${log.id})" title="Edit meal">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-icon btn-icon-danger" onclick="requestDeleteMeal(${log.id}, ${JSON.stringify(escapeHtml(log.meal_name)).replace(/"/g, '&quot;')})" title="Delete">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updateHistorySummary(totals, total) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set('histTotalCal', totals?.totalCalories || 0);
  set('histTotalProtein', totals?.totalProtein || 0);
  set('histTotalCarbs', totals?.totalCarbs || 0);
  set('histTotalFats', totals?.totalFats || 0);
  set('historyCount', `${total} meal${total === 1 ? '' : 's'}`);
}

const RANGE_LABELS = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'Last 30 days',
  all: 'All time',
  custom: 'Custom range'
};

function updateHistoryFooter(data) {
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const label = document.getElementById('historyRangeLabel');

  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle('hidden', !data.hasMore);
  }

  if (label) {
    const shown = historyState.logs.length;
    const rangeText = data.range === 'custom' && data.startDate && data.endDate
      ? `${RANGE_LABELS.custom} (${data.startDate} to ${data.endDate})`
      : (RANGE_LABELS[data.range] || RANGE_LABELS.today);

    const searchText = historyState.search ? ` matching "${historyState.search}"` : '';
    label.textContent = data.total === 0
      ? `${rangeText}${searchText}`
      : `Showing ${shown} of ${data.total} meal${data.total === 1 ? '' : 's'} - ${rangeText}${searchText}`;
  }
}

function formatLogDateTime(value) {
  const date = new Date(String(value).replace(' ', 'T'));
  if (isNaN(date.getTime())) return escapeHtml(value);

  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

// ---------- ROW EDITING ----------

let editingMealId = null;

function startEditMeal(id) {
  if (editingMealId === id) return;

  if (editingMealId) cancelEditMeal(editingMealId);

  const log = historyState.logs.find((item) => item.id === id);
  if (!log) return;

  editingMealId = id;
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) {
    editingMealId = null;
    return;
  }

  row.innerHTML = `
    <td colspan="9">
      <form class="row-edit-form" onsubmit="saveMealEdit(event, ${id})">
        <div class="row-edit-grid">
          <label>
            <span>Meal name</span>
            <input type="text" name="mealName" value="${escapeAttr(log.meal_name)}" maxlength="160" required />
          </label>
          <label>
            <span>Type</span>
            <select name="mealType">
              ${['Breakfast', 'Lunch', 'Dinner', 'Snack']
                .map((type) => `<option value="${type}"${type === log.meal_type ? ' selected' : ''}>${type}</option>`)
                .join('')}
            </select>
          </label>
          <label>
            <span>Calories</span>
            <input type="number" name="calories" value="${log.calories}" min="0" max="10000" step="1" />
          </label>
          <label>
            <span>Protein (g)</span>
            <input type="number" name="protein" value="${log.protein}" min="0" max="1000" step="1" />
          </label>
          <label>
            <span>Carbs (g)</span>
            <input type="number" name="carbs" value="${log.carbs}" min="0" max="1000" step="1" />
          </label>
          <label>
            <span>Fats (g)</span>
            <input type="number" name="fats" value="${log.fats}" min="0" max="1000" step="1" />
          </label>
          <label>
            <span>Goal alignment</span>
            <select name="efficiencyScore">
              ${['High', 'Medium', 'Low']
                .map((score) => `<option value="${score}"${score.toLowerCase() === String(log.efficiency_score).toLowerCase() ? ' selected' : ''}>${score}</option>`)
                .join('')}
            </select>
          </label>
          <label class="row-edit-wide">
            <span>Advice</span>
            <input type="text" name="advice" value="${escapeAttr(log.advice || '')}" maxlength="1000" />
          </label>
        </div>
        <div class="row-edit-actions">
          <button type="submit" class="btn-save-edit"><i class="fa-solid fa-check"></i> Save</button>
          <button type="button" class="btn-ghost" onclick="cancelEditMeal(${id})">Cancel</button>
        </div>
      </form>
    </td>
  `;

  const firstInput = row.querySelector('input[name="mealName"]');
  if (firstInput) firstInput.focus();
}

function cancelEditMeal(id) {
  if (editingMealId === id) editingMealId = null;
  loadHistory({ reset: true });
}

async function saveMealEdit(event, id) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  const payload = {
    mealName: form.mealName.value.trim(),
    mealType: form.mealType.value,
    calories: Number(form.calories.value),
    protein: Number(form.protein.value),
    carbs: Number(form.carbs.value),
    fats: Number(form.fats.value),
    efficiencyScore: form.efficiencyScore.value,
    advice: form.advice.value.trim()
  };

  try {
    const response = await fetch(`/api/logs/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    if (handleUnauthorized(response)) return;

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Failed to update meal log.');
      return;
    }

    editingMealId = null;
    await loadHistory({ reset: true });
    loadDailyData();
  } catch (error) {
    alert('Error: ' + error.message);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save';
    }
  }
}

// ---------- DETAILS MODAL ----------

let detailCache = new Map();

async function openMealDetails(id) {
  const overlay = document.getElementById('mealDetailsOverlay');
  const body = document.getElementById('mealDetailsBody');
  if (!overlay || !body) return;

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  body.innerHTML = '<p class="text-center"><i class="fa-solid fa-spinner fa-spin"></i> Loading meal details...</p>';

  try {
    let log = detailCache.get(id);

    if (!log) {
      const response = await fetch(`/api/logs/${id}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      if (handleUnauthorized(response)) return;

      const data = await response.json();
      if (!response.ok) {
        body.innerHTML = `<p class="message error">${escapeHtml(data.error || 'Could not load this meal.')}</p>`;
        return;
      }
      log = data.log;
      detailCache.set(id, log);
    }

    renderMealDetails(log);
  } catch (error) {
    body.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  }
}

function renderMealDetails(log) {
  const body = document.getElementById('mealDetailsBody');
  if (!body) return;

  const title = document.getElementById('mealDetailsTitle');
  if (title) {
    title.innerHTML = `<i class="fa-solid fa-utensils"></i> ${escapeHtml(log.meal_name)}`;
  }

  const items = Array.isArray(log.detectedItems) ? log.detectedItems : [];

  body.innerHTML = `
    ${log.imageBase64
      ? `<img class="meal-details-image" src="${escapeAttr(log.imageBase64)}" alt="Photo of ${escapeAttr(log.meal_name)}" />`
      : ''}

    <div class="detail-meta">
      <span class="detail-meta-item"><i class="fa-regular fa-clock"></i> ${formatLogDateTime(log.created_at)}</span>
      <span class="detail-meta-item"><i class="fa-solid fa-tag"></i> ${escapeHtml(log.meal_type)}</span>
      <span class="detail-meta-item"><i class="fa-solid fa-dumbbell"></i> ${escapeHtml(log.category || 'N/A')}</span>
      <span class="detail-meta-item">
        <span class="badge ${String(log.efficiency_score || 'medium').toLowerCase()}">${escapeHtml(log.efficiency_score)}</span>
      </span>
    </div>

    ${log.originalInput
      ? `<div class="detail-block">
           <h4><i class="fa-regular fa-pen-to-square"></i> Your description</h4>
           <p class="detail-text">${escapeHtml(log.originalInput)}</p>
         </div>`
      : ''}

    <div class="detail-block">
      <h4><i class="fa-solid fa-bolt"></i> Nutrition</h4>
      <div class="detail-macros">
        <div class="detail-macro detail-macro-cal">
          <span class="detail-macro-value">${log.calories}</span>
          <span class="detail-macro-label">kcal</span>
        </div>
        <div class="detail-macro detail-macro-protein">
          <span class="detail-macro-value">${log.protein}g</span>
          <span class="detail-macro-label">Protein</span>
        </div>
        <div class="detail-macro detail-macro-carbs">
          <span class="detail-macro-value">${log.carbs}g</span>
          <span class="detail-macro-label">Carbs</span>
        </div>
        <div class="detail-macro detail-macro-fats">
          <span class="detail-macro-value">${log.fats}g</span>
          <span class="detail-macro-label">Fats</span>
        </div>
      </div>
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-list-ul"></i> Detected foods</h4>
      ${items.length > 0
        ? `<ul class="detail-items">
             ${items.map((item) => `
               <li>
                 <span class="detail-item-name">${escapeHtml(item.name)}</span>
                 <span class="detail-item-portion">${escapeHtml(item.estimatedPortion || '')}</span>
               </li>
             `).join('')}
           </ul>`
        : '<p class="detail-text detail-muted">No individual foods were recorded for this meal.</p>'}
    </div>

    ${log.goalAlignmentReason
      ? `<div class="detail-block">
           <h4><i class="fa-solid fa-bullseye"></i> Goal alignment</h4>
           <p class="detail-text">${escapeHtml(log.goalAlignmentReason)}</p>
         </div>`
      : ''}

    ${log.advice
      ? `<div class="detail-block">
           <h4><i class="fa-solid fa-lightbulb"></i> Advice</h4>
           <p class="detail-text">${escapeHtml(log.advice)}</p>
         </div>`
      : ''}

    <div class="detail-actions">
      <button type="button" class="btn-save-edit" onclick="closeMealDetails(); startEditMeal(${log.id})">
        <i class="fa-solid fa-pen"></i> Edit meal
      </button>
      <button type="button" class="btn-ghost" onclick="closeMealDetails()">Close</button>
    </div>
  `;
}

function closeMealDetails() {
  const overlay = document.getElementById('mealDetailsOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  if (document.getElementById('confirmDeleteOverlay')?.classList.contains('hidden')) {
    document.body.style.overflow = '';
  }
}

// ---------- DELETE (with confirm modal) ----------

let pendingDeleteId = null;

function requestDeleteMeal(id, mealName) {
  pendingDeleteId = id;
  const overlay = document.getElementById('confirmDeleteOverlay');
  const text = document.getElementById('confirmDeleteText');
  if (text) {
    text.textContent = mealName
      ? `Delete "${mealName}"? This cannot be undone.`
      : 'Delete this meal log? This cannot be undone.';
  }
  if (overlay) {
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeConfirmDeleteModal() {
  const overlay = document.getElementById('confirmDeleteOverlay');
  pendingDeleteId = null;
  if (!overlay) return;
  overlay.classList.add('hidden');
  if (document.getElementById('mealDetailsOverlay')?.classList.contains('hidden')) {
    document.body.style.overflow = '';
  }
}

// ---------- SHARED HTML ESCAPING ----------
// escapeHtml/escapeAttr are defined once, near the top of this file.

function escapeAttr(value) {
  return escapeHtml(value);
}

// Wrap the search term in <mark> after the surrounding text has been escaped.
function highlightMatch(escapedText, term) {
  if (!term) return escapedText;

  const needle = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapedText.replace(new RegExp(needle, 'gi'), (match) => `<mark>${match}</mark>`);
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

  try {
    const requestBody = { mealType, category, textInput, imageBase64: currentBase64Image };
    let response;
    let data;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      submitBtn.innerHTML = attempt === 1
        ? '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...'
        : `<i class="fa-solid fa-clock fa-spin"></i> AI is busy, retrying (${attempt}/${maxAttempts})...`;

      response = await fetch('/api/analyze-meal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(requestBody)
      });
      data = await response.json();

      if (response.status !== 503 || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, (data.retryAfterSeconds || 5) * 1000));
    }

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      alert(data.error || 'Failed to analyze meal. Please try again.');
      return;
    }

    displayAnalysisResult(data.data);
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
    const response = await fetch('/api/daily-history', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

    if (!response.ok) return;

    const data = await response.json();
    updateDailyDisplay(data.totals, data.logs);
    loadHistory({ reset: true });
    loadInsights();
  } catch (error) {
    console.error('Failed to load daily data:', error);
  }
}

function updateDailyDisplay(totals, logs) {
  lastTotals = totals;

  document.getElementById('calorieCountText').textContent = `${totals.totalCalories || 0} / ${currentGoals.calories} kcal`;
  document.getElementById('totalProtein').textContent = (totals.totalProtein || 0) + 'g';
  document.getElementById('totalCarbs').textContent = (totals.totalCarbs || 0) + 'g';
  document.getElementById('totalFats').textContent = (totals.totalFats || 0) + 'g';

  const progressPercent = Math.min(((totals.totalCalories || 0) / currentGoals.calories) * 100, 100);
  document.getElementById('calorieProgressBar').style.width = progressPercent + '%';

  updateSummary();
  updateMacroChart(totals);
}

function updateSummary() {
  const calorieGoal = parseInt(document.getElementById('calorieGoalInput').value) || currentGoals.calories;
  const totals = lastTotals || { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFats: 0 };

  const pcts = {
    calories: setStatCard('Calories', totals.totalCalories || 0, calorieGoal, ' kcal'),
    protein: setStatCard('Protein', totals.totalProtein || 0, currentGoals.protein, 'g'),
    carbs: setStatCard('Carbs', totals.totalCarbs || 0, currentGoals.carbs, 'g'),
    fats: setStatCard('Fats', totals.totalFats || 0, currentGoals.fats, 'g')
  };

  updateMotivational(pcts);
}

function setStatCard(metric, consumed, goal, unit) {
  const label = metric.charAt(0).toUpperCase() + metric.slice(1);
  const pct = goal > 0 ? (consumed / goal) * 100 : 0;
  const clamped = Math.min(pct, 100);

  document.getElementById(`pct${label}`).textContent = Math.round(pct) + '%';
  document.getElementById(`value${label}`).textContent = Math.round(consumed);
  document.getElementById(`goal${label}`).textContent = goal;

  const ring = document.getElementById(`ring${label}`);
  if (ring) {
    ring.style.strokeDasharray = RING_CIRCUMFERENCE;
    ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - clamped / 100);
  }

  const bar = document.getElementById(`bar${label}`);
  if (bar) bar.style.width = clamped + '%';

  const remainingEl = document.getElementById(`remaining${label}`);
  const remaining = goal - consumed;
  if (remaining > 0) {
    remainingEl.classList.remove('over');
    remainingEl.innerHTML = `Remaining today: <strong>${Math.round(remaining)}${unit}</strong>`;
  } else {
    remainingEl.classList.add('over');
    remainingEl.innerHTML = `<strong>${Math.round(-remaining)}${unit}</strong> over target`;
  }

  return pct;
}

function updateMotivational(pcts) {
  const statusEl = document.getElementById('motivationalStatus');
  const textEl = document.getElementById('motivationalText');
  if (!statusEl || !textEl) return;

  statusEl.classList.remove('done', 'ahead', 'mid', 'low', 'start');
  const totalLogged = lastTotals ? (lastTotals.totalCalories || 0) : 0;
  const allDone = Object.values(pcts).every(p => p >= 100);

  if (totalLogged === 0) {
    textEl.textContent = 'Log your first meal to start today\'s tracking.';
    statusEl.classList.add('start');
  } else if (allDone) {
    textEl.textContent = 'All daily goals reached — outstanding work today.';
    statusEl.classList.add('done');
  } else {
    const entries = [['Calories', pcts.calories], ['Protein', pcts.protein], ['Carbs', pcts.carbs], ['Fats', pcts.fats]];
    const lowest = entries.reduce((a, b) => a[1] <= b[1] ? a : b);
    textEl.textContent = `${lowest[0]} goal: ${Math.round(lowest[1])}% complete.`;
    statusEl.classList.add(lowest[1] >= 75 ? 'done' : lowest[1] >= 40 ? 'mid' : 'low');
  }
}

function updateGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = currentUser && currentUser.username ? ', ' + currentUser.username : '';
  const greetingEl = document.getElementById('greetingText');
  if (greetingEl) greetingEl.textContent = part + name;

  const dateEl = document.getElementById('summaryDateLine');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }
}

function updateMacroChart(totals) {
  const ctx = document.getElementById('macroChart')?.getContext('2d');
  if (!ctx) return;

  if (chartInstance) chartInstance.destroy();

  const totalLogged = (totals.totalProtein || 0) + (totals.totalCarbs || 0) + (totals.totalFats || 0);
  const emptyEl = document.getElementById('macroChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', totalLogged > 0);

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
  renderHistoryRows(logs);
}

async function deleteMeal(id) {
  try {
    const response = await fetch(`/api/logs/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

    if (response.ok) {
      detailCache.delete(id);
      if (editingMealId === id) editingMealId = null;
      await loadHistory({ reset: true });
      loadDailyData();
    } else {
      const data = await response.json().catch(() => ({}));
      alert(data.error || 'Failed to delete meal log');
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

async function handleClearAll() {
  if (!confirm('Delete ALL meal logs? This cannot be undone.')) return;

  try {
    const response = await fetch('/api/daily-history', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const data = await response.json();
    if (response.ok) {
      alert(`Deleted ${data.deletedCount} meal logs`);
      detailCache.clear();
      editingMealId = null;
      await loadHistory({ reset: true });
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
    const response = await fetch('/api/monthly-history', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

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

  if (monthlyChartInstance) monthlyChartInstance.destroy();

  const labels = data.map(d => new Date(d.log_date).toLocaleDateString());
  const calories = data.map(d => d.totalCalories);

  monthlyChartInstance = new Chart(ctx, {
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

// ========== INSIGHTS & PROGRESS ==========

const insightsState = { days: 30, data: null, loading: false, pending: false };

let weightChartInstance = null;
let weeklyChartInstance = null;

const CHART_TEXT_COLOR = '#eef1f8';
const CHART_GRID_COLOR = 'rgba(255, 255, 255, 0.08)';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function parseLocalDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function formatShortDate(dateString) {
  const date = parseLocalDate(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatSigned(value, suffix = '') {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}${suffix}`;
}

const toLocalDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function setupInsightsControls() {
  const rangeSwitch = document.getElementById('insightsRangeSwitch');
  const weightForm = document.getElementById('weightForm');
  const applyTargetsBtn = document.getElementById('applySuggestedTargets');
  const insightsBtn = document.getElementById('insightsBtn');

  if (rangeSwitch) {
    rangeSwitch.addEventListener('click', (e) => {
      const btn = e.target.closest('.range-btn');
      if (!btn || btn.classList.contains('is-active')) return;

      rangeSwitch.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      insightsState.days = parseInt(btn.dataset.days, 10) || 30;
      loadInsights();
    });
  }

  if (weightForm) weightForm.addEventListener('submit', handleWeightSubmit);
  if (applyTargetsBtn) applyTargetsBtn.addEventListener('click', applySuggestedTargets);

  if (insightsBtn) {
    insightsBtn.addEventListener('click', () => {
      document.getElementById('insightsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

async function loadInsights() {
  // A refresh requested mid-flight (a meal was just logged) must not be dropped,
  // or the screen keeps showing numbers from before it.
  if (insightsState.loading) {
    insightsState.pending = true;
    return;
  }
  insightsState.loading = true;

  try {
    const response = await fetch(`/api/insights?days=${insightsState.days}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      setText('insightsRangeSummary', 'Could not load insights. Please try again.');
      return;
    }

    const data = await response.json();
    insightsState.data = data.insights;
    renderInsights(data.insights);
  } catch (error) {
    console.error('Failed to load insights:', error);
    setText('insightsRangeSummary', 'Could not reach the server.');
  } finally {
    insightsState.loading = false;

    if (insightsState.pending) {
      insightsState.pending = false;
      loadInsights();
    }
  }
}

function renderInsights(insights) {
  const { range } = insights;

  setText(
    'insightsRangeSummary',
    `${range.loggedDays} of ${range.days} days logged · ${range.mealsAnalysed} meals analysed`
  );

  renderWeeklyCalories(insights.weeklyCalories);
  renderMacroConsistency(insights.macroConsistency);
  renderGoalCompletion(insights.goalCompletion);
  renderStreaks(insights.streaks);
  renderMostCommonMeals(insights.mostCommonMeals);
  renderMealTiming(insights.mealTiming);
  renderWeightProgress(insights.weight);
  renderWeeklyChart(insights.streaks.weeks);
}

// ---------- Weekly calorie average ----------

function renderWeeklyCalories(weekly) {
  setText('insWeeklyAvg', weekly.loggedDays > 0 ? weekly.averageCalories.toLocaleString() : '—');

  const bar = document.getElementById('insWeeklyBar');
  if (bar) {
    const pct = weekly.target > 0 ? (weekly.averageCalories / weekly.target) * 100 : 0;
    bar.style.width = Math.min(pct, 100) + '%';
    bar.classList.toggle('over', weekly.status === 'over');
    bar.classList.toggle('under', weekly.status === 'under');
  }

  const note = document.getElementById('insWeeklyNote');
  if (note) {
    if (weekly.loggedDays === 0) {
      note.textContent = 'No meals logged in the last 7 days yet.';
    } else {
      // Inside the +/-10% band the average is still "under" or "over", so the
      // sign of the delta is what the sentence has to follow.
      const direction = weekly.deltaCalories > 0 ? 'over' : 'under';
      const delta = `${Math.abs(weekly.deltaCalories).toLocaleString()} kcal/day ${direction}`;
      note.innerHTML = `<strong>${weekly.onTargetDays}/${weekly.loggedDays}</strong> days on target · ${escapeHtml(delta)} your goal`;
    }
  }

  const strip = document.getElementById('insWeekStrip');
  if (!strip) return;

  const today = toLocalDateString(new Date());

  strip.innerHTML = weekly.days.map((day) => {
    const classes = ['has-data', day.onTarget ? 'on-target' : '', day.date === today ? 'today' : '']
      .filter(Boolean)
      .join(' ');

    const title = `${formatShortDate(day.date)} · ${day.mealCount > 0
      ? day.calories.toLocaleString() + ' kcal'
      : 'no meals logged'}`;

    return `<li class="${classes}" title="${escapeAttr(title)}">
      ${escapeHtml(parseLocalDate(day.date).toLocaleDateString(undefined, { weekday: 'narrow' }))}
      <i></i>
    </li>`;
  }).join('');
}

// ---------- Macro consistency ----------

function renderMacroConsistency(consistency) {
  setText('insConsistencyScore', consistency.daysAnalysed > 0 ? consistency.score : '—');
  setText('insConsistencyGrade', consistency.grade);

  const list = document.getElementById('insMacroConsistency');
  if (!list) return;

  if (consistency.daysAnalysed === 0) {
    list.innerHTML = '<li class="insight-note">Log a few days of meals to score your consistency.</li>';
    return;
  }

  list.innerHTML = consistency.macros.map((macro) => `
    <li class="consistency-row">
      <div class="row-top">
        <span class="row-label">${escapeHtml(macro.label)}</span>
        <span class="row-value">${macro.average}g / ${macro.target}g · score ${macro.score}</span>
      </div>
      <div class="insight-bar">
        <div class="insight-bar-fill ${escapeAttr(macro.key)}" style="width: ${macro.score}%"></div>
      </div>
    </li>
  `).join('');
}

// ---------- Goal completion ----------

function renderGoalCompletion(completion) {
  setText('insGoalPct', completion.loggedDays > 0 ? completion.percentage : '—');

  const list = document.getElementById('insGoalMetrics');
  if (list) {
    if (completion.loggedDays === 0) {
      list.innerHTML = '<li class="insight-note">No meals logged in this range yet.</li>';
    } else {
      list.innerHTML = completion.perMetric.map((metric) => `
        <li class="goal-meter-row">
          <div class="row-top">
            <span class="row-label">${escapeHtml(metric.label)}</span>
            <span class="row-value">${metric.percentage}%</span>
          </div>
          <div class="insight-bar">
            <div class="insight-bar-fill ${escapeAttr(metric.key)}" style="width: ${metric.percentage}%"></div>
          </div>
        </li>
      `).join('');
    }
  }

  const note = document.getElementById('insGoalNote');
  if (note) {
    note.innerHTML = completion.loggedDays === 0
      ? 'Log meals to track how close you land to your targets.'
      : `<strong>${completion.onTargetDays}/${completion.loggedDays}</strong> days within 10% of your calorie goal · protein target hit on <strong>${completion.proteinTargetDays}</strong>`;
  }
}

// ---------- Streaks ----------

function renderStreaks(streaks) {
  setText('insLogStreak', streaks.currentLogStreak);
  setText('insGoalStreak', streaks.currentGoalStreak);
  setText('insWeekStreak', streaks.weekStreak);
  setText('insLongestStreak', streaks.longestLogStreak);

  const note = document.getElementById('insStreakNote');
  if (!note) return;

  const weeks = streaks.weeks.length;
  note.innerHTML = `Best goal streak: <strong>${streaks.longestGoalStreak}</strong> days · <strong>${streaks.weeksOnTarget}</strong> of ${weeks} week${weeks === 1 ? '' : 's'} hit a goal day`;
}

// ---------- Most common meals ----------

function renderMostCommonMeals(meals) {
  const list = document.getElementById('insCommonMeals');
  if (!list) return;

  if (meals.items.length === 0) {
    list.innerHTML = '<li class="insight-note">No meals logged in this range yet.</li>';
    return;
  }

  list.innerHTML = meals.items.map((meal) => `
    <li class="common-meal">
      <span class="common-meal-body">
        <span class="common-meal-name" title="${escapeAttr(meal.name)}">${escapeHtml(meal.name)}</span>
        <span class="common-meal-meta">
          ${escapeHtml(meal.topType || 'Meal')} · ${meal.averageCalories} kcal avg · last ${escapeHtml(formatShortDate(meal.lastLogged))}
        </span>
      </span>
      <span class="common-meal-count">${meal.times}&times;</span>
    </li>
  `).join('');
}

// ---------- Meal timing ----------

function renderMealTiming(timing) {
  const list = document.getElementById('insMealTiming');
  if (list) {
    if (timing.byType.length === 0) {
      list.innerHTML = '<li class="insight-note">No meals logged in this range yet.</li>';
    } else {
      list.innerHTML = timing.byType.map((entry) => `
        <li class="timing-row ${escapeAttr(entry.type.toLowerCase())}">
          <span class="timing-type">${escapeHtml(entry.type)}</span>
          <span class="timing-time">${escapeHtml(entry.averageTime)}</span>
          <span class="timing-detail">&plusmn;${entry.spreadMinutes} min · ${entry.count} logged</span>
        </li>
      `).join('');
    }
  }

  const note = document.getElementById('insTimingNote');
  if (!note || timing.mealsAnalysed === 0) {
    if (note) note.textContent = 'Log meals to see your eating rhythm.';
    return;
  }

  const parts = [
    `<strong>${timing.mealsPerDay}</strong> meals/day`,
    `first <strong>${escapeHtml(timing.averageFirstMeal)}</strong>, last <strong>${escapeHtml(timing.averageLastMeal)}</strong>`
  ];

  if (timing.eatingWindowHours !== null) {
    parts.push(`eating window <strong>${timing.eatingWindowHours}h</strong>`);
  }
  if (timing.lateNight.meals > 0) {
    parts.push(`<strong>${timing.lateNight.mealsPct}%</strong> logged after 21:00`);
  }

  note.innerHTML = parts.join(' · ');
}

// ---------- Weight progress ----------

function weightStat(label, value, tone = '') {
  return `<span class="weight-stat">
    <span>${escapeHtml(label)}</span>
    <strong${tone ? ` class="${tone}"` : ''}>${escapeHtml(value)}</strong>
  </span>`;
}

function renderWeightProgress(weight) {
  const stats = document.getElementById('insWeightStats');
  const note = document.getElementById('insWeightNote');
  const targetsBox = document.getElementById('insWeightTargets');
  const targetsText = document.getElementById('insWeightTargetsText');

  if (!weight.hasEntries) {
    if (stats) {
      stats.innerHTML = `<span class="insight-note">No weight check-ins yet — log your first one to start the trend.</span>`;
    }
    if (note) note.textContent = '';
    if (targetsBox) targetsBox.classList.add('hidden');

    // Returning users already have a weight on their profile, so start the
    // first check-in from that number instead of an empty box.
    const weightInput = document.getElementById('weightInput');
    if (weightInput && !weightInput.value && weight.profileWeight) {
      weightInput.value = weight.profileWeight;
    }

    renderWeightChart([]);
    return;
  }

  if (stats) {
    const trendLabel = { down: 'Trending down', up: 'Trending up', steady: 'Holding steady' }[weight.trend];

    stats.innerHTML = [
      weightStat('Current', `${weight.latestWeight} kg`),
      weightStat('Total change', formatSigned(weight.changeKg, ' kg'), weight.trend),
      weightStat('Per week', weight.weeklyRate === null ? '—' : formatSigned(weight.weeklyRate, ' kg')),
      weightStat('Range', `${weight.lowestWeight} – ${weight.highestWeight} kg`),
      weightStat('BMI', weight.bmi === null ? '—' : `${weight.bmi} · ${weight.bmiCategory}`)
    ].join('');
  }

  if (note) {
    const goalSuffix = weight.onTrack === null
      ? ''
      : weight.onTrack ? ' — moving the right way for your goal.' : ' — not moving the way your goal wants yet.';
    note.textContent = `${trendLabel} since ${formatShortDate(weight.firstDate)} over ${weight.entries} check-in${weight.entries === 1 ? '' : 's'}.${goalSuffix}`;
  }

  // Offer the last known number so a daily check-in is a one-field edit.
  const weightInput = document.getElementById('weightInput');
  if (weightInput && !weightInput.value) weightInput.value = weight.latestWeight;

  if (targetsBox && targetsText) {
    const suggested = weight.targetsOutdated ? weight.suggestedTargets : null;

    if (suggested) {
      targetsText.textContent = `Targets still reflect your onboarding weight. Recalculated for ${weight.latestWeight} kg: ${suggested.dailyCalorieTarget} kcal, ${suggested.dailyProteinTarget}g protein.`;
      targetsBox.classList.remove('hidden');
    } else {
      targetsBox.classList.add('hidden');
    }
  }

  renderWeightChart(weight.points);
}

function renderWeightChart(points) {
  const ctx = document.getElementById('weightChart')?.getContext('2d');
  if (!ctx) return;

  if (weightChartInstance) {
    weightChartInstance.destroy();
    weightChartInstance = null;
  }

  const emptyEl = document.getElementById('weightChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', points.length > 0);

  if (points.length === 0) return;

  const labels = points.map((point) => formatShortDate(point.date));

  weightChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Weight (kg)',
          data: points.map((point) => point.weight),
          borderColor: '#4fd1e6',
          backgroundColor: 'rgba(79, 209, 230, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: points.length > 30 ? 0 : 3,
          pointBackgroundColor: '#4fd1e6'
        },
        {
          label: '7-day average',
          data: points.map((point) => point.average),
          borderColor: '#ffc65c',
          borderDash: [4, 4],
          fill: false,
          tension: 0.35,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_TEXT_COLOR, font: { size: 11 } } }
      },
      scales: {
        y: {
          ticks: { color: CHART_TEXT_COLOR },
          grid: { color: CHART_GRID_COLOR }
        },
        x: {
          ticks: { color: CHART_TEXT_COLOR, maxTicksLimit: 8 },
          grid: { color: CHART_GRID_COLOR }
        }
      }
    }
  });
}

// ---------- Week by week ----------

function renderWeeklyChart(weeks) {
  const ctx = document.getElementById('weeklyChart')?.getContext('2d');
  if (!ctx) return;

  if (weeklyChartInstance) {
    weeklyChartInstance.destroy();
    weeklyChartInstance = null;
  }

  const emptyEl = document.getElementById('weeklyChartEmpty');
  const hasData = weeks.some((week) => week.loggedDays > 0);
  if (emptyEl) emptyEl.classList.toggle('hidden', hasData);
  if (!hasData) return;

  const labels = weeks.map((week) => `w/c ${formatShortDate(week.weekStart)}`);

  weeklyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Avg kcal/day',
          data: weeks.map((week) => week.averageCalories),
          backgroundColor: 'rgba(255, 138, 92, 0.55)',
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: 'On-target days',
          data: weeks.map((week) => week.onTargetDays),
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          tension: 0.3,
          pointRadius: 3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_TEXT_COLOR, font: { size: 11 } } }
      },
      scales: {
        y: {
          position: 'left',
          ticks: { color: CHART_TEXT_COLOR },
          grid: { color: CHART_GRID_COLOR }
        },
        y1: {
          position: 'right',
          min: 0,
          max: 7,
          ticks: { color: CHART_TEXT_COLOR, stepSize: 1, precision: 0 },
          grid: { drawOnChartArea: false }
        },
        x: {
          ticks: { color: CHART_TEXT_COLOR, maxTicksLimit: 8 },
          grid: { color: CHART_GRID_COLOR }
        }
      }
    }
  });

  const note = document.getElementById('insWeekByWeekNote');
  if (note) {
    const scored = weeks.filter((week) => week.loggedDays > 0);
    const best = scored.reduce((top, week) => (week.averageCalories > top.averageCalories ? week : top), scored[0]);
    const bestWeek = scored.length > 1
      ? ` Best week: w/c ${formatShortDate(best.weekStart)} at ${Math.round(best.averageCalories).toLocaleString()} kcal/day.`
      : '';
    note.textContent = `Each bar is that week's average per logged day; the line counts days on target.${bestWeek}`;
  }
}

// ---------- Weight logging ----------

function setWeightMessage(text, type) {
  const message = document.getElementById('weightMessage');
  if (!message) return;
  message.textContent = text;
  message.className = type ? `message ${type}` : 'message';
}

async function handleWeightSubmit(e) {
  e.preventDefault();

  const input = document.getElementById('weightInput');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const weightKg = parseFloat(input.value);

  if (Number.isNaN(weightKg) || weightKg < 25 || weightKg > 400) {
    setWeightMessage('Enter a weight between 25 and 400 kg.', 'error');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await fetch('/api/weight', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ weightKg })
    });

    const data = await response.json();

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      setWeightMessage(data.error || 'Failed to log your weight.', 'error');
      return;
    }

    setWeightMessage(`Logged ${data.log.weightKg} kg for today.`, 'success');
    input.value = '';
    await loadInsights();
  } catch (error) {
    setWeightMessage('Error: ' + error.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Apply the targets the insights payload recalculated from the latest weight.
 * Deliberately confirmed by the user - targets are personal, so they are never
 * overwritten silently.
 */
async function applySuggestedTargets() {
  const suggested = insightsState.data?.weight?.suggestedTargets;
  if (!suggested) return;

  const confirmed = confirm(
    `Update your daily targets to ${suggested.dailyCalorieTarget} kcal, ${suggested.dailyProteinTarget}g protein, ` +
    `${suggested.dailyCarbsTarget}g carbs and ${suggested.dailyFatsTarget}g fats?`
  );
  if (!confirmed) return;

  try {
    const response = await fetch('/api/goals', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        dailyCalorieTarget: suggested.dailyCalorieTarget,
        dailyProteinTarget: suggested.dailyProteinTarget,
        dailyCarbsTarget: suggested.dailyCarbsTarget,
        dailyFatsTarget: suggested.dailyFatsTarget
      })
    });

    const data = await response.json();

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      alert(data.error || 'Failed to update targets.');
      return;
    }

    await loadNutritionGoals();
    await loadDailyData();
    setWeightMessage('Targets updated from your latest weight.', 'success');
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

// ========== INLINE HANDLER EXPORTS ==========
// The history table and modals use inline onclick/onsubmit attributes, so these
// must be reachable from the global scope.

Object.assign(window, {
  openMealDetails,
  closeMealDetails,
  startEditMeal,
  cancelEditMeal,
  saveMealEdit,
  requestDeleteMeal,
  closeConfirmDeleteModal,
  deleteMeal,
  loadHistory
});