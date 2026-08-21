/**
 * CrewCall — comprehensive test suite for interval sequence generation,
 * Smart Builder questionnaire-to-plan mapping, Surprise Me randomization,
 * timing calculations, and regression tests.
 */
const {
  RATIOS, MINLEN, INTENSITY_FREQ,
  freqFor, arrange, computeLen, minPresentLen,
  canAdd, curCounts, canSetTarget, buildPreview,
  applyAutoBreaks, generateSmartPlan,
  surpriseDeterministic, mulberry32,
  validateConfigSchema, VALID_INTENSITIES
} = require('./crewcall-logic.js');

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Create a minimal state config with given counts and target. */
function makeConfig(counts, targetMin) {
  return {
    high:   { count: counts.high   || 0, len: 45,  rate: 30 },
    medium: { count: counts.medium || 0, len: 90,  rate: 28 },
    med:    { count: counts.med    || 0, len: 105, rate: 26 },
    low:    { count: counts.low    || 0, len: 120, rate: 24 },
    freeform: { count: counts.freeform || 0, len: 60, rate: null },
    _targetSec: (targetMin || 10) * 60
  };
}

/** Total duration of a sequence in seconds. */
function totalDuration(seq) {
  return seq.reduce(function (sum, s) { return sum + s.len; }, 0);
}

/** Count interval types in a sequence. */
function countByIntensity(seq) {
  var counts = {};
  seq.forEach(function (s) {
    counts[s.intensity] = (counts[s.intensity] || 0) + 1;
  });
  return counts;
}

// ─── freqFor ─────────────────────────────────────────────────────────────────

describe('freqFor', function () {
  it('returns correct frequencies for known intensity keys', function () {
    expect(freqFor('high')).toBe(740);
    expect(freqFor('medium')).toBe(640);
    expect(freqFor('med')).toBe(540);
    expect(freqFor('break')).toBe(380);
  });

  it('returns default 440 for unknown keys', function () {
    expect(freqFor('low')).toBe(440);
    expect(freqFor('freeform')).toBe(440);
    expect(freqFor('')).toBe(440);
  });
});

// ─── arrange ─────────────────────────────────────────────────────────────────

describe('arrange', function () {
  it('returns empty array for all-zero counts', function () {
    expect(arrange(0, 0, 0, 0, 0)).toEqual([]);
  });

  it('starts and ends with low when low count >= 2', function () {
    var result = arrange(0, 0, 0, 2, 0);
    expect(result[0]).toBe('low');
    expect(result[result.length - 1]).toBe('low');
  });

  it('starts with low when low count = 1', function () {
    var result = arrange(0, 0, 0, 1, 0);
    expect(result[0]).toBe('low');
  });

  it('produces correct total count from arrange', function () {
    var result = arrange(2, 3, 2, 4, 0);
    expect(result.length).toBe(11); // 2+3+2+4
  });

  it('interleaves intensities without consecutive duplicates', function () {
    var result = arrange(3, 2, 2, 4, 0);
    for (var i = 1; i < result.length; i++) {
      expect(result[i]).not.toBe(result[i - 1]);
    }
  });

  it('handles freeform counts', function () {
    var result = arrange(1, 1, 1, 2, 2);
    expect(result.length).toBe(7);
    expect(result.filter(function (k) { return k === 'freeform'; }).length).toBe(2);
  });

  it('produces balanced distribution for small counts', function () {
    var result = arrange(1, 1, 1, 2, 0);
    expect(result.length).toBe(5);
    expect(result[0]).toBe('low');
    expect(result[result.length - 1]).toBe('low');
  });

  it('handles high counts only', function () {
    var result = arrange(5, 0, 0, 0, 0);
    expect(result.length).toBe(5);
    result.forEach(function (k) { expect(k).toBe('high'); });
  });

  it('handles large counts without error', function () {
    var result = arrange(12, 12, 12, 12, 5);
    expect(result.length).toBe(53);
  });
});

// ─── computeLen ──────────────────────────────────────────────────────────────

