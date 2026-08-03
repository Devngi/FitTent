/**
 * ============================================================
 *  FitTrack — charts.js  (v2 — zoom + rich tooltips)
 *  Requires (loaded via CDN in <head>):
 *    1. Chart.js  v4
 *    2. Hammer.js v2
 *    3. chartjs-plugin-zoom v2
 *
 *  Public API:
 *    renderStepRing(steps, goalSteps)        — index.html doughnut ring
 *    renderTrendFromAPI(metric)              — history.html, fetches data.json
 *    renderTrendChart(logs, metric)          — history.html, uses GLOBAL_LOGS
 *
 *  Internal design:
 *    • Colors always read from CSS :root variables → auto light/dark mode.
 *    • window._FT_charts stores instances for clean destroy-before-redraw.
 *    • window._FT_rawLogs caches fetched data.json for instant metric switching.
 * ============================================================
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */

function _cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function _applyGlobalDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color       = _cssVar('--text') || '#1e293b';
  Chart.defaults.font.family = "'Inter', sans-serif";
}

/* Global namespaces */
window._FT_charts  = window._FT_charts  || {};   // chart instances
window._FT_rawLogs = window._FT_rawLogs || null;  // cached data.json payload


/* ─────────────────────────────────────────────────────────────
   MOOD VALUE MAP  (text stored in DB → numeric 1-5 for plotting)
───────────────────────────────────────────────────────────── */
var MOOD_TO_NUM = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
var MOOD_LABELS = {
  '1': '😢 Burned out', '2': '😔 Tired',
  '3': '😐 Neutral',    '4': '😊 Good', '5': '😁 Amazing',
};


/* ═══════════════════════════════════════════════════════════
   1. DASHBOARD  (index.html)
   Step-count doughnut / progress ring
═══════════════════════════════════════════════════════════ */

/**
 * Renders (or updates) the step-progress doughnut ring on index.html.
 * Called by api.js after the dashboard stats are loaded from SQLite.
 *
 * @param {number|null} steps     - Today's step count (null = no data yet)
 * @param {number}      goalSteps - Daily step goal (default 10 000)
 */
function renderStepRing(steps, goalSteps) {
  goalSteps = goalSteps || 10000;
  var canvas = document.getElementById('stepRingChart');
  if (!canvas || !window.Chart) return;

  var safeSteps = (steps != null && isFinite(Number(steps)))
    ? Math.max(0, Number(steps)) : 0;
  var remaining = Math.max(0, goalSteps - safeSteps);
  var pct       = Math.min(100, Math.round((safeSteps / goalSteps) * 100));

  var primary  = _cssVar('--primary')  || '#0d9488';
  var accent   = _cssVar('--accent')   || '#14b8a6';
  var border   = _cssVar('--border')   || '#e2e8f0';
  var cardBg   = _cssVar('--card-bg')  || '#ffffff';
  var textCol  = _cssVar('--text')     || '#1e293b';
  var mutedCol = _cssVar('--muted')    || '#94a3b8';

  if (window._FT_charts.stepRing) {
    window._FT_charts.stepRing.destroy();
    window._FT_charts.stepRing = null;
  }

  /* Inline center-text plugin — no extra CDN needed */
  var centerTextPlugin = {
    id: 'centerText',
    afterDraw: function (chart) {
      var ctx = chart.ctx;
      var ca  = chart.chartArea;
      if (!ca) return;
      var cx = (ca.left + ca.right) / 2;
      var cy = (ca.top  + ca.bottom) / 2;
      ctx.save();

      /* Step count */
      ctx.font = "800 1.65rem 'Inter', sans-serif";
      ctx.fillStyle     = textCol;
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'middle';
      ctx.fillText(safeSteps.toLocaleString(), cx, cy - 10);

      /* Sub-label */
      ctx.font      = "500 0.72rem 'Inter', sans-serif";
      ctx.fillStyle = mutedCol;
      ctx.fillText('steps today', cx, cy + 14);

      /* Percentage */
      ctx.font      = "700 0.85rem 'Inter', sans-serif";
      ctx.fillStyle = pct >= 100 ? '#10b981' : primary;
      ctx.fillText(pct + '%', cx, cy + 30);

      ctx.restore();
    },
  };

  _applyGlobalDefaults();

  window._FT_charts.stepRing = new Chart(canvas, {
    type: 'doughnut',
    plugins: [centerTextPlugin],
    data: {
      labels: ['Steps Done', 'Remaining'],
      datasets: [{
        data: [safeSteps, remaining],
        backgroundColor: [primary, border],
        borderColor:     [primary, 'transparent'],
        borderWidth:     [2, 0],
        hoverBackgroundColor: [accent, border],
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '76%',
      responsive: true,
      maintainAspectRatio: true,
      animation: { animateRotate: true, duration: 950, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cardBg,
          titleColor:  textCol,
          bodyColor:   mutedCol,
          borderColor: border,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function (ctx) {
              var val = ctx.raw;
              return ctx.label === 'Steps Done'
                ? ' ' + Number(val).toLocaleString() + ' steps completed'
                : ' ' + Number(val).toLocaleString() + ' steps to goal';
            },
          },
        },
        /* zoom plugin not used on ring — explicitly disabled */
        zoom: undefined,
      },
    },
  });
}


