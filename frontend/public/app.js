/**
 * NutriAI Tracker - Frontend Application
 * Includes authentication, meal logging, and nutrition tracking
 */

let chartInstance = null;
let monthlyChartInstance = null;
let currentBase64Image = null;
let currentUser = null;
let authToken = null;
let pendingVerificationEmail = sessionStorage.getItem('pendingVerificationEmail') || '';
let authListenersInitialized = false;
let appListenersInitialized = false;
let loginInProgress = false;
let signupInProgress = false;
let resendCooldownTimer = null;

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
  applyStoredTheme();
  applyStoredSidebarMode();
  checkAuthentication();
});

function applyStoredTheme() {
  const theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (icon) icon.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
}

function applyStoredSidebarMode() {
  if (localStorage.getItem('compactSidebar') === '1') {
    document.querySelector('.app-shell')?.classList.add('compact-sidebar');
  }
}

function toggleCompactSidebar() {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  shell.classList.toggle('compact-sidebar');
  localStorage.setItem('compactSidebar', shell.classList.contains('compact-sidebar') ? '1' : '0');
}

// ========== AUTHENTICATION ==========

async function checkAuthentication() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('currentUser');
  
  if (token && user && token.split('.').length === 3) {
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
    if (token || user) clearAuthentication();
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
  if (pendingVerificationEmail) {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('signupForm').classList.add('hidden');
    document.getElementById('verificationEmail').textContent = pendingVerificationEmail;
    document.getElementById('verificationForm').classList.remove('hidden');
  }
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  updateGreeting();
}

function setVerificationMessage(text, type = 'error') {
  const el = document.getElementById('verificationMessage');
  if (!el) return;
  el.textContent = text || '';
  if (!text) {
    el.className = 'message hidden';
    return;
  }
  if (type === 'success') {
    el.className = 'message success';
  } else if (type === 'info') {
    el.className = 'message';
  } else {
    el.className = 'error-message';
  }
}

function startResendCooldown(seconds = 60) {
  const button = document.getElementById('resendVerificationBtn');
  if (!button) return;
  button.disabled = true;
  let remaining = seconds;
  button.textContent = `Resend code (${remaining}s)`;
  if (resendCooldownTimer) clearInterval(resendCooldownTimer);
  resendCooldownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
      button.disabled = false;
      button.textContent = 'Resend code';
    } else {
      button.textContent = `Resend code (${remaining}s)`;
    }
  }, 1000);
}

function stopResendCooldown() {
  if (resendCooldownTimer) {
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = null;
  }
  const button = document.getElementById('resendVerificationBtn');
  if (button) {
    button.disabled = false;
    button.textContent = 'Resend code';
  }
}

function setupAuthListeners() {
  if (authListenersInitialized) return;

  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const verificationForm = document.getElementById('verificationForm');
  const toggleToSignup = document.getElementById('toggleToSignup');
  const toggleToLogin = document.getElementById('toggleToLogin');
  const resendVerificationBtn = document.getElementById('resendVerificationBtn');
  const backToSignup = document.getElementById('backToSignup');
  const verificationToLogin = document.getElementById('verificationToLogin');

  loginForm.addEventListener('submit', handleLogin);
  signupForm.addEventListener('submit', handleSignup);
  verificationForm.addEventListener('submit', handleEmailVerification);
  resendVerificationBtn.addEventListener('click', handleResendVerification);
  backToSignup.addEventListener('click', (event) => {
    event.preventDefault();
    pendingVerificationEmail = '';
    sessionStorage.removeItem('pendingVerificationEmail');
    stopResendCooldown();
    verificationForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    setVerificationMessage('');
  });
  if (verificationToLogin) {
    verificationToLogin.addEventListener('click', (event) => {
      event.preventDefault();
      pendingVerificationEmail = '';
      sessionStorage.removeItem('pendingVerificationEmail');
      stopResendCooldown();
      verificationForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      setVerificationMessage('');
    });
  }
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
  if (signupInProgress) return;

  const submitButton = document.querySelector('#signupForm button[type="submit"]');
  const submitLabel = submitButton?.textContent;
  const username = document.getElementById('signupUsername').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errorDiv = document.getElementById('signupError');
  errorDiv.textContent = '';

  signupInProgress = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Sending verification code...';
  }

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

    if (data.verificationRequired) {
      pendingVerificationEmail = data.email || email.toLowerCase();
      sessionStorage.setItem('pendingVerificationEmail', pendingVerificationEmail);
      document.getElementById('verificationEmail').textContent = pendingVerificationEmail;
      document.getElementById('verificationCode').value = data.devCode || '';
      setVerificationMessage(data.message || 'Check your email for the verification code.', 'success');
      document.getElementById('signupForm').classList.add('hidden');
      document.getElementById('verificationForm').classList.remove('hidden');
      startResendCooldown(60);
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
  } finally {
    signupInProgress = false;
    if (submitButton) {
      submitButton.disabled = false;
      if (submitLabel !== undefined) submitButton.textContent = submitLabel;
    }
  }
}