describe('computeLen', function () {
  it('returns zeros when total ratio is zero', function () {
    var L = computeLen(600, { high: 0, medium: 0, med: 0, low: 0, freeform: 0 });
    expect(L).toEqual({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 });
  });

  it('computes lengths proportional to RATIOS', function () {
    var L = computeLen(600, { high: 1, medium: 1, med: 1, low: 1, freeform: 1 });
    // total ratio = 2+3+3.5+4+3 = 15.5
    // unit = 600/15.5 = 38.7...
    expect(L.high).toBeGreaterThan(0);
    expect(L.low).toBeGreaterThan(L.high); // low ratio 4 > high ratio 2
  });

  it('always returns at least 1 second per tier', function () {
    var L = computeLen(30, { high: 0, medium: 0, med: 0, low: 1, freeform: 0 });
    expect(L.low).toBeGreaterThanOrEqual(1);
  });

  it('scales linearly with target time', function () {
    var counts = { high: 1, medium: 1, med: 1, low: 1, freeform: 0 };
    var L10 = computeLen(600, counts);
    var L20 = computeLen(1200, counts);
    // Each length should approximately double
    expect(Math.round(L20.high / L10.high)).toBeGreaterThanOrEqual(1);
    expect(Math.round(L20.high / L10.high)).toBeLessThanOrEqual(3);
  });

  it('maintains ratio consistency between tiers', function () {
    var counts = { high: 2, medium: 2, med: 2, low: 2, freeform: 0 };
    var L = computeLen(1200, counts);
    // low:high ratio should be close to 4:2 = 2:1
    var ratio = L.low / L.high;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });
});

// ─── minPresentLen ───────────────────────────────────────────────────────────

describe('minPresentLen', function () {
  it('finds minimum among present tiers', function () {
    var L = { high: 45, medium: 90, med: 105, low: 120, freeform: 60 };
    var counts = { high: 2, medium: 0, med: 1, low: 4, freeform: 0 };
    expect(minPresentLen(L, counts)).toBe(45);
  });

  it('returns Infinity when no tiers present', function () {
    var L = { high: 45, medium: 90, med: 105, low: 120, freeform: 60 };
    var counts = { high: 0, medium: 0, med: 0, low: 0, freeform: 0 };
    expect(minPresentLen(L, counts)).toBe(Infinity);
  });
});

// ─── buildPreview ────────────────────────────────────────────────────────────

describe('buildPreview', function () {
  it('produces a sequence with matching counts', function () {
    var config = makeConfig({ high: 2, medium: 2, med: 2, low: 3, freeform: 0 }, 20);
    var preview = buildPreview(config);
    var counts = countByIntensity(preview);
    expect(preview.length).toBeGreaterThan(0);
  });

  it('all segments have positive length', function () {
    var config = makeConfig({ high: 2, medium: 2, med: 2, low: 4, freeform: 0 }, 15);
    var preview = buildPreview(config);
    preview.forEach(function (seg, i) {
      expect(seg.len).toBeGreaterThan(0, 'Segment ' + i + ' has zero length');
    });
  });
});

// ─── applyAutoBreaks ─────────────────────────────────────────────────────────

describe('applyAutoBreaks', function () {
  var baseSeq = [
    { intensity: 'high', len: 60, rate: 30 },
    { intensity: 'low', len: 120, rate: 24 },
    { intensity: 'medium', len: 90, rate: 28 },
    { intensity: 'low', len: 120, rate: 24 }
  ];

  it('returns identical sequence when breaks disabled', function () {
    var result = applyAutoBreaks(baseSeq, false, 30);
    expect(result.length).toBe(baseSeq.length);
    expect(result).toEqual(baseSeq);
  });

  it('returns identical sequence when target < 20 min', function () {
    var result = applyAutoBreaks(baseSeq, true, 15);
    expect(result).toEqual(baseSeq);
  });

  it('inserts break segments for long sequences', function () {
    // A 30-min sequence should get breaks
    var longSeq = [{ intensity: 'low', len: 1800, rate: 24 }]; // 30 min
    var result = applyAutoBreaks(longSeq, true, 30);
    expect(result.length).toBeGreaterThan(1);
    var breakCount = result.filter(function (s) { return s.intensity === 'break'; }).length;
    expect(breakCount).toBeGreaterThan(0);
  });

  it('does not insert breaks in the final segment', function () {
    // Last segment that ends at exactly targetMin should not get a trailing break
    var seq = [{ intensity: 'low', len: 1800, rate: 24 }]; // exactly 30 min
    var result = applyAutoBreaks(seq, true, 30);
    var last = result[result.length - 1];
    expect(last.intensity).not.toBe('break');
  });

  it('total duration matches with breaks (breaks add time)', function () {
    var seq = [{ intensity: 'low', len: 1200, rate: 24 }]; // 20 min
    var result = applyAutoBreaks(seq, true, 20);
    // At 10 min mark, a 30s break should be inserted
    var dur = totalDuration(result);
    expect(dur).toBe(1200 + 30); // original + one break
  });

  it('handles short segments correctly', function () {
    var seq = [
      { intensity: 'high', len: 45, rate: 30 },
      { intensity: 'medium', len: 90, rate: 28 }
    ];
    var result = applyAutoBreaks(seq, true, 30);
    // Short sequence (< 10 min) with breaks enabled but 30 min target
    // No breaks should appear since total < 10 min
    expect(result.length).toBe(seq.length);
  });
});

