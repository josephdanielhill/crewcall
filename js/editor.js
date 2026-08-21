// Editor module - advanced timeline editor for CrewCall
"use strict";

import { state, COLORS, fmt, esc } from './state.js';
import { render } from './render.js';

export function goToAdvance() {
  state.enteringAdvance = true;
  state.mode = 'advance';
  state.advancedSequence = state.advancedSequence.length > 0
    ? state.advancedSequence
    : [].concat(state.sequence);
  state.advancedEdited = false;
  render();
}

export function exitAdvance() {
  state.mode = 'setup';
  state.enteringAdvance = false;
  state.insertIndex = null;
  render();
}

export function resetAdvance() {
  state.advancedSequence = [];
  state.advancedEdited = false;
  state.insertIndex = null;
  render();
}

export function addAdvancedBlock(intensity) {
  var dftLen = { high: 45, medium: 90, med: 105, low: 120, break: 30, freeform: 60 };
  state.advancedSequence.push({
    intensity: intensity,
    len: dftLen[intensity] || 60,
    rate: state.config[intensity] ? state.config[intensity].rate : null
  });
  state.advancedEdited = true;
  state.insertIndex = null;
  render();
}

export function toggleInsertMenu(i) {
  state.insertIndex = (state.insertIndex === i) ? null : i;
  render();
}

export function closeInsertMenu() {
  state.insertIndex = null;
  render();
}

export function insertAdvancedBlock(idx, intensity) {
  var dftLen = { high: 45, medium: 90, med: 105, low: 120, break: 30, freeform: 60 };
  var newBlock = {
    intensity: intensity,
    len: dftLen[intensity] || 60,
    rate: state.config[intensity] ? state.config[intensity].rate : null
  };
  state.advancedSequence.splice(idx, 0, newBlock);
  state.advancedEdited = true;
  state.insertIndex = null;
  render();
}

export function deleteAdvancedBlock(idx) {
  state.advancedSequence.splice(idx, 1);
  state.advancedEdited = true;
  render();
}

export function changeAdvancedRate(idx, delta) {
  var s = state.advancedSequence[idx];
  if (!s) return;
  if (s.intensity === 'break' || s.intensity === 'freeform') return;
  var cr = s.rate || 24;
  var nr = Math.max(16, Math.min(40, cr + delta));
  s.rate = nr;
  state.advancedEdited = true;
  render();
}

export function changeAdvancedDur(idx, delta) {
  var s = state.advancedSequence[idx];
  if (!s) return;
  var nd = Math.max(10, s.len + delta);
  s.len = nd;
  state.advancedEdited = true;
  render();
}

export function moveAdvancedBlock(idx, dir) {
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.advancedSequence.length) return;
  var arr = state.advancedSequence;
  var tmp = arr[idx];
  arr[idx] = arr[newIdx];
  arr[newIdx] = tmp;
  state.advancedEdited = true;
  render();
}

export function jumpToAdvancedBlock(idx) {
  var app = document.getElementById('app');
  var card = app.querySelector('.timeline-card[data-index="' + idx + '"]');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    app.querySelectorAll('.timeline-card').forEach(function(c) {
      c.classList.remove('card-highlighted');
      c.style.removeProperty('--highlight-color');
    });
    var intensity = state.advancedSequence[idx].intensity;
    var co = COLORS[intensity];
    card.style.setProperty('--highlight-color', co.fill);
    card.classList.add('card-highlighted');
    setTimeout(function() {
      card.classList.remove('card-highlighted');
      card.style.removeProperty('--highlight-color');
    }, 2000);
  }
}