async function handleEmailVerification(event) {
  event.preventDefault();
  const codeInput = document.getElementById('verificationCode');
  const submitButton = document.getElementById('verifyEmailBtn');
  const submitLabel = submitButton?.textContent;
  const code = codeInput.value.trim();

  if (!/^\d{6}$/.test(code)) {
    setVerificationMessage('Enter the six-digit code from your email.', 'error');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Verifying code...';
  setVerificationMessage('Verifying code...', 'info');

  try {
    const response = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingVerificationEmail, code })
    });
    const data = await response.json();
    if (!response.ok) {
      setVerificationMessage(data.error || 'Could not verify this code.', 'error');
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    pendingVerificationEmail = '';
    sessionStorage.removeItem('pendingVerificationEmail');
    stopResendCooldown();
    showApp();
    setupEventListeners();
    loadDailyData();
    loadNutritionGoals();
    setupAutoMealType();
    await loadProfile();
    openOnboarding(false);
    setVerificationMessage('');
  } catch (error) {
    setVerificationMessage('Could not connect to the server: ' + error.message, 'error');
  } finally {
    submitButton.disabled = false;
    if (submitLabel !== undefined) submitButton.textContent = submitLabel;
  }
}

async function handleResendVerification() {
  const button = document.getElementById('resendVerificationBtn');
  if (!pendingVerificationEmail) {
    setVerificationMessage('Start signup again to request a new verification code.', 'error');
    return;
  }

  button.disabled = true;
  setVerificationMessage('Requesting new code...', 'info');
  try {
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingVerificationEmail })
    });
    const data = await response.json();
    if (response.ok) {
      setVerificationMessage(data.message || 'A new verification code has been sent.', 'success');
      if (data.devCode) {
        document.getElementById('verificationCode').value = data.devCode;
      }
      startResendCooldown(60);
    } else {
      setVerificationMessage(data.error || 'Could not resend the code.', 'error');
      button.disabled = false;
    }
  } catch (error) {
    setVerificationMessage('Could not connect to the server: ' + error.message, 'error');
    button.disabled = false;
  }
}

function handleLogout() {
  clearAuthentication();
  location.reload();
}

function showToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconClass = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
  toast.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }
  return toast;
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
      showToast(data.error || 'Failed to save goals', 'error');
      return;
    }

    messageDiv.textContent = 'Goals saved successfully!';
    messageDiv.className = 'message success';
    showToast('Goals saved successfully!', 'success');
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

// ========== PROFILE SETTINGS: CHANGE PASSWORD ==========

async function handleChangePassword(e) {
  e.preventDefault();
  const messageDiv = document.getElementById('changePasswordMessage');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  messageDiv.textContent = '';
  messageDiv.className = 'message';

  const currentPassword = document.getElementById('cpCurrentPassword').value;
  const newPassword = document.getElementById('cpNewPassword').value;
  const confirmPassword = document.getElementById('cpConfirmPassword').value;

  if (newPassword !== confirmPassword) {
    messageDiv.textContent = 'New password and confirmation do not match.';
    messageDiv.className = 'message error';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Changing...';
  }

  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await response.json();

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      messageDiv.textContent = data.error || 'Failed to change password.';
      messageDiv.className = 'message error';
      showToast(data.error || 'Failed to change password.', 'error');
      return;
    }

    messageDiv.textContent = 'Password changed successfully!';
    messageDiv.className = 'message success';
    showToast('Password changed successfully.', 'success');
    document.getElementById('changePasswordForm').reset();
    setTimeout(() => { messageDiv.textContent = ''; }, 3000);
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Change Password';
    }
  }
}

// ========== PROFILE SETTINGS: FORGOT PASSWORD ==========

async function handleForgotPassword(e) {
  e.preventDefault();
  const messageDiv = document.getElementById('forgotPasswordMessage');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  messageDiv.textContent = '';
  messageDiv.className = 'message';

  const email = document.getElementById('fpEmail').value;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
  }

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok) {
      // Still show generic success to avoid email enumeration
      messageDiv.textContent = 'If an account exists for that email, a reset token has been generated.';
      messageDiv.className = 'message success';
      showToast('If an account exists, a reset token has been generated.', 'info');
      document.getElementById('forgotPasswordForm').reset();
      return;
    }

    // In development, show the token so the user can test the reset flow
    if (data.resetToken) {
      messageDiv.textContent = `Reset token generated: ${data.resetToken}`;
      messageDiv.className = 'message success';
      showToast('Reset token generated (dev mode). Copy it to reset your password.', 'info');

      // Offer to open the reset modal with the token pre-filled
      const openReset = confirm('A reset token has been generated. Open the reset password form now?');
      if (openReset) {
        openResetPasswordModal(data.resetToken);
      }
    } else {
      messageDiv.textContent = 'If an account exists for that email, a reset token has been generated.';
      messageDiv.className = 'message success';
      showToast('If an account exists, a reset token has been generated.', 'info');
    }

    document.getElementById('forgotPasswordForm').reset();
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reset Link';
    }
  }
}

