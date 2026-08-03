/**
 * ============================================================
 *  FitTrack — app.js
 *  Vanilla JavaScript (NO localStorage — all data via SQLite API)
 *
 *  Pages handled:
 *    index.html      → Dashboard  (form submit, stat cards, goal progress)
 *    history.html    → History    (table render, filters)
 *    medication.html → Medication (checkbox / field persistence via API)
 *    awards.html     → Awards     (badge unlock logic)
 *    settings.html   → Settings   (full save/restore via API)
 * ============================================================
 */

'use strict';

/* ─────────────────────────────────────────────
   CONSTANTS & GLOBALS
───────────────────────────────────────────── */
const TOTAL_BADGES = 12;

/* In-memory log cache — populated by api.js from SQLite */
let GLOBAL_LOGS = [];

/* In-memory settings — populated by apiLoadProfile() */
let GLOBAL_SETTINGS = null;

const DEFAULT_SETTINGS = {
  name: '', email: '', age: '', dob: '', gender: '', height: '', weight: '', bio: '',
  goalSteps: 10000, goalWater: 3, goalSleep: 8, goalWorkoutDays: 4,
  theme: 'light', darkMode: false, lang: 'en', dateFormat: 'DD Mon YYYY', units: 'metric',
  n_dailyLog: true, n_medication: true, n_hydration: false, n_weekly: false, n_awards: true,
  medications_state: null, reminder_time: null,
};

function getSettings() {
  return GLOBAL_SETTINGS || Object.assign({}, DEFAULT_SETTINGS);
}

function getGoals() {
  const s = getSettings();
  return {
    steps: s.goalSteps || 10000,
    water: s.goalWater || 3,
    sleep: s.goalSleep || 8,
  };
}

function getLogs() { return GLOBAL_LOGS; }
function saveLogs(logs) { GLOBAL_LOGS = logs; }
function persistSettings(obj) { GLOBAL_SETTINGS = obj; }

/* Mood value → emoji label */
const MOOD_MAP = {
  '5': '😁 Amazing',
  '4': '😊 Good',
  '3': '😐 Neutral',
  '2': '😔 Tired',
  '1': '😢 Burned out',
};

/* ─────────────────────────────────────────────
   UTILITY HELPERS
───────────────────────────────────────────── */

function formatDate(d) {
  if (d === null || d === undefined || d === '') return '—';

  let date;
  if (d instanceof Date) {
    date = d;
  } else if (typeof d === 'number') {
    date = new Date(d);
  } else {
    const iso = String(d).slice(0, 10);
    const parts = iso.split('-');
    if (parts.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      date = new Date(d);
    }
  }

  if (isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function pct(value, max) {
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

/* ─────────────────────────────────────────────
   PAGE DETECTOR
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  applyDarkMode(); // applies from sessionStorage instantly — no flash

  // Dashboard form only (no pre-loaded data required).
  // History / Awards / Medication / Settings are inited by api.js
  // AFTER async profile + data are fetched from SQLite.
  if (document.getElementById('activityForm')) initDashboard();
});


/* ════════════════════════════════════════════
   0. NAVIGATION  (all pages)
════════════════════════════════════════════ */

function initNavigation() {
  const path = window.location.pathname;
  const filename = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
  const navLinks = document.querySelectorAll('.sidebar-link[data-page]');
  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.dataset.page === filename) link.classList.add('active');
  });
}


/* ════════════════════════════════════════════
   1. DASHBOARD  (index.html)
════════════════════════════════════════════ */

/**
 * Returns today's ISO date string: "YYYY-MM-DD"
 */
function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Finds the most-recent log entry for today in GLOBAL_LOGS.
 * Returns the log object or null.
 */
function findTodayLog() {
  const today = getTodayISO();
  // GLOBAL_LOGS is sorted oldest-first by api.js; scan from the end for speed
  for (let i = GLOBAL_LOGS.length - 1; i >= 0; i--) {
    const d = String(GLOBAL_LOGS[i].date ?? GLOBAL_LOGS[i].log_date ?? '').slice(0, 10);
    if (d === today) return GLOBAL_LOGS[i];
  }
  return null;
}

/**
 * Pre-fills all dashboard form inputs with values from an existing log object.
 * Also swaps button text + form subtitle into "Update" mode.
 */
function prefillDashboardForm(log) {
  if (!log) return;

  /* ── Form inputs ── */
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };

  setVal('workoutType',     log.workout  ?? log.workout_type);
  setVal('workoutDuration', log.duration ?? log.workout_duration);
  setVal('workoutIntensity',log.intensity?? log.workout_intensity);
  setVal('workoutNotes',    log.notes    ?? log.workout_notes);
  setVal('dailySteps',      log.steps);
  setVal('waterIntake',     log.water    ?? log.water_intake);
  setVal('sleepHours',      log.sleep    ?? log.sleep_hours);
  setVal('moodLevel',       log.mood);
  setVal('energyLevel',     log.energy   ?? log.energy_level);

  /* ── Swap button text ── */
  const submitBtn = document.querySelector('#activityForm .btn-submit');
  if (submitBtn) {
    submitBtn.innerHTML = '✏️&nbsp; Update Today\'s Log';
    submitBtn.style.background = 'linear-gradient(135deg,#6366f1,#8b5cf6)';  // purple = edit mode
  }

  /* ── Swap form card subtitle ── */
  const subtitle = document.getElementById('formCardSubtitle');
  if (subtitle) subtitle.textContent = 'You already logged today — edit your values and click Update.';

  /* ── Visual badge on header ── */
  const header = document.querySelector('.form-card-header h5');
  if (header && !document.getElementById('editModeBadge')) {
    const badge = document.createElement('span');
    badge.id = 'editModeBadge';
    badge.innerHTML = ' <span style="font-size:0.7rem;font-weight:600;background:rgba(255,255,255,0.22);padding:0.15rem 0.55rem;border-radius:1rem;">EDIT MODE</span>';
    header.appendChild(badge);
  }
}

