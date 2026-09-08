// Session module - workout execution, timer, download/import
"use strict";

import { state, COLORS, RATIOS, MINLEN, PREP_DURATION, SOUND_ENABLED, COUNTDOWN_BEEPS, COUNTDOWN_WINDOW, INTENSITY_FREQ, freqFor, fmt, arrange, curCounts, computeLen, minPresentLen, canSetTarget, buildPreview, applyAutoBreaks, segIndexAt, segStart, esc } from './state.js';
import { ensureAudio, scheduleCountdown, transitionBeep, beep, countBeep, completeBeep } from './audio.js';
import { render } from './render.js';
import { trackEvent } from './track.js';
import { log, initLog, addLogEntry, setRating, deleteEntry, getEntry, exportLog } from './rowlog.js';

var INTENSITY_ORDER = ['high', 'medium', 'med', 'low', 'break', 'freeform'];
var ALT_STROKES = { high: 32, medium: 28, med: 26, low: 24, break: null, freeform: null };

var cueTimeline = [];
var nextCueIdx = 0;

// BLD-1008: per-second countdown beep for the t-5s window.
// countdownBeepLast tracks the last integer second we beeped at (5,4,3,2,1) in
// the active-cadence window; prepBeepLast does the same for the pre-session
// countdown. -1 = disarmed (outside the window).
var countdownBeepLast = -1;
var prepBeepLast = -1;

export function build() {
  state.sequence = applyAutoBreaks(buildPreview());
  var acc = 0;
  state.ends = state.sequence.map(function(s) { acc += s.len; return acc; });
  state.totalDuration = acc;
  state.isAdvancedWorkout = false;
}

export function surprise() {
  // Randomise the main-page interval plan (BLD-983).
  //
  // The previous implementation wrote to state.advancedSequence, which is the
  // Advanced editor's private timeline. That timeline is not rendered on the
  // main setup screen, so clicking "Surprise me" appeared to do nothing.
  // We now randomize the config counts that drive the main preview, rebuild
  // the sequence, and re-render so the plan visibly changes and can be started.
  var kinds = ['high', 'medium', 'med', 'low'];
  var tgt = state.targetMin * 60;
  var counts = { high: 0, medium: 0, med: 0, low: 0, freeform: 0 };
  var want = 6 + Math.floor(Math.random() * 6);
  var guard = 0;
  while (counts.high + counts.medium + counts.med + counts.low < want && guard < 300) {
    guard++;
    var k = kinds[Math.floor(Math.random() * 4)];
    if (counts[k] >= 12) continue;
    var test = { high: counts.high, medium: counts.medium, med: counts.med, low: counts.low, freeform: 0 };
    test[k]++;
    var L = computeLen(tgt, test);
    if (minPresentLen(L, test) >= MINLEN) {
      counts = test;
    } else {
      break;
    }
  }
  if (counts.high + counts.medium + counts.med + counts.low === 0) {
    counts.low = 2;
  }
  // Commit the randomized counts (and recomputed interval lengths) to the
  // shared config so the setup screen preview + the sequence both reflect it.
  var lens = computeLen(tgt, counts);
  ['high', 'medium', 'med', 'low', 'freeform'].forEach(function(key) {
    state.config[key].count = counts[key];
    state.config[key].len = lens[key];
  });
  state.isAdvancedWorkout = false;
  state.advancedEdited = false;
  build();
  render();
  showToast('Surprise me — intervals randomised');
}

function buildCueTimeline() {
  cueTimeline = [];
  nextCueIdx = 0;
  state.cueTimeline = cueTimeline;
  state.nextCueIdx = nextCueIdx;
  var sequence = state.sequence;
  var acc = 0;
  for (var i = 0; i < sequence.length; i++) {
    var s = sequence[i];
    cueTimeline.push({ time: acc, type: 'transition', intensity: s.intensity });
    if (state.mode === 'running' || state.mode === 'paused') {
      var intervalSec = 60 / (s.rate || ALT_STROKES[s.intensity] || 24);
      countSchedules(s, acc, intervalSec, cueTimeline);
    }
    acc += s.len;
  }
  state.cueTimeline = cueTimeline;
  state.nextCueIdx = 0;
}

function countSchedules(s, start, intSec, list) {
  if (s.intensity === 'break' || s.intensity === 'freeform') return;
  var count = Math.floor(s.len / intSec);
  for (var j = 1; j <= count; j++) {
    list.push({ time: start + j * intSec, type: 'count' });
  }
}

function scheduleCues() {
  state.nextCueIdx = 0;
  state.cueTimeline = cueTimeline;
}