async function handleForgotPasswordModal(e) {
  e.preventDefault();
  const messageDiv = document.getElementById('modalForgotPasswordMessage');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  messageDiv.textContent = '';
  messageDiv.className = 'message';

  const email = document.getElementById('modalFpEmail').value;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
  }

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok) {
      messageDiv.textContent = 'If an account exists for that email, a reset token has been generated.';
      messageDiv.className = 'message success';
      document.getElementById('forgotPasswordModalForm').reset();
      return;
    }

    if (data.resetToken) {
      messageDiv.textContent = `Reset token: ${data.resetToken}`;
      messageDiv.className = 'message success';
      const openReset = confirm('A reset token has been generated. Open the reset password form now?');
      if (openReset) {
        closeForgotPasswordModal();
        openResetPasswordModal(data.resetToken);
      }
    } else {
      messageDiv.textContent = 'If an account exists for that email, a reset token has been generated.';
      messageDiv.className = 'message success';
    }

    document.getElementById('forgotPasswordModalForm').reset();
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reset Token';
    }
  }
}

// ========== PROFILE SETTINGS: RESET PASSWORD ==========

let pendingResetToken = null;

function openResetPasswordModal(token = null) {
  const overlay = document.getElementById('resetPasswordModalOverlay');
  const tokenInput = document.getElementById('modalResetToken');
  if (!overlay || !tokenInput) return;

  if (token) {
    tokenInput.value = token;
    pendingResetToken = token;
  } else if (pendingResetToken) {
    tokenInput.value = pendingResetToken;
  }

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeResetPasswordModal() {
  const overlay = document.getElementById('resetPasswordModalOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.getElementById('resetPasswordModalForm').reset();
  document.getElementById('modalResetPasswordMessage').textContent = '';
  document.body.style.overflow = '';
}

async function handleResetPassword(e) {
  e.preventDefault();
  const messageDiv = document.getElementById('modalResetPasswordMessage');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  messageDiv.textContent = '';
  messageDiv.className = 'message';

  const token = document.getElementById('modalResetToken').value || pendingResetToken;
  const newPassword = document.getElementById('modalRpNewPassword').value;
  const confirmPassword = document.getElementById('modalRpConfirmPassword').value;

  if (newPassword !== confirmPassword) {
    messageDiv.textContent = 'New password and confirmation do not match.';
    messageDiv.className = 'message error';
    return;
  }

  if (!token) {
    messageDiv.textContent = 'Missing reset token.';
    messageDiv.className = 'message error';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';
  }

  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
    });

    const data = await response.json();

    if (!response.ok) {
      messageDiv.textContent = data.error || 'Failed to reset password.';
      messageDiv.className = 'message error';
      return;
    }

    messageDiv.textContent = 'Password has been reset successfully! You can now sign in.';
    messageDiv.className = 'message success';
    showToast('Password reset successfully.', 'success');
    document.getElementById('resetPasswordModalForm').reset();
    pendingResetToken = null;

    setTimeout(() => {
      closeResetPasswordModal();
      showAuthScreen();
    }, 1500);
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset Password';
    }
  }
}

// ========== PROFILE SETTINGS: EXPORT DATA ==========