function initDashboard() {
  const form = document.getElementById('activityForm');

  setDynamicGreeting();
  initMotivationSlider();
  refreshStatCards();

  /* ── Initialization: check for today's existing log ──────────────────
     GLOBAL_LOGS may already be populated if api.js loaded first;
     if it's empty we set up a one-time listener to pre-fill when data arrives. */
  let todayLog = findTodayLog();
  if (todayLog) {
    prefillDashboardForm(todayLog);
  } else {
    // api.js fires 'ft:logsLoaded' after GLOBAL_LOGS is populated
    document.addEventListener('ft:logsLoaded', () => {
      todayLog = findTodayLog();
      if (todayLog) prefillDashboardForm(todayLog);
    }, { once: true });
  }

  /* ── Submit: Save (POST) or Update (PUT) ── */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    /* Collect form values */
    const toNum = (v) => (v !== '' && v !== null && isFinite(Number(v))) ? Number(v) : null;

    const workout   = document.getElementById('workoutType').value;
    const duration  = document.getElementById('workoutDuration').value;
    const intensity = document.getElementById('workoutIntensity').value;
    const notes     = document.getElementById('workoutNotes').value.trim();
    const steps     = document.getElementById('dailySteps').value;
    const water     = document.getElementById('waterIntake').value;
    const sleep     = document.getElementById('sleepHours').value;
    const mood      = document.getElementById('moodLevel').value;
    const energy    = document.getElementById('energyLevel').value;

    /* Validation */
    const errors = [];
    if (!isNaN(toNum(steps)) && toNum(steps) !== null && toNum(steps) < 0) errors.push('Daily Steps cannot be negative.');
    if (!isNaN(toNum(water)) && toNum(water) !== null && toNum(water) < 0) errors.push('Water Intake cannot be negative.');
    if (!isNaN(toNum(sleep)) && toNum(sleep) !== null && toNum(sleep) < 0) errors.push('Sleep Hours cannot be negative.');
    if (!workout) errors.push('Please select a Gym Workout type.');
    if (errors.length > 0) { showAlert('danger', errors); return; }

    const entry = {
      date:      getTodayISO(),
      workout:   workout   || null,
      duration:  toNum(duration),
      intensity: intensity || null,
      notes:     notes     || null,
      steps:     toNum(steps),
      water:     toNum(water),
      sleep:     toNum(sleep),
      mood:      mood      || null,
      energy:    toNum(energy),
    };

    /* ── Resolve current today-log (may have been set after init) ── */
    todayLog = findTodayLog();
    let saved = null;

    if (todayLog && todayLog.id) {
      /* ── UPDATE path: PUT to existing row ── */
      if (typeof apiUpdateLog === 'function') {
        saved = await apiUpdateLog(todayLog.id, entry);
        if (saved) {
          /* Use findIndex to update the in-memory cache in-place */
          const idx = GLOBAL_LOGS.findIndex(l => l.id === todayLog.id);
          const normalised = {
            id: saved.id, date: saved.log_date,
            workout: saved.workout_type, duration: saved.workout_duration,
            intensity: saved.workout_intensity, notes: saved.workout_notes,
            steps: saved.steps, water: saved.water_intake, sleep: saved.sleep_hours,
            mood: saved.mood, energy: saved.energy_level,
          };
          if (idx !== -1) {
            GLOBAL_LOGS[idx] = normalised;
          }
          todayLog = normalised;  // keep reference fresh
          showAlert('success', ['✏️ Today\'s log updated successfully!']);
        } else {
          showAlert('danger', ['❌ Update failed — please try again.']);
          return;
        }
      }
    } else {
      /* ── SAVE path: POST new row ── */
      if (typeof apiSaveLog === 'function') {
        saved = await apiSaveLog(entry);
        if (saved) {
          const normalised = {
            id: saved.id, date: saved.log_date,
            workout: saved.workout_type, duration: saved.workout_duration,
            intensity: saved.workout_intensity, notes: saved.workout_notes,
            steps: saved.steps, water: saved.water_intake, sleep: saved.sleep_hours,
            mood: saved.mood, energy: saved.energy_level,
          };
          GLOBAL_LOGS.push(normalised);
          todayLog = normalised;
          /* Switch UI to update mode for subsequent edits this session */
          prefillDashboardForm(normalised);
          showAlert('success', ['✅ Today\'s log saved successfully!']);
        } else {
          showAlert('danger', ['❌ Save failed — please try again.']);
          return;
        }
      }
    }

    /* ── Dynamic re-render: stat cards + goal cards + step ring ── */
    refreshStatCards();
    if (typeof apiLoadDashboardGoals === 'function') apiLoadDashboardGoals();
  });
}

