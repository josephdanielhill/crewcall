/**
 * Extracted CrewCall logic for testing.
 * Core functions from the CrewCall rowing interval app.
 */

// Constants
var RATIOS = { high: 2, medium: 3, med: 3.5, low: 4, freeform: 3 };
var MINLEN = 15;
var INTENSITY_FREQ = { high: 740, medium: 640, med: 540, break: 380 };

function freqFor(k) { return INTENSITY_FREQ[k] || 440; }

/**
 * Arrange intervals in balanced order.
 * @param {number} h - high interval count
 * @param {number} m - medium interval count
 * @param {number} md - med interval count
 * @param {number} l - low interval count
 * @param {number} [f=0] - freeform interval count
 * @returns {string[]} Array of intensity keys in arranged order
 */
function arrange(h, m, md, l, f) {
  f = f || 0;
  var firstLow = false;
  var lastLow = false;
  var remL = l;

  if (remL > 0) {
    firstLow = true;
    remL--;
  }
  if (remL > 0) {
    lastLow = true;
    remL--;
  }

  var pools = { high: h, medium: m, med: md, low: remL, freeform: f };
  var total = h + m + md + remL + f;
  var remaining = { high: pools.high, medium: pools.medium, med: pools.med, low: pools.low, freeform: pools.freeform };
  var placed = { high: 0, medium: 0, med: 0, low: 0, freeform: 0 };
  var order = ['low', 'med', 'medium', 'high', 'medium', 'med', 'freeform'];
  var middleSeq = [];
  var prev = firstLow ? 'low' : null;

  for (var i = 0; i < total; i++) {
    var best = null, bestScore = -Infinity;
    var progress = (i + 1) / total;
    ['high', 'medium', 'med', 'low', 'freeform'].forEach(function (k) {
      if (remaining[k] <= 0) return;
      var score = progress * pools[k] - placed[k];
      if (k === prev) score -= 1.0;
      score += order.indexOf(k) * 0.0001;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
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

/**
 * Compute interval lengths for each tier based on target duration.
 * @param {number} targetSec - target duration in seconds
 * @param {Object} counts - {high, medium, med, low, freeform} counts
 * @returns {Object} length per tier in seconds
 */
function computeLen(targetSec, counts) {
  var R = RATIOS;
  var tr = counts.high * R.high + counts.medium * R.medium + counts.med * R.med + counts.low * R.low + counts.freeform * R.freeform;
  if (tr === 0) return { high: 0, medium: 0, med: 0, low: 0, freeform: 0 };
  var u = targetSec / tr;
  return {
    high: Math.max(1, Math.round(R.high * u)),
    medium: Math.max(1, Math.round(R.medium * u)),
    med: Math.max(1, Math.round(R.med * u)),
    low: Math.max(1, Math.round(R.low * u)),
    freeform: Math.max(1, Math.round(R.freeform * u))
  };
}

/**
 * Find the minimum present segment length among tiers that have at least one interval.
 */
function minPresentLen(L, counts) {
  var mn = Infinity;
  ['high', 'medium', 'med', 'low', 'freeform'].forEach(function (k) {
    if (counts[k] > 0) mn = Math.min(mn, L[k]);
  });
  return mn;
}

/**
 * Check if an interval of kind k can be added.
 */
function canAdd(k, stateConfig) {
  if (stateConfig[k].count >= 12) return false;
  var counts = curCounts(stateConfig);
  counts[k]++;
  var L = computeLen(stateConfig._targetSec, counts);
  return minPresentLen(L, counts) >= MINLEN;
}

/**
 * Get current counts from config.
 */
function curCounts(config) {
  return {
    high: config.high.count,
    medium: config.medium.count,
    med: config.med.count,
    low: config.low.count,
    freeform: config.freeform.count
  };
}

/**
 * Check if a target duration is valid.
 */
function canSetTarget(targetSec, config) {
  var counts = curCounts(config);
  var L = computeLen(targetSec, counts);
  return minPresentLen(L, counts) >= MINLEN;
}

/**
 * Build a preview of the interval sequence.
 */
function buildPreview(stateConfig) {
  var counts = curCounts(stateConfig);
  var L = computeLen(stateConfig._targetSec, counts);
  return arrange(counts.high, counts.medium, counts.med, counts.low, counts.freeform).map(function (k) {
    return { intensity: k, len: L[k] };
  });
}

/**
 * Apply auto-breaks every 10 minutes if enabled and session >= 20 min.
 */
function applyAutoBreaks(sequence, breaksEnabled, targetMin) {
  if (!breaksEnabled || targetMin < 20) {
    return sequence.slice();
  }
  var result = [];
  var activeElapsed = 0;
  var nextBreakMark = 600;
  for (var i = 0; i < sequence.length; i++) {
    var seg = sequence[i];
    var remainingLen = seg.len;
    var intensity = seg.intensity;
    var rate = seg.rate;

    while (remainingLen > 0) {
      var timeToNextBreak = nextBreakMark - activeElapsed;
      if (timeToNextBreak > 0 && remainingLen >= timeToNextBreak) {
        result.push({
          intensity: intensity,
          len: timeToNextBreak,
          rate: rate
        });
        activeElapsed += timeToNextBreak;
        remainingLen -= timeToNextBreak;
        if (activeElapsed < targetMin * 60) {
          result.push({
            intensity: 'break',
            len: 30,
            rate: 0
          });
        }
        nextBreakMark += 600;
      } else {
        result.push({
          intensity: intensity,
          len: remainingLen,
          rate: rate
        });
        activeElapsed += remainingLen;
        remainingLen = 0;
      }
    }
  }
  return result;
}

/**
 * Generate a Smart Plan sequence from questionnaire answers.
 * @param {Object} answers - { energy: 'high'|'moderate'|'low', tired: 'yes'|'no', goal: 'sweat'|'balanced'|'recovery', duration: number }
 * @returns {Object[]} Array of {intensity, len, rate} segments
 */
function generateSmartPlan(answers) {
  var energy = answers.energy;
  var tired = answers.tired;
  var goal = answers.goal;
  var durMin = parseInt(answers.duration, 10);

  var targetSec = durMin * 60;
  var warmupSec = durMin <= 15 ? 120 : 180;
  var cooldownSec = durMin <= 15 ? 120 : 180;

  var sequence = [];

  // 1. Add Warmup
  sequence.push({ intensity: 'low', len: warmupSec, rate: 24 });

  // 2. Build core block options
  var coreSec = targetSec - warmupSec - cooldownSec;
  var coreBlocks = [];

  if (goal === 'sweat') {
    if (energy === 'high') {
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'high', len: 45, rate: 30 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'break', len: 45, rate: 0 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'high', len: 60, rate: 30 },
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'medium', len: 120, rate: 28 },
          { intensity: 'low', len: 90, rate: 24 },
          { intensity: 'high', len: 60, rate: 30 },
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'medium', len: 120, rate: 28 },
          { intensity: 'low', len: 90, rate: 24 }
        ];
      }
    } else if (energy === 'moderate') {
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'high', len: 45, rate: 30 },
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'medium', len: 120, rate: 28 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      }
    } else { // energy === 'low'
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'medium', len: 60, rate: 28 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'med', len: 120, rate: 26 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      }
    }
  } else if (goal === 'balanced') {
    if (energy === 'high') {
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'high', len: 45, rate: 30 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'high', len: 60, rate: 30 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'medium', len: 120, rate: 28 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      }
    } else if (energy === 'moderate') {
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 120, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'medium', len: 90, rate: 28 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 120, rate: 24 },
          { intensity: 'med', len: 120, rate: 26 }
        ];
      }
    } else { // energy === 'low'
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'low', len: 180, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 },
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 }
        ];
      }
    }
  } else { // goal === 'recovery'
    if (energy === 'high') {
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'low', len: 180, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'med', len: 180, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 },
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 }
        ];
      }
    } else if (energy === 'moderate') {
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'med', len: 90, rate: 26 },
          { intensity: 'low', len: 180, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'low', len: 180, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'med', len: 120, rate: 26 },
          { intensity: 'low', len: 240, rate: 24 }
        ];
      }
    } else { // energy === 'low'
      if (tired === 'yes') {
        coreBlocks = [
          { intensity: 'low', len: 240, rate: 24 },
          { intensity: 'break', len: 30, rate: 0 },
          { intensity: 'low', len: 240, rate: 24 }
        ];
      } else {
        coreBlocks = [
          { intensity: 'low', len: 240, rate: 24 },
          { intensity: 'med', len: 60, rate: 26 },
          { intensity: 'low', len: 240, rate: 24 }
        ];
      }
    }
  }

  // Fill the core duration by repeating coreBlocks, adjusting sizes as we approach coreSec
  var elapsedCore = 0;
  var idx = 0;
  while (elapsedCore < coreSec) {
    var block = coreBlocks[idx % coreBlocks.length];
    var nextLen = block.len;

    // If the next block exceeds the remaining core duration
    if (elapsedCore + nextLen > coreSec) {
      var remaining = coreSec - elapsedCore;
      if (remaining >= 30) {
        sequence.push({ intensity: block.intensity, len: remaining, rate: block.rate });
      } else if (sequence.length > 1) {
        sequence[sequence.length - 1].len += remaining;
      }
      break;
    }

    sequence.push({ intensity: block.intensity, len: nextLen, rate: block.rate });
    elapsedCore += nextLen;
    idx++;
  }

  // 3. Add Cooldown
  sequence.push({ intensity: 'low', len: cooldownSec, rate: 24 });

  return sequence;
}

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Deterministic — same seed always produces the same sequence.
 */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Surprise Me — deterministic version using seeded RNG.
 * @param {Object} stateConfig - { targetMin, config (high,medium,med,low,freeform) }
 * @param {function} rng - seeded random function (0-1)
 * @returns {Object} updated config counts
 */
