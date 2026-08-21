// Session module - workout execution, timer, download/import
"use strict";

import { state, COLORS, RATIOS, MINLEN, PREP_DURATION, SOUND_ENABLED, COUNTDOWN_BEEPS, COUNTDOWN_WINDOW, INTENSITY_FREQ, freqFor, fmt, arrange, curCounts, computeLen, minPresentLen, buildPreview, applyAutoBreaks, segIndexAt, segStart, esc } from './state.js';
import { ensureAudio, scheduleCountdown, transitionBeep, beep, completeBeep } from './audio.js';
import { render } from './render.js';
import { trackEvent } from './track.js';

var INTENSITY_ORDER = ['high', 'medium', 'med', 'low', 'break', 'freeform'];
var ALT_STROKES = { high: 32, medium: 28, med: 26, low: 24, break: null, freeform: null };

var cueTimeline = [];
var nextCueIdx = 0;

export function build() {
  state.sequence = applyAutoBreaks(buildPreview());
  var acc = 0;
  state.ends = state.sequence.map(function(s) { acc += s.len; return acc; });
  state.totalDuration = acc;
  state.isAdvancedWorkout = false;
}

export function surprise() {
  var intensityKeys = ['high', 'medium', 'med', 'low', 'freeform'];
  var seq = [];
  var totalLen = 0;
  var target = state.targetMin * 60;
  var accum = 0;
  var allowed = intensityKeys.filter(function(k) { return k !== 'freeform' || Math.random() < 0.3; });
  while (accum < target) {
    var k = allowed[Math.floor(Math.random() * allowed.length)];
    var blockLen = Math.round((15 + Math.random() * 90) / 5) * 5;
    var rate = null;
    if (k !== 'freeform' && k !== 'break') {
      rate = Math.round(20 + Math.random() * 12);
    }
    seq.push({ intensity: k, len: blockLen, rate: rate });
    accum += blockLen;
    if (seq.length > 30) break;
  }
  state.advancedSequence = seq;
  state.advancedEdited = true;
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
  state.elapsed = 0;
  state.prepElapsed = 0;
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

function beginPrep() {
  state.mode = 'prep';
  state.prepStart = performance.now();
  state.prepElapsed = 0;
  render();
  prepLoop();
}

function prepLoop() {
  if (state.mode !== 'prep') return;
  var now = performance.now();
  if (state.prepLastTick) {
    state.prepElapsed += (now - state.prepLastTick) / 1000;
  }
  state.prepLastTick = now;
  render();
  if (state.prepElapsed >= PREP_DURATION) {
    state.mode = 'setup';
    state.prepElapsed = 0;
    state.prepLastTick = null;
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
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = msg;
  app.appendChild(toast);
  toastTimeout = setTimeout(function() { toast.remove(); toastTimeout = null; }, 3000);
}

export function downloadShareCard() {
  var app = document.getElementById('app');
  // Use a canvas approach via html2canvas or manual rendering
  var preview = app.querySelector('#share-card-preview');
  if (!preview) return;
  trackEvent('download_card', {});
  // Fall back: save the share-card section as HTML snippet
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:40px;font-family:"Space Grotesk",system-ui,sans-serif}</style></head><body>'+preview.outerHTML+'</body></html>';
  var blob = new Blob([html], {type:'text/html'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'crewcall-workout-summary.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

// Re-export changeTarget's dependency
export { canSetTarget } from './state.js';