function refreshStatCards() {
  const logs = getLogs();
  if (logs.length === 0) return;

  /* Prefer today's log for the stat cards; fall back to the most recent */
  const today = getTodayISO();
  const todayEntry = logs.slice().reverse().find(l =>
    String(l.date ?? l.log_date ?? '').slice(0, 10) === today
  ) || logs[logs.length - 1];

  const last = todayEntry;

  if (last.steps !== null && last.steps !== undefined) {
    const el = document.getElementById('statSteps');
    if (el) el.textContent = Number(last.steps).toLocaleString();
    const fill = document.getElementById('statStepsFill');
    if (fill) fill.style.width = pct(last.steps, getGoals().steps) + '%';

    /* Re-render the step ring instantly without waiting for api.js */
    if (typeof renderStepRing === 'function') {
      const goalSteps = getGoals().steps;
      renderStepRing(last.steps, goalSteps);
      const doneEl  = document.getElementById('stepRingDone');
      const leftEl  = document.getElementById('stepRingLeft');
      const goalBdg = document.getElementById('stepRingGoalBadge');
      const goalTxt = document.getElementById('stepRingGoalText');
      if (doneEl)  doneEl.textContent  = Number(last.steps).toLocaleString();
      if (leftEl)  leftEl.textContent  = Math.max(0, goalSteps - last.steps).toLocaleString();
      if (goalBdg) goalBdg.textContent = 'Goal: ' + Number(goalSteps).toLocaleString() + ' steps';
      if (goalTxt) goalTxt.textContent = 'of ' + Number(goalSteps).toLocaleString() + ' steps';
    }
  }

  if (last.water !== null && last.water !== undefined) {
    const el = document.getElementById('statWater');
    if (el) el.textContent = last.water + ' L';
    const fill = document.getElementById('statWaterFill');
    if (fill) fill.style.width = pct(last.water, getGoals().water) + '%';
  }

  if (last.sleep !== null && last.sleep !== undefined) {
    const el = document.getElementById('statSleep');
    if (el) el.textContent = last.sleep + ' hrs';
    const fill = document.getElementById('statSleepFill');
    if (fill) fill.style.width = pct(last.sleep, getGoals().sleep) + '%';
  }

  if (last.workout) {
    const el = document.getElementById('statWorkout');
    if (el) el.textContent = last.workout.length > 10
      ? last.workout.slice(0, 9) + '…'
      : last.workout;
    const fill = document.getElementById('statWorkoutFill');
    if (fill) fill.style.width = '100%';
  }
}

function showAlert(type, msgs) {
  const alertBox = document.getElementById('formAlert');
  if (!alertBox) return;
  alertBox.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show mb-4" role="alert"
         style="border-radius:0.6rem; font-size:0.88rem;">
      ${msgs.map(m => `<div>${m}</div>`).join('')}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>`;
}

function clearAlert() {
  const alertBox = document.getElementById('formAlert');
  if (alertBox) alertBox.innerHTML = '';
}


/* ════════════════════════════════════════════
   2. HISTORY  (history.html)
════════════════════════════════════════════ */

function initHistory() {
  // Only wire up filter listeners — api.js renders the table once data is loaded.
  const fFrom = document.getElementById('filterFrom');
  const fTo = document.getElementById('filterTo');
  const fWorkout = document.getElementById('filterWorkout');
  if (fFrom) fFrom.addEventListener('change', renderHistoryTable);
  if (fTo) fTo.addEventListener('change', renderHistoryTable);
  if (fWorkout) fWorkout.addEventListener('change', renderHistoryTable);
}

function renderHistoryTable() {
  const tbody = document.getElementById('historyTableBody');
  const footerInfo = document.getElementById('tableFooterInfo');

  const fromVal = document.getElementById('filterFrom').value;
  const toVal = document.getElementById('filterTo').value;
  const workoutVal = document.getElementById('filterWorkout').value;

  let logs = getLogs();

  if (fromVal) {
    logs = logs.filter(l => {
      const d = l.date ?? l.log_date;
      return d && String(d).slice(0, 10) >= fromVal;
    });
  }

  if (toVal) {
    logs = logs.filter(l => {
      const d = l.date ?? l.log_date;
      return d && String(d).slice(0, 10) <= toVal;
    });
  }

  if (workoutVal) {
    logs = logs.filter(l => {
      const w = l.workout ?? l.workout_type;
      return w && w.toLowerCase() === workoutVal.toLowerCase();
    });
  }

  logs = [...logs].reverse();

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <p>No entries found. Start logging on the Dashboard!</p>
          </div>
        </td>
      </tr>`;
    footerInfo.textContent = 'No entries match the current filters.';
    return;
  }

  tbody.innerHTML = logs.map(log => buildTableRow(log)).join('');
  footerInfo.textContent =
    `Showing ${logs.length} entr${logs.length === 1 ? 'y' : 'ies'}`;
}