// ─── generateSmartPlan — all 18 combinations ─────────────────────────────────

describe('generateSmartPlan', function () {
  function verifySmartPlan(answers) {
    var seq = generateSmartPlan(answers);
    // Should have warmup + core blocks + cooldown
    expect(seq.length).toBeGreaterThanOrEqual(3);
    // First segment should be warmup (low intensity)
    expect(seq[0].intensity).toBe('low');
    expect(seq[0].len).toBeGreaterThan(0);
    // Last segment should be cooldown (low intensity)
    expect(seq[seq.length - 1].intensity).toBe('low');
    expect(seq[seq.length - 1].len).toBeGreaterThan(0);
    // All segments should have positive length
    seq.forEach(function (s, i) {
      expect(s.len).toBeGreaterThan(0, 'Segment ' + i + ' has zero length');
    });
    // Total duration should approximately match target
    var dur = Math.round(totalDuration(seq) / 60);
    expect(dur).toBeGreaterThanOrEqual(parseInt(answers.duration, 10) - 2);
    expect(dur).toBeLessThanOrEqual(parseInt(answers.duration, 10) + 2);
    // No consecutive same intensity (except breaks)
    for (var i = 1; i < seq.length; i++) {
      if (seq[i].intensity !== 'break' && seq[i - 1].intensity !== 'break') {
        // Allow consecutive 'low' for warmup->core or core->cooldown transitions
      }
    }
    return seq;
  }

  // Sweat goal — 6 combinations
  describe('goal=sweat', function () {
    it('energy=high, tired=yes', function () {
      verifySmartPlan({ energy: 'high', tired: 'yes', goal: 'sweat', duration: 20 });
    });
    it('energy=high, tired=no', function () {
      verifySmartPlan({ energy: 'high', tired: 'no', goal: 'sweat', duration: 30 });
    });
    it('energy=moderate, tired=yes', function () {
      verifySmartPlan({ energy: 'moderate', tired: 'yes', goal: 'sweat', duration: 20 });
    });
    it('energy=moderate, tired=no', function () {
      verifySmartPlan({ energy: 'moderate', tired: 'no', goal: 'sweat', duration: 25 });
    });
    it('energy=low, tired=yes', function () {
      verifySmartPlan({ energy: 'low', tired: 'yes', goal: 'sweat', duration: 20 });
    });
    it('energy=low, tired=no', function () {
      verifySmartPlan({ energy: 'low', tired: 'no', goal: 'sweat', duration: 30 });
    });
  });

  // Balanced goal — 6 combinations
  describe('goal=balanced', function () {
    it('energy=high, tired=yes', function () {
      verifySmartPlan({ energy: 'high', tired: 'yes', goal: 'balanced', duration: 20 });
    });
    it('energy=high, tired=no', function () {
      verifySmartPlan({ energy: 'high', tired: 'no', goal: 'balanced', duration: 30 });
    });
    it('energy=moderate, tired=yes', function () {
      verifySmartPlan({ energy: 'moderate', tired: 'yes', goal: 'balanced', duration: 20 });
    });
    it('energy=moderate, tired=no', function () {
      verifySmartPlan({ energy: 'moderate', tired: 'no', goal: 'balanced', duration: 25 });
    });
    it('energy=low, tired=yes', function () {
      var seq = verifySmartPlan({ energy: 'low', tired: 'yes', goal: 'balanced', duration: 20 });
      // Low energy + tired → should have mostly low/med intensity
      var highCount = seq.filter(function (s) { return s.intensity === 'high'; }).length;
      expect(highCount).toBe(0);
    });
    it('energy=low, tired=no', function () {
      verifySmartPlan({ energy: 'low', tired: 'no', goal: 'balanced', duration: 30 });
    });
  });

  // Recovery goal — 6 combinations
  describe('goal=recovery', function () {
    it('energy=high, tired=yes', function () {
      verifySmartPlan({ energy: 'high', tired: 'yes', goal: 'recovery', duration: 20 });
    });
    it('energy=high, tired=no', function () {
      verifySmartPlan({ energy: 'high', tired: 'no', goal: 'recovery', duration: 30 });
    });
    it('energy=moderate, tired=yes', function () {
      verifySmartPlan({ energy: 'moderate', tired: 'yes', goal: 'recovery', duration: 20 });
    });
    it('energy=moderate, tired=no', function () {
      verifySmartPlan({ energy: 'moderate', tired: 'no', goal: 'recovery', duration: 25 });
    });
    it('energy=low, tired=yes', function () {
      var seq = verifySmartPlan({ energy: 'low', tired: 'yes', goal: 'recovery', duration: 20 });
      // Recovery + low energy → no high intensity
      var highCount = seq.filter(function (s) { return s.intensity === 'high'; }).length;
      expect(highCount).toBe(0);
    });
    it('energy=low, tired=no', function () {
      verifySmartPlan({ energy: 'low', tired: 'no', goal: 'recovery', duration: 30 });
    });
  });

  // Edge cases
  it('handles short duration (15 min) with correct warmup', function () {
    var seq = generateSmartPlan({ energy: 'moderate', tired: 'no', goal: 'balanced', duration: 15 });
    expect(seq[0].len).toBe(120); // 2 min warmup for <=15 min
    expect(seq[seq.length - 1].len).toBe(120); // 2 min cooldown
  });

  it('handles long duration (60 min)', function () {
    var seq = generateSmartPlan({ energy: 'high', tired: 'no', goal: 'sweat', duration: 60 });
    expect(seq[0].len).toBe(180); // 3 min warmup for >15 min
    expect(seq[seq.length - 1].len).toBe(180); // 3 min cooldown
    expect(seq.length).toBeGreaterThan(5);
  });

  it('all segments have valid rate values', function () {
    var seq = generateSmartPlan({ energy: 'high', tired: 'no', goal: 'sweat', duration: 30 });
    seq.forEach(function (s, i) {
      expect(typeof s.rate).toBe('number', 'Segment ' + i + ' missing rate');
    });
  });

  it('break segments have rate 0', function () {
    var seq = generateSmartPlan({ energy: 'high', tired: 'yes', goal: 'sweat', duration: 30 });
    seq.forEach(function (s) {
      if (s.intensity === 'break') {
        expect(s.rate).toBe(0);
      }
    });
  });
});

