// Main module - event handlers, ACTIONS, initialization
"use strict";

import { state, COLORS, RATIOS, MINLEN, PREP_DURATION, INTENSITY_FREQ, fmt, arrange, curCounts, computeLen, canAdd, canSetTarget, buildPreview, applyAutoBreaks, segIndexAt, segStart, esc, toggleBreaks } from './state.js';
import { ensureAudio, createBeepUrl, beep, transitionBeep, scheduleTransition, countBeep, scheduleCountdown, completeBeep } from './audio.js';
import { render } from './render.js';
import { goToAdvance, exitAdvance, resetAdvance, addAdvancedBlock, toggleInsertMenu, closeInsertMenu, insertAdvancedBlock, deleteAdvancedBlock, changeAdvancedRate, changeAdvancedDur, moveAdvancedBlock, jumpToAdvancedBlock } from './editor.js';
import { build, runWorkout, start, startAdvanced, beginPrep, prepLoop, pause, resume, togglePause, skip, stop, finish, restart, change, changeTarget, showToast, downloadShareCard, downloadConfig, triggerUpload, importConfig, surprise, initRowLog, openRowLog, exitRowLog, logRow, setLogRating, deleteLogEntryFn, replayLogEntry, exportRowLog } from './session.js';
import { openBuilder, closeBuilder, setBuilderAnswer, nextBuilderStep, prevBuilderStep, generateSmartPlan } from './smart-builder.js';
import { isMobile, trackEvent } from './track.js';

// Swipe/drag state
var dragInfo = null;
var lastPointer = null;

// PWA install prompt
var deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredPrompt = e;
  console.log('Install prompt available');
});

// ACTIONS object - maps action names to handler functions
var ACTIONS = {
  toggleSidebar: function() {
    state.sidebarHidden = !state.sidebarHidden;
    render();
  },
  surprise: surprise,
  openBuilder: openBuilder,
  closeBuilder: closeBuilder,
  setBuilderAnswer: function(el) {
    var key = el.getAttribute('data-key');
    var val = el.getAttribute('data-val');
    if (key && val !== null) setBuilderAnswer(key, val);
  },
  nextBuilderStep: nextBuilderStep,
  prevBuilderStep: prevBuilderStep,
  generateSmartPlan: generateSmartPlan,
  advance: goToAdvance,
  exitAdvance: exitAdvance,
  resetAdvance: resetAdvance,
  addAdvancedBlock: function(el) {
    var intensity = el.getAttribute('data-intensity');
    if (intensity) addAdvancedBlock(intensity);
  },
  toggleInsertMenu: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) toggleInsertMenu(idx);
  },
  closeInsertMenu: closeInsertMenu,
  insertBlockConfirm: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    var intensity = el.getAttribute('data-intensity');
    if (!isNaN(idx) && intensity) insertAdvancedBlock(idx, intensity);
  },
  deleteBlock: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) deleteAdvancedBlock(idx);
  },
  incDur: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) changeAdvancedDur(idx, 5);
  },
  decDur: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) changeAdvancedDur(idx, -5);
  },
  moveUp: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) moveAdvancedBlock(idx, -1);
  },
  moveDown: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) moveAdvancedBlock(idx, 1);
  },
  jumpToBlock: function(el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) jumpToAdvancedBlock(idx);
  },
  start: start,
  startAdvanced: startAdvanced,
  beginPrep: beginPrep,
  togglePause: togglePause,
  pause: pause,
  resume: resume,
  skip: skip,
  stop: stop,
  finish: finish,
  restart: restart,
  incTarget: function() { changeTarget(5); },
  decTarget: function() { changeTarget(-5); },
  incHc: function() { change('high', 1); },
  decHc: function() { change('high', -1); },
  incMc: function() { change('medium', 1); },
  decMc: function() { change('medium', -1); },
  incMdc: function() { change('med', 1); },
  decMdc: function() { change('med', -1); },
  incLc: function() { change('low', 1); },
  decLc: function() { change('low', -1); },
  incFc: function() { change('freeform', 1); },
  decFc: function() { change('freeform', -1); },
  toggleBreaks: toggleBreaks,
  changeTarget: changeTarget,
  downloadCard: downloadShareCard,
  downloadConfig: downloadConfig,
  uploadConfigBtn: triggerUpload,
  minimise: function() {
    state.sidebarHidden = !state.sidebarHidden;

    render();
  },
  openRowLog: openRowLog,
  exitRowLog: exitRowLog,
  logRow: logRow,
  setLogRating: setLogRating,
  deleteLogEntryFn: deleteLogEntryFn,
  replayLogEntry: replayLogEntry,
  exportRowLog: exportRowLog,
};