/* ═══════════════════════════════════════════════════════════
   2. HISTORY  (history.html)
   Multi-axis trend line — zoom/pan + rich tooltips
═══════════════════════════════════════════════════════════ */

/** Metric config map — drives dataset label, field key, color, unit */
var TREND_CONFIGS = {
  steps: {
    label:  'Daily Steps',
    field:  'steps',
    color:  '#0d9488',
    yLabel: 'Steps',
    format: function (v) { return Number(v).toLocaleString() + ' steps'; },
  },
  sleep: {
    label:  'Sleep Hours',
    field:  'sleep_hours',
    color:  '#6366f1',
    yLabel: 'Hours',
    format: function (v) { return v + ' hrs'; },
  },
  water: {
    label:  'Water Intake',
    field:  'water_intake',
    color:  '#0ea5e9',
    yLabel: 'Litres',
    format: function (v) { return v + ' L'; },
  },
  workout: {
    label:  'Workout Duration',
    field:  'workout_duration',
    color:  '#f59e0b',
    yLabel: 'Minutes',
    format: function (v) { return v + ' min'; },
  },
  mood: {
    label:  'Mood Score',
    field:  'mood',
    color:  '#ec4899',
    yLabel: 'Mood (1–5)',
    format: function (v) { return MOOD_LABELS[String(v)] || (v + '/5'); },
    toNum:  function (raw) {
      if (raw == null) return null;
      var n = Number(raw);
      if (!isNaN(n) && n >= 1 && n <= 5) return n;
      return MOOD_TO_NUM[String(raw)] || null;
    },
  },
};

/* ── data.json fetcher ──────────────────────────────────────── */

/**
 * Fetches frontend/data.json (generated by export_data.py) and caches it.
 * Returns a Promise that resolves to the logs array, or [] on failure.
 */
function _fetchDataJson() {
  if (window._FT_rawLogs) {
    return Promise.resolve(window._FT_rawLogs);
  }
  /* Resolve path relative to the HTML file being served */
  var url = (window.location.pathname.replace(/\/[^/]*$/, '') || '') + '/data.json';

  return fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (payload) {
      var logs = Array.isArray(payload)
        ? payload                   /* bare array format */
        : (payload.logs || []);     /* { logs: [...] } format */
      window._FT_rawLogs = logs;
      return logs;
    })
    .catch(function (err) {
      console.warn('[FitTrack charts] data.json not found — falling back to GLOBAL_LOGS.', err.message);
      return [];
    });
}

/**
 * Public entry for history.html when you want to use data.json.
 * Fetches the file, then renders. Wires the dropdown automatically.
 */
function renderTrendFromAPI(metric) {
  metric = metric || 'steps';
  _fetchDataJson().then(function (logs) {
    /* If fetch failed, fall back to in-memory GLOBAL_LOGS */
    if (!logs.length && typeof GLOBAL_LOGS !== 'undefined' && GLOBAL_LOGS.length) {
      logs = _normaliseAppLogs(GLOBAL_LOGS);
    }
    window._FT_rawLogs = logs;
    _drawTrendLine(logs, metric);
    _wireTrendDropdown(logs);
  });
}

/**
 * Public entry used by api.js when logs are already in GLOBAL_LOGS.
 * Normalises field names from app.js format to data.json format.
 */
function renderTrendChart(logs, metric) {
  metric = metric || 'steps';
  var normLogs = _normaliseAppLogs(logs || []);
  /* Merge with any cached data.json logs (data.json wins for extra fields) */
  var merged = window._FT_rawLogs && window._FT_rawLogs.length
    ? window._FT_rawLogs
    : normLogs;
  window._FT_rawLogs = merged;
  _drawTrendLine(merged, metric);
  _wireTrendDropdown(merged);
}