function processCue() {
  var cues = cueTimeline;
  var idx = state.nextCueIdx;
  if (idx >= cues.length) return;
  var e = state.elapsed;
  while (idx < cues.length && cues[idx].time <= e) {
    var cue = cues[idx];
    if (cue.type === 'transition') {
      transitionBeep(cue.intensity);
    } else if (cue.type === 'count' && COUNTDOWN_BEEPS) {
      // stroke cadence beep
      beep(520, 0.03, 'sine');
    }
    idx++;
  }
  state.nextCueIdx = idx;
}

// BLD-1008/1009: descending countdown beep each second during the last
// COUNTDOWN_WINDOW (5s) of each active cadence/interval before it switches,
// anchored to cadence transitions (segment boundaries in session timer logic —
// NOT the 60fps render loop). Fires at t-5, t-4, t-3, t-2, t-1 (one per second);
// no beep on the final interval (session end).
function processCountdownCue() {
  if (!COUNTDOWN_BEEPS || !SOUND_ENABLED) return;
  var e = state.elapsed;
  var idx = segIndexAt(e);
  if (idx < 0 || idx >= state.sequence.length) return;
  // No countdown beep on the final interval-to-session-end.
  if (idx === state.sequence.length - 1) {
    countdownBeepLast = -1;
    return;
  }
  var remaining = state.ends[idx] - e;
  if (remaining > 0 && remaining <= COUNTDOWN_WINDOW) {
    // Beep once per integer second as we descend 5 -> 4 -> 3 -> 2 -> 1.
    var sec = Math.ceil(remaining);
    if (sec !== countdownBeepLast) {
      countdownBeepLast = sec;
      countBeep(sec);
    }
  } else {
    // Outside the window (fresh segment, or seek backwards): re-arm.
    countdownBeepLast = -1;
  }
}

export function runWorkout() {
  ensureAudio();
  buildCueTimeline();
  state.elapsed = 0;
  state.baseElapsed = 0;
  state.runStart = performance.now();
  state.mode = 'running';
  if (state.advancedSequence.length > 0) state.isAdvancedWorkout = true;
  scheduleCues();
  processCue();
  render();
  loop();
}

export function start() {
  build();
  if (state.sequence.length === 0) return;
  // BLD-1008 (rework): create the AudioContext here, inside the start user
  // gesture, so the pre-session countdown beep (fired by prepLoop before
  // runWorkout) has a live context instead of a null one that latched
  // AUDIO_FALLBACK and silenced all later beeps. Creating within a gesture also
  // satisfies the browser autoplay policy (context starts running).
  ensureAudio();
  state.elapsed = 0;
  state.prepElapsed = 0;
  prepBeepLast = -1;
  countdownBeepLast = -1;
  state.mode = 'prep';
  state.prepStart = performance.now();
  state.prepLastTick = null;
  render();
  prepLoop();
  trackEvent('start', { minutes: state.targetMin });
}

export function startAdvanced() {
  state.isAdvancedWorkout = true;
  state.sequence = [].concat(state.advancedSequence);
  var acc = 0;
  state.ends = state.sequence.map(function(s) { acc += s.len; return acc; });
  state.totalDuration = acc;
  runWorkout();
}

var prepRaf = null;

export function beginPrep() {
  // BLD-1008 (rework): same as start() — create the context inside the gesture
  // so the pre-session countdown beep has a live, running AudioContext.
  ensureAudio();
  state.mode = 'prep';
  state.prepStart = performance.now();
  state.prepElapsed = 0;
  prepBeepLast = -1;
  render();
  prepLoop();
}

export function prepLoop() {
  if (state.mode !== 'prep') return;
  var now = performance.now();
  if (state.prepLastTick) {
    state.prepElapsed += (now - state.prepLastTick) / 1000;
  }
  state.prepLastTick = now;
  render();
  // BLD-1008/1010: descending countdown beep each second in the last
  // COUNTDOWN_WINDOW (5s) of the pre-session countdown, before the session
  // starts. Same per-second boundary logic as the active-cadence beep.
  if (COUNTDOWN_BEEPS && SOUND_ENABLED) {
    var prepRemaining = PREP_DURATION - state.prepElapsed;
    if (prepRemaining > 0 && prepRemaining <= COUNTDOWN_WINDOW) {
      var sec = Math.ceil(prepRemaining);
      if (sec !== prepBeepLast) {
        prepBeepLast = sec;
        countBeep(sec);
      }
    } else {
      prepBeepLast = -1;
    }
  }
  if (state.prepElapsed >= PREP_DURATION) {
    state.mode = 'setup';
    state.prepElapsed = 0;
    state.prepLastTick = null;
    prepBeepLast = -1;
    ensureAudio();
    runWorkout();
    return;
  }
  prepRaf = requestAnimationFrame(prepLoop);
}

