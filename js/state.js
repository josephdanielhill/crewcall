// State management module - constants, config, helpers
"use strict";

export const COLORS = {
  high:   { name:'EXTREME', fill:'oklch(0.71 0.145 27)',  tint:'oklch(0.93 0.05 27)',  ink:'oklch(0.45 0.15 27)' },
  medium: { name:'HARD',    fill:'oklch(0.83 0.12 82)',   tint:'oklch(0.93 0.06 82)',  ink:'oklch(0.52 0.12 70)' },
  med:    { name:'MEDIUM',  fill:'oklch(0.78 0.09 190)',  tint:'oklch(0.93 0.05 190)', ink:'oklch(0.48 0.09 190)' },
  low:    { name:'LOW',     fill:'oklch(0.80 0.095 158)', tint:'oklch(0.93 0.05 158)', ink:'oklch(0.46 0.09 160)' },
  break:  { name:'BREAK',   fill:'oklch(0.86 0.015 240)', tint:'oklch(0.95 0.005 240)', ink:'oklch(0.40 0.01 240)' },
  freeform: { name:'FREEFORM', fill:'oklch(0.74 0.13 310)', tint:'oklch(0.93 0.05 310)', ink:'oklch(0.48 0.13 310)' }
};
export const RATIOS = { high:2, medium:3, med:3.5, low:4, freeform:3 };
export const MINLEN = 15;
export const SOUND_ENABLED = true;
export const COUNTDOWN_BEEPS = true;
export const COUNTDOWN_WINDOW = 5;
export const PREP_DURATION = 10;
export const INTENSITY_FREQ = { high:740, medium:640, med:540, break:380 };

export function freqFor(k) { return INTENSITY_FREQ[k] || 440; }

export let AUDIO_FALLBACK = false;
export let AUDIO_UNSUPPORTED = false;

export function setAudioFallback(v) { AUDIO_FALLBACK = v; }
export function setAudioUnsupported(v) { AUDIO_UNSUPPORTED = v; }

export const state = {
  mode: 'setup',
  config: {
    high:   {count:2, len:45,  rate:30},
    medium: {count:2, len:90,  rate:28},
    med:    {count:3, len:105, rate:26},
    low:    {count:4, len:120, rate:24},
    freeform: {count:0, len:60, rate:null}
  },
  targetMin: 10,
  elapsed: 0, baseElapsed: 0, runStart: 0,
  sequence: [], ends: [], totalDuration: 0,
  lastSegIndex: -1, lastCountTick: null, raf: null, actx: null,
  prepStart: 0, prepElapsed: 0, prepLastTick: null,
  advancedSequence: [],
  advancedEdited: false,
  isAdvancedWorkout: false,
  sidebarHidden: false,
  breaksEnabled: true,
  builderActive: false,
  builderStep: 0,
  builderAnswers: {
    energy: 'moderate',
    tired: 'no',
    goal: 'balanced',
    duration: 30
  },
  insertIndex: null,
  cueTimeline: null,
  nextCueIdx: 0,
  toastTimeout: null,
};

export function fmt(s) {
  s = Math.max(0, Math.round(s));
  var m = Math.floor(s / 60), ss = s % 60;
  return m + ':' + String(ss).padStart(2, '0');
}

export function arrange(h, m, md, l, f) {
  f = f || 0;
  var firstLow = false, lastLow = false, remL = l;
  if (remL > 0) { firstLow = true; remL--; }
  if (remL > 0) { lastLow = true; remL--; }
  var pools = { high: h, medium: m, med: md, low: remL, freeform: f };
  var total = h + m + md + remL + f;
  var remaining = { high: pools.high, medium: pools.medium, med: pools.med, low: pools.low, freeform: pools.freeform };
  var placed = { high: 0, medium: 0, med: 0, low: 0, freeform: 0 };
  var order = ['low', 'med', 'medium', 'high', 'medium', 'med', 'freeform'];
  var middleSeq = [];
  var prev = firstLow ? 'low' : null;
  for (var i = 0; i < total; i++) {
    var best = null, bestScore = -Infinity, progress = (i + 1) / total;
    ['high', 'medium', 'med', 'low', 'freeform'].forEach(function(k) {
      if (remaining[k] <= 0) return;
      var score = progress * pools[k] - placed[k];
      if (k === prev) score -= 1.0;
      score += order.indexOf(k) * 0.0001;
      if (score > bestScore) { bestScore = score; best = k; }
    });
    middleSeq.push(best);
    remaining[best]--;
    placed[best]++;
    prev = best;
  }
  var seq = [];
  if (firstLow) seq.push('low');
  seq = seq.concat(middleSeq);
  if (lastLow) seq.push('low');
  return seq;
}