// Track the last processed action (pointerdown fires before click on the same
// interaction — use this to prevent double-firing when both dispatch).
var _lastAct = null;

// Event delegation — primary: pointerdown
// Uses pointerdown instead of click because render() replaces innerHTML every
// animation frame (~60 Hz) during prep/running modes, which creates a race:
// the DOM node the user pressed on is destroyed between mousedown and mouseup,
// causing the browser to NOT dispatch a click event (different mousedown vs
// mouseup target). pointerdown fires immediately on finger/pointer contact,
// before any rAF-driven render() can replace the DOM.
// We keep click as a secondary fallback for platforms where pointerdown is
// suppressed by system heuristics (e.g. iOS scroll containers, older browsers).
document.addEventListener('pointerdown', function(e) {
  if (e.button !== 0) return;
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act');
  _lastAct = act;
  console.log('[CrewCall] pointerdown data-act=' + act, el);
  var handler = ACTIONS[act];
  if (handler) {
    try {
      handler(el);
      trackEvent('click_' + act, {});
    } catch(err) {
      console.error('[CrewCall] handler error for ' + act + ':', err);
    }
  } else {
    console.warn('[CrewCall] no handler for data-act=' + act);
  }
});

// Secondary — click fallback (skips if already handled by pointerdown).
document.addEventListener('click', function(e) {
  if (e.button !== 0) return;
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act');
  if (_lastAct === act) { _lastAct = null; return; }
  _lastAct = null;
  console.log('[CrewCall] click data-act=' + act, el);
  var handler = ACTIONS[act];
  if (handler) {
    try {
      handler(el);
      trackEvent('click_' + act, {});
    } catch(err) {
      console.error('[CrewCall] handler error for ' + act + ':', err);
    }
  } else {
    console.warn('[CrewCall] no handler for data-act=' + act);
  }
});

// File upload hidden
var uploadInput = document.createElement('input');
uploadInput.type = 'file';
uploadInput.accept = '.json';
uploadInput.style.display = 'none';
document.body.appendChild(uploadInput);

// Override triggerUpload to use the hidden input
var origTrigger = triggerUpload;
ACTIONS.uploadConfigBtn = function() {
  uploadInput.click();
};
uploadInput.addEventListener('change', function(e) {
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
  uploadInput.value = '';
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  var key = e.key.toLowerCase ? e.key.toLowerCase() : '';
  var isEnter = key === 'enter';
  if (isEnter && state.mode === 'setup') {
    // Space key is more intuitive
  }
  if (key === 'escape') onEsc();
  if (key === 'arrowup' && state.mode === 'setup') changeTarget(5);
  if (key === 'arrowdown' && state.mode === 'setup') changeTarget(-5);
});

// Resize handler
window.addEventListener('resize', function() {
  render();
});

// Pointer event handler for drag/swipe on timeline cards (mobile/desktop)
document.addEventListener('pointerdown', function(e) {
  var card = e.target.closest('.timeline-card');
  if (!card) return;
  var handle = e.target.closest('.drag-handle');
  if (!handle) return;
  var index = card.getAttribute('data-index');
  if (index === null) return;
  dragInfo = { index: parseInt(index, 10), startY: e.clientY };
  lastPointer = e.clientX;
  card.setPointerCapture(e.pointerId);
  e.preventDefault();
});

document.addEventListener('pointermove', function(e) {
  if (!dragInfo) return;
  lastPointer = e.clientX;
  // Visual feedback could go here
});

document.addEventListener('pointerup', function(e) {
  if (!dragInfo) return;
  var dy = e.clientY - dragInfo.startY;
  if (Math.abs(dy) > 30) {
    moveAdvancedBlock(dragInfo.index, dy > 0 ? 1 : -1);
  }
  dragInfo = null;
});

// Esc handler
function onEsc() {
  if (state.mode === 'advance') {
    if (state.insertIndex !== null) { closeInsertMenu(); return; }
    exitAdvance();
  }
  if (state.mode === 'setup' && state.builderActive) {
    closeBuilder();
  }
  if (state.mode === 'running' || state.mode === 'paused') {
    stop();
  }
}

// Mutation observer for dynamic timeline card re-initialization
var observer = new MutationObserver(function() {
  // No special init needed - all events are delegated
});
observer.observe(document.getElementById('app'), { childList: true, subtree: true });

// Initial render
render();

// Load persisted Row Log into memory (localStorage w/ IndexedDB fallback)
initRowLog();

// Load Fathom analytics (external - already in app.html)
// The external script tag in app.html handles this

// Nav handling - PWA install handler
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredPrompt = e;
  // Could show install button UI
});

// Track app install
window.addEventListener('appinstalled', function() {
  trackEvent('app_installed', {});
  deferredPrompt = null;
  showToast('CrewCall installed!');
});