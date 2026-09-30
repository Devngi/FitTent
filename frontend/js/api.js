/**
 * api.js — FitTent API Bridge
 * ====================================
 * Single source of truth for all async page initialisation.
 * All data flows: Browser ← Flask ← PostgreSQL (no localStorage).
 *
 * Boot order on every page:
 *   1. Apply theme from sessionStorage cache (SYNC — zero flash)
 *   2. Fetch profile from API (async) → update cache + re-apply theme
 *   3. Start alarm checker on every page
 *   4. Page-specific: fetch data → call app.js init functions → render
 */

'use strict';

// Dynamically resolve API base so the same code works on localhost AND on Render
const API_BASE = window.location.origin + '/api';

/* ── Global profile cache ──────────────────────────────────── */
window.FT = window.FT || { profile: null };


/* ════════════════════════════════════════════
   FETCH HELPER
════════════════════════════════════════════ */

async function apiFetch(path, method = 'GET', body = null) {
  const options = {
    method,
    credentials: 'include',   // send session cookie on every request
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(API_BASE + path, options);

  if (response.status === 401) {
    // Session expired or not logged in — redirect to login
    window.location.href = '/login.html';
    return;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const e = new Error(err.error || `HTTP ${response.status}`);
    e.details = err.details || [];
    throw e;
  }
  if (response.status === 204) return null;
  return response.json();
}

/* ════════════════════════════════════════════
   AUTH GUARD — call on every protected page
════════════════════════════════════════════ */

/**
 * Verifies that the user has an active session.
 * Redirects to /login.html if not authenticated.
 * Call this at the top of each page's boot sequence.
 */
async function apiCheckAuth() {
  try {
    const user = await fetch(API_BASE + '/auth/me', { credentials: 'include' });
    if (!user.ok) {
      window.location.href = '/login.html';
      return null;
    }
    return user.json();
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

/** Call this to log out and redirect to login page. */
async function apiLogout() {
  await fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html?msg=Logged+out+successfully';
}



/** Called synchronously at page-start — zero flash */
function applyThemeCached() {
  const theme = sessionStorage.getItem('ft_theme') || 'light';
  _applyTheme(theme);
}

/** Called after profile is fetched from DB */
function applyThemeFromProfile(profile) {
  const theme = (profile && profile.theme) || 'light';
  sessionStorage.setItem('ft_theme', theme);   // keep cache in sync
  _applyTheme(theme);
}

function _applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}


/* ════════════════════════════════════════════
   PROFILE
════════════════════════════════════════════ */

async function apiLoadProfile() {
  try {
    const profile = await apiFetch('/profile');
    window.FT.profile = profile;

    // Push into GLOBAL_SETTINGS so app.js helper functions work
    if (typeof GLOBAL_SETTINGS !== 'undefined') {
      GLOBAL_SETTINGS = {
        name:            profile.name           || '',
        email:           profile.email          || '',
        age:             profile.age            || '',
        dob:             profile.dob            || '',
        gender:          profile.gender         || '',
        height:          profile.height         || '',
        weight:          profile.weight         || '',
        bio:             profile.bio            || '',
        goalSteps:       profile.goal_steps     || 10000,
        goalWater:       profile.goal_water     || 3,
        goalSleep:       profile.goal_sleep     || 8,
        goalWorkoutDays: profile.goal_workout_days || 4,
        theme:           profile.theme          || 'light',
        darkMode:        profile.theme === 'dark',
        lang:            profile.language       || 'en',
        dateFormat:      profile.date_format    || 'DD Mon YYYY',
        units:           profile.units          || 'metric',
        medications_state: profile.medications_state || null,
        reminder_time:   profile.reminder_time  || null,
        n_dailyLog:      !!profile.n_daily_log,
        n_medication:    !!profile.n_medication,
        n_hydration:     !!profile.n_hydration,
        n_weekly:        !!profile.n_weekly,
        n_awards:        !!profile.n_awards,
      };
    }

    applyThemeFromProfile(profile);
    return profile;
  } catch (err) {
    console.warn('[FitTent] Profile load failed:', err.message);
    return null;
  }
}

async function apiSaveProfile() {
  const s = (typeof GLOBAL_SETTINGS !== 'undefined' && GLOBAL_SETTINGS) || {};
  const payload = {
    name:              s.name            || '',
    email:             s.email           || '',
    age:               s.age             || null,
    dob:               s.dob             || null,
    gender:            s.gender          || null,
    height:            s.height          || null,
    weight:            s.weight          || null,
    bio:               s.bio             || null,
    goal_steps:        s.goalSteps       || 10000,
    goal_water:        s.goalWater       || 3,
    goal_sleep:        s.goalSleep       || 8,
    goal_workout_days: s.goalWorkoutDays || 4,
    theme:             s.darkMode ? 'dark' : 'light',
    language:          s.lang            || 'en',
    date_format:       s.dateFormat      || 'DD Mon YYYY',
    units:             s.units           || 'metric',
    medications_state: s.medications_state || null,
    reminder_time:     s.reminder_time    || null,
    n_daily_log:       s.n_dailyLog  ? 1 : 0,
    n_medication:      s.n_medication ? 1 : 0,
    n_hydration:       s.n_hydration ? 1 : 0,
    n_weekly:          s.n_weekly    ? 1 : 0,
    n_awards:          s.n_awards    ? 1 : 0,
  };

  try {
    const updated = await apiFetch('/profile', 'POST', payload);
    window.FT.profile = updated;
    // Keep sessionStorage in sync with the freshly saved value
    sessionStorage.setItem('ft_theme', updated.theme || 'light');
    console.info('[FitTent] Profile saved to PostgreSQL');
    return updated;
  } catch (err) {
    console.warn('[FitTent] Profile save failed:', err.message);
    return null;
  }
}


/* ════════════════════════════════════════════
   LOGS
════════════════════════════════════════════ */

async function apiSaveLog(entry) {
  const payload = {
    log_date:          entry.date
      ? String(entry.date).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    workout_type:      entry.workout    || null,
    workout_duration:  entry.duration   || null,
    workout_intensity: entry.intensity  || null,
    workout_notes:     entry.notes      || null,
    steps:             entry.steps      ?? null,
    water_intake:      entry.water      ?? null,
    sleep_hours:       entry.sleep      ?? null,
    mood:              entry.mood       || null,
    energy_level:      entry.energy     || null,
    medications_taken: entry.medications || null,
  };

  try {
    const saved = await apiFetch('/logs', 'POST', payload);
    console.info('[FitTent] Log saved, id =', saved.id);
    return saved;
  } catch (err) {
    console.warn('[FitTent] Log save failed:', err.message);
    return null;
  }
}

/**
 * Update an existing log row via PUT /api/logs/:id.
 * Called by initDashboard() smart-form when today's log already exists.
 */
async function apiUpdateLog(logId, entry) {
  const payload = {
    workout_type:      entry.workout    || null,
    workout_duration:  entry.duration   || null,
    workout_intensity: entry.intensity  || null,
    workout_notes:     entry.notes      || null,
    steps:             entry.steps      ?? null,
    water_intake:      entry.water      ?? null,
    sleep_hours:       entry.sleep      ?? null,
    mood:              entry.mood       || null,
    energy_level:      entry.energy     || null,
  };

  try {
    const updated = await apiFetch(`/logs/${logId}`, 'PUT', payload);
    console.info('[FitTent] Log updated, id =', updated.id);
    return updated;
  } catch (err) {
    console.warn('[FitTent] Log update failed:', err.message);
    return null;
  }
}

/** Fetch logs from PostgreSQL and normalise column names for app.js */
async function apiFetchLogs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo)   params.set('date_to',   filters.dateTo);
  if (filters.workout)  params.set('workout',   filters.workout);
  if (filters.limit)    params.set('limit',     filters.limit);

  const query = params.toString() ? `?${params}` : '';

  try {
    const rows = await apiFetch(`/logs${query}`);
    console.info(`[FitTent] Fetched ${rows.length} logs from SQLite`);
    return rows.map(r => ({
      id:        r.id,
      date:      r.log_date,        // ← unified field name used by app.js
      log_date:  r.log_date,
      workout:   r.workout_type,
      duration:  r.workout_duration,
      intensity: r.workout_intensity,
      notes:     r.workout_notes,
      steps:     r.steps,
      water:     r.water_intake,
      sleep:     r.sleep_hours,
      mood:      r.mood,
      energy:    r.energy_level,
      medications: r.medications_taken,
    }));
  } catch (err) {
    console.warn('[FitTent] Fetch logs failed:', err.message);
    return [];
  }
}