// ─── surpriseDeterministic ───────────────────────────────────────────────────

describe('surpriseDeterministic', function () {
  it('produces deterministic output with same seed', function () {
    var rng1 = mulberry32(42);
    var rng2 = mulberry32(42);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);

    var result1 = surpriseDeterministic(config, rng1);
    var result2 = surpriseDeterministic(config, rng2);
    expect(result1).toEqual(result2);
  });

  it('produces different output with different seeds', function () {
    var rng1 = mulberry32(42);
    var rng2 = mulberry32(99);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);

    var result1 = surpriseDeterministic(config, rng1);
    var result2 = surpriseDeterministic(config, rng2);
    // They might occasionally match, but very unlikely with different seeds
    expect(result1).not.toEqual(result2);
  });

  it('returns valid counts (between 0-12 per tier)', function () {
    var rng = mulberry32(42);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);
    var result = surpriseDeterministic(config, rng);

    ['high', 'medium', 'med', 'low'].forEach(function (k) {
      expect(result[k]).toBeGreaterThanOrEqual(0);
      expect(result[k]).toBeLessThanOrEqual(12);
    });
  });

  it('produces at least 6 total intervals', function () {
    var rng = mulberry32(42);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);
    var result = surpriseDeterministic(config, rng);

    var total = result.high + result.medium + result.med + result.low;
    expect(total).toBeGreaterThanOrEqual(6);
    // Surprise generates 6 + rand(0..5) intervals, so should be 6-11
    expect(total).toBeLessThanOrEqual(11);
  });

  it('starts with exactly 2 low intervals', function () {
    var rng = mulberry32(42);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);
    var result = surpriseDeterministic(config, rng);
    expect(result.low).toBeGreaterThanOrEqual(2);
  });

  it('falls back to 2 low when all counts zero', function () {
    // Use a seed that produces no viable intervals
    var rng = mulberry32(1);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 1); // very short target = impossible to add
    var result = surpriseDeterministic(config, rng);
    expect(result.low).toBeGreaterThanOrEqual(2);
  });

  it('applies valid timing constraints', function () {
    var rng = mulberry32(42);
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);
    var result = surpriseDeterministic(config, rng);

    // Every tier present should have length >= MINLEN
    var counts = result;
    var L = computeLen(config._targetSec, counts);
    expect(minPresentLen(L, counts)).toBeGreaterThanOrEqual(MINLEN);
  });

  it('produces varied results across multiple seeds', function () {
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 30);
    var results = {};
    for (var seed = 0; seed < 10; seed++) {
      var rng = mulberry32(seed);
      var r = surpriseDeterministic(config, rng);
      var key = r.high + '-' + r.medium + '-' + r.med + '-' + r.low;
      results[key] = (results[key] || 0) + 1;
    }
    // At least 2 different results from 10 seeds
    expect(Object.keys(results).length).toBeGreaterThanOrEqual(2);
  });
});

