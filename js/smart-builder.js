// Smart-builder module - questionnaire-based session builder
"use strict";

import { state, COLORS, RATIOS, MINLEN, fmt } from './state.js';
import { showToast } from './session.js';
import { render } from './render.js';

export function openBuilder() {
  state.builderActive = true;
  state.builderStep = 0;
  state.builderAnswers = {
    energy: 'moderate',
    tired: 'no',
    goal: 'balanced',
    duration: 30
  };
  render();
}

export function closeBuilder() {
  state.builderActive = false;
  state.builderStep = 0;
  state.builderAnswers = {
    energy: 'moderate',
    tired: 'no',
    goal: 'balanced',
    duration: 30
  };
  render();
}

export function setBuilderAnswer(key, val) {
  state.builderAnswers[key] = val;
  render();
}

export function nextBuilderStep() {
  if (state.builderStep < 2) {
    state.builderStep++;
    render();
  } else {
    // Step 3 -> generate the plan
    generateSmartPlan();
  }
}

export function prevBuilderStep() {
  if (state.builderStep > 0) {
    state.builderStep--;
    render();
  }
}

export function generateSmartPlan() {
  // Generate an intelligent session plan based on answers
  var answers = state.builderAnswers;
  var targetMin = parseInt(answers.duration, 10) || 30;
  state.targetMin = targetMin;

  var seq = [];

  // Warm-up: always start with a LOW block
  seq.push({ intensity: 'low', len: 120, rate: 22 });

  // Core blocks based on energy, tiredness, and goal
  var coreIntensity = 'medium';
  if (answers.energy === 'high') coreIntensity = 'high';
  else if (answers.energy === 'moderate') coreIntensity = 'medium';
  else coreIntensity = 'med';

  var tired = answers.tired === 'yes';
  var sweat = answers.goal === 'sweat';
  var recovery = answers.goal === 'recovery';

  if (sweat) coreIntensity = answers.energy === 'low' ? 'medium' : 'high';
  if (recovery) coreIntensity = 'low';

  var coreLen = tired ? 90 : 120;
  var coreCount = Math.max(2, Math.floor((targetMin * 60 - 240) / (coreLen + 45)));

  for (var i = 0; i < coreCount; i++) {
    var intensity = coreIntensity;
    // Build pyramid pattern if balanced
    if (answers.goal === 'balanced') {
      var mid = Math.floor(coreCount / 2);
      if (i < mid) {
        var fraction = i / Math.max(1, mid);
        intensity = fraction < 0.33 ? 'med' : (fraction < 0.66 ? 'medium' : 'high');
      } else {
        var frac = (i - mid) / Math.max(1, coreCount - mid - 1);
        intensity = frac < 0.33 ? 'high' : (frac < 0.66 ? 'medium' : 'med');
      }
    }
    var blockLen = tired ? Math.round(coreLen * 0.75) : coreLen;
    seq.push({ intensity: intensity, len: blockLen, rate: getRate(intensity) });
    // Break between core blocks
    if (tired) {
      seq.push({ intensity: 'break', len: 30, rate: null });
    }
    seq.push({ intensity: 'break', len: 30, rate: null });
  }

  // Cool-down: always end with a LOW block
  seq.push({ intensity: 'low', len: 120, rate: 22 });

  state.advancedSequence = seq;
  state.advancedEdited = true;
  state.builderActive = false;

  showToast('Smart plan generated! Review & start.', false);
  render();
}

function getRate(intensity) {
  var rates = { high: 30, medium: 28, med: 26, low: 24, break: null, freeform: null };
  return rates[intensity] || 24;
}