async function apiDeleteLog(dbId) {
  try {
    await apiFetch(`/logs/${dbId}`, 'DELETE');
    return true;
  } catch (err) {
    console.warn('[FitTent] Delete failed:', err.message);
    return false;
  }
}


/* ════════════════════════════════════════════
   STATS  (Settings → Data panel)
════════════════════════════════════════════ */

async function apiRefreshDataStats() {
  try {
    const s = await apiFetch('/stats');
    const setText = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v ?? '—';
    };
    setText('ds_totalLogs',  s.total_logs ?? 0);
    setText('ds_avgSteps',   s.avg_steps ? Number(s.avg_steps).toLocaleString() : '—');
    setText('ds_avgSleep',   s.avg_sleep  ? s.avg_sleep  + ' hrs' : '—');
    setText('ds_avgWater',   s.avg_water  ? s.avg_water  + ' L'   : '—');
    setText('ds_topWorkout', s.top_workout || '—');
    setText('ds_storage',    'PostgreSQL');
  } catch (err) {
    console.warn('[FitTent] Stats load failed:', err.message);
  }
}


/* ════════════════════════════════════════════
   DASHBOARD  — Goal Progress Cards
════════════════════════════════════════════ */

async function apiLoadDashboardGoals() {
  try {
    const stats   = await apiFetch('/stats');
    const profile = window.FT.profile || {};
    const today   = stats.today || {};

    const goalSteps = profile.goal_steps || 10000;
    const goalWater = profile.goal_water || 3;
    const goalSleep = profile.goal_sleep || 8;

    _updateGoalCard('statSteps', 'statStepsFill', 'statStepsGoal',
      today.steps,        goalSteps, v => v != null ? Number(v).toLocaleString() : '—', 'steps');
    _updateGoalCard('statWater', 'statWaterFill', 'statWaterGoal',
      today.water_intake, goalWater, v => v != null ? v + ' L'   : '—', 'L');
    _updateGoalCard('statSleep', 'statSleepFill', 'statSleepGoal',
      today.sleep_hours,  goalSleep, v => v != null ? v + ' hrs' : '—', 'hrs');

    // Workout card
    const wEl   = document.getElementById('statWorkout');
    const wFill = document.getElementById('statWorkoutFill');
    if (wEl && today.workout_type) {
      wEl.textContent = today.workout_type.length > 10
        ? today.workout_type.slice(0, 9) + '…'
        : today.workout_type;
      if (wFill) wFill.style.width = '100%';
    }

    // Overall score card
    let met = 0;
    if (today.steps       != null && today.steps        >= goalSteps) met++;
    if (today.water_intake != null && today.water_intake >= goalWater) met++;
    if (today.sleep_hours  != null && today.sleep_hours  >= goalSleep) met++;
    const pct = Math.round((met / 3) * 100);
    const scoreEl  = document.getElementById('statScore');
    const scoreFill= document.getElementById('statScoreFill');
    const scoreGoal= document.getElementById('statScoreGoal');
    if (scoreEl)   scoreEl.textContent   = pct + '%';
    if (scoreFill) scoreFill.style.width = pct + '%';
    if (scoreGoal) scoreGoal.textContent = `${met}/3 goals met`;

  } catch (err) {
    console.warn('[FitTent] Dashboard goals load failed:', err.message);
  }
}