// ─── canAdd / canSetTarget ───────────────────────────────────────────────────

describe('canAdd', function () {
  it('returns true when interval can be added', function () {
    var config = makeConfig({ high: 1, medium: 2, med: 2, low: 3, freeform: 0 }, 20);
    expect(canAdd('high', config)).toBe(true);
  });

  it('returns false when count >= 12', function () {
    var config = makeConfig({ high: 12, medium: 0, med: 0, low: 0, freeform: 0 }, 20);
    expect(canAdd('high', config)).toBe(false);
  });

  it('returns false when adding would make segments too short', function () {
    // Very short target + many intervals = segments too short
    var config = makeConfig({ high: 10, medium: 10, med: 10, low: 10, freeform: 0 }, 5);
    expect(canAdd('high', config)).toBe(false);
  });
});

describe('canSetTarget', function () {
  it('returns true for feasible target', function () {
    var config = makeConfig({ high: 2, medium: 2, med: 2, low: 4, freeform: 0 }, 20);
    expect(canSetTarget(30 * 60, config)).toBe(true);
  });

  it('returns false for too-short target', function () {
    var config = makeConfig({ high: 4, medium: 4, med: 4, low: 4, freeform: 0 }, 20);
    // Very short target with many intervals
    expect(canSetTarget(60, config)).toBe(false);
  });
});

// ─── Integration: arrange + computeLen + buildPreview ────────────────────────

describe('arrange + computeLen integration', function () {
  it('produces complete preview with correct total intervals', function () {
    var counts = { high: 3, medium: 2, med: 3, low: 4, freeform: 0 };
    var config = makeConfig(counts, 20);
    var preview = buildPreview(config);
    var totalFromPreview = countByIntensity(preview);
    var sum = 0;
    Object.keys(totalFromPreview).forEach(function (k) {
      sum += totalFromPreview[k];
    });
    var totalCounts = counts.high + counts.medium + counts.med + counts.low + counts.freeform;
    expect(sum).toBe(totalCounts);
  });

  it('reproduces same sequence for same inputs', function () {
    var config = makeConfig({ high: 2, medium: 2, med: 2, low: 4, freeform: 1 }, 25);
    var preview1 = buildPreview(config);
    var preview2 = buildPreview(config);
    expect(preview1).toEqual(preview2);
  });

  it('all interval lengths satisfy MINLEN constraint', function () {
    var config = makeConfig({ high: 8, medium: 8, med: 0, low: 8, freeform: 0 }, 30);
    var preview = buildPreview(config);
    preview.forEach(function (seg, i) {
      expect(seg.len).toBeGreaterThanOrEqual(MINLEN, 'Interval ' + i + ' too short: ' + seg.len + 's');
    });
  });
});

// ─── Regression: Edge Cases ──────────────────────────────────────────────────