async function handleExportCsv() {
  const messageDiv = document.getElementById('exportMessage');
  messageDiv.textContent = 'Preparing CSV export...';
  messageDiv.className = 'message';

  try {
    const response = await fetch('/api/export/csv', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      messageDiv.textContent = data.error || 'Failed to export CSV.';
      messageDiv.className = 'message error';
      showToast(data.error || 'Failed to export CSV.', 'error');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nutriai-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    messageDiv.textContent = 'CSV exported successfully.';
    messageDiv.className = 'message success';
    showToast('CSV downloaded successfully.', 'success');
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
    showToast('Error: ' + error.message, 'error');
  }
}

async function handleExportPdf() {
  const messageDiv = document.getElementById('exportMessage');
  messageDiv.textContent = 'Preparing PDF export...';
  messageDiv.className = 'message';

  try {
    const response = await fetch('/api/export/pdf', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      messageDiv.textContent = data.error || 'Failed to export PDF.';
      messageDiv.className = 'message error';
      showToast(data.error || 'Failed to export PDF.', 'error');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nutriai-export-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    messageDiv.textContent = 'PDF exported successfully.';
    messageDiv.className = 'message success';
    showToast('PDF downloaded successfully.', 'success');
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
    showToast('Error: ' + error.message, 'error');
  }
}

// ========== PROFILE SETTINGS: DELETE ACCOUNT ==========

let pendingDeleteAccount = false;

function openDeleteAccountConfirmModal() {
  const overlay = document.getElementById('deleteAccountConfirmOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDeleteAccountConfirmModal() {
  const overlay = document.getElementById('deleteAccountConfirmOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  pendingDeleteAccount = false;
  document.body.style.overflow = '';
}

async function handleDeleteAccount(e) {
  e.preventDefault();
  const messageDiv = document.getElementById('deleteAccountMessage');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  messageDiv.textContent = '';
  messageDiv.className = 'message';

  const password = document.getElementById('daPassword').value;

  if (!password) {
    messageDiv.textContent = 'Please enter your password to confirm.';
    messageDiv.className = 'message error';
    return;
  }

  openDeleteAccountConfirmModal();
  // The actual deletion happens when the user clicks "Delete Account" in the modal
  pendingDeleteAccount = true;
  document.getElementById('daPassword').value = password; // store temporarily via closure below
  // We'll use a module-level variable to pass the password
  window._pendingDeletePassword = password;
}

async function executeDeleteAccount(password) {
  try {
    const response = await fetch('/api/auth/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (handleUnauthorized(response)) return;

    if (!response.ok) {
      showToast(data.error || 'Failed to delete account.', 'error');
      closeDeleteAccountConfirmModal();
      return;
    }

    showToast('Account deleted successfully.', 'success');
    closeDeleteAccountConfirmModal();
    clearAuthentication();
    showAuthScreen();
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
    closeDeleteAccountConfirmModal();
  }
}

// ========== FORGOT PASSWORD MODAL (from accounts page link) ==========

function openForgotPasswordModal() {
  const overlay = document.getElementById('forgotPasswordModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeForgotPasswordModal() {
  const overlay = document.getElementById('forgotPasswordModalOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.getElementById('forgotPasswordModalForm').reset();
  document.getElementById('modalForgotPasswordMessage').textContent = '';
  document.body.style.overflow = '';
}

// ========== EVENT LISTENERS FOR PROFILE SETTINGS ==========

function setupProfileSettingsListeners() {
  const changePasswordForm = document.getElementById('changePasswordForm');
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  const forgotPasswordModalForm = document.getElementById('forgotPasswordModalForm');
  const resetPasswordModalForm = document.getElementById('resetPasswordModalForm');
  const deleteAccountForm = document.getElementById('deleteAccountForm');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');

  // Modals - close buttons
  const closeForgotBtn = document.getElementById('closeForgotPasswordModalBtn');
  const closeForgotBtn2 = document.getElementById('closeForgotPasswordModalBtn2');
  const closeResetBtn = document.getElementById('closeResetPasswordModalBtn');
  const closeResetBtn2 = document.getElementById('closeResetPasswordModalBtn2');
  const closeDeleteConfirmBtn = document.getElementById('closeDeleteAccountConfirmBtn');
  const cancelDeleteConfirmBtn = document.getElementById('cancelDeleteAccountConfirmBtn');
  const acceptDeleteConfirmBtn = document.getElementById('acceptDeleteAccountConfirmBtn');

  if (changePasswordForm) changePasswordForm.addEventListener('submit', handleChangePassword);
  if (forgotPasswordForm) forgotPasswordForm.addEventListener('submit', handleForgotPassword);
  if (forgotPasswordModalForm) forgotPasswordModalForm.addEventListener('submit', handleForgotPasswordModal);
  if (resetPasswordModalForm) resetPasswordModalForm.addEventListener('submit', handleResetPassword);
  if (deleteAccountForm) deleteAccountForm.addEventListener('submit', handleDeleteAccount);
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', handleExportCsv);
  if (exportPdfBtn) exportPdfBtn.addEventListener('click', handleExportPdf);

  // Modal close handlers
  if (closeForgotBtn) closeForgotBtn.addEventListener('click', closeForgotPasswordModal);
  if (closeForgotBtn2) closeForgotBtn2.addEventListener('click', closeForgotPasswordModal);
  if (closeResetBtn) closeResetBtn.addEventListener('click', closeResetPasswordModal);
  if (closeResetBtn2) closeResetBtn2.addEventListener('click', closeResetPasswordModal);
  if (closeDeleteConfirmBtn) closeDeleteConfirmBtn.addEventListener('click', closeDeleteAccountConfirmModal);
  if (cancelDeleteConfirmBtn) cancelDeleteConfirmBtn.addEventListener('click', closeDeleteAccountConfirmModal);
  if (acceptDeleteConfirmBtn) {
    acceptDeleteConfirmBtn.addEventListener('click', async () => {
      const password = window._pendingDeletePassword;
      closeDeleteAccountConfirmModal();
      if (password) await executeDeleteAccount(password);
      window._pendingDeletePassword = null;
    });
  }

  // Click outside modal to close
  const forgotOverlay = document.getElementById('forgotPasswordModalOverlay');
  const resetOverlay = document.getElementById('resetPasswordModalOverlay');
  const deleteOverlay = document.getElementById('deleteAccountConfirmOverlay');

  if (forgotOverlay) {
    forgotOverlay.addEventListener('click', (e) => {
      if (e.target === forgotOverlay) closeForgotPasswordModal();
    });
  }
  if (resetOverlay) {
    resetOverlay.addEventListener('click', (e) => {
      if (e.target === resetOverlay) closeResetPasswordModal();
    });
  }
  if (deleteOverlay) {
    deleteOverlay.addEventListener('click', (e) => {
      if (e.target === deleteOverlay) closeDeleteAccountConfirmModal();
    });
  }

  // Escape key already handled in setupEventListeners - add these modals
  const originalKeydown = document.documentElement.ondown || null;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeForgotPasswordModal();
      closeResetPasswordModal();
      closeDeleteAccountConfirmModal();
    }
  });
}

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

  if (name === 'health') loadHealthData();
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
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const compactSidebarBtn = document.getElementById('compactSidebarBtn');

  if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
  if (compactSidebarBtn) compactSidebarBtn.addEventListener('click', toggleCompactSidebar);

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
  setupHealthControls();

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
  setupProfileSettingsListeners();
  updateThemeIcon(localStorage.getItem('theme') || 'dark');
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
    tbody.innerHTML = `<tr><td colspan="9" class="text-center empty-state-cell"><div class="empty-state"><i class="fa-solid fa-plate-wheat"></i><p>${emptyMessage || historyEmptyMessage()}</p><small>Log a meal to get started</small></div></td></tr>`;
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
      showToast(data.error || 'Failed to update meal log.', 'error');
      return;
    }

    editingMealId = null;
    await loadHistory({ reset: true });
    loadDailyData();
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
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
  const analysisDetails = (log.analysisDetails && typeof log.analysisDetails === 'object') ? log.analysisDetails : {};
  const confidenceLevel = normalizeConfidenceLabel(analysisDetails.confidenceLevel || analysisDetails.confidence || log.confidenceLevel);
  const efficiencyScoreReason = String(analysisDetails.efficiencyScoreReason || '');
  const substitutions = toStringArray(analysisDetails.healthierSubstitutions);
  const toAdd = toStringArray(analysisDetails.whatToAdd || analysisDetails.additions || analysisDetails.toAdd);
  const toReduce = toStringArray(analysisDetails.whatToReduce || analysisDetails.reductions || analysisDetails.toReduce);
  const warnings = toStringArray(analysisDetails.warnings);

  const renderList = (values, emptyText) => values.length
    ? `<ul class="detail-items">${values.map((value) => `<li><span class="detail-item-name">${escapeHtml(value)}</span></li>`).join('')}</ul>`
    : `<p class="detail-text detail-muted">${escapeHtml(emptyText)}</p>`;

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

    ${efficiencyScoreReason
      ? `<p class="score-reason"><strong>Why this score:</strong> ${escapeHtml(efficiencyScoreReason)}</p>`
      : ''}

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
        <div class="detail-macro">
          <span class="detail-macro-value">${log.fiber || 0}g</span>
          <span class="detail-macro-label">Fiber</span>
        </div>
        <div class="detail-macro">
          <span class="detail-macro-value">${log.sugar || 0}g</span>
          <span class="detail-macro-label">Sugar</span>
        </div>
        <div class="detail-macro">
          <span class="detail-macro-value">${log.sodium || 0}mg</span>
          <span class="detail-macro-label">Sodium</span>
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
                 <span class="detail-item-portion">${escapeHtml(item.estimatedPortion || '')}${item.confidence ? ` · ${escapeHtml(item.confidence)}` : ''}</span>
               </li>
             `).join('')}
           </ul>`
        : '<p class="detail-text detail-muted">No individual foods were recorded for this meal.</p>'}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-gauge-high"></i> Confidence level</h4>
      <p class="detail-text"><span class="${confidenceBadgeClass(confidenceLevel)}">${escapeHtml(confidenceLevel)}</span></p>
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-right-left"></i> Healthier substitutions</h4>
      ${renderList(substitutions, 'No healthier substitutions suggested.')}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-plus"></i> What to add</h4>
      ${renderList(toAdd, 'Nothing specific to add.')}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-minus"></i> What to reduce</h4>
      ${renderList(toReduce, 'Nothing specific to reduce.')}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-triangle-exclamation"></i> Warnings</h4>
      ${renderList(warnings, 'No warnings.')}
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
    showToast('Please provide either a meal description or image.', 'error');
    return;
  }

  submitBtn.disabled = true;

  const resultCard = document.getElementById('latestResultCard');
  if (resultCard) {
    resultCard.classList.remove('hidden');
    resultCard.innerHTML = `
      <div class="skeleton skeleton-card" aria-busy="true" aria-live="polite">
        <div class="skeleton-text" style="width:60%"></div>
        <div class="skeleton-text" style="width:90%"></div>
        <div class="skeleton-text" style="width:75%"></div>
        <div class="skeleton-text" style="width:80%"></div>
      </div>
    `;
  }

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
      showToast(data.error || 'Failed to analyze meal. Please try again.', 'error');
      return;
    }

    displayAnalysisResult(data.data);
    loadDailyData();
    clearForm();
    showToast('Meal analyzed and logged successfully.', 'success');
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyze & Log Meal';
  }
}

