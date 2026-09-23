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
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    updateHistoryTable(data.logs);
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
    const response = await fetch(`/api/logs/${id}`, {
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
    const response = await fetch('/api/daily-history', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const data = await response.json();
    if (response.ok) {
      alert(`Deleted ${data.deletedCount} meal logs`);
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