function buildTableRow(log) {
  const dateVal = log.date ?? log.log_date ?? null;
  const workoutVal = log.workout ?? log.workout_type ?? null;
  const stepsVal = log.steps ?? null;
  const waterVal = log.water ?? log.water_intake ?? null;
  const sleepVal = log.sleep ?? log.sleep_hours ?? null;
  const moodVal = log.mood ?? null;

  const dateCell = `<td class="td-date">${formatDate(dateVal)}</td>`;

  const workoutCell = workoutVal
    ? `<td><span class="td-workout">🏋️<span class="workout-badge">${workoutVal}</span></span></td>`
    : `<td><span style="color:#94a3b8;">—</span></td>`;

  let stepsCell = '<td>—</td>';
  if (stepsVal !== null && stepsVal !== undefined) {
    const cls = Number(stepsVal) >= getGoals().steps ? 'steps-goal' : 'steps-low';
    stepsCell = `<td class="td-steps"><span class="${cls}">🦶 ${Number(stepsVal).toLocaleString()}</span></td>`;
  }

  let waterCell = '<td>—</td>';
  if (waterVal !== null && waterVal !== undefined) {
    const safeWater = Number(waterVal) || 0;
    const w = pct(safeWater, getGoals().water);
    waterCell = `<td>
      <div class="water-bar-wrap">
        <div class="water-bar"><div class="water-bar-fill" style="width:${w}%"></div></div>
        <span style="font-size:0.82rem;">${safeWater} L</span>
      </div>
    </td>`;
  }

  let sleepCell = '<td>—</td>';
  if (sleepVal !== null && sleepVal !== undefined) {
    const safeSleep = Number(sleepVal) || 0;
    let pillClass = 'sleep-ok';
    if (safeSleep >= 7) pillClass = 'sleep-good';
    if (safeSleep < 5) pillClass = 'sleep-bad';
    sleepCell = `<td><span class="sleep-pill ${pillClass}">🌙 ${safeSleep} hrs</span></td>`;
  }

  const moodLabel = moodVal ? (MOOD_MAP[String(moodVal)] || '—') : '—';
  const moodCell = `<td style="font-size:0.85rem;">${moodLabel}</td>`;

  const actionCell = `<td class="td-actions">
    <button class="btn-icon" title="Delete entry"
      onclick="deleteLog(${log.id})">🗑</button>
  </td>`;

  return `<tr>${dateCell}${workoutCell}${stepsCell}${waterCell}${sleepCell}${moodCell}${actionCell}</tr>`;
}

async function deleteLog(id) {
  if (!confirm('Delete this log entry?')) return;
  if (typeof apiDeleteLog === 'function') {
    const ok = await apiDeleteLog(id);
    if (ok) {
      GLOBAL_LOGS = GLOBAL_LOGS.filter(l => l.id !== id);
      renderHistoryTable();
    }
  }
}


/* ════════════════════════════════════════════
   3. MEDICATION  (medication.html)
════════════════════════════════════════════ */

const MED_CHECKBOX_IDS = [
  'med_mv', 'med_vd', 'med_vc', 'med_om', 'med_mg',
  'med_zn', 'med_b12', 'med_fe',
  'med_pr', 'med_cr', 'med_bcaa', 'med_pre', 'med_pb', 'med_mel',
];
const MED_TEXT_IDS = [
  'rx1_name', 'rx1_dose', 'rx1_time',
  'rx2_name', 'rx2_dose', 'rx2_time',
  'medNotes',
];

function initMedication() {
  restoreMedState();
  initMedicationReminder();

  const form = document.getElementById('medForm');
  form.addEventListener('change', saveMedState);
  form.addEventListener('input', saveMedState);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveMedState();
    showMedAlert('✅ Medication log saved!');
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      if (GLOBAL_SETTINGS) GLOBAL_SETTINGS.medications_state = null;
      if (typeof apiSaveProfile === 'function') apiSaveProfile();
    }, 50);
  });
}

function saveMedState() {
  const state = {};
  MED_CHECKBOX_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) state[id] = el.checked;
  });
  MED_TEXT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) state[id] = el.value;
  });

  if (!GLOBAL_SETTINGS) GLOBAL_SETTINGS = getSettings();
  GLOBAL_SETTINGS.medications_state = JSON.stringify(state);
  if (typeof apiSaveProfile === 'function') apiSaveProfile();
}

function restoreMedState() {
  const profile = (window.FT && window.FT.profile) || {};
  let state;
  try {
    state = JSON.parse(profile.medications_state || (GLOBAL_SETTINGS && GLOBAL_SETTINGS.medications_state) || '{}');
  } catch { return; }
  if (!state) return;

  MED_CHECKBOX_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && state[id] !== undefined) el.checked = state[id];
  });
  MED_TEXT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && state[id] !== undefined) el.value = state[id];
  });
}