function clearForm() {
  document.getElementById('mealForm').reset();
  clearImageUpload();
  setupAutoMealType();

  // Keep the dietary goal tied to the user's profile after the form is cleared.
  // form.reset() restores the HTML default ("Maintenance"), which used to stick on
  // subsequent meals whenever the select was disabled by applyGoalToMealForm().
  if (currentProfile && currentProfile.goal) {
    applyGoalToMealForm(currentProfile.goal);
  }
}

// ========== DASHBOARD DISPLAY ==========

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function normalizeConfidenceLabel(value) {
  const text = String(value || '').trim();
  const normalized = text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
  return ['High', 'Medium', 'Low'].includes(normalized) ? normalized : 'Medium';
}

function confidenceBadgeClass(value) {
  const normalized = normalizeConfidenceLabel(value).toLowerCase();
  return `badge ${normalized}`;
}

function renderStringList(items, emptyText) {
  if (!items || items.length === 0) {
    return `<p class="detail-text detail-muted">${escapeHtml(emptyText)}</p>`;
  }
  return `<ul class="detail-items">${items.map((item) => `<li><span class="detail-item-name">${escapeHtml(item)}</span></li>`).join('')}</ul>`;
}

function displayAnalysisResult(data) {
  const resultCard = document.getElementById('latestResultCard');
  if (!resultCard) return;

  const confidenceLevel = normalizeConfidenceLabel(data.confidenceLevel || data.confidence);
  const substitutions = toStringArray(data.healthierSubstitutions);
  const toAdd = toStringArray(data.whatToAdd || data.additions || data.toAdd);
  const toReduce = toStringArray(data.whatToReduce || data.reductions || data.toReduce);
  const warnings = toStringArray(data.warnings);
  const detectedItems = Array.isArray(data.detectedItems) ? data.detectedItems : [];
  const efficiencyScore = normalizeConfidenceLabel(data.efficiencyScore);

  const itemsHtml = detectedItems.length > 0
    ? `<ul class="detail-items">${detectedItems.map((item) => `
        <li>
          <span class="detail-item-name">${escapeHtml(item.name || '')}</span>
          <span class="detail-item-portion">${escapeHtml(item.estimatedPortion || '')}${item.confidence ? ` · ${escapeHtml(item.confidence)}` : ''}</span>
        </li>
      `).join('')}</ul>`
    : '<p class="detail-text detail-muted">No individual foods were recorded for this meal.</p>';

  resultCard.innerHTML = `
    <div class="result-header">
      <h3>${escapeHtml(data.mealName || 'Logged Meal')}</h3>
      <span class="badge ${efficiencyScore.toLowerCase()}">${escapeHtml(efficiencyScore)}</span>
    </div>

    ${data.efficiencyScoreReason ? `<p class="score-reason"><strong>Why this score:</strong> ${escapeHtml(data.efficiencyScoreReason)}</p>` : ''}

    <div class="detail-meta">
      <span class="detail-meta-item">Confidence: <span class="${confidenceBadgeClass(confidenceLevel)}">${escapeHtml(confidenceLevel)}</span></span>
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-list-ul"></i> Detected ingredients & portions</h4>
      ${itemsHtml}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-bolt"></i> Nutrition</h4>
      <div class="detail-macros">
        <div class="detail-macro detail-macro-cal">
          <span class="detail-macro-value">${data.nutritionalSummary?.totalCalories ?? 0}</span>
          <span class="detail-macro-label">kcal</span>
        </div>
        <div class="detail-macro detail-macro-protein">
          <span class="detail-macro-value">${data.nutritionalSummary?.proteinGrams ?? 0}g</span>
          <span class="detail-macro-label">Protein</span>
        </div>
        <div class="detail-macro detail-macro-carbs">
          <span class="detail-macro-value">${data.nutritionalSummary?.carbsGrams ?? 0}g</span>
          <span class="detail-macro-label">Carbs</span>
        </div>
        <div class="detail-macro detail-macro-fats">
          <span class="detail-macro-value">${data.nutritionalSummary?.fatsGrams ?? 0}g</span>
          <span class="detail-macro-label">Fats</span>
        </div>
        <div class="detail-macro">
          <span class="detail-macro-value">${data.nutritionalSummary?.fiberGrams ?? 0}g</span>
          <span class="detail-macro-label">Fiber</span>
        </div>
        <div class="detail-macro">
          <span class="detail-macro-value">${data.nutritionalSummary?.sugarGrams ?? 0}g</span>
          <span class="detail-macro-label">Sugar</span>
        </div>
        <div class="detail-macro">
          <span class="detail-macro-value">${data.nutritionalSummary?.sodiumMg ?? 0}mg</span>
          <span class="detail-macro-label">Sodium</span>
        </div>
      </div>
    </div>

    ${data.goalAlignmentReason ? `<div class="detail-block">
      <h4><i class="fa-solid fa-bullseye"></i> Goal alignment</h4>
      <p class="detail-text">${escapeHtml(data.goalAlignmentReason)}</p>
    </div>` : ''}

    <div class="detail-block">
      <h4><i class="fa-solid fa-right-left"></i> Healthier substitutions</h4>
      ${renderStringList(substitutions, 'No healthier substitutions suggested.')}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-plus"></i> What to add</h4>
      ${renderStringList(toAdd, 'Nothing specific to add.')}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-minus"></i> What to reduce</h4>
      ${renderStringList(toReduce, 'Nothing specific to reduce.')}
    </div>

    <div class="detail-block">
      <h4><i class="fa-solid fa-triangle-exclamation"></i> Warnings</h4>
      ${renderStringList(warnings, 'No warnings.')}
    </div>

    ${data.suggestedAdjustments ? `<p class="advice-text">${escapeHtml(data.suggestedAdjustments)}</p>` : ''}
  `;

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
      showToast('Meal deleted.', 'success');
    } else {
      const data = await response.json().catch(() => ({}));
      showToast(data.error || 'Failed to delete meal log', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
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
      showToast(`Deleted ${data.deletedCount} meal logs`, 'success');
      detailCache.clear();
      editingMealId = null;
      await loadHistory({ reset: true });
      loadDailyData();
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
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

function setupHealthControls() {
  const waterForm = document.getElementById('waterForm');
  if (waterForm) waterForm.addEventListener('submit', handleWaterSubmit);
  const exerciseForm = document.getElementById('exerciseForm');
  if (exerciseForm) exerciseForm.addEventListener('submit', handleExerciseSubmit);
  const sleepForm = document.getElementById('sleepForm');
  if (sleepForm) sleepForm.addEventListener('submit', handleSleepSubmit);
}

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
function setWaterMessage(text, type) {
  const el = document.getElementById('waterMessage');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
}
function setExerciseMessage(text, type) {
  const el = document.getElementById('exerciseMessage');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
}
function setSleepMessage(text, type) {
  const el = document.getElementById('sleepMessage');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
}

async function handleWaterSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('waterInput');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const intakeMl = parseInt(input.value, 10);
  if (!Number.isFinite(intakeMl) || intakeMl < 0) {
    setWaterMessage('Enter a valid amount in ml.', 'error');
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  try {
    const response = await fetch('/api/water', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ intakeMl })
    });
    const data = await response.json();
    if (handleUnauthorized(response)) return;
    if (!response.ok) { setWaterMessage(data.error || 'Failed to log water.', 'error'); return; }
    setWaterMessage(`Logged ${data.log.intakeMl} ml for today.`, 'success');
    input.value = '';
    await loadHealthData();
  } catch (error) {
    setWaterMessage('Error: ' + error.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleExerciseSubmit(e) {
  e.preventDefault();
  const activity = document.getElementById('exerciseActivity').value.trim();
  const duration = parseInt(document.getElementById('exerciseMinutes').value, 10) || 0;
  const calories = parseInt(document.getElementById('exerciseCalories').value, 10) || 0;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (!activity) { setExerciseMessage('Activity is required.', 'error'); return; }
  if (submitBtn) submitBtn.disabled = true;
  try {
    const response = await fetch('/api/exercise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ activity, durationMin: duration, caloriesBurned: calories })
    });
    const data = await response.json();
    if (handleUnauthorized(response)) return;
    if (!response.ok) { setExerciseMessage(data.error || 'Failed to log exercise.', 'error'); return; }
    setExerciseMessage(`Logged ${activity}.`, 'success');
    await loadHealthData();
  } catch (error) {
    setExerciseMessage('Error: ' + error.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleSleepSubmit(e) {
  e.preventDefault();
  const hours = parseFloat(document.getElementById('sleepHours').value);
  const quality = document.getElementById('sleepQuality').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (!Number.isFinite(hours)) { setSleepMessage('Enter sleep hours.', 'error'); return; }
  if (submitBtn) submitBtn.disabled = true;
  try {
    const response = await fetch('/api/sleep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ sleepHours: hours, quality })
    });
    const data = await response.json();
    if (handleUnauthorized(response)) return;
    if (!response.ok) { setSleepMessage(data.error || 'Failed to log sleep.', 'error'); return; }
    setSleepMessage(`Logged ${hours} hours.`, 'success');
    await loadHealthData();
  } catch (error) {
    setSleepMessage('Error: ' + error.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadHealthData() {
  const today = new Date();
  const todayString = toLocalDateString(today);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const startDate = toLocalDateString(weekStart);
  const rangeQuery = `startDate=${startDate}&endDate=${todayString}`;
  const headers = { 'Authorization': `Bearer ${authToken}` };
  const requests = await Promise.allSettled([
    fetch(`/api/water?${rangeQuery}`, { headers }),
    fetch(`/api/exercise?${rangeQuery}`, { headers }),
    fetch(`/api/sleep?${rangeQuery}`, { headers }),
    fetch(`/api/water?date=${todayString}`, { headers }),
    fetch(`/api/sleep?date=${todayString}`, { headers })
  ]);

  const [waterHistory, exerciseHistory, sleepHistory, waterToday, sleepToday] = requests;
  const responseFor = async (result, statusId) => {
    const status = document.getElementById(statusId);
    if (result.status === 'rejected') {
      if (status) status.textContent = 'Could not reach the server. Check that the app is running, then reopen this section.';
      return null;
    }

    if (handleUnauthorized(result.value)) return null;
    if (!result.value.ok) {
      const errorData = await result.value.json().catch(() => ({}));
      if (status) status.textContent = errorData.error || `Could not load data (HTTP ${result.value.status}).`;
      return null;
    }

    return result.value.json();
  };

  const [waterData, exerciseData, sleepData, todayWaterData, todaySleepData] = await Promise.all([
    responseFor(waterHistory, 'waterHistoryStatus'),
    responseFor(exerciseHistory, 'exerciseStatus'),
    responseFor(sleepHistory, 'sleepHistoryStatus'),
    responseFor(waterToday, 'waterStatus'),
    responseFor(sleepToday, 'sleepStatus')
  ]);

  if (waterData) {
    const list = document.getElementById('waterHistoryList');
    const logs = waterData.logs || [];
    if (list) list.innerHTML = logs.length
      ? logs.map((log) => `<li><span class="detail-item-name">${escapeHtml(formatShortDate(log.date))}</span><span class="detail-item-portion">${Number(log.intakeMl).toLocaleString()} / ${Number(log.goalMl).toLocaleString()} ml</span></li>`).join('')
      : '<li class="health-empty-row">No water entries in the last seven days.</li>';
  }
  if (todayWaterData) {
    const status = document.getElementById('waterStatus');
    if (status) status.textContent = todayWaterData.log
      ? `${Number(todayWaterData.log.intakeMl).toLocaleString()} ml logged today (goal ${Number(todayWaterData.log.goalMl).toLocaleString()} ml).`
      : 'No water logged today.';
  }

  if (exerciseData) {
    const list = document.getElementById('exerciseList');
    const logs = exerciseData.logs || [];
    if (list) list.innerHTML = logs.length
      ? logs.map((log) => `<li><span class="detail-item-name">${escapeHtml(log.activity)} · ${escapeHtml(formatShortDate(log.date))}</span><span class="detail-item-portion">${Number(log.durationMin)} min · ${Number(log.caloriesBurned)} kcal</span></li>`).join('')
      : '<li class="health-empty-row">No exercise logged in the last seven days.</li>';
    const status = document.getElementById('exerciseStatus');
    if (status) status.textContent = `${logs.length} exercise session${logs.length === 1 ? '' : 's'} in the last seven days.`;
  }

  if (sleepData) {
    const list = document.getElementById('sleepHistoryList');
    const logs = sleepData.logs || [];
    if (list) list.innerHTML = logs.length
      ? logs.map((log) => `<li><span class="detail-item-name">${escapeHtml(formatShortDate(log.date))}</span><span class="detail-item-portion">${Number(log.sleepHours)} hr · ${escapeHtml(log.quality || 'unrated')}</span></li>`).join('')
      : '<li class="health-empty-row">No sleep entries in the last seven days.</li>';
  }
  if (todaySleepData) {
    const status = document.getElementById('sleepStatus');
    if (status) status.textContent = todaySleepData.log
      ? `${Number(todaySleepData.log.sleepHours)} hours (${todaySleepData.log.quality || 'unrated'}).`
      : 'No sleep logged today.';
  }
}

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
      showToast(data.error || 'Failed to update targets.', 'error');
      return;
    }

    await loadNutritionGoals();
    await loadDailyData();
    setWeightMessage('Targets updated from your latest weight.', 'success');
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
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
  loadHistory,
  openResetPasswordModal,
  closeResetPasswordModal,
  openDeleteAccountConfirmModal,
  closeDeleteAccountConfirmModal,
  openForgotPasswordModal,
  closeForgotPasswordModal,
  executeDeleteAccount
});