function loop() {
  if (state.mode !== 'running' && state.mode !== 'paused') return;
  if (state.mode === 'running') {
    var now = performance.now();
    state.elapsed = state.baseElapsed + (now - state.runStart) / 1000;
    processCue();
    processCountdownCue();
    if (state.elapsed >= state.totalDuration) {
      finish();
      return;
    }
  }
  render();
  state.raf = requestAnimationFrame(loop);
}

function tick() {
  // tick is handled by loop() rAF
}

export function pause() {
  if (state.mode !== 'running') return;
  state.mode = 'paused';
  state.baseElapsed = state.elapsed;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  render();
  trackEvent('pause', { elapsed: Math.round(state.elapsed) });
}

export function resume() {
  if (state.mode !== 'paused') return;
  state.mode = 'running';
  state.runStart = performance.now();
  render();
  loop();
  trackEvent('resume', { elapsed: Math.round(state.elapsed) });
}

export function togglePause() {
  if (state.mode === 'running') pause();
  else if (state.mode === 'paused') resume();
}

export function skip() {
  if (state.mode !== 'running' && state.mode !== 'paused') return;
  var cur = segIndexAt(state.elapsed);
  if (cur < 0 || cur >= state.ends.length) return;
  state.elapsed = state.ends[cur < state.ends.length - 1 ? cur : cur];
  state.baseElapsed = state.elapsed;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  if (state.elapsed >= state.totalDuration) {
    finish();
  } else {
    state.runStart = performance.now();
    render();
    transitionBeep(state.sequence[segIndexAt(state.elapsed)].intensity);
    loop();
  }
}

export function stop() {
  state.mode = 'setup';
  state.elapsed = 0;
  state.baseElapsed = 0;
  state.prepElapsed = 0;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  if (prepRaf) { cancelAnimationFrame(prepRaf); prepRaf = null; }
  trackEvent('stop', { elapsed: Math.round(state.elapsed) });
  render();
}

export function finish() {
  state.mode = 'done';
  state.elapsed = state.totalDuration;
  state.baseElapsed = state.totalDuration;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  completeBeep();
  render();
  trackEvent('complete', { totalMinutes: Math.round(state.totalDuration / 60) });
}

export function restart() {
  if (state.isAdvancedWorkout && state.advancedSequence.length > 0) {
    state.sequence = [].concat(state.advancedSequence);
    var acc = 0;
    state.ends = state.sequence.map(function(s) { acc += s.len; return acc; });
    state.totalDuration = acc;
  } else {
    build();
  }
  runWorkout();
}

export function change(intensity, delta) {
  var c = state.config[intensity];
  if (!c) return;
  var newCount = Math.max(0, Math.min(12, c.count + delta));
  c.count = newCount;
  render();
}

export function changeTarget(delta) {
  var newMin = Math.max(10, Math.min(90, state.targetMin + delta));
  if (canSetTarget(newMin * 60)) {
    state.targetMin = newMin;
    render();
  }
}

var toastTimeout = null;

export function showToast(msg, isError) {
  var app = document.getElementById('app');
  var existing = app.querySelector('.toast');
  if (existing) existing.remove();
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
  var toast = document.createElement('div');
  toast.className = 'toast show' + (isError ? ' toast-error' : '');
  toast.textContent = msg;
  app.appendChild(toast);
  toastTimeout = setTimeout(function() { toast.remove(); toastTimeout = null; }, 3000);
}

