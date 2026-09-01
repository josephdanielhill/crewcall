// Row Log module - data model + persistent storage
//
// A "row" is a completed CrewCall session. Log it after you row, then browse
// past rows from the Row Log screen (main menu), rate each thumbs up/down and
// replay any logged plan.
//
// Storage strategy (works on Safari incl. iOS, where the File System Access
// API is unsupported):
//   1. localStorage   -> primary, synchronous, reliable everywhere
//   2. IndexedDB      -> fallback when localStorage is unavailable (private mode)
//   3. in-memory      -> last resort so the app never crashes (warns when degrading)
// `exportLog()` lets the user save the whole log as a JSON file to any folder.
"use strict";

var KEY = 'crewcall.rowlog.v1';

// ---- in-memory cache (source of truth for rendering) ----
export var log = { entries: [], loaded: false };

// ---- storage backend ----
function localStore() {
  try {
    var s = window.localStorage;
    var t = '__cc_ping__';
    s.setItem(t, '1');
    s.removeItem(t);
    return s;
  } catch (e) {
    return null;
  }
}

var idbPromise = null;
function idbOpen() {
  if (!window.indexedDB) return null;
  if (idbPromise) return idbPromise;
  idbPromise = new Promise(function(resolve) {
    var req = window.indexedDB.open('crewcall', 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('rowlog')) {
        db.createObjectStore('rowlog', { keyPath: 'id' });
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function() { resolve(null); };
  });
  return idbPromise;
}

function idbWrite(entries) {
  idbOpen().then(function(db) {
    if (!db) return;
    var tx = db.transaction('rowlog', 'readwrite');
    var store = tx.objectStore('rowlog');
    store.clear();
    entries.forEach(function(en) { store.put(en); });
  }).catch(function() {});
}

function idbRead(cb) {
  idbOpen().then(function(db) {
    if (!db) { cb(null); return; }
    var req = db.transaction('rowlog', 'readonly').objectStore('rowlog').getAll();
    req.onsuccess = function() { cb(req.result || []); };
    req.onerror = function() { cb(null); };
  }).catch(function() { cb(null); });
}

function parseEntries(raw) {
  try {
    var arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.filter(function(e) { return e && typeof e.id === 'string'; });
    }
  } catch (e) {}
  return [];
}

export function initLog(onReady) {
  var ls = localStore();
  if (ls) {
    log.entries = parseEntries(ls.getItem(KEY));
    log.loaded = true;
    if (onReady) onReady(log.entries);
    return;
  }
  // localStorage unavailable -> try IndexedDB, else degrade to memory
  idbRead(function(entries) {
    if (entries) { log.entries = entries; }
    log.loaded = true;
    if (onReady) onReady(log.entries);
  });
}

function persist() {
  var ls = localStore();
  if (ls) {
    try { ls.setItem(KEY, JSON.stringify(log.entries)); return; }
    catch (e) { /* fall through to idb */ }
  }
  idbWrite(log.entries);
  if (!ls && !window.indexedDB) {
    try { console.warn('Row Log: storage unavailable, keeping in memory.'); } catch (e) {}
  }
}

// ---- data model ----
export function buildEntry(input) {
  var now = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var breakdown = {
    high: input.high || 0, medium: input.medium || 0,
    med: input.med || 0, low: input.low || 0, freeform: input.freeform || 0
  };
  return {
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ts: now.getTime(),
    dateISO: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
    timeStr: pad(now.getHours()) + ':' + pad(now.getMinutes()),
    durationSec: input.durationSec || 0,
    intervals: input.intervals || 0,
    rating: null,
    label: input.label || '',
    breakdown: breakdown,
    plan: input.plan || null
  };
}

export function addLogEntry(input) {
  var entry = buildEntry(input);
  log.entries.unshift(entry);
  persist();
  return entry;
}

export function setRating(id, rating) {
  for (var i = 0; i < log.entries.length; i++) {
    if (log.entries[i].id === id) {
      log.entries[i].rating = (rating === 'up' || rating === 'down') ? rating : null;
      persist();
      return true;
    }
  }
  return false;
}

export function deleteEntry(id) {
  var next = [];
  var removed = false;
  for (var i = 0; i < log.entries.length; i++) {
    if (log.entries[i].id === id) { removed = true; continue; }
    next.push(log.entries[i]);
  }
  if (removed) { log.entries = next; persist(); }
  return removed;
}

export function getEntry(id) {
  for (var i = 0; i < log.entries.length; i++) {
    if (log.entries[i].id === id) return log.entries[i];
  }
  return null;
}

export function exportLog() {
  var blob = new Blob([JSON.stringify(log.entries, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'crewcall-row-log.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- pure helpers (unit-testable) ----
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

export function dateLabel(entry) {
  var d = entry.dateISO || '';
  var short = d.split('-').slice(1).join('/');
  return { date: short, time: entry.timeStr || '' };
}