function surpriseDeterministic(stateConfig, rng) {
  var tgt = stateConfig._targetSec;
  var kinds = ['high', 'medium', 'med', 'low'];
  var counts = { high: 0, medium: 0, med: 0, low: 2, freeform: 0 };
  var guard = 0;
  var want = 6 + Math.floor(rng() * 6);
  while ((counts.high + counts.medium + counts.med + counts.low) < want && guard < 300) {
    guard++;
    var k = kinds[Math.floor(rng() * 4)];
    if (counts[k] >= 12) continue;
    var test = { high: counts.high, medium: counts.medium, med: counts.med, low: counts.low, freeform: counts.freeform };
    test[k]++;
    var L = computeLen(tgt, test);
    if (minPresentLen(L, test) >= MINLEN) { counts = test; } else break;
  }
  if (counts.high + counts.medium + counts.med + counts.low === 0) { counts.low = 2; }
  return counts;
}

/**
 * Generate a complete sequence from smart plan (warmup + core * repetitions + cooldown).
 */
function generateSmartPlanFullSequence(answers) {
  return generateSmartPlan(answers);
}

module.exports = {
  RATIOS: RATIOS,
  MINLEN: MINLEN,
  INTENSITY_FREQ: INTENSITY_FREQ,
  freqFor: freqFor,
  arrange: arrange,
  computeLen: computeLen,
  minPresentLen: minPresentLen,
  canAdd: canAdd,
  curCounts: curCounts,
  canSetTarget: canSetTarget,
  buildPreview: buildPreview,
  applyAutoBreaks: applyAutoBreaks,
  generateSmartPlan: generateSmartPlan,
  generateSmartPlanFullSequence: generateSmartPlanFullSequence,
  surpriseDeterministic: surpriseDeterministic,
  mulberry32: mulberry32
};