export function downloadShareCard() {
  trackEvent('download_card', {});
  var totalSec = state.totalDuration || 0;
  var totalText = fmt(totalSec);
  var count = state.sequence ? state.sequence.length : 0;
  var W = 760, H = 400, R = 32, P = 48;
  var canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  var cx = canvas.getContext('2d');

  // Rounded rect helper
  function rRect(x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.lineTo(x + w - r, y);
    cx.quadraticCurveTo(x + w, y, x + w, y + r);
    cx.lineTo(x + w, y + h - r);
    cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    cx.lineTo(x + r, y + h);
    cx.quadraticCurveTo(x, y + h, x, y + h - r);
    cx.lineTo(x, y + r);
    cx.quadraticCurveTo(x, y, x + r, y);
    cx.closePath();
  }

  // White card background
  rRect(0, 0, W, H, R);
  cx.fillStyle = '#ffffff';
  cx.fill();
  cx.strokeStyle = 'oklch(0.9 0.016 230)';
  cx.lineWidth = 2;
  rRect(0, 0, W, H, R);
  cx.stroke();

  // Header: CREWCALL
  cx.fillStyle = '#000000';
  cx.font = '700 26px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.textBaseline = 'top';
  cx.textAlign = 'left';
  cx.fillText('CREWCALL', P, P);

  // Header: Rowing Stats
  cx.fillStyle = 'oklch(0.55 0.012 70)';
  cx.font = '400 22px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.textAlign = 'right';
  cx.fillText('Rowing Stats', W - P, P + 6);

  // Title
  cx.fillStyle = 'oklch(0.3 0.012 70)';
  cx.font = '700 48px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.textAlign = 'left';
  cx.fillText('Workout complete!', P, 120);
  cx.fillStyle = 'oklch(0.55 0.012 70)';
  cx.font = '400 26px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.fillText('Cadence held, limits pushed.', P, 170);

  // Stats row
  var sx = P, sy = 240;
  cx.fillStyle = 'oklch(0.6 0.012 70)';
  cx.font = '600 18px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.fillText('DURATION', sx, sy);
  cx.fillStyle = 'oklch(0.3 0.012 70)';
  cx.font = '600 38px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.fillText(totalText, sx, sy + 34);

  var mx = W * 0.5;
  cx.fillStyle = 'oklch(0.6 0.012 70)';
  cx.font = '600 18px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.fillText('INTERVALS', mx, sy);
  cx.fillStyle = 'oklch(0.3 0.012 70)';
  cx.font = '600 38px "Space Grotesk", "Hanken Grotesk", system-ui, sans-serif';
  cx.fillText(String(count), mx, sy + 34);

  // Color bar — preview segments
  var seq = state.sequence || [];
  var barY = 330, barH = 24, barW = W - P * 2;
  if (seq.length > 0) {
    rRect(P, barY, barW, barH, 12);
    cx.save();
    cx.clip();
    var segTotal = 0;
    seq.forEach(function(s) { segTotal += s.len; });
    if (segTotal > 0) {
      var xOff = P;
      seq.forEach(function(s) {
        var co = COLORS[s.intensity];
        var sw = Math.round((s.len / segTotal) * barW);
        cx.fillStyle = co.fill;
        cx.fillRect(xOff, barY, Math.max(sw, 6), barH);
        xOff += sw;
      });
    }
    cx.restore();
    cx.strokeStyle = 'oklch(0.9 0.016 230 / 0.5)';
    cx.lineWidth = 1;
    rRect(P, barY, barW, barH, 12);
    cx.stroke();
  }

  // Export as PNG
  canvas.toBlob(function(blob) {
    var pngUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = pngUrl;
    a.download = 'crewcall-workout-summary.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(pngUrl);
  }, 'image/png');
}