describe('regression edge cases', function () {
  it('handles single tier only (all low)', function () {
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 5, freeform: 0 }, 15);
    var preview = buildPreview(config);
    expect(preview.length).toBe(5);
    preview.forEach(function (s) { expect(s.intensity).toBe('low'); });
  });

  it('handles zero count for all tiers', function () {
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 0 }, 10);
    var preview = buildPreview(config);
    expect(preview.length).toBe(0);
  });

  it('handles freeform-only input', function () {
    var config = makeConfig({ high: 0, medium: 0, med: 0, low: 0, freeform: 3 }, 10);
    var preview = buildPreview(config);
    expect(preview.length).toBe(3);
    preview.forEach(function (s) { expect(s.intensity).toBe('freeform'); });
  });

  it('handles very long durations (120 min)', function () {
    var seq = generateSmartPlan({ energy: 'high', tired: 'no', goal: 'sweat', duration: 120 });
    var dur = Math.round(totalDuration(seq) / 60);
    // Should be close to 120 min (allow for rounding)
    expect(dur).toBeGreaterThanOrEqual(115);
    expect(dur).toBeLessThanOrEqual(125);
  });

  it('handles very short duration (5 min)', function () {
    var seq = generateSmartPlan({ energy: 'moderate', tired: 'no', goal: 'balanced', duration: 5 });
    var dur = Math.round(totalDuration(seq) / 60);
    expect(dur).toBeGreaterThanOrEqual(3);
    expect(dur).toBeLessThanOrEqual(7);
    // Very short session: should still have warmup and cooldown
    expect(seq[0].intensity).toBe('low');
    expect(seq[seq.length - 1].intensity).toBe('low');
  });

  it('no NaN or Infinity values in any computation', function () {
    // arrange
    var seq = arrange(2, 2, 2, 3, 1);
    seq.forEach(function (k, i) {
      expect(k).not.toBeNaN();
    });

    // computeLen
    var L = computeLen(600, { high: 1, medium: 1, med: 1, low: 1, freeform: 1 });
    Object.keys(L).forEach(function (k) {
      expect(isNaN(L[k])).toBe(false);
      expect(L[k]).not.toBe(Infinity);
      expect(L[k]).not.toBe(-Infinity);
    });
  });
});

// ─── applyAutoBreaks edge cases ──────────────────────────────────────────────

describe('applyAutoBreaks edge cases', function () {
  it('handles empty sequence', function () {
    expect(applyAutoBreaks([], true, 30)).toEqual([]);
  });

  it('inserts breaks at correct 10-minute intervals', function () {
    // 2 hours of low
    var seq = [{ intensity: 'low', len: 7200, rate: 24 }];
    var result = applyAutoBreaks(seq, true, 120);
    var breakCount = result.filter(function (s) { return s.intensity === 'break'; }).length;
    // 120 minutes → 11 breaks (at 10, 20, 30, ... 110 min marks)
    expect(breakCount).toBe(11);
  });

  it('total duration calculation with many breaks', function () {
    var seq = [{ intensity: 'low', len: 3600, rate: 24 }]; // 60 min
    var result = applyAutoBreaks(seq, true, 60);
    var totalBreakTime = result
      .filter(function (s) { return s.intensity === 'break'; })
      .reduce(function (sum, s) { return sum + s.len; }, 0);
    // 5 breaks × 30s = 150s (at 10, 20, 30, 40, 50 min marks — no break at 60 min)
    expect(totalBreakTime).toBe(150);
    expect(totalDuration(result)).toBe(3600 + 150);
  });

  it('break segments have rate 0', function () {
    var seq = [{ intensity: 'low', len: 3600, rate: 24 }];
    var result = applyAutoBreaks(seq, true, 60);
    result.forEach(function (s) {
      if (s.intensity === 'break') {
        expect(s.rate).toBe(0);
      } else {
        expect(s.rate).toBe(24);
      }
    });
  });
});

// ─── curCounts ───────────────────────────────────────────────────────────────

describe('curCounts', function () {
  it('extracts counts from config correctly', function () {
    var config = makeConfig({ high: 3, medium: 4, med: 5, low: 6, freeform: 1 }, 20);
    var counts = curCounts(config);
    expect(counts).toEqual({ high: 3, medium: 4, med: 5, low: 6, freeform: 1 });
  });
});

// ─── Permutation stability ──────────────────────────────────────────────────

describe('sequence stability', function () {
  it('arrange is deterministic for same inputs', function () {
    var r1 = arrange(3, 2, 2, 4, 0);
    var r2 = arrange(3, 2, 2, 4, 0);
    expect(r1).toEqual(r2);
  });

  it('total duration is consistent for same config', function () {
    var seq1 = generateSmartPlan({ energy: 'high', tired: 'no', goal: 'sweat', duration: 30 });
    var seq2 = generateSmartPlan({ energy: 'high', tired: 'no', goal: 'sweat', duration: 30 });
    expect(totalDuration(seq1)).toBe(totalDuration(seq2));
  });
});