function _updateGoalCard(valueId, fillId, goalTextId, value, goal, fmt, unit) {
  const el     = document.getElementById(valueId);
  const fill   = document.getElementById(fillId);
  const goalEl = document.getElementById(goalTextId);
  if (el)     el.textContent = fmt(value);
  if (fill)   fill.style.width = value != null
    ? Math.min(100, Math.round((Number(value) / goal) * 100)) + '%'
    : '0%';
  if (goalEl) goalEl.textContent = unit === 'steps'
    ? `Goal: ${Number(goal).toLocaleString()} steps`
    : `Goal: ${goal} ${unit}`;
}


/* ════════════════════════════════════════════
   MEDICATION ALARM  — runs on EVERY page
   Reads reminder_time from window.FT.profile.
════════════════════════════════════════════ */

let _alarmFiredMinute = null;

function startAlarmChecker() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  checkMedicationAlarm();
  setInterval(checkMedicationAlarm, 30000);
}

function checkMedicationAlarm() {
  const profile    = window.FT && window.FT.profile;
  const savedTime  = profile ? profile.reminder_time : null;
  if (!savedTime) return;

  const now   = new Date();
  const hh    = String(now.getHours()).padStart(2, '0');
  const mm    = String(now.getMinutes()).padStart(2, '0');
  const nowHM = `${hh}:${mm}`;

  if (nowHM === savedTime && _alarmFiredMinute !== nowHM) {
    _alarmFiredMinute = nowHM;
    _fireAlarm(savedTime);
  }
}

function _fireAlarm(time) {
  if (typeof playReminderBeep === 'function') playReminderBeep();

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('💊 FitTent Medication Reminder', {
      body: `Time to take your medication! (Scheduled: ${time})`,
    });
  } else {
    alert(`💊 FitTent Reminder\n\nTime to take your medication!\n(Scheduled: ${time})`);
  }

  const statusEl = document.getElementById('reminderStatus');
  if (statusEl) statusEl.innerHTML = `✅ Reminder fired at <strong>${time}</strong>`;
}

function playReminderBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    function note(freq, start, dur) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.6, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      o.start(start); o.stop(start + dur);
    }
    const t = ctx.currentTime;
    note(523.25, t, 0.25); note(659.25, t + 0.3, 0.25);
    note(783.99,  t + 0.6, 0.25); note(1046.5, t + 0.9, 0.5);
  } catch (_) {}
}


/* ════════════════════════════════════════════
   BOOT — single DOMContentLoaded in api.js
   app.js DOMContentLoaded only inits the form.
════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ── STEP 1: Apply cached theme SYNCHRONOUSLY — no flash ── */
  applyThemeCached();

  /* ── STEP 2: Fetch real profile from SQLite ── */
  const profile = await apiLoadProfile();   // also calls applyThemeFromProfile

  /* ── STEP 3: Alarm checker on every page ── */
  startAlarmChecker();

  /* ── STEP 4: Greeting update (dashboard might have loaded before profile) ── */
  if (typeof setDynamicGreeting === 'function') setDynamicGreeting();

  /* ── STEP 5: Page-specific data loading + rendering ── */
  const page = window.location.pathname.split('/').pop() || 'index.html';

  /* ─── DASHBOARD ─── */
  if (page === 'index.html' || page === '') {
    const logs = await apiFetchLogs({ limit: 100 });
    if (logs.length > 0) {
      GLOBAL_LOGS = logs;
      /* Notify initDashboard's smart-form listener that logs are ready */
      document.dispatchEvent(new CustomEvent('ft:logsLoaded'));
      if (typeof refreshStatCards === 'function') refreshStatCards();
    }
    await apiLoadDashboardGoals();

    /* ── Step Ring Chart ── */
    if (typeof renderStepRing === 'function') {
      const prof    = window.FT.profile || {};
      const stats2  = await apiFetch('/stats').catch(() => ({}));
      const todayD  = (stats2 && stats2.today) || {};
      const steps   = todayD.steps != null ? todayD.steps : null;
      const goal    = prof.goal_steps || 10000;
      renderStepRing(steps, goal);
      /* Update flanking stat labels */
      var doneEl = document.getElementById('stepRingDone');
      var leftEl = document.getElementById('stepRingLeft');
      var goalBadge = document.getElementById('stepRingGoalBadge');
      var goalText  = document.getElementById('stepRingGoalText');
      if (steps != null) {
        if (doneEl)  doneEl.textContent  = Number(steps).toLocaleString();
        if (leftEl)  leftEl.textContent  = Math.max(0, goal - steps).toLocaleString();
      }
      if (goalBadge) goalBadge.textContent = 'Goal: ' + Number(goal).toLocaleString() + ' steps';
      if (goalText)  goalText.textContent  = 'of ' + Number(goal).toLocaleString() + ' steps';
    }
  }

  /* ─── HISTORY ─── */
  if (page === 'history.html') {
    // Show loading skeleton
    const tbody = document.getElementById('historyTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:#64748b;font-size:0.9rem;">
        ⏳ Loading history from database…</td></tr>`;
    }
    // Set up filter listeners (no render yet)
    if (typeof initHistory === 'function') initHistory();
    // Fetch all logs then render
    const logs = await apiFetchLogs();
    GLOBAL_LOGS = logs;
    if (typeof renderHistoryTable === 'function') renderHistoryTable();

    /* ── Trend Line Chart ── */
    /* Use GLOBAL_LOGS directly — guaranteed real DB data with correct 1-5 mood values */
    if (typeof renderTrendChart === 'function') {
      renderTrendChart(GLOBAL_LOGS, 'steps');
    }
  }

  /* ─── AWARDS ─── */
  if (page === 'awards.html') {
    const logs = await apiFetchLogs();
    GLOBAL_LOGS = logs;
    if (typeof initAwards === 'function') initAwards();
  }

  /* ─── MEDICATION ─── */
  if (page === 'medication.html') {
    // initMedication reads restoreMedState from profile — profile is loaded now
    if (typeof initMedication === 'function') initMedication();

    // Restore reminder time from SQLite profile
    const timeEl   = document.getElementById('reminderTime');
    const statusEl = document.getElementById('reminderStatus');
    if (timeEl && profile && profile.reminder_time) {
      timeEl.value = profile.reminder_time;
      if (statusEl) statusEl.innerHTML =
        `🔔 Reminder active at <strong>${profile.reminder_time}</strong> — fires on all pages.`;
    }
  }

  /* ─── SETTINGS ─── */
  if (page === 'settings.html') {
    // initSettings wires tabs & range sliders (no data needed)
    if (typeof initSettings === 'function') initSettings();
    // restoreSettings reads from window.FT.profile — now loaded
    if (typeof restoreSettings === 'function') restoreSettings();
    // Load stats for the Data tab
    apiRefreshDataStats();
  }
});