/** Wire the metric dropdown once, idempotently */
function _wireTrendDropdown(logs) {
  var sel = document.getElementById('trendMetricSelect');
  if (!sel || sel._ftWired) return;
  sel._ftWired = true;
  sel.addEventListener('change', function () {
    _drawTrendLine(logs, sel.value);
  });
}

/**
 * Normalise app.js GLOBAL_LOGS objects (camelCase / mixed) to the
 * flat snake_case format used by data.json.
 */
function _normaliseAppLogs(logs) {
  return logs.map(function (l) {
    return {
      log_date:         l.date || l.log_date || null,
      steps:            l.steps != null ? Number(l.steps) : null,
      water_intake:     l.water != null ? Number(l.water) : (l.water_intake != null ? Number(l.water_intake) : null),
      sleep_hours:      l.sleep != null ? Number(l.sleep) : (l.sleep_hours  != null ? Number(l.sleep_hours)  : null),
      workout_type:     l.workout    || l.workout_type    || null,
      workout_duration: l.duration   != null ? Number(l.duration)  : (l.workout_duration != null ? Number(l.workout_duration) : null),
      workout_intensity:l.intensity  || l.workout_intensity || null,
      mood:             l.mood       || null,
      energy_level:     l.energy     != null ? Number(l.energy) : (l.energy_level != null ? Number(l.energy_level) : null),
    };
  });
}

/* ── Core chart renderer ─────────────────────────────────────── */