export function curCounts() {
  var c = state.config;
  return { high: c.high.count, medium: c.medium.count, med: c.med.count, low: c.low.count, freeform: c.freeform.count };
}

export function computeLen(targetSec, counts) {
  var tr = counts.high * RATIOS.high + counts.medium * RATIOS.medium + counts.med * RATIOS.med + counts.low * RATIOS.low + counts.freeform * RATIOS.freeform;
  if (tr === 0) return { high: 0, medium: 0, med: 0, low: 0, freeform: 0 };
  var u = targetSec / tr;
  return {
    high: Math.max(1, Math.round(RATIOS.high * u)),
    medium: Math.max(1, Math.round(RATIOS.medium * u)),
    med: Math.max(1, Math.round(RATIOS.med * u)),
    low: Math.max(1, Math.round(RATIOS.low * u)),
    freeform: Math.max(1, Math.round(RATIOS.freeform * u))
  };
}

export function minPresentLen(L, counts) {
  var mn = Infinity;
  ['high', 'medium', 'med', 'low', 'freeform'].forEach(function(k) {
    if (counts[k] > 0) mn = Math.min(mn, L[k]);
  });
  return mn;
}

export function canAdd(k) {
  if (state.config[k].count >= 12) return false;
  var counts = curCounts();
  counts[k]++;
  var L = computeLen(state.targetMin * 60, counts);
  return minPresentLen(L, counts) >= MINLEN;
}

export function canSetTarget(targetSec) {
  var counts = curCounts();
  var L = computeLen(targetSec, counts);
  return minPresentLen(L, counts) >= MINLEN;
}

export function buildPreview() {
  var counts = curCounts();
  var L = computeLen(state.targetMin * 60, counts);
  var config = state.config;
  return arrange(counts.high, counts.medium, counts.med, counts.low, counts.freeform).map(function(k) {
    return { intensity: k, len: L[k], rate: config[k] != null ? config[k].rate : null };
  });
}

export function applyAutoBreaks(sequence) {
  if (!state.breaksEnabled || state.targetMin < 20) return sequence;
  var result = [];
  var activeElapsed = 0, nextBreakMark = 600;
  for (var i = 0; i < sequence.length; i++) {
    var seg = sequence[i], remainingLen = seg.len, intensity = seg.intensity;
    while (remainingLen > 0) {
      var timeToNextBreak = nextBreakMark - activeElapsed;
      if (timeToNextBreak > 0 && remainingLen >= timeToNextBreak) {
        result.push({ intensity: intensity, len: timeToNextBreak });
        activeElapsed += timeToNextBreak;
        remainingLen -= timeToNextBreak;
        if (activeElapsed < state.targetMin * 60) {
          result.push({ intensity: 'break', len: 30 });
        }
        nextBreakMark += 600;
      } else {
        result.push({ intensity: intensity, len: remainingLen });
        activeElapsed += remainingLen;
        remainingLen = 0;
      }
    }
  }
  return result;
}

export function segIndexAt(e) {
  for (var i = 0; i < state.ends.length; i++) {
    if (e < state.ends[i]) return i;
  }
  return state.ends.length - 1;
}

export function segStart(i) {
  return i === 0 ? 0 : state.ends[i - 1];
}

export function toggleBreaks() {
  state.breaksEnabled = !state.breaksEnabled;
}

export function esc(s) { return String(s); }