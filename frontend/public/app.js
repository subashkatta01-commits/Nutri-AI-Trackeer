/**
 * NutriAI Tracker - Frontend Application
 * Includes authentication, meal logging, and nutrition tracking
 */

let chartInstance = null;
let currentBase64Image = null;
let currentUser = null;
let authToken = null;

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

function checkAuthentication() {
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
    loadProfile();
    if (!(currentUser.onboarding_completed || 0)) {
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
    const response = await fetch('/api/auth/login', {
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
    loadProfile();
    if (!(currentUser.onboarding_completed || 0)) {
      openOnboarding(false);
    }
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
    loadProfile();
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
  }
}

async function loadProfile() {
  try {
    const response = await fetch('/api/profile', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

    const data = await response.json();
    if (response.ok) {
      currentProfile = data.profile;
      renderProfileSummary(currentProfile);

      // Prefill the wizard if it's currently visible (initial or edit mode)
      const onboardingScreen = document.getElementById('onboardingScreen');
      if (onboardingScreen && !onboardingScreen.classList.contains('hidden')) {
        refillOnboarding(currentProfile);
      }
    } else {
      renderProfileSummary(null);
    }
  } catch (error) {
    console.error('Failed to load profile:', error);
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
  document.getElementById('settingsModalOverlay').classList.remove('hidden');
  renderProfileSummary(currentProfile);
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

  // Onboarding
  setupOnboarding();

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