function _drawTrendLine(logs, metric) {
  var canvas = document.getElementById('trendLineChart');
  if (!canvas || !window.Chart) return;

  var cfg      = TREND_CONFIGS[metric] || TREND_CONFIGS.steps;
  var primary  = cfg.color;
  var border   = _cssVar('--border')  || '#e2e8f0';
  var cardBg   = _cssVar('--card-bg') || '#ffffff';
  var textCol  = _cssVar('--text')    || '#1e293b';
  var mutedCol = _cssVar('--muted')   || '#94a3b8';

  /* ── Filter to last 30 days with a valid value for this metric ── */
  var today  = new Date();
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 29);

  var filtered = logs
    .filter(function (l) {
      var d = l.log_date;
      if (!d) return false;
      var date = new Date(String(d).slice(0, 10));
      var rawVal = l[cfg.field];
      /* For mood, try numeric coercion */
      if (metric === 'mood') rawVal = (TREND_CONFIGS.mood.toNum(rawVal) != null) ? rawVal : null;
      return date >= cutoff && rawVal != null;
    })
    .sort(function (a, b) {
      return String(a.log_date) < String(b.log_date) ? -1 : 1;
    });

  /* X-axis labels */
  var labels = filtered.map(function (l) {
    var d = new Date(String(l.log_date).slice(0, 10) + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  });

  /* Y values — mood needs numeric coercion */
  var data = filtered.map(function (l) {
    if (metric === 'mood') {
      return TREND_CONFIGS.mood.toNum(l.mood);
    }
    return Number(l[cfg.field]);
  });

  /* ── Gradient fill ── */
  var ctx = canvas.getContext('2d');
  var h   = canvas.offsetHeight || 260;
  var gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0,   primary + '55');
  gradient.addColorStop(0.65, primary + '15');
  gradient.addColorStop(1,   primary + '00');

  /* ── Destroy old instance ── */
  if (window._FT_charts.trendLine) {
    window._FT_charts.trendLine.destroy();
    window._FT_charts.trendLine = null;
  }

  _applyGlobalDefaults();

  /* ── Build zoom plugin config (only if plugin is loaded) ── */
  var zoomCfg = {};
  if (window.Chart && Chart.registry && Chart.registry.plugins.get('zoom')) {
    zoomCfg = {
      zoom: {
        zoom: {
          wheel:  { enabled: true, speed: 0.08 },
          pinch:  { enabled: true },
          mode:   'x',
        },
        pan: {
          enabled: true,
          mode:    'x',
          /* Require pointer to be dragging (not just hovering) */
          threshold: 5,
        },
        limits: {
          x: { min: 'original', max: 'original' },
        },
      },
    };
  }

  /* ── Rich tooltip callback — shows mood/workout detail ── */
  var tooltipCallbacks = {
    title: function (items) {
      return items.length ? items[0].label : '';
    },
    label: function (item) {
      return ' ' + cfg.label + ': ' + cfg.format(item.raw);
    },
    afterBody: function (items) {
      if (!items.length) return [];
      var idx  = items[0].dataIndex;
      var log  = filtered[idx];
      if (!log) return [];

      var extras = [];

      /* Mood line — show text label */
      if (metric !== 'mood' && log.mood != null) {
        extras.push('  Mood: ' + (MOOD_LABELS[String(log.mood)] || log.mood));
      }
      /* Non-workout lines — show workout info */
      if (metric !== 'workout' && log.workout_type) {
        var wStr = '  Workout: ' + log.workout_type;
        if (log.workout_duration) wStr += ' (' + log.workout_duration + ' min)';
        if (log.workout_intensity) wStr += ' [' + log.workout_intensity + ']';
        extras.push(wStr);
      }
      /* Non-step lines — show steps */
      if (metric !== 'steps' && log.steps != null) {
        extras.push('  Steps: ' + Number(log.steps).toLocaleString());
      }
      /* Non-sleep lines — show sleep */
      if (metric !== 'sleep' && log.sleep_hours != null) {
        extras.push('  Sleep: ' + log.sleep_hours + ' hrs');
      }
      /* Non-water lines — show water */
      if (metric !== 'water' && log.water_intake != null) {
        extras.push('  Water: ' + log.water_intake + ' L');
      }

      return extras.length ? ['─────────────'].concat(extras) : [];
    },
  };

  /* ── Render ── */
  window._FT_charts.trendLine = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label:               cfg.label,
        data:                data,
        borderColor:         primary,
        backgroundColor:     gradient,
        borderWidth:         2.5,
        pointBackgroundColor: primary,
        pointBorderColor:    cardBg,
        pointBorderWidth:    2,
        pointRadius:         5,
        pointHoverRadius:    7,
        tension:             0.35,
        fill:                true,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: 'easeInOutCubic' },
      interaction: { mode: 'index', intersect: false },
      plugins: Object.assign({
        legend: {
          display:  true,
          position: 'top',
          align:    'end',
          labels: {
            boxWidth:         12,
            boxHeight:        12,
            borderRadius:     3,
            useBorderRadius:  true,
            color:            textCol,
            font: { size: 12 },
          },
        },
        tooltip: {
          backgroundColor: cardBg,
          titleColor:  textCol,
          bodyColor:   mutedCol,
          borderColor: border,
          borderWidth: 1,
          padding:     14,
          cornerRadius: 10,
          displayColors: false,
          callbacks:   tooltipCallbacks,
        },
      }, zoomCfg),
      scales: {
        x: {
          grid:  { color: border + '80' },
          ticks: { color: mutedCol, font: { size: 11 }, maxRotation: 30, maxTicksLimit: 10, autoSkip: true },
        },
        y: {
          title: { display: true, text: cfg.yLabel, color: mutedCol, font: { size: 11, weight: '600' } },
          grid:  { color: border + '80' },
          ticks: { color: mutedCol, font: { size: 11 } },
          beginAtZero: false,
        },
      },
    },
  });

  /* Update the metric sub-label above the chart */
  var metricLabel = document.getElementById('trendMetricLabel');
  if (metricLabel) metricLabel.textContent = cfg.label + ' — Last 30 Days';

  /* Show / hide zoom-reset button */
  var resetBtn = document.getElementById('trendZoomReset');
  if (resetBtn) resetBtn.style.display = zoomCfg.zoom ? 'inline-flex' : 'none';
}


/* ═══════════════════════════════════════════════════════════
   3. ZOOM-RESET BUTTON HANDLER
   Wired to <button id="trendZoomReset"> in history.html
═══════════════════════════════════════════════════════════ */

function resetTrendZoom() {
  var chart = window._FT_charts.trendLine;
  if (chart && typeof chart.resetZoom === 'function') {
    chart.resetZoom();
  }
}


/* ═══════════════════════════════════════════════════════════
   4. DARK-MODE WATCHER
   Re-renders active charts when body.dark-mode is toggled
═══════════════════════════════════════════════════════════ */

(function watchTheme() {
  var observer = new MutationObserver(function () {
    setTimeout(function () {
      _applyGlobalDefaults();
      if (window._FT_charts.stepRing)  window._FT_charts.stepRing.update();
      if (window._FT_charts.trendLine) window._FT_charts.trendLine.update();
    }, 80);
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