export function downloadConfig() {
  var config = {
    version: 1,
    targetMin: state.targetMin,
    isAdvanced: state.isAdvancedWorkout,
    advancedSequence: state.advancedEdited ? [].concat(state.advancedSequence) : undefined,
    config: {
      high: { count: state.config.high.count, len: state.config.high.len, rate: state.config.high.rate },
      medium: { count: state.config.medium.count, len: state.config.medium.len, rate: state.config.medium.rate },
      med: { count: state.config.med.count, len: state.config.med.len, rate: state.config.med.rate },
      low: { count: state.config.low.count, len: state.config.low.len, rate: state.config.low.rate },
      freeform: { count: state.config.freeform.count, len: state.config.freeform.len, rate: null }
    }
  };
  var blob = new Blob([JSON.stringify(config, null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'crewcall-plan.json';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  trackEvent('export_config', {});
}

export function triggerUpload() {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (!data.version || !data.config) { showToast('Invalid config file', true); return; }
        importConfig(data);
      } catch(err) {
        showToast('Could not parse file', true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

export function importConfig(data) {
  var c = data.config;
  state.config.high.count = c.high.count;
  state.config.high.rate = c.high.rate;
  state.config.medium.count = c.medium.count;
  state.config.medium.rate = c.medium.rate;
  state.config.med.count = c.med.count;
  state.config.med.rate = c.med.rate;
  state.config.low.count = c.low.count;
  state.config.low.rate = c.low.rate;
  state.config.freeform.count = c.freeform.count;
  if (data.targetMin) state.targetMin = data.targetMin;
  if (data.isAdvanced && data.advancedSequence && data.advancedSequence.length > 0) {
    state.advancedSequence = data.advancedSequence;
    state.advancedEdited = true;
  }
  showToast('Config loaded!', false);
  render();
  trackEvent('import_config', {});
}

// ---------------------------------------------------------------
// Row Log — log after a row, browse from the main menu, replay & rate
// ---------------------------------------------------------------

export function initRowLog() {
  initLog(function() { render(); });
}

export function openRowLog() {
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  if (prepRaf) { cancelAnimationFrame(prepRaf); prepRaf = null; }
  state.mode = 'rowlog';
  render();
  trackEvent('open_row_log', {});
}

export function exitRowLog() {
  state.mode = 'setup';
  render();
}

export function logRow() {
  if (!log.loaded) return;
  var counts = curCounts();
  var labelParts = [];
  if (counts.high) labelParts.push('H' + counts.high);
  if (counts.medium) labelParts.push('M+' + counts.medium);
  if (counts.med) labelParts.push('M' + counts.med);
  if (counts.low) labelParts.push('L' + counts.low);
  if (counts.freeform) labelParts.push('F' + counts.freeform);
  if (!labelParts.length) labelParts.push('Intervals');
  var plan = {
    targetMin: state.targetMin,
    isAdvanced: state.isAdvancedWorkout && state.advancedSequence.length > 0,
    advancedSequence: (state.isAdvancedWorkout && state.advancedSequence.length > 0) ? [].concat(state.advancedSequence) : undefined,
    config: {
      high: { count: state.config.high.count, len: state.config.high.len, rate: state.config.high.rate },
      medium: { count: state.config.medium.count, len: state.config.medium.len, rate: state.config.medium.rate },
      med: { count: state.config.med.count, len: state.config.med.len, rate: state.config.med.rate },
      low: { count: state.config.low.count, len: state.config.low.len, rate: state.config.low.rate },
      freeform: { count: state.config.freeform.count, len: state.config.freeform.len, rate: null }
    }
  };
 addLogEntry({
    durationSec: state.totalDuration,
    intervals: state.sequence.length,
    high: counts.high, medium: counts.medium, med: counts.med, low: counts.low, freeform: counts.freeform,
    label: labelParts.join(' &middot; '),
    plan: plan
  });
 showToast('Row logged to your device', false);
 render();
 trackEvent('log_row', {});
}

export function setLogRating(el) {
  var id = el.getAttribute('data-id');
  var rating = el.getAttribute('data-rating');
  if (setRating(id, rating)) { render(); trackEvent('rate_row', { rating: rating }); }
}

export function deleteLogEntryFn(el) {
  var id = el.getAttribute('data-id');
  if (deleteEntry(id)) { showToast('Row removed', false); render(); }
}

export function replayLogEntry(el) {
  var id = el.getAttribute('data-id');
  var entry = getEntry(id);
  if (!entry || !entry.plan) { showToast('No saved plan to replay', true); return; }
  var p = entry.plan;
  var c = p.config;
  if (c) {
    state.config.high.count = c.high.count; state.config.high.rate = c.high.rate;
    state.config.medium.count = c.medium.count; state.config.medium.rate = c.medium.rate;
    state.config.med.count = c.med.count; state.config.med.rate = c.med.rate;
    state.config.low.count = c.low.count; state.config.low.rate = c.low.rate;
    state.config.freeform.count = c.freeform.count;
  }
  if (p.targetMin) state.targetMin = p.targetMin;
  if (p.isAdvanced && p.advancedSequence && p.advancedSequence.length > 0) {
    state.advancedSequence = p.advancedSequence;
    state.advancedEdited = true;
  } else {
    state.advancedSequence = [];
    state.advancedEdited = false;
  }
  state.isAdvancedWorkout = !!p.isAdvanced;
  state.mode = 'setup';
  render();
  showToast('Plan loaded — ready to row', false);
  trackEvent('replay_row', {});
}

export function exportRowLog() {
  exportLog();
  trackEvent('export_row_log', {});
}


// Re-export changeTarget's dependency
export { canSetTarget } from './state.js';

// BLD-1008/1011: test-only seek hook so Playwright can deterministically advance
// the running timer and re-run cue + countdown-boundary processing without
// waiting through real (30-60s+) intervals. Installed only when the test sets
// window.__crewcallTestSeek = true via addInitScript before app scripts load.
// No-op in normal use — never present in production.
if (typeof window !== 'undefined' && window.__crewcallTestSeek) {
  window.__crewcallState = state;
  window.__crewcallSeek = function(sec) {
    state.elapsed = sec;
    state.baseElapsed = sec;
    state.runStart = performance.now();
    processCue();
    processCountdownCue();
  };
}