function showMedAlert(msg) {
  const existing = document.getElementById('medSaveAlert');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'medSaveAlert';
  banner.className = 'alert alert-success alert-dismissible fade show mb-4';
  banner.style.cssText = 'border-radius:0.6rem; font-size:0.88rem;';
  banner.innerHTML = `${msg}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;

  const formBody = document.querySelector('#medForm');
  formBody.insertBefore(banner, formBody.firstChild);
  setTimeout(() => banner.remove(), 3000);
}

function initMedicationReminder() {
  const statusEl = document.getElementById('reminderStatus');
  const timeEl = document.getElementById('reminderTime');
  if (!timeEl) return;

  // Listen for changes to the time field
  timeEl.addEventListener('change', () => {
    if (!timeEl.value) return;
    if (!GLOBAL_SETTINGS) GLOBAL_SETTINGS = getSettings();
    GLOBAL_SETTINGS.reminder_time = timeEl.value;
    // Also update the cached profile so alarm checker sees it immediately
    if (window.FT && window.FT.profile) window.FT.profile.reminder_time = timeEl.value;
    if (typeof apiSaveProfile === 'function') apiSaveProfile();
    if (statusEl) statusEl.innerHTML = `🔔 Reminder set for <strong>${timeEl.value}</strong> — active on all pages.`;
  });
}

function saveMedicationReminder() {
  const timeEl = document.getElementById('reminderTime');
  if (!timeEl || !timeEl.value) return;
  if (!GLOBAL_SETTINGS) GLOBAL_SETTINGS = getSettings();
  GLOBAL_SETTINGS.reminder_time = timeEl.value;
  if (window.FT && window.FT.profile) window.FT.profile.reminder_time = timeEl.value;
  if (typeof apiSaveProfile === 'function') apiSaveProfile();
}


/* ════════════════════════════════════════════
   4. AWARDS  (awards.html)
════════════════════════════════════════════ */

const BADGE_RULES = {
  streak7: (logs) => {
    if (logs.length < 7) return false;
    const days = [...new Set(logs.map(l => String(l.date ?? l.log_date).slice(0, 10)))].sort();
    for (let i = 0; i <= days.length - 7; i++) {
      let ok = true;
      for (let j = 1; j < 7; j++) {
        const diff = (new Date(days[i + j]) - new Date(days[i + j - 1])) / 86400000;
        if (diff !== 1) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  },

  hydrationHero: (logs) => {
    const byDay = {};
    logs.forEach(l => {
      const day = String(l.date ?? l.log_date).slice(0, 10);
      const w = l.water ?? l.water_intake;
      if (w !== null) byDay[day] = Math.max(byDay[day] || 0, w);
    });
    const days = Object.keys(byDay).sort();
    let streak = 0;
    for (const d of days) {
      if (byDay[d] >= 3) { streak++; if (streak >= 5) return true; }
      else streak = 0;
    }
    return false;
  },

  stepMaster: (logs) =>
    logs.some(l => (l.steps ?? 0) >= 10000),

  sleepChampion: (logs) => {
    const byDay = {};
    logs.forEach(l => {
      const day = String(l.date ?? l.log_date).slice(0, 10);
      const s = l.sleep ?? l.sleep_hours;
      if (s !== null) byDay[day] = Math.max(byDay[day] || 0, s);
    });
    const days = Object.keys(byDay).sort();
    let streak = 0;
    for (const d of days) {
      if (byDay[d] >= 8) { streak++; if (streak >= 3) return true; }
      else streak = 0;
    }
    return false;
  },

  warrior30: (logs) => {
    const days = [...new Set(logs.map(l => String(l.date ?? l.log_date).slice(0, 10)))].sort();
    if (days.length < 30) return false;
    for (let i = 0; i <= days.length - 30; i++) {
      let ok = true;
      for (let j = 1; j < 30; j++) {
        if ((new Date(days[i + j]) - new Date(days[i + j - 1])) / 86400000 !== 1) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  },

  gymRat: (logs) => {
    const types = ['chest day', 'back & biceps', 'leg day', 'shoulders & triceps', 'full body'];
    return logs.filter(l => {
      const w = ((l.workout ?? l.workout_type) || '').toLowerCase();
      return types.includes(w);
    }).length >= 20;
  },

  medCompliant: (logs) => {
    const profile = (window.FT && window.FT.profile) || {};
    if (!profile.medications_state) return false;
    return BADGE_RULES.streak7(logs);
  },

  earlyBird: (logs) => {
    return logs.filter(l => {
      const dateStr = l.date ?? l.log_date;
      if (!dateStr) return false;
      const h = new Date(dateStr).getHours();
      const w = l.workout ?? l.workout_type;
      return w && h < 7;
    }).length >= 5;
  },

  cardioKing: (logs) => {
    const types = ['running', 'cycling', 'hiit', 'swimming'];
    return logs.filter(l => {
      const w = ((l.workout ?? l.workout_type) || '').toLowerCase();
      return types.includes(w);
    }).length >= 10;
  },

  mindBody: (logs) => {
    const days = new Set(
      logs.filter(l => l.mood === '4' || l.mood === '5')
        .map(l => String(l.date ?? l.log_date).slice(0, 10))
    );
    return days.size >= 10;
  },

  calorieCruncher: (logs) => {
    const days = [...new Set(logs.map(l => String(l.date ?? l.log_date).slice(0, 10)))].sort();
    if (days.length < 14) return false;
    for (let i = 0; i <= days.length - 14; i++) {
      let ok = true;
      for (let j = 1; j < 14; j++) {
        if ((new Date(days[i + j]) - new Date(days[i + j - 1])) / 86400000 !== 1) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  },

  perfectWeek: (logs) => {
    const goals = getGoals();
    const byDay = {};
    logs.forEach(l => {
      const day = String(l.date ?? l.log_date).slice(0, 10);
      if (!byDay[day]) byDay[day] = { steps: 0, water: 0, sleep: 0 };
      const s = l.steps ?? 0, w = l.water ?? l.water_intake ?? 0, sl = l.sleep ?? l.sleep_hours ?? 0;
      byDay[day].steps = Math.max(byDay[day].steps, s);
      byDay[day].water = Math.max(byDay[day].water, w);
      byDay[day].sleep = Math.max(byDay[day].sleep, sl);
    });
    const days = Object.keys(byDay).sort();
    if (days.length < 7) return false;
    for (let i = 0; i <= days.length - 7; i++) {
      let ok = true;
      for (let j = 0; j < 7; j++) {
        const d = byDay[days[i + j]];
        if (d.steps < goals.steps || d.water < goals.water || d.sleep < 7) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  },
};

function unlockBadgeCard(card) {
  card.classList.remove('locked');
  const tag = card.querySelector('.badge-status-tag');
  if (tag) {
    tag.className = 'badge-status-tag badge-earned';
    tag.innerHTML = '<i class="fa-solid fa-trophy"></i> Earned';
  }
}

function initAwards() {
  const logs = getLogs();
  const cards = document.querySelectorAll('.badge-card[data-badge]');
  let unlockedCount = 0;

  cards.forEach(card => {
    const key = card.dataset.badge;
    const rule = BADGE_RULES[key];
    if (rule && rule(logs)) { unlockBadgeCard(card); unlockedCount++; }
  });

  const lockedCount = TOTAL_BADGES - unlockedCount;
  document.getElementById('psUnlocked').textContent = unlockedCount;
  document.getElementById('psLocked').textContent = lockedCount;
  document.getElementById('psBarFill').style.width = pct(unlockedCount, TOTAL_BADGES) + '%';
  document.getElementById('psBarNote').innerHTML =
    `${unlockedCount} of ${TOTAL_BADGES} badges earned &nbsp;&middot;&nbsp; ${unlockedCount === TOTAL_BADGES ? '🎉 All badges earned!' : 'Keep going!'
    }`;
}


/* ════════════════════════════════════════════
   5. SETTINGS  (settings.html)
════════════════════════════════════════════ */

let _settingsInitDone = false;
function initSettings() {
  if (_settingsInitDone) return;  // guard: only wire listeners once
  _settingsInitDone = true;

  // Tab switching — event delegation on the nav container for reliability
  const nav = document.getElementById('settingsNav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('.settings-nav-item[data-tab]');
      if (!item) return;

      // Deactivate all tabs
      nav.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));

      // Activate clicked tab
      item.classList.add('active');
      const panel = document.getElementById('panel-' + item.dataset.tab);
      if (panel) panel.classList.add('active');

      // Lazy-load data tab stats
      if (item.dataset.tab === 'data') {
        if (typeof apiRefreshDataStats === 'function') apiRefreshDataStats();
      }
    });
  }

  // Range sliders live display
  bindRangeDisplay('s_goalSteps', 'disp_steps', v => Number(v).toLocaleString() + ' steps');
  bindRangeDisplay('s_goalWater', 'disp_water', v => v + ' L');
  bindRangeDisplay('s_goalSleep', 'disp_sleep', v => v + ' hrs');
  bindRangeDisplay('s_goalWorkoutDays', 'disp_workoutdays', v => v + ' days');

  // Import file input
  const fileInput = document.getElementById('importFileInput');
  if (fileInput) fileInput.addEventListener('change', handleImportFile);
}

function saveSettings() {
  if (!GLOBAL_SETTINGS) GLOBAL_SETTINGS = Object.assign({}, DEFAULT_SETTINGS);
  const s = GLOBAL_SETTINGS;

  // Profile
  s.name = val('s_name');
  s.dob = val('s_dob');
  s.gender = val('s_gender');
  s.height = val('s_height');
  s.weight = val('s_weight');
  s.bio = val('s_bio');

  // Goals
  s.goalSteps = Number(val('s_goalSteps')) || 10000;
  s.goalWater = Number(val('s_goalWater')) || 3;
  s.goalSleep = Number(val('s_goalSleep')) || 8;
  s.goalWorkoutDays = Number(val('s_goalWorkoutDays')) || 4;

  // Notifications
  s.n_dailyLog = checked('n_dailyLog');
  s.n_medication = checked('n_medication');
  s.n_hydration = checked('n_hydration');
  s.n_weekly = checked('n_weekly');
  s.n_awards = checked('n_awards');

  // Appearance — theme buttons
  const activeThemeBtn = document.querySelector('.theme-btn.active');
  if (activeThemeBtn) {
    const theme = activeThemeBtn.dataset.theme;
    s.darkMode = (theme === 'dark');
    s.theme = theme;
    // ── Cache in sessionStorage immediately so all pages pick it up ──
    sessionStorage.setItem('ft_theme', theme);
  }
  s.lang = val('s_lang');
  s.dateFormat = val('s_dateFormat');
  s.units = val('s_units');

  persistSettings(s);

  // Update profile cache so applyDarkMode reads the new value
  if (window.FT && window.FT.profile) {
    window.FT.profile.theme = s.darkMode ? 'dark' : 'light';
  }

  applyDarkMode();

  if (typeof apiSaveProfile === 'function') apiSaveProfile();
  showSettingsAlert('success', '✅ Settings saved successfully!');
}

function restoreSettings() {
  const profile = (window.FT && window.FT.profile) || {};
  const s = GLOBAL_SETTINGS || {};

  // Merge: profile (SQLite) takes precedence
  const name = profile.name || s.name || '';
  const dob = profile.dob || s.dob || '';
  const gender = profile.gender || s.gender || '';
  const height = profile.height || s.height || '';
  const weight = profile.weight || s.weight || '';
  const bio = profile.bio || s.bio || '';

  setVal('s_name', name);
  setVal('s_dob', dob);
  setVal('s_gender', gender);
  setVal('s_height', height);
  setVal('s_weight', weight);
  setVal('s_bio', bio);

  const goalSteps = profile.goal_steps || s.goalSteps || 10000;
  const goalWater = profile.goal_water || s.goalWater || 3;
  const goalSleep = profile.goal_sleep || s.goalSleep || 8;
  const goalWorkoutDays = profile.goal_workout_days || s.goalWorkoutDays || 4;

  setVal('s_goalSteps', goalSteps);
  setVal('s_goalWater', goalWater);
  setVal('s_goalSleep', goalSleep);
  setVal('s_goalWorkoutDays', goalWorkoutDays);

  setText('disp_steps', Number(goalSteps).toLocaleString() + ' steps');
  setText('disp_water', goalWater + ' L');
  setText('disp_sleep', goalSleep + ' hrs');
  setText('disp_workoutdays', goalWorkoutDays + ' days');

  setChecked('n_dailyLog', profile.n_daily_log !== undefined ? !!profile.n_daily_log : s.n_dailyLog);
  setChecked('n_medication', profile.n_medication !== undefined ? !!profile.n_medication : s.n_medication);
  setChecked('n_hydration', profile.n_hydration !== undefined ? !!profile.n_hydration : s.n_hydration);
  setChecked('n_weekly', profile.n_weekly !== undefined ? !!profile.n_weekly : s.n_weekly);
  setChecked('n_awards', profile.n_awards !== undefined ? !!profile.n_awards : s.n_awards);

  // Theme buttons
  const theme = profile.theme || (s.darkMode ? 'dark' : 'light');
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  setVal('s_lang', profile.language || s.lang || 'en');
  setVal('s_dateFormat', profile.date_format || s.dateFormat || 'DD Mon YYYY');
  setVal('s_units', profile.units || s.units || 'metric');
}

function refreshDataStats() {
  if (typeof apiRefreshDataStats === 'function') apiRefreshDataStats();
}

/* Danger zone */
async function clearActivityLogs() {
  if (!confirm('Delete all activity logs? This cannot be undone.')) return;
  try {
    // Fetch all logs and delete each one
    const logs = await apiFetchLogs();
    for (const log of logs) {
      await apiDeleteLog(log.id);
    }
    GLOBAL_LOGS = [];
    showSettingsAlert('warning', '🗑 All activity logs cleared.');
    apiRefreshDataStats();
  } catch (e) {
    showSettingsAlert('danger', '❌ Failed to clear logs.');
  }
}

function clearMedData() {
  if (!confirm('Reset all medication data? This cannot be undone.')) return;
  if (GLOBAL_SETTINGS) GLOBAL_SETTINGS.medications_state = null;
  if (window.FT && window.FT.profile) window.FT.profile.medications_state = null;
  if (typeof apiSaveProfile === 'function') apiSaveProfile();
  showSettingsAlert('warning', '🗑 Medication data cleared.');
}

async function resetAllData() {
  if (!confirm('⚠️ This will wipe ALL FitTrack data. Are you sure?')) return;
  await clearActivityLogs();
  clearMedData();
  GLOBAL_LOGS = [];
  GLOBAL_SETTINGS = Object.assign({}, DEFAULT_SETTINGS);
  if (window.FT) window.FT.profile = null;
  if (typeof apiSaveProfile === 'function') apiSaveProfile();
  showSettingsAlert('danger', '⚠️ All data has been reset.');
  apiRefreshDataStats();
}

/* Export / Import */
function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    logs: getLogs(),
    settings: getSettings(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fittrack-export-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showSettingsAlert('success', '📥 Data exported successfully!');
}

function importData() {
  document.getElementById('importFileInput').click();
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (Array.isArray(parsed.logs)) {
        let count = 0;
        for (const log of parsed.logs) {
          await apiSaveLog({ ...log, date: log.date || log.log_date });
          count++;
        }
        showSettingsAlert('success', `📂 Imported ${count} log entries.`);
        apiRefreshDataStats();
      } else {
        showSettingsAlert('danger', '❌ Invalid file format.');
      }
    } catch {
      showSettingsAlert('danger', '❌ Could not parse the file.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function showSettingsAlert(type, msg) {
  const box = document.getElementById('settingsAlert');
  if (!box) return;
  box.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show mb-3" role="alert"
         style="border-radius:0.6rem; font-size:0.88rem;">
      ${msg}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
  setTimeout(() => { if (box.firstChild) box.firstChild.remove(); }, 4000);
}

/* DOM helpers */
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function checked(id) { const el = document.getElementById(id); return el ? el.checked : false; }
function setVal(id, v) { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; }
function setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function bindRangeDisplay(rangeId, displayId, formatter) {
  const range = document.getElementById(rangeId);
  const display = document.getElementById(displayId);
  if (!range || !display) return;
  range.addEventListener('input', () => { display.textContent = formatter(range.value); });
  display.textContent = formatter(range.value);
}


/* ════════════════════════════════════════════
   6. GREETING & DATE  (index.html)
════════════════════════════════════════════ */

function setDynamicGreeting() {
  const greetingEl = document.getElementById('greeting');
  const dateEl = document.getElementById('currentDate');
  if (!greetingEl || !dateEl) return;

  const now = new Date();
  const hour = now.getHours();
  const name = getSettings().name || (window.FT && window.FT.profile && window.FT.profile.name) || '';

  let period, icon;
  if (hour >= 5 && hour < 12) { period = 'Good morning'; icon = '☀️'; }
  else if (hour >= 12 && hour < 17) { period = 'Good afternoon'; icon = '🌤️'; }
  else if (hour >= 17 && hour < 21) { period = 'Good evening'; icon = '🌇'; }
  else { period = 'Good night'; icon = '🌙'; }

  greetingEl.textContent = name
    ? `${period}, ${name}! ${icon}`
    : `${period}! ${icon}`;

  const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekNum = getWeekNumber(now);
  dateEl.innerHTML = `${dayName}, ${dateStr} &nbsp;&middot;&nbsp; Week ${weekNum}`;
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}


/* ════════════════════════════════════════════
   7. MOTIVATIONAL SLIDER  (index.html)
════════════════════════════════════════════ */

function initMotivationSlider() {
  const slider = document.getElementById('motSlider');
  if (!slider) return;

  const slides = slider.querySelectorAll('.mot-slide');
  const dots = slider.querySelectorAll('.mot-dot');
  let current = 0;

  function goTo(index) {
    slides[current].classList.remove('active');
    dots[current] && dots[current].classList.remove('active');
    current = (index + slides.length) % slides.length;
    slides[current].classList.add('active');
    dots[current] && dots[current].classList.add('active');
  }

  setInterval(() => goTo(current + 1), 4000);
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
}


/* ════════════════════════════════════════════
   8. DARK MODE  (all pages)
════════════════════════════════════════════ */

function applyDarkMode() {
  // Priority: live profile > sessionStorage cache > in-memory settings
  const profile = (window.FT && window.FT.profile) || {};
  const sessionTheme = sessionStorage.getItem('ft_theme');
  const settings = getSettings();

  const isDark = profile.theme === 'dark'
    || sessionTheme === 'dark'
    || settings.darkMode;

  if (isDark) {
    document.body.classList.add('dark-mode');
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.body.classList.remove('dark-mode');
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

/* Inject shared dark-mode CSS for pages that don't have it inline */
(function injectGlobalDarkCSS() {
  if (document.getElementById('globalDarkCSS')) return;
  const style = document.createElement('style');
  style.id = 'globalDarkCSS';
  style.textContent = `
    :root[data-theme="dark"] {
      --bg: #0f172a; --text: #e2e8f0; --muted: #94a3b8;
      --border: #1e293b; --card-bg: #1e293b;
    }
    body.dark-mode { background: #0f172a !important; color: #e2e8f0 !important; }
    body.dark-mode .main-content { background: #0f172a; }
    body.dark-mode .stat-card,
    body.dark-mode .form-card,
    body.dark-mode .table-card,
    body.dark-mode .log-card,
    body.dark-mode .settings-card,
    body.dark-mode .settings-nav { background: #1e293b !important; border-color: #334155 !important; }
    body.dark-mode .settings-card-header { background: #0f172a; border-color: #334155; }
    body.dark-mode .settings-card-header h6 { color: #e2e8f0; }
    body.dark-mode .form-control,
    body.dark-mode .form-select { background: #0f172a !important; border-color: #334155 !important; color: #e2e8f0 !important; }
    body.dark-mode .form-label { color: #cbd5e1; }
    body.dark-mode .topbar-title { color: #e2e8f0 !important; }
    body.dark-mode .stat-value   { color: #e2e8f0 !important; }
    body.dark-mode .stat-label   { color: #94a3b8 !important; }
    body.dark-mode .history-table thead tr { background: #1e293b; }
    body.dark-mode .history-table tbody td { color: #e2e8f0; }
    body.dark-mode .history-table tbody tr:hover { background: #334155; }
    body.dark-mode .filter-bar  { background: #1e293b; }
    body.dark-mode .table-footer { background: #1e293b; }
    body.dark-mode .med-item { background: #1e293b !important; border-color: #334155 !important; }
    body.dark-mode .info-banner { background: rgba(6,182,212,0.05); }
    body.dark-mode .data-stat { background: #0f172a; border-color: #334155; }
    body.dark-mode .data-stat-value { color: #e2e8f0; }
    body.dark-mode .toggle-row { border-color: #334155; }
    body.dark-mode .t-label { color: #e2e8f0; }
    body.dark-mode .section-label { color: #22d3ee; border-color: #334155; }
    body.dark-mode .goal-card { background: #1e293b !important; border-color: #334155 !important; }
    body.dark-mode .goal-label { color: #94a3b8 !important; }
    body.dark-mode .goal-sub { color: #64748b !important; }
  `;
  document.head.appendChild(style);
})();