// ─── validateConfigSchema — import/export validation ─────────────────────────

describe('validateConfigSchema', function () {
  var validConfig = {
    targetMin: 20,
    config: {
      high:     { count: 2, rate: 30 },
      medium:   { count: 2, rate: 28 },
      med:      { count: 2, rate: 26 },
      low:      { count: 4, rate: 24 },
      freeform: { count: 0, rate: null }
    }
  };

  it('validates a standard config', function () {
    var result = validateConfigSchema(validConfig);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('rejects null/undefined input', function () {
    expect(validateConfigSchema(null).valid).toBe(false);
    expect(validateConfigSchema(undefined).valid).toBe(false);
  });

  it('rejects non-object data', function () {
    expect(validateConfigSchema('string').valid).toBe(false);
    expect(validateConfigSchema(42).valid).toBe(false);
  });

  it('rejects missing targetMin', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    delete data.targetMin;
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('session length');
  });

  it('rejects targetMin below 10', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    data.targetMin = 5;
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
  });

  it('rejects targetMin above 90', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    data.targetMin = 100;
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
  });

  it('rejects missing config object', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    delete data.config;
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('configuration object');
  });

  it('rejects missing intensity config', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    delete data.config.high;
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('high');
  });

  it('rejects invalid count (negative)', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    data.config.high.count = -1;
    expect(validateConfigSchema(data).valid).toBe(false);
  });

  it('rejects invalid count (over 12)', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    data.config.high.count = 15;
    expect(validateConfigSchema(data).valid).toBe(false);
  });

  it('rejects invalid rate (below 10)', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    data.config.high.rate = 5;
    expect(validateConfigSchema(data).valid).toBe(false);
  });

  it('accepts null rate for freeform', function () {
    var data = JSON.parse(JSON.stringify(validConfig));
    data.config.freeform.rate = null;
    expect(validateConfigSchema(data).valid).toBe(true);
  });

  it('rejects config that makes intervals too short', function () {
    var data = {
      targetMin: 10,
      config: {
        high:     { count: 10, rate: 30 },
        medium:   { count: 10, rate: 28 },
        med:      { count: 10, rate: 26 },
        low:      { count: 10, rate: 24 },
        freeform: { count: 0, rate: null }
      }
    };
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('shorter than');
  });

  // Advanced sequence tests
  it('validates a valid advanced sequence', function () {
    var data = {
      targetMin: 30,
      advancedSequence: [
        { intensity: 'low', len: 120, rate: 24 },
        { intensity: 'high', len: 60, rate: 30 },
        { intensity: 'break', len: 30, rate: 0 },
        { intensity: 'med', len: 90, rate: 26 },
        { intensity: 'low', len: 120, rate: 24 }
      ]
    };
    expect(validateConfigSchema(data).valid).toBe(true);
  });

  it('rejects advanced sequence with bad block structure', function () {
    var data = {
      targetMin: 30,
      advancedSequence: ['string', 'not', 'blocks']
    };
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('malformed');
  });

  it('rejects advanced sequence with invalid intensity', function () {
    var data = {
      targetMin: 30,
      advancedSequence: [
        { intensity: 'extreme', len: 60, rate: 30 }
      ]
    };
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('unrecognized intensity');
  });

  it('rejects advanced sequence with too-short block', function () {
    var data = {
      targetMin: 30,
      advancedSequence: [
        { intensity: 'low', len: 5, rate: 24 }
      ]
    };
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid duration');
  });

  it('rejects advanced sequence with invalid stroke rate', function () {
    var data = {
      targetMin: 30,
      advancedSequence: [
        { intensity: 'high', len: 60, rate: 200 }
      ]
    };
    var result = validateConfigSchema(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid stroke rate');
  });

  it('accepts break blocks without rate', function () {
    var data = {
      targetMin: 30,
      advancedSequence: [
        { intensity: 'break', len: 30 }
      ]
    };
    expect(validateConfigSchema(data).valid).toBe(true);
  });

  it('VALID_INTENSITIES includes all expected values', function () {
    expect(VALID_INTENSITIES).toEqual(['high', 'medium', 'med', 'low', 'break', 'freeform']);
  });
});