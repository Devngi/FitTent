/**
 * ============================================================
 *  FitTent — prescription_alarm.js
 *  Prescription & Alarm Manager module.
 *
 *  Responsibilities:
 *    1. CRUD calls to /api/prescriptions
 *    2. Render the "Current Prescriptions" dashboard grid
 *    3. setInterval alarm loop — fires once per rx per day
 *    4. Web Audio API tone synthesis
 *    5. Stylized in-page toast notifications
 * ============================================================
 */

'use strict';

/* ── Constants ─────────────────────────────────────────── */
const RX_API         = '/api/prescriptions';
const ALARM_CHECK_MS = 30000; // check every 30 seconds

/**
 * Tracks alarms already fired today.
 * Key format: "rxId_YYYY-MM-DD"
 */
const _firedAlarms = new Set();

/* ── Pill visual config ────────────────────────────────── */
const PILL_SHAPES = {
  round:   '⬤',
  oval:    '⬬',
  capsule: '💊',
  square:  '■',
  diamond: '◆',
};

const TYPE_LABELS = {
  pill:      { label: 'Pill',      icon: '💊', bg: 'rgba(13,148,136,0.12)',  color: '#0d9488' },
  liquid:    { label: 'Liquid',    icon: '🧴', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
  injection: { label: 'Injection', icon: '💉', bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  patch:     { label: 'Patch',     icon: '🩹', bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
  inhaler:   { label: 'Inhaler',   icon: '🌬️', bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
};

const WORKOUT_LABELS = {
  pre:       '🏃 Pre-workout',
  post:      '💪 Post-workout',
  with_meal: '🍽️ With meal',
  none:      '—',
};

/* ══════════════════════════════════════════════════════════
   1. API HELPERS
══════════════════════════════════════════════════════════ */

async function rxFetchAll() {
  const res = await fetch(RX_API);
  if (!res.ok) throw new Error('Failed to fetch prescriptions');
  return res.json();
}

async function rxCreate(data) {
  const res = await fetch(RX_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save prescription');
  }
  return res.json();
}

async function rxDelete(id) {
  const res = await fetch(RX_API + '/' + id, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete prescription');
}

/* ══════════════════════════════════════════════════════════
   2. DASHBOARD RENDER
══════════════════════════════════════════════════════════ */

function rxRenderDashboard(prescriptions) {
  const grid       = document.getElementById('rxDashboardGrid');
  const emptyState = document.getElementById('rxEmptyState');
  const counter    = document.getElementById('rxCount');

  if (!grid) return;

  if (counter) counter.textContent = prescriptions.length;

  if (prescriptions.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  grid.innerHTML = prescriptions.map(rx => rxCardHTML(rx)).join('');
}

function rxCardHTML(rx) {
  const typeInfo    = TYPE_LABELS[rx.med_type] || TYPE_LABELS.pill;
  const shapeSymbol = PILL_SHAPES[rx.pill_shape] || '⬤';
  const workoutTxt  = WORKOUT_LABELS[rx.workout_intake] || '—';
  const alarmTxt    = rx.alarm_time ? ('⏰ ' + rx.alarm_time) : '—';
  const endDateTxt  = rx.end_date   ? rx.end_date             : 'Ongoing';

  const todayKey   = rx.id + '_' + todayStr();
  const alarmFired = _firedAlarms.has(todayKey);
  const alarmBadge = rx.alarm_time
    ? ('<span class="rx-alarm-badge' + (alarmFired ? ' fired' : '') + '">' + alarmTxt + '</span>')
    : '';

  const contrastColor = lightenHex(rx.pill_color);

  return '<div class="rx-card" id="rx-card-' + rx.id + '" data-rx-id="' + rx.id + '">' +
    '<div class="rx-card-header" style="background: linear-gradient(135deg,' + rx.pill_color + '22,' + rx.pill_color + '44);">' +
      '<div class="rx-swatch" style="background:' + rx.pill_color + '; box-shadow: 0 4px 14px ' + rx.pill_color + '55;">' +
        '<span class="rx-shape-symbol" style="color:' + contrastColor + ';">' + shapeSymbol + '</span>' +
      '</div>' +
      '<div class="rx-type-badge" style="background:' + typeInfo.bg + '; color:' + typeInfo.color + ';">' +
        typeInfo.icon + ' ' + typeInfo.label +
      '</div>' +
      '<button class="rx-delete-btn" onclick="rxHandleDelete(' + rx.id + ')" title="Delete">✕</button>' +
    '</div>' +
    '<div class="rx-card-body">' +
      '<div class="rx-name">' + escHtml(rx.med_name) + '</div>' +
      '<div class="rx-dosage">' + escHtml(rx.dosage) + ' ' + escHtml(rx.dosage_unit) + '</div>' +
      '<div class="rx-meta">' +
        '<div class="rx-meta-row"><span class="rx-meta-label">Workout</span><span class="rx-meta-value">' + workoutTxt + '</span></div>' +
        '<div class="rx-meta-row"><span class="rx-meta-label">Until</span><span class="rx-meta-value">' + escHtml(endDateTxt) + '</span></div>' +
      '</div>' +
      alarmBadge +
      (rx.notes ? '<div class="rx-notes">' + escHtml(rx.notes) + '</div>' : '') +
    '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════
   3. FORM HANDLING
══════════════════════════════════════════════════════════ */

async function rxHandleSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('rxSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const gv = function(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  };

  const data = {
    med_name:       gv('rxMedName').trim()    || '',
    med_type:       gv('rxMedType')            || 'pill',
    dosage:         gv('rxDosage').trim()      || '',
    dosage_unit:    gv('rxDosageUnit')         || 'mg',
    start_date:     gv('rxStartDate')          || null,
    end_date:       gv('rxEndDate')            || null,
    workout_intake: gv('rxWorkoutIntake')      || 'none',
    alarm_time:     gv('rxAlarmTime')          || null,
    pill_color:     gv('rxPillColor')          || '#0d9488',
    pill_shape:     gv('rxPillShape')          || 'round',
    notes:          gv('rxNotes').trim()       || null,
  };

  if (!data.med_name) {
    showRxToast('⚠️ Please enter a medication name.', 'warning');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Save Prescription'; }
    return;
  }

  try {
    await rxCreate(data);
    showRxToast('💊 "' + data.med_name + '" saved successfully!', 'success');
    document.getElementById('rxForm').reset();
    var colorEl   = document.getElementById('rxPillColor');
    var previewEl = document.getElementById('rxColorPreview');
    if (colorEl && previewEl) previewEl.style.background = colorEl.value;
    await rxRefreshDashboard();
  } catch (err) {
    showRxToast('❌ ' + err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Save Prescription'; }
  }
}

async function rxHandleDelete(id) {
  var card = document.getElementById('rx-card-' + id);
  var name = card && card.querySelector('.rx-name') ? card.querySelector('.rx-name').textContent : 'this prescription';
  if (!confirm('Delete "' + name + '"?')) return;

  try {
    await rxDelete(id);
    if (card) {
      card.style.transition = 'all 0.3s ease';
      card.style.opacity    = '0';
      card.style.transform  = 'scale(0.9)';
      setTimeout(function() { card.remove(); }, 300);
    }
    var counter = document.getElementById('rxCount');
    if (counter) counter.textContent = Math.max(0, parseInt(counter.textContent || '0') - 1);
    showRxToast('🗑️ Prescription deleted.', 'warning');

    setTimeout(function() {
      var grid = document.getElementById('rxDashboardGrid');
      if (grid && grid.querySelectorAll('.rx-card').length === 0) {
        var emptyState = document.getElementById('rxEmptyState');
        if (emptyState) emptyState.style.display = 'flex';
        if (counter) counter.textContent = '0';
      }
    }, 350);
  } catch (err) {
    showRxToast('❌ ' + err.message, 'danger');
  }
}

async function rxRefreshDashboard() {
  try {
    var prescriptions = await rxFetchAll();
    rxRenderDashboard(prescriptions);
    return prescriptions;
  } catch (err) {
    console.warn('[RxAlarm] Could not refresh dashboard:', err);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   4. ALARM LOOP
══════════════════════════════════════════════════════════ */

var _alarmIntervalId       = null;
var _cachedPrescriptions   = [];

function startAlarmLoop() {
  rxRefreshDashboard().then(function(rxs) { _cachedPrescriptions = rxs; });

  // Re-fetch every 5 minutes to stay in sync
  setInterval(function() {
    rxRefreshDashboard().then(function(rxs) { _cachedPrescriptions = rxs; });
  }, 5 * 60 * 1000);

  // Check alarms every 30 seconds
  _alarmIntervalId = setInterval(function() {
    checkAlarms(_cachedPrescriptions);
  }, ALARM_CHECK_MS);
}

function checkAlarms(prescriptions) {
  if (!Array.isArray(prescriptions) || prescriptions.length === 0) return;

  var now     = new Date();
  var hh      = String(now.getHours()).padStart(2, '0');
  var mm      = String(now.getMinutes()).padStart(2, '0');
  var nowHHMM = hh + ':' + mm;
  var today   = todayStr();

  for (var i = 0; i < prescriptions.length; i++) {
    var rx = prescriptions[i];
    if (!rx.alarm_time) continue;

    var key = rx.id + '_' + today;

    if (rx.alarm_time === nowHHMM && !_firedAlarms.has(key)) {
      _firedAlarms.add(key);
      triggerAlarm(rx);

      var badge = document.querySelector('#rx-card-' + rx.id + ' .rx-alarm-badge');
      if (badge) badge.classList.add('fired');
    }
  }
}

function triggerAlarm(rx) {
  var tune = (document.getElementById('alarmTune') || {}).value || 'chime';
  if (typeof window.playReminderBeep === 'function') {
    window.playReminderBeep();
  } else {
    playRxTone(tune);
  }
  showAlarmToast(rx);
}

/* ══════════════════════════════════════════════════════════
   5. WEB AUDIO API — TONE SYNTHESIS
══════════════════════════════════════════════════════════ */

function playRxTone(tune) {
  tune = tune || 'chime';
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var t   = ctx.currentTime;

    function note(freq, start, dur, type, vol) {
      type = type || 'sine';
      vol  = vol  || 0.45;
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type            = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur + 0.01);
    }

    if (tune === 'beep') {
      note(880, t,       0.2);
      note(880, t + 0.3, 0.2);
    } else if (tune === 'melody') {
      var freqs = [523, 587, 659, 698, 784];
      for (var i = 0; i < freqs.length; i++) {
        note(freqs[i], t + i * 0.18, 0.15);
      }
    } else {
      note(523.25, t,       0.25);
      note(659.25, t + 0.3, 0.25);
      note(783.99, t + 0.6, 0.25);
      note(1046.5, t + 0.9, 0.5);
    }
  } catch (e) {
    console.warn('[RxAlarm] Web Audio API error:', e);
  }
}

/* ══════════════════════════════════════════════════════════
   6. TOAST NOTIFICATIONS
══════════════════════════════════════════════════════════ */

function showRxToast(message, type) {
  type = type || 'success';
  var container = _ensureToastContainer();
  var id        = 'rx-toast-' + Date.now();
  var colors    = {
    success: { bg: '#0d9488', icon: '✅' },
    warning: { bg: '#f59e0b', icon: '⚠️' },
    danger:  { bg: '#ef4444', icon: '❌' },
    info:    { bg: '#3b82f6', icon: 'ℹ️' },
  };
  var c = colors[type] || colors.info;

  var el       = document.createElement('div');
  el.id        = id;
  el.className = 'rx-toast';
  el.innerHTML =
    '<div class="rx-toast-icon" style="background:' + c.bg + ';">' + c.icon + '</div>' +
    '<div class="rx-toast-body">' + message + '</div>' +
    '<button class="rx-toast-close" onclick="document.getElementById(\'' + id + '\')?.remove()">✕</button>';

  container.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });

  setTimeout(function() {
    el.classList.remove('show');
    setTimeout(function() { el.remove(); }, 350);
  }, 4000);
}

function showAlarmToast(rx) {
  var container = _ensureToastContainer();
  var id        = 'rx-alarm-toast-' + rx.id + '-' + Date.now();
  var typeInfo  = TYPE_LABELS[rx.med_type] || TYPE_LABELS.pill;

  var el       = document.createElement('div');
  el.id        = id;
  el.className = 'rx-toast rx-alarm-toast';
  el.innerHTML =
    '<div class="rx-toast-alarm-swatch" style="background:' + rx.pill_color + ';"></div>' +
    '<div class="rx-toast-body">' +
      '<div class="rx-toast-alarm-title">⏰ Medication Alarm!</div>' +
      '<div class="rx-toast-alarm-med">' + typeInfo.icon + ' <strong>' + escHtml(rx.med_name) + '</strong></div>' +
      '<div class="rx-toast-alarm-sub">' + escHtml(rx.dosage) + ' ' + escHtml(rx.dosage_unit) + ' · ' + typeInfo.label + '</div>' +
    '</div>' +
    '<button class="rx-toast-close" onclick="document.getElementById(\'' + id + '\')?.remove()">✕</button>';

  container.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });

  setTimeout(function() {
    el.classList.remove('show');
    setTimeout(function() { el.remove(); }, 350);
  }, 10000);
}

function _ensureToastContainer() {
  var c = document.getElementById('rxToastContainer');
  if (!c) {
    c    = document.createElement('div');
    c.id = 'rxToastContainer';
    c.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.75rem;max-width:340px;pointer-events:none;';
    document.body.appendChild(c);
    _injectToastStyles();
  }
  return c;
}

function _injectToastStyles() {
  if (document.getElementById('rxToastStyles')) return;
  var s   = document.createElement('style');
  s.id    = 'rxToastStyles';
  s.textContent = [
    '.rx-toast{display:flex;align-items:center;gap:.75rem;background:var(--card-bg,#fff);border:1px solid var(--border,#e2e8f0);border-radius:.8rem;padding:.8rem 1rem;box-shadow:0 8px 32px rgba(0,0,0,.18);opacity:0;transform:translateX(120%);transition:all .35s cubic-bezier(.34,1.56,.64,1);pointer-events:all;}',
    '.rx-toast.show{opacity:1;transform:translateX(0);}',
    '.rx-toast-icon{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;}',
    '.rx-toast-body{flex:1;font-size:.85rem;color:var(--text,#1e293b);line-height:1.4;}',
    '.rx-toast-close{background:none;border:none;font-size:.8rem;color:var(--muted,#94a3b8);cursor:pointer;flex-shrink:0;padding:0;}',
    '.rx-alarm-toast{border-left:4px solid #f59e0b;}',
    '.rx-toast-alarm-swatch{width:10px;border-radius:99px;align-self:stretch;flex-shrink:0;}',
    '.rx-toast-alarm-title{font-size:.78rem;font-weight:700;color:#f59e0b;letter-spacing:.04em;text-transform:uppercase;}',
    '.rx-toast-alarm-med{font-size:.92rem;font-weight:600;margin-top:2px;}',
    '.rx-toast-alarm-sub{font-size:.78rem;color:var(--muted,#94a3b8);}',
  ].join('');
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════
   7. UTILITY HELPERS
══════════════════════════════════════════════════════════ */

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function lightenHex(hex) {
  try {
    var r    = parseInt(hex.slice(1, 3), 16);
    var g    = parseInt(hex.slice(3, 5), 16);
    var b    = parseInt(hex.slice(5, 7), 16);
    var luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return luma > 160 ? '#1e293b' : '#ffffff';
  } catch (e) { return '#ffffff'; }
}

function rxInitColorPreview() {
  var colorInput = document.getElementById('rxPillColor');
  var preview    = document.getElementById('rxColorPreview');
  if (!colorInput || !preview) return;
  function update() {
    preview.style.background = colorInput.value;
    preview.style.boxShadow  = '0 4px 14px ' + colorInput.value + '66';
  }
  colorInput.addEventListener('input', update);
  update();
}

/* ══════════════════════════════════════════════════════════
   8. INITIALISATION  (runs when medication.html is loaded)
══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function() {
  if (!document.getElementById('rxForm')) return; // not on medication.html

  document.getElementById('rxForm').addEventListener('submit', rxHandleSubmit);
  rxInitColorPreview();
  startAlarmLoop();
});
