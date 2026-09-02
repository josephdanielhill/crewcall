// Render module - DOM rendering for CrewCall
"use strict";

import { state, COLORS, RATIOS, MINLEN, PREP_DURATION, fmt } from './state.js';
import { ensureAudio, scheduleCountdown, transitionBeep, beep } from './audio.js';
import { isMobile } from './track.js';

import { buildPreview, applyAutoBreaks, curCounts, computeLen, canAdd, canSetTarget, segIndexAt, segStart, arrange } from './state.js';
import { log, fmtDur, dateLabel } from './rowlog.js';

export function renderVals() {
  var c = state.config, CO = COLORS;
  var isSetup = state.mode === 'setup', isDone = state.mode === 'done', isRowLog = state.mode === 'rowlog';
  var isActive = state.mode === 'running' || state.mode === 'paused';
  var isAdvance = state.mode === 'advance';
  var isPrep = state.mode === 'prep';

  var prev = isAdvance ? state.advancedSequence : applyAutoBreaks(buildPreview());
  var pt = 0;
  var previewSegs = prev.map(function(s) { pt += s.len; return { flex: s.len, color: CO[s.intensity].fill }; });
  var tgt = state.targetMin * 60;
  var counts = curCounts();
  var L = computeLen(tgt, counts);
  var lenT = function(k) { return counts[k] ? fmt(L[k]) : '-'; };
  var subT = function(k) { return counts[k] ? counts[k] + ' × ' + fmt(L[k]) : 'none'; };

  var useSeq = (isSetup || isAdvance) ? prev : state.sequence;
  var acc = 0;
  var ends = (isSetup || isAdvance) ? useSeq.map(function(s) { acc += s.len; return acc; }) : state.ends;
  var curIdx = isActive ? segIndexAt(state.elapsed) : (isDone ? useSeq.length - 1 : -1);

  var segViews = useSeq.map(function(s, i) {
    var co = CO[s.intensity];
    var ss = i === 0 ? 0 : ends[i - 1];
    var status = 'upcoming';
    if (isDone) status = 'done';
    else if (isActive) { status = i < curIdx ? 'done' : (i === curIdx ? 'active' : 'upcoming'); }
    var segElapsed = (isActive && i === curIdx) ? Math.max(0, Math.min(s.len, state.elapsed - ss)) : (status === 'done' ? s.len : 0);
    var pPct = Math.max(0, Math.min(100, (segElapsed / s.len) * 100));
    return {
      idxText: String(i + 1).padStart(2, '0'), label: co.name, durText: fmt(s.len),
      color: co.fill, ink: co.ink, tint: co.tint, flex: s.len,
      status: status,
      rowOpacity: status === 'done' ? 0.42 : 1,
      rowBg: status === 'active' ? 'oklch(1 0 0)' : 'transparent',
      rowBorder: status === 'active' ? 'oklch(0.84 0.02 230)' : 'oklch(0.93 0.016 230)',
      phasePctText: status === 'active' ? pPct + '%' : '0%',
      barOpacity: status === 'upcoming' ? 0.3 : 1,
    };
  });

  var phaseLabel = '', phaseFill = 'oklch(0.965 0.004 85)', phaseInk = 'oklch(0.3 0.012 70)', phaseRemain = '', phaseHeight = '0%', phaseIdx = '', nextLabel = '', nextInk = '', phaseStrokes = '';
  if (isActive) {
    var s = state.sequence[curIdx], co = CO[s.intensity];
    var remain = state.ends[curIdx] - state.elapsed;
    var frac = Math.max(0, Math.min(1, remain / s.len));
    var nx = state.sequence[curIdx + 1];
    phaseLabel = co.name; phaseFill = co.fill; phaseInk = co.ink;
    phaseRemain = fmt(Math.ceil(remain)); phaseHeight = (frac * 100) + '%';
    phaseIdx = (curIdx + 1) + ' / ' + state.sequence.length;
    if (s.intensity === 'break') {
      phaseStrokes = 'BREAK';
    } else if (s.intensity === 'freeform') {
      phaseStrokes = 'FREEFORM';
    } else {
      phaseStrokes = String(s.rate !== undefined ? s.rate : (c[s.intensity] ? c[s.intensity].rate : 24));
    }
    nextLabel = nx ? CO[nx.intensity].name : 'FINISH';
    nextInk = nx ? CO[nx.intensity].ink : COLORS.low.ink;
  }

  var total = (isSetup || isAdvance) ? pt : state.totalDuration;
  var overallPct = (isActive || isDone) && total ? Math.max(0, Math.min(100, (state.elapsed / total) * 100)) : 0;

  var prepRemainText = '', prepFirstLabel = '', prepFirstInk = '', prepFirstFill = '';
  if (isPrep) {
    var prepRemain = Math.max(0, PREP_DURATION - state.prepElapsed);
    prepRemainText = String(Math.ceil(prepRemain));
    var firstSeg = state.sequence[0];
    if (firstSeg) {
      var firstCo = CO[firstSeg.intensity];
      prepFirstLabel = firstCo.name; prepFirstInk = firstCo.ink; prepFirstFill = firstCo.fill;
    }
  }

  return {
    isSetup: isSetup, isActive: isActive, isDone: isDone, showList: isActive || isDone || isPrep, isAdvance: isAdvance, isRowLog: isRowLog,
    isPrep: isPrep, prepRemainText: prepRemainText, prepFirstLabel: prepFirstLabel, prepFirstInk: prepFirstInk, prepFirstFill: prepFirstFill,
    canStart: prev.length > 0, cannotStart: prev.length === 0,
    previewSegs: previewSegs, segViews: segViews,
    setupTotalText: fmt(pt), setupCount: useSeq.length,
    targetText: fmt(state.targetMin * 60),
    hrate: c.high.rate, mrate: c.medium.rate, mdrate: c.med.rate, lrate: c.low.rate,
    elapsedText: fmt(state.elapsed), totalText: fmt(total),
    overallPctText: overallPct + '%',
    overallPctRoundedText: Math.round(overallPct) + '%',
    pauseLabel: state.mode === 'paused' ? 'Resume' : 'Pause',
    phaseLabel: phaseLabel, phaseFill: phaseFill, phaseInk: phaseInk, phaseRemain: phaseRemain, phaseHeight: phaseHeight, phaseIdx: phaseIdx, nextLabel: nextLabel, nextInk: nextInk, phaseStrokes: phaseStrokes,
    hc: c.high.count, mc: c.medium.count, mdc: c.med.count, lc: c.low.count, fc: c.freeform.count,
    hlenText: lenT('high'), mlenText: lenT('medium'), mdlenText: lenT('med'), llenText: lenT('low'), flenText: lenT('freeform'),
    hsub: subT('high'), msub: subT('medium'), mdsub: subT('med'), lsub: subT('low'), fsub: subT('freeform'),
    addHDisabled: !canAdd('high'), addMDisabled: !canAdd('medium'), addMdDisabled: !canAdd('med'), addLDisabled: !canAdd('low'), addFDisabled: !canAdd('freeform'),
    decTargetDisabled: !(state.targetMin > 10 && canSetTarget((state.targetMin - 5) * 60)), incTargetDisabled: !(state.targetMin < 90),
  };
}

export function sidebarToggleBtn() {
  var mobile = isMobile();
  var hidden = state.sidebarHidden;
  var icon = mobile
    ? (hidden ? '<polyline points="18 9 12 15 6 9"></polyline>' : '<polyline points="18 15 12 9 6 15"></polyline>')
    : (hidden ? '<polyline points="15 18 9 12 15 6"></polyline>' : '<polyline points="9 18 15 12 9 6"></polyline>');
  return '' +
    '<button data-act="toggleSidebar" class="sidebar-toggle-btn" aria-label="Toggle session plan" aria-expanded="' + String(!hidden) + '">' +
    (mobile ? '<span>' + (hidden ? 'View plan' : 'Hide plan') + '</span>' : '') +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' +
    '</button>';
}

export function stepperBtn(act, disabled, soft, label) {
  var cls = soft ? 'btn-stepper-soft' : 'btn-stepper';
  var bg = soft ? 'oklch(0.985 0.005 85)' : 'oklch(1 0 0)';
  var border = soft ? 'oklch(0.86 0.01 85)' : 'oklch(0.84 0.01 85)';
  return '<button data-act="' + act + '" class="' + cls + (disabled ? ' btn-disabled' : '') + '" style="width:44px;height:44px;cursor:pointer;touch-action:manipulation;border:1px solid ' + border + ';background:' + bg + ';border-radius:11px;font-size:22px;color:oklch(0.35 0.012 70);">' + label + '</button>';
}

export function intensityCard(label, dotColor, inkColor, badgeBg, badgeText, count, sub, decAct, incAct, addDisabled, lenText) {
  return '' +
    '<div style="border:1px solid oklch(0.9 0.006 85);border-radius:14px;padding:14px 18px;background:oklch(1 0 0);">' +
    '<div class="flex-align gap-xl mb-xl">' +
    '<span style="width:13px;height:13px;border-radius:50%;background:' + dotColor + ';"></span>' +
    '<span style="font-size:16px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:' + inkColor + ';">' + label + '</span>' +
    '<span style="font-family:\'Space Grotesk\';font-size:13px;color:' + inkColor + ';background:' + badgeBg + ';padding:4px 11px;border-radius:20px;">' + badgeText + '</span>' +
    '</div>' +
    '<div class="flex gap-4xl">' +
    '<div style="flex:1;">' +
    '<div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.6 0.012 70);margin-bottom:9px;">Intervals</div>' +
    '<div class="flex-align gap-2xl">' +
    stepperBtn(decAct, false, true, '\u2212') +
    '<span style="font-family:\'Space Grotesk\';font-size:26px;font-weight:500;min-width:28px;text-align:center;color:oklch(0.3 0.012 70);">' + count + '</span>' +
    stepperBtn(incAct, addDisabled, true, '+') +
    '</div>' +
    '</div>' +
    '<div style="flex:1;">' +
    '<div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.6 0.012 70);margin-bottom:9px;">Length each</div>' +
    '<div class="flex-align gap-lg" style="height:44px;">' +
    '<span style="font-family:\'Space Grotesk\';font-size:26px;font-weight:500;color:oklch(0.3 0.012 70);font-variant-numeric:tabular-nums;">' + lenText + '</span>' +
    '<span style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.62 0.012 70);">auto</span>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

export function renderInsertDivider(i) {
  var isOpen = state.insertIndex === i;
  if (isOpen) {
    return '' +
      '<div style="margin: 8px 0; padding: 12px; background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px dashed oklch(0.78 0.09 190 / 0.5); border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; animation: fadeIn 0.2s ease;">' +
      '<span style="font-size: 12px; font-weight: 700; color: oklch(0.4 0.012 70); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 4px;">Insert here:</span>' +
      '<button data-act="insertBlockConfirm" data-idx="' + i + '" data-intensity="high" class="btn-int-insert">' +
      '  <span class="int-extreme-swatch" style="width:6px;height:6px;border-radius:50%;"></span>Extreme' +
      '</button>' +
      '<button data-act="insertBlockConfirm" data-idx="' + i + '" data-intensity="medium" class="btn-int-insert">' +
      '  <span class="int-hard-swatch" style="width:6px;height:6px;border-radius:50%;"></span>Hard' +
      '</button>' +
      '<button data-act="insertBlockConfirm" data-idx="' + i + '" data-intensity="med" class="btn-int-insert">' +
      '  <span class="int-medium-swatch" style="width:6px;height:6px;border-radius:50%;"></span>Medium' +
      '</button>' +
      '<button data-act="insertBlockConfirm" data-idx="' + i + '" data-intensity="low" class="btn-int-insert">' +
      '  <span class="int-low-swatch" style="width:6px;height:6px;border-radius:50%;"></span>Low' +
      '</button>' +
      '<button data-act="insertBlockConfirm" data-idx="' + i + '" data-intensity="break" class="btn-int-insert">' +
      '  <span class="int-break-swatch" style="width:6px;height:6px;border-radius:50%;"></span>Break' +
      '</button>' +
      '<button data-act="insertBlockConfirm" data-idx="' + i + '" data-intensity="freeform" class="btn-int-insert">' +
      '  <span class="int-freeform-swatch" style="width:6px;height:6px;border-radius:50%;"></span>Freeform' +
      '</button>' +
      '<button data-act="closeInsertMenu" style="background:none; border:none; cursor:pointer; color:oklch(0.5 0.012 70); font-size:18px; padding:2px; display:flex; align-items:center; justify-content:center; margin-left:4px;">&times;</button>' +
      '</div>';
  } else {
    return '' +
      '<div class="insert-divider" style="position:relative; height:16px; margin: 4px 0; display:flex; align-items:center; justify-content:center; opacity:0.15; transition:opacity 0.2s ease;">' +
      '<div style="position:absolute; left:0; right:0; height:1px; background:oklch(0.7 0.012 70); border-top:1px dashed oklch(0.7 0.012 70);"></div>' +
      '<button data-act="toggleInsertMenu" data-idx="' + i + '" class="insert-toggle-btn" title="Insert block here">' +
      '+' +
      '</button>' +
      '</div>';
  }
}

// Rebuild the ordered interval sequence for a logged entry so the card can
// render the same mini timeline bar as the design concept (proportional
// coloured segments matching the interval structure).
function rowLogTimelineSegments(e) {
  if (e.plan && e.plan.isAdvanced && e.plan.advancedSequence && e.plan.advancedSequence.length) {
    return e.plan.advancedSequence.map(function(s) {
      return { intensity: s.intensity, len: s.len || 0 };
    });
  }
  var counts = e.breakdown || {};
  var order = [];
  try {
    order = arrange(counts.high || 0, counts.medium || 0, counts.med || 0, counts.low || 0, counts.freeform || 0);
  } catch (err) { order = []; }
  var lens = (e.plan && e.plan.config) ? e.plan.config : null;
  var fallbackLen = Math.max(1, Math.round((e.durationSec || 0) / Math.max(1, e.intervals || order.length)));
  return order.map(function(k) {
    var len = lens && lens[k] ? lens[k].len : fallbackLen;
    return { intensity: k, len: (len || fallbackLen) };
  });
}

// Duration-segment timeline bar: renders each logged interval as a colored
// segment on a single horizontal bar, proportionally sized to each interval's
// length and coloured by intensity zone (matches the design concept).
function rowLogTimelineBar(e) {
  var segs = rowLogTimelineSegments(e);
  if (!segs.length) return '';
  var total = 0;
  segs.forEach(function (s) { total += (s.len || 0); });
  if (total <= 0) {
    // No length data — fall back to equal-sized segments so the sequence
    // structure is still visible.
    total = segs.length;
  }
  var barHeight = 26;
  var segments = segs.map(function (s) {
    var co = COLORS[s.intensity] || COLORS.low;
    var flex = Math.max(1, Math.round(((s.len || 1) / total) * 1000));
    return '<div style="flex:' + flex + ';background:' + co.fill + ';border-left:2px solid #fafafa;height:' + barHeight + 'px;"></div>';
  }).join('');
  return '<div class="rowlog-timeline" style="display:flex;width:100%;height:' + barHeight + 'px;gap:0;background:oklch(0.93 0.005 85);border-radius:7px;overflow:hidden;">' + segments + '</div>';
}

function rowLogCard(e) {
  var dl = dateLabel(e);
  var upClass = e.rating === 'up' ? 'rowlog-rate active' : 'rowlog-rate';
  var downClass = e.rating === 'down' ? 'rowlog-rate active' : 'rowlog-rate';
  var timelineBar = rowLogTimelineBar(e);
  var replayBtn = e.plan ? '<button data-act="replayLogEntry" data-id="' + e.id + '" style="flex:1;cursor:pointer;border:1px solid oklch(0.6 0.09 27);background:oklch(0.29 0.06 24);color:oklch(0.97 0.02 27);padding:9px 12px;border-radius:9px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Replay</button>' : '<span style="flex:1;"></span>';
  var metaLine = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<span style="font-family:\'Space Grotesk\';font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;color:oklch(0.3 0.012 70);">' + dl.date + '</span>' +
      '<span style="font-size:12px;color:oklch(0.58 0.012 70);">' + dl.time + '</span>' +
      '<span style="margin-left:auto;font-family:\'Space Grotesk\';font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;color:oklch(0.3 0.012 70);">' + fmtDur(e.durationSec) + '</span>' +
      '<span style="font-size:11px;color:oklch(0.55 0.012 70);">' + e.intervals + (e.intervals === 1 ? ' int' : ' ints') + '</span>' +
    '</div>';
  return '<div style="background:oklch(1 0 0);border:1px solid oklch(0.91 0.006 85);border-radius:14px;padding:13px 16px;display:flex;flex-direction:column;gap:11px;">' +
    metaLine +
    (e.label ? '<div style="font-size:12px;color:oklch(0.5 0.012 70);">' + e.label + '</div>' : '') +
    timelineBar +
    '<div style="display:flex;align-items:center;gap:8px;">' +
      '<button data-act="setLogRating" data-id="' + e.id + '" data-rating="up" class="' + upClass + '" title="Good row" style="font-size:17px;cursor:pointer;border:1px solid oklch(0.9 0.006 85);background:oklch(0.97 0.01 85);border-radius:9px;width:34px;height:34px;line-height:1;">&#128077;</button>' +
      '<button data-act="setLogRating" data-id="' + e.id + '" data-rating="down" class="' + downClass + '" title="Tough row" style="font-size:17px;cursor:pointer;border:1px solid oklch(0.9 0.006 85);background:oklch(0.97 0.01 85);border-radius:9px;width:34px;height:34px;line-height:1;">&#128078;</button>' +
      replayBtn +
      '<button data-act="deleteLogEntryFn" data-id="' + e.id + '" style="cursor:pointer;border:1px solid oklch(0.88 0.04 85);background:oklch(0.98 0.01 85);color:oklch(0.6 0.09 27);border-radius:9px;width:34px;height:34px;font-size:15px;">&#128465;&#65039;</button>' +
    '</div>' +
  '</div>';
}

function renderRowLogScreen() {
  var entries = log.entries;
  var empty = entries.length === 0;
  var listHtml = '';
  if (!empty) {
    var cards = entries.map(rowLogCard);
    listHtml = '<div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;width:100%;min-height:0;padding-right:6px;">' + cards.join('') + '</div>';
  } else {
    listHtml = '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;color:oklch(0.5 0.012 70);padding:24px;min-height:220px;">' +
      '<div style="font-size:38px;">&#128203;</div>' +
      '<div style="font-size:16px;font-weight:600;color:oklch(0.35 0.012 70);">No rows logged yet.</div>' +
      '<div style="font-size:13px;line-height:1.5;max-width:300px;">Finish a session and tap <strong>Log this row</strong> on the end screen &#8212; it stores here with your intervals and timing.</div>' +
      '</div>';
  }
  return '<div class="left-container" style="justify-content:flex-start;overflow:hidden;height:100%;box-sizing:border-box;padding:64px 52px 40px;">' +
    '<div style="flex-shrink:0;margin-bottom:22px;width:100%;">' +
    '<div style="margin-bottom:18px;">' +
    '<a href="index.html" style="display:block;font-family:\'Space Grotesk\';font-weight:600;font-size:17px;letter-spacing:0.16em;color:#000000;text-decoration:none;">CREWCALL</a>' +
    '<div style="margin-top:6px;font-size:15px;color:oklch(0.6 0.022 255);letter-spacing:0.02em;">Interval rowing coach</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
      '<div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:oklch(0.5 0.012 70);font-weight:600;">Row Log</div>' +
      '<span style="font-size:12px;color:oklch(0.55 0.012 70);">' + entries.length + (entries.length === 1 ? ' row' : ' rows') + '</span>' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:14px;">' +
      '<button data-act="exportRowLog" style="flex:1;cursor:pointer;border:1px solid oklch(0.78 0.012 70);background:oklch(1 0 0);color:oklch(0.3 0.012 70);padding:11px 14px;border-radius:11px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Save as JSON</button>' +
      '<button data-act="exitRowLog" style="flex:1;cursor:pointer;border:1px solid oklch(0.78 0.012 70);background:oklch(1 0 0);color:oklch(0.3 0.012 70);padding:11px 14px;border-radius:11px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Back</button>' +
    '</div>' +
    '</div>' +
    listHtml +
  '</div>';
}

export function renderLeft(v) {
  if (v.isRowLog) {
    return renderRowLogScreen();
  }
  if (v.isAdvance) {
    var cardsHtml = "";
    if (state.advancedSequence.length === 0) {
      cardsHtml = '<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:220px; border: 2px dashed oklch(0.87 0.012 85); border-radius:18px; color: oklch(0.5 0.012 70); font-size:15px; text-align:center; padding: 20px; background:oklch(1 0 0);">' +
        '<div style="font-size:32px; margin-bottom:12px;">&#9201;&#65039;</div>' +
        '<div style="font-weight:600; font-size:16px;">No intervals added yet.</div>' +
        '<div style="font-size:13px; color:oklch(0.6 0.012 70); margin-top:4px;">Click the buttons below to build your custom plan!</div>' +
        '</div>';
    } else {
      var listHtml = "";
      var len = state.advancedSequence.length;
      for (var i = 0; i <= len; i++) {
        listHtml += renderInsertDivider(i);
        if (i < len) {
          var s = state.advancedSequence[i];
          var co = COLORS[s.intensity];
          var dotColor = co.fill.replace(')', ' / 0.15)');
          listHtml += '' +
            '<div class="timeline-card" data-index="' + i + '" style="display:flex; align-items:center; gap:16px; border:1px solid ' + dotColor + '; border-radius:14px; padding:12px 18px; background:' + co.tint + '; margin-bottom:8px; transition:transform 0.15s ease, box-shadow 0.15s ease;">' +
            '<div style="cursor:grab; color:oklch(0.6 0.012 70); font-size:18px; user-select:none; touch-action:none; padding:10px 8px; margin:-10px 0;" class="drag-handle">&#8942;&#8942;</div>' +
            '<span style="width:12px; height:12px; border-radius:50%; background:' + co.fill + '; flex-shrink:0;"></span>' +
            '<div class="flex-1 flex-align gap-md">' +
            '<span style="font-size:14px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:' + co.ink + ';">' + co.name + '</span>' +
            (s.intensity === 'break' ? '' : s.intensity === 'freeform' ? '<span style="font-family:\'Space Grotesk\'; font-size:12px; color:' + co.ink + '; background:oklch(1 0 0); padding:2px 8px; border-radius:10px; font-weight:500; white-space:nowrap;">your own pace</span>' : '<span style="font-family:\'Space Grotesk\'; font-size:12px; color:' + co.ink + '; background:oklch(1 0 0); padding:2px 8px; border-radius:10px; font-weight:500; white-space:nowrap;">' + s.rate + ' strokes</span>') +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:6px; background:oklch(1 0 0 / 0.6); padding:4px 8px; border-radius:10px; border:1px solid ' + co.fill.replace(')', ' / 0.1)') + ';">' +
            '<span style="font-size:12px; color:oklch(0.5 0.012 70); font-weight:600;">Dur:</span>' +
            '<button data-act="decDur" data-idx="' + i + '" class="timeline-dur-btn" style="border:none; background:transparent; font-size:16px; cursor:pointer; color:oklch(0.4 0.012 70); font-weight:bold; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">\u2212</button>' +
            '<span style="font-family:\'Space Grotesk\'; font-size:14px; font-weight:600; min-width:44px; text-align:center; color:oklch(0.3 0.012 70);">' + fmt(s.len) + '</span>' +
            '<button data-act="incDur" data-idx="' + i + '" class="timeline-dur-btn" style="border:none; background:transparent; font-size:16px; cursor:pointer; color:oklch(0.4 0.012 70); font-weight:bold; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">+</button>' +
            '</div>' +
            '<div class="flex gap-xs">' +
            '<button data-act="moveUp" data-idx="' + i + '" style="border:1px solid ' + co.fill.replace(')', ' / 0.15)') + '; background:oklch(1 0 0); border-radius:8px; width:30px; height:30px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:11px; color:oklch(0.4 0.012 70);">&#9650;</button>' +
            '<button data-act="moveDown" data-idx="' + i + '" style="border:1px solid ' + co.fill.replace(')', ' / 0.15)') + '; background:oklch(1 0 0); border-radius:8px; width:30px; height:30px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:11px; color:oklch(0.4 0.012 70);">&#9660;</button>' +
            '</div>' +
            '<button data-act="deleteBlock" data-idx="' + i + '" class="timeline-delete-btn" style="border:none; background:transparent; cursor:pointer; font-size:16px; color:oklch(0.6 0.1 27); padding:4px; display:flex; align-items:center; justify-content:center; margin-left:8px;" title="Delete Block">&#128465;&#65039;</button>' +
            '</div>';
        }
      }
      cardsHtml = listHtml;
    }

    var advTotal = 0;
    state.advancedSequence.forEach(function(s) { advTotal += s.len; });

    var timelineSegmentsHtml = state.advancedSequence.map(function(s, idx) {
      var co = COLORS[s.intensity];
      return '<div data-act="jumpToBlock" data-idx="' + idx + '" style="flex:' + s.len + '; background:' + co.fill + '; border-radius:2px; cursor:pointer; transition:transform 0.1s ease;" title="Jump to block ' + (idx + 1) + '" onmouseover="this.style.transform=\'scaleY(1.3)\'" onmouseout="this.style.transform=\'scaleY(1)\'"></div>';
    }).join('');

    var showWarning = false;
    if (state.advancedSequence.length > 0) {
      var nonBreakBlocks = state.advancedSequence.filter(function(s) { return s.intensity !== 'break'; });
      if (nonBreakBlocks.length > 0) {
        var first = nonBreakBlocks[0];
        var last = nonBreakBlocks[nonBreakBlocks.length - 1];
        if (first.intensity !== 'low' || last.intensity !== 'low') {
          showWarning = true;
        }
      }
    }

    var warningHtml = "";
    if (showWarning) {
      warningHtml = '' +
        '<div style="background: oklch(0.98 0.03 82 / 0.7); border: 1px solid oklch(0.85 0.08 82); border-radius: 14px; padding: 14px 20px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; font-size: 14px; color: oklch(0.35 0.1 70); line-height: 1.45;">' +
        '<span style="font-size: 20px; flex-shrink: 0;">&#9888;&#65039;</span>' +
        '<div><strong>Warm-up & Cool-down tip:</strong> It is usually best to start your session with a <strong>LOW</strong> intensity block to warm up, and finish with a <strong>LOW</strong> block to cool down.</div>' +
        '</div>';
    }

    return '' +
      '<div class="left-container" style="justify-content: flex-start; overflow: hidden; height: 100%; box-sizing: border-box; padding: 64px 60px 40px;">' +
      '<div class="flex-shrink-0 mb-5xl w-full">' +
      '<div class="advance-brand" style="margin-bottom: 20px;">' +
      '<a href="index.html" style="display:block;font-family:\'Space Grotesk\';font-weight:600;font-size:17px;letter-spacing:0.16em;color:#000000;text-decoration:none;">CREWCALL</a>' +
      '<div style="margin-top:6px;font-size:15px;color:oklch(0.6 0.022 255);letter-spacing:0.02em;">Interval rowing coach</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.45); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.5); border-radius:16px; padding:16px 24px; display:flex; flex-direction:column; gap:12px; box-shadow:0 8px 32px 0 rgba(31,38,135,0.05);">' +
      '<div class="flex-between" style="align-items:baseline;">' +
      '<div style="font-size:14px; font-weight:600; color:oklch(0.3 0.012 70);">Custom Timeline</div>' +
      '<div style="font-family:\'Space Grotesk\'; font-size:16px; font-variant-numeric:tabular-nums; color:oklch(0.4 0.012 70); font-weight:600;">' +
      fmt(advTotal) + ' / ' + state.advancedSequence.length + ' blocks' +
      '</div>' +
      '</div>' +
      '<div style="display:flex; gap:3px; height:18px; border-radius:6px; overflow:hidden; background:oklch(0.95 0.012 85); width:100%;">' +
      (state.advancedSequence.length > 0 ? timelineSegmentsHtml : '<div style="flex:1; background:oklch(0.93 0.01 85);"></div>') +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="advance-body" style="display:flex; flex:1; overflow:hidden; gap:36px; min-height:0; width:100%;">' +
      '<div id="timeline-cards-column" style="flex:1; overflow-y:auto; padding-right:12px; display:flex; flex-direction:column; gap:8px; padding-bottom:24px; min-height:0;">' +
      warningHtml +
      '<div class="timeline-cards-container flex-col gap-md">' +
      cardsHtml +
      '</div>' +
      '</div>' +
      '<div class="control-panel" style="width:340px; flex-shrink:0; display:flex; flex-direction:column; background:oklch(1 0 0); border:1px solid oklch(0.9 0.016 230); border-radius:20px; padding:0 24px; box-sizing:border-box; overflow-y:auto; max-height:100%;">' +
      '<div style="position: sticky; top:0; background:oklch(1 0 0); padding-top:24px; padding-bottom:16px; z-index:10; border-bottom:1px solid oklch(0.95 0.012 85);">' +
      '<div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:oklch(0.6 0.012 70); margin-bottom:12px; font-weight:600;">Session Actions</div>' +
      '<div class="advance-actions-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
      '<button data-act="uploadConfigBtn" class="btn-soft" style="cursor:pointer; border:1px solid oklch(0.87 0.012 85); background:oklch(1 0 0); color:oklch(0.35 0.012 70); padding:10px 14px; border-radius:10px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px;"><span>&#128194;</span>Import</button>' +
      '<button data-act="downloadConfig" class="btn-soft" style="cursor:pointer; border:1px solid oklch(0.87 0.012 85); background:oklch(1 0 0); color:oklch(0.35 0.012 70); padding:10px 14px; border-radius:10px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px;"><span>&#128190;</span>Export</button>' +
      '<button data-act="resetAdvance" class="btn-soft" style="cursor:pointer; border:1px solid oklch(0.87 0.012 85); background:oklch(1 0 0); color:oklch(0.35 0.012 70); padding:10px 14px; border-radius:10px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px;"><span>&#128260;</span>Reset</button>' +
      '<button data-act="exitAdvance" class="btn-soft" style="cursor:pointer; border:1px solid oklch(0.87 0.012 85); background:oklch(1 0 0); color:oklch(0.35 0.012 70); padding:10px 14px; border-radius:10px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px;"><span>&#8592;</span>Back</button>' +
      '</div>' +
      '</div>' +
      '<div style="position: sticky; bottom:0; background:oklch(1 0 0); padding-top:16px; padding-bottom:24px; z-index:10; margin-top:auto; border-top:1px solid oklch(0.95 0.012 85);">' +
      '<button data-act="startAdvanced" class="btn-start" style="width:100%; display:flex; align-items:center; justify-content:center; gap:12px; border:none; cursor:pointer; color:oklch(0.97 0.006 85); padding:16px; border-radius:12px; font-size:16px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; animation:breathe 4.5s ease-in-out infinite;">' +
      '<span style="width:8px; height:8px; border-radius:50%; background:oklch(0.8 0.095 158);"></span>' +
      'Start session' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
  if (v.isSetup) {
    return '' +
      '<div class="left-container" style="padding:64px 60px 40px;">' +
      '<div class="setup-brand">' +
      '<a href="index.html" style="display:block;font-family:\'Space Grotesk\';font-weight:600;font-size:17px;letter-spacing:0.16em;color:#000000;text-decoration:none;">CREWCALL</a>' +
      '<div style="margin-top:6px;font-size:15px;color:oklch(0.6 0.022 255);letter-spacing:0.02em;">Interval rowing coach</div>' +
      '</div>' +
      '<div class="setup-summary flex-col gap-7xl w-full glass-card" style="padding:24px 32px;">' +
      '<div class="setup-metrics-row">' +
      '<div>' +
      '<div class="setup-time-val">' + v.setupTotalText + '</div>' +
      '<div class="setup-time-label mt-lg flex-center gap-xl flex-wrap">' +
      '<span style="font-size:14px;letter-spacing:0.16em;text-transform:uppercase;color:oklch(0.3 0.012 70);white-space:nowrap;">Total session</span>' +
      '<span style="font-family:\'Space Grotesk\';font-size:13px;color:oklch(0.35 0.022 255);background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.6);padding:3px 11px;border-radius:20px;white-space:nowrap;">Goal ' + v.targetText + '</span>' +
      '</div>' +
      '</div>' +
      '<div style="padding-bottom:14px;text-align:center;">' +
      '<div class="setup-count-val">' + v.setupCount + '</div>' +
      '<div class="setup-count-label" style="margin-top:8px;font-size:14px;letter-spacing:0.16em;text-transform:uppercase;color:oklch(0.3 0.012 70);">Intervals</div>' +
      '</div>' +
      '</div>' +
      '<div class="setup-preview-bar" style="display:flex;gap:3px;height:14px;border-radius:8px;overflow:hidden;width:100%;">' +
      v.previewSegs.map(function(seg) { return '<div style="flex:' + seg.flex + ';background:' + seg.color + ';border-radius:3px;"></div>'; }).join('') +
      '</div>' +
      '</div>' +
      '<div class="setup-cta flex-col gap-xl">' +
      (v.canStart ?
        '<button data-act="start" class="btn-start" style="display:flex;align-items:center;gap:16px;border:none;cursor:pointer;color:oklch(0.97 0.006 85);padding:22px 38px;border-radius:16px;font-size:19px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;animation:breathe 4.5s ease-in-out infinite;">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:oklch(0.8 0.095 158);"></span>' +
        'Start session' +
        '</button>'
        : '<div style="font-size:16px;color:oklch(0.6 0.012 70);">Add at least one interval to begin &rarr;</div>') +
      '<button data-act="openRowLog" class="btn-soft" style="display:flex;align-items:center;justify-content:center;gap:12px;cursor:pointer;border:1px solid oklch(0.78 0.012 70);background:oklch(1 0 0);color:oklch(0.3 0.012 70);padding:13px 24px;border-radius:14px;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;"><span>&#128203;</span>Row Log</button>' +
      '</div>' +
      '</div>';
  }
  if (v.isPrep) {
    return '' +
      '<div class="left-container" style="justify-content:center;align-items:center;text-align:center;background:transparent;padding:40px 30px;">' +
      '<div style="font-size:15px;letter-spacing:0.22em;text-transform:uppercase;color:oklch(0.5 0.012 70);margin-bottom:8px;">Get ready</div>' +
      '<div class="prep-countdown-val" style="font-family:\'Space Grotesk\';font-weight:500;font-size:200px;line-height:0.92;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:oklch(0.3 0.012 70);">' + v.prepRemainText + '</div>' +
      '<div style="margin-top:18px;display:inline-flex;align-items:center;gap:10px;padding:9px 20px;border-radius:30px;background:oklch(1 0 0 / 0.5);border:1px solid ' + v.prepFirstInk + ';">' +
      '<span style="width:9px;height:9px;border-radius:50%;background:' + v.prepFirstFill + ';"></span>' +
      '<span style="font-size:16px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:' + v.prepFirstInk + ';">First up &middot; ' + v.prepFirstLabel + '</span>' +
      '</div>' +
      '<button data-act="stop" class="btn-soft" style="margin-top:30px;cursor:pointer;border:1px solid oklch(0.78 0.016 230);background:oklch(1 0 0);color:oklch(0.3 0.022 255);padding:14px 28px;border-radius:13px;font-size:14px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">Cancel</button>' +
      '</div>';
  }
  if (v.isActive) {
    return '' +
      '<div class="left-container" style="background:transparent;overflow:hidden;">' +
      '<div style="position:absolute;left:0;right:0;bottom:0;height:' + v.phaseHeight + ';background:' + v.phaseFill + ';transition:background 0.4s ease;opacity:0.75;z-index:1;"></div>' +
      '<div class="active-inner" style="z-index:2;">' +
      '<div class="flex-between" style="align-items:flex-start;">' +
      '<div class="flex-align gap-2xl">' +
      '<span style="width:14px;height:14px;border-radius:50%;background:' + v.phaseInk + ';"></span>' +
      '<span style="font-size:15px;letter-spacing:0.18em;text-transform:uppercase;color:oklch(0.4 0.012 70);">Interval ' + v.phaseIdx + '</span>' +
      '</div>' +
      '<div style="text-align:right;font-size:15px;letter-spacing:0.06em;color:oklch(0.45 0.012 70);">' +
      'Next&nbsp;&middot;&nbsp;<span style="color:' + v.nextInk + ';font-weight:600;">' + v.nextLabel + '</span>' +
      '</div>' +
      '</div>' +
      '<div style="text-align:center;">' +
      '<div style="font-size:34px;font-weight:600;letter-spacing:0.34em;text-transform:uppercase;color:' + v.phaseInk + ';">' + v.phaseLabel + '</div>' +
      '<div style="font-family:\'Space Grotesk\';font-weight:500;font-size:200px;line-height:0.92;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:' + v.phaseInk + ';margin-top:6px;">' + v.phaseRemain + '</div>' +
      '<div style="margin-top:4px;font-size:15px;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.5 0.012 70);">remaining in phase</div>' +
      (v.phaseStrokes === 'BREAK' ?
        '<div style="margin-top:18px;display:inline-flex;align-items:center;gap:10px;padding:9px 20px;border-radius:30px;background:oklch(1 0 0 / 0.5);border:1px solid ' + v.phaseInk + ';">' +
        '<span style="font-size:20px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:' + v.phaseInk + ';">Active Break</span>' +
        '</div>'
        : v.phaseStrokes === 'FREEFORM' ?
          '<div style="margin-top:18px;display:inline-flex;align-items:center;gap:10px;padding:9px 20px;border-radius:30px;background:oklch(1 0 0 / 0.5);border:1px solid ' + v.phaseInk + ';">' +
          '<span style="font-size:20px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:' + v.phaseInk + ';">Set your own pace</span>' +
          '</div>'
          :
          '<div style="margin-top:18px;display:inline-flex;align-items:center;gap:10px;padding:9px 20px;border-radius:30px;background:oklch(1 0 0 / 0.5);border:1px solid ' + v.phaseInk + ';">' +
          '<span style="font-family:\'Space Grotesk\';font-size:26px;font-weight:600;color:' + v.phaseInk + ';">' + v.phaseStrokes + '</span>' +
          '<span style="font-size:14px;letter-spacing:0.14em;text-transform:uppercase;color:' + v.phaseInk + ';">strokes&nbsp;&middot;&nbsp;target</span>' +
          '</div>'
      ) +
      '</div>' +
      '<div class="flex-col gap-5xl glass-card" style="z-index:2;position:relative;padding:28px 32px;">' +
      '<div>' +
      '<div class="flex-between mb-lg" style="font-size:14px;letter-spacing:0.04em;color:oklch(0.45 0.022 255);">' +
      '<span style="font-weight:600;text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">Session</span>' +
      '<span style="font-family:\'Space Grotesk\';font-variant-numeric:tabular-nums;font-weight:500;">' + v.elapsedText + ' / ' + v.totalText + '</span>' +
      '</div>' +
      '<div style="position:relative;display:flex;gap:2px;height:12px;background:oklch(0.97 0.016 230);padding:1px;border-radius:4px;border:1px solid oklch(0.9 0.016 230);">' +
      v.segViews.map(function(seg) { return '<div style="flex:' + seg.flex + ';background:' + seg.color + ';opacity:' + seg.barOpacity + ';border-radius:3px;"></div>'; }).join('') +
      '<div style="position:absolute;top:-4px;bottom:-4px;left:' + v.overallPctText + ';width:3px;background:#005B96;border-radius:2px;box-shadow:0 0 6px rgba(0,0,0,0.15);transform:translateX(-50%);"></div>' +
      '</div>' +
      '</div>' +
      '<div class="flex gap-xl">' +
      '<button data-act="togglePause" class="btn-soft" style="flex:1;cursor:pointer;border:1px solid oklch(0.78 0.016 230);background:oklch(1 0 0);color:oklch(0.3 0.022 255);padding:16px;border-radius:13px;font-size:15px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">' + v.pauseLabel + '</button>' +
      '<button data-act="skip" class="btn-soft" style="flex:1;cursor:pointer;border:1px solid oklch(0.78 0.016 230);background:oklch(1 0 0);color:oklch(0.3 0.022 255);padding:16px;border-radius:13px;font-size:15px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">Skip</button>' +
      '<button data-act="stop" class="btn-danger" style="flex:0 0 auto;cursor:pointer;border:1px solid oklch(0.82 0.05 27);background:oklch(1 0 0);color:oklch(0.5 0.12 27);padding:16px 22px;border-radius:13px;font-size:15px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">End</button>' +
      '<button data-act="minimise" class="btn-soft" style="cursor:pointer;border:1px solid oklch(0.78 0.016 230);background:oklch(1 0 0);color:oklch(0.3 0.022 255);padding:16px 14px;border-radius:13px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;" title="Minimise session panel">Minimise</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
  if (v.isDone) {
    return '' +
      '<div class="left-container" style="justify-content:center;align-items:center;text-align:center;background:transparent;padding:40px 30px;">' +
      '<div style="font-size:44px;margin-bottom:12px;">&#127942;</div>' +
      '<div style="font-size:13px;letter-spacing:0.25em;text-transform:uppercase;color:oklch(0.46 0.09 160);font-weight:600;">Workout Cleared</div>' +
      '<div style="font-family:\'Space Grotesk\';font-weight:500;font-size:110px;line-height:0.95;letter-spacing:-0.02em;color:oklch(0.3 0.012 70);margin:12px 0 6px;">' + v.totalText + '</div>' +
      '<div style="font-size:16px;color:oklch(0.4 0.012 70);font-weight:500;">' + v.setupCount + ' intervals &middot; Cadence held!</div>' +
      '<div id="share-card-preview" style="margin-top:28px;background:oklch(1 0 0);border:1px solid oklch(0.9 0.016 230);border-radius:20px;padding:24px;width:100%;max-width:380px;box-shadow:0 8px 24px oklch(0.3 0.022 255 / 0.04);display:flex;flex-direction:column;gap:16px;text-align:left;">' +
      '<div class="flex-between-align">' +
      '<span style="font-family:\'Space Grotesk\';font-weight:600;font-size:13px;letter-spacing:0.16em;color:#000000;">CREWCALL</span>' +
      '<span style="font-size:11px;color:oklch(0.55 0.012 70);text-transform:uppercase;letter-spacing:0.04em;">Rowing Stats</span>' +
      '</div>' +
      '<div>' +
      '<div style="font-size:24px;font-weight:600;color:oklch(0.3 0.012 70);">Workout complete!</div>' +
      '<div style="font-size:13px;color:oklch(0.55 0.012 70);margin-top:2px;">Cadence held, limits pushed.</div>' +
      '</div>' +
      '<div class="flex gap-5xl" style="margin:4px 0;">' +
      '<div>' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:oklch(0.6 0.012 70);">Duration</div>' +
      '<div style="font-family:\'Space Grotesk\';font-size:20px;font-weight:600;color:oklch(0.3 0.012 70);">' + v.totalText + '</div>' +
      '</div>' +
      '<div>' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:oklch(0.6 0.012 70);">Intervals</div>' +
      '<div style="font-family:\'Space Grotesk\';font-size:20px;font-weight:600;color:oklch(0.3 0.012 70);">' + v.setupCount + '</div>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:2px;height:12px;border-radius:4px;overflow:hidden;">' +
      v.previewSegs.map(function(seg) { return '<div style="flex:' + seg.flex + ';background:' + seg.color + ';"></div>'; }).join('') +
      '</div>' +
      '</div>' +
      '<div class="flex-col gap-xl mt-7xl w-full" style="max-width:380px;">' +
      '<button data-act="downloadCard" class="btn-start" style="width:100%;cursor:pointer;border:none;color:oklch(0.97 0.006 85);padding:16px 24px;border-radius:13px;font-size:15px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;display:flex;align-items:center;justify-content:center;gap:10px;"><span>&#128229;</span>Save workout PNG</button>' +
      '<button data-act="downloadConfig" class="btn-soft" style="width:100%;cursor:pointer;border:1px solid oklch(0.78 0.012 70);background:oklch(1 0 0);color:oklch(0.3 0.012 70);padding:16px 24px;border-radius:13px;font-size:15px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;display:flex;align-items:center;justify-content:center;gap:10px;"><span>&#128190;</span>Save plan</button>' +
      '<button data-act="logRow" class="btn-soft" style="width:100%;cursor:pointer;border:1px solid oklch(0.55 0.09 27);background:oklch(0.29 0.06 24);color:oklch(0.97 0.02 27);padding:16px 24px;border-radius:13px;font-size:15px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;display:flex;align-items:center;justify-content:center;gap:10px;"><span>&#128203;</span>Log this row</button>' +
      '<div class="flex gap-xl w-full">' +
      '<button data-act="restart" class="btn-soft" style="flex:1;cursor:pointer;border:1px solid oklch(0.78 0.012 70);background:oklch(1 0 0);color:oklch(0.3 0.012 70);padding:14px;border-radius:12px;font-size:14px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Repeat</button>' +
      '<button data-act="stop" class="btn-soft" style="flex:1;cursor:pointer;border:1px solid oklch(0.78 0.012 70);background:oklch(1 0 0);color:oklch(0.3 0.012 70);padding:14px;border-radius:12px;font-size:14px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Return to Home</button>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
  return '';
}

export function renderRight(v) {
  if (state.builderActive && v.isSetup) {
    var step = state.builderStep;
    var answers = state.builderAnswers;

    var contentHtml = '';
    if (step === 0) {
      contentHtml = '' +
        '<div>' +
        '<div style="font-size:14px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.45 0.012 70);margin-bottom:14px;">1. Energy Level</div>' +
        '<div style="font-size:16px;font-weight:600;color:oklch(0.3 0.012 70);margin-bottom:16px;line-height:1.4;">How energized are you feeling right now?</div>' +
        '<div class="flex-col gap-xl">' +
        button_option('setBuilderAnswer', 'energy', 'low', answers.energy === 'low', '&#128267;', 'Low Energy', 'Exhausted or recovery focus. Calmer pacing.', 'oklch(0.46 0.09 160)', 'oklch(0.93 0.05 158)', 'oklch(0.80 0.095 158)') +
        button_option('setBuilderAnswer', 'energy', 'moderate', answers.energy === 'moderate', '&#9889;', 'Moderate Energy', 'Steady baseline. Balanced workout challenge.', 'oklch(0.48 0.09 190)', 'oklch(0.93 0.05 190)', 'oklch(0.78 0.09 190)') +
        button_option('setBuilderAnswer', 'energy', 'high', answers.energy === 'high', '&#128640;', 'High Energy', 'Fully charged. Ready to push limits and sweat.', 'oklch(0.45 0.15 27)', 'oklch(0.93 0.05 27)', 'oklch(0.71 0.145 27)') +
        '</div>' +
        '</div>';
    } else if (step === 1) {
      contentHtml = '' +
        '<div>' +
        '<div style="font-size:14px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.45 0.012 70);margin-bottom:14px;">2. Fatigue & Soreness</div>' +
        '<div style="font-size:16px;font-weight:600;color:oklch(0.3 0.012 70);margin-bottom:16px;line-height:1.4;">Are you feeling tired, stiff, or sore?</div>' +
        '<div class="flex-col gap-xl">' +
        button_option('setBuilderAnswer', 'tired', 'yes', answers.tired === 'yes', '&#129496;', 'Yes, take it easy', 'Adds extra recovery breaks and scales down block lengths.', 'oklch(0.40 0.01 240)', 'oklch(0.95 0.005 240)', 'oklch(0.65 0.02 240)') +
        button_option('setBuilderAnswer', 'tired', 'no', answers.tired === 'no', '&#127939;', 'No, feeling fresh', 'Keep standard recovery gaps and longer core sets.', 'oklch(0.46 0.09 160)', 'oklch(0.93 0.05 158)', 'oklch(0.80 0.095 158)') +
        '</div>' +
        '</div>';
    } else if (step === 2) {
      var durs = [15, 20, 30, 45];
      var durHtml = durs.map(function(d) {
        var isSel = parseInt(answers.duration, 10) === d;
        return '<button data-act="setBuilderAnswer" data-key="duration" data-val="' + d + '" style="flex:1;cursor:pointer;border-radius:10px;padding:10px;font-family:\'Space Grotesk\';font-size:15px;font-weight:600;text-align:center;transition:all 0.2s;' +
          (isSel ?
            'background:oklch(0.3 0.012 70);color:oklch(1 0 0);border:1px solid oklch(0.3 0.012 70);' :
            'background:oklch(1 0 0);color:oklch(0.4 0.012 70);border:1px solid oklch(0.9 0.006 85);') + '">' +
          d + 'm' +
          '</button>';
      }).join('');

      contentHtml = '' +
        '<div>' +
        '<div style="font-size:14px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.45 0.012 70);margin-bottom:14px;">3. Goal & Duration</div>' +
        '<div style="font-size:16px;font-weight:600;color:oklch(0.3 0.012 70);margin-bottom:12px;line-height:1.4;">What is your focus and target time?</div>' +
        '<div class="flex-col gap-lg mb-5xl">' +
        builder_goal_option('setBuilderAnswer', 'goal', 'sweat', answers.goal === 'sweat', '&#129397;', 'Hard Sweat', 'Heavy on Extreme & Hard efforts.', 'oklch(0.45 0.15 27)', 'oklch(0.93 0.05 27)', 'oklch(0.71 0.145 27)') +
        builder_goal_option('setBuilderAnswer', 'goal', 'balanced', answers.goal === 'balanced', '&#127744;', 'Balanced Pyramid', 'Smooth build-up and cool-down waves.', 'oklch(0.48 0.09 190)', 'oklch(0.93 0.05 190)', 'oklch(0.78 0.09 190)') +
        builder_goal_option('setBuilderAnswer', 'goal', 'recovery', answers.goal === 'recovery', '&#127754;', 'Steady Endurance', 'Consistent pacing focused on aerobic base.', 'oklch(0.46 0.09 160)', 'oklch(0.93 0.05 158)', 'oklch(0.80 0.095 158)') +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:oklch(0.5 0.012 70);margin-bottom:8px;">Target Workout Duration</div>' +
        '<div class="flex gap-md">' +
        durHtml +
        '</div>' +
        '</div>';
    }

    var pct = Math.round(((step + 1) / 3) * 100);

    return '' +
      '<div class="flex-col h-full p-7xl box-border">' +
      '<div class="flex-between-align mb-5xl">' +
      '<div>' +
      '<div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:oklch(0.58 0.012 70);font-weight:600;">Smart Session Builder</div>' +
      '<div style="font-size:22px;font-weight:700;color:oklch(0.3 0.012 70);margin-top:4px;letter-spacing:-0.01em;">Tailor your row</div>' +
      '</div>' +
      '<button data-act="closeBuilder" style="background:none;border:none;font-size:26px;cursor:pointer;color:oklch(0.5 0.012 70);padding:4px;line-height:1;">&times;</button>' +
      '</div>' +
      '<div style="margin-bottom:24px;">' +
      '<div class="flex-between mb-sm" style="font-size:12px;font-weight:600;color:oklch(0.5 0.012 70);">' +
      '<span>Step ' + (step + 1) + ' of 3</span>' +
      '<span style="font-family:\'Space Grotesk\';">' + pct + '%</span>' +
      '</div>' +
      '<div style="height:4px;background:oklch(0.93 0.012 85);border-radius:2px;overflow:hidden;">' +
      '<div style="height:100%;width:' + pct + '%;background:oklch(0.78 0.09 190);transition:width 0.3s ease;"></div>' +
      '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding-right:2px;animation:fadeIn 0.25s ease;">' +
      contentHtml +
      '</div>' +
      '<div class="flex gap-xl mt-5xl" style="border-top:1px solid oklch(0.95 0.012 85);padding-top:var(--space-3xl);">' +
      (step > 0 ?
        '<button data-act="prevBuilderStep" class="btn-soft" style="flex:1;cursor:pointer;border:1px solid oklch(0.87 0.012 85);background:oklch(1 0 0);color:oklch(0.35 0.012 70);padding:14px;border-radius:12px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Back</button>'
        : ''
      ) +
      '<button data-act="nextBuilderStep" class="btn-start" style="flex:2;cursor:pointer;border:none;color:oklch(0.97 0.006 85);padding:14px;border-radius:12px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;justify-content:center;gap:8px;">' +
      (step === 2 ? 'Generate Plan &#10024;' : 'Continue &rarr;') +
      '</button>' +
      '</div>' +
      '</div>';
  }

  if (v.isSetup) {
    return '' +
      '<div class="setup-builder-scroll flex-col h-full p-7xl overflow-y-auto">' +
      '<div class="flex-col gap-3xl">' +
      '<div>' +
      '<div style="font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:oklch(0.58 0.012 70);">Build your session</div>' +
      '<div style="font-size:24px;font-weight:600;color:oklch(0.3 0.012 70);margin-top:8px;letter-spacing:-0.01em;">Set the time, stack the work.</div>' +
      '</div>' +
      '<div class="flex-col gap-lg">' +
      '<div class="flex gap-lg flex-wrap">' +
      '<button data-act="surprise" class="btn-surprise" style="cursor:pointer;border:1px solid oklch(0.8 0.05 27);background:oklch(1 0 0);color:oklch(0.48 0.13 27);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;letter-spacing:0.03em;display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
      '<span style="width:7px;height:7px;border-radius:50%;background:oklch(0.71 0.145 27);"></span>Surprise me' +
      '</button>' +
      '<button data-act="openBuilder" class="btn-soft" style="cursor:pointer;border:1px solid oklch(0.78 0.09 190);background:oklch(0.96 0.03 190);color:oklch(0.35 0.09 190);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
      '<span>&#10024;</span>Smart Builder' +
      '</button>' +
      '<button data-act="advance" class="btn-soft" style="cursor:pointer;border:1px solid oklch(0.87 0.012 85);background:oklch(1 0 0);color:oklch(0.35 0.012 70);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
      '<span>&#9889;</span>Advance' +
      '</button>' +
      '</div>' +
      '<div class="flex gap-lg flex-wrap">' +
      '<button data-act="uploadConfigBtn" class="btn-soft" style="cursor:pointer;border:1px solid oklch(0.87 0.012 85);background:oklch(1 0 0);color:oklch(0.35 0.012 70);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
      '<span>&#128194;</span>Import plan' +
      '</button>' +
      '<button data-act="downloadConfig" class="btn-soft" style="cursor:pointer;border:1px solid oklch(0.87 0.012 85);background:oklch(1 0 0);color:oklch(0.35 0.012 70);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
      '<span>&#128190;</span>Export plan' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="flex-col gap-lg" style="margin-top:36px;">' +
      '<div style="border:1px solid oklch(0.87 0.012 85);border-radius:14px;padding:12px 18px;background:oklch(0.965 0.012 85);display:flex;align-items:center;justify-content:space-between;gap:18px;">' +
      '<div>' +
      '<div style="font-size:14px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.4 0.012 70);">Session length</div>' +
      '</div>' +
      '<div class="flex-align gap-2xl">' +
      stepperBtn('decTarget', v.decTargetDisabled, false, '\u2212') +
      '<span style="font-family:\'Space Grotesk\';font-size:30px;font-weight:500;min-width:78px;text-align:center;font-variant-numeric:tabular-nums;color:oklch(0.3 0.012 70);">' + v.targetText + '</span>' +
      stepperBtn('incTarget', v.incTargetDisabled, false, '+') +
      '</div>' +
      '</div>' +
      (state.targetMin >= 20 ?
        '<div style="border:1px solid oklch(0.87 0.012 85);border-radius:14px;padding:12px 18px;background:oklch(1 0 0);display:flex;align-items:center;justify-content:space-between;gap:18px;animation:fadeIn 0.3s ease;">' +
        '<div>' +
        '<div style="font-size:14px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.4 0.012 70);">Auto breaks</div>' +
        '<div style="font-size:13px;color:oklch(0.6 0.012 70);margin-top:4px;">30s break after every 10 mins</div>' +
        '</div>' +
        '<button data-act="toggleBreaks" style="cursor:pointer;border:none;background:' + (state.breaksEnabled ? 'oklch(0.80 0.095 158)' : 'oklch(0.9 0.012 85)') + ';padding:8px 16px;border-radius:12px;font-size:13px;font-weight:700;color:' + (state.breaksEnabled ? 'oklch(0.98 0.01 158)' : 'oklch(0.4 0.012 70)') + ';transition:background 0.2s, color 0.2s;text-transform:uppercase;letter-spacing:0.05em;">' +
        (state.breaksEnabled ? 'On' : 'Off') +
        '</button>' +
        '</div>'
        : '') +
      intensityCard('Extreme', 'oklch(0.71 0.145 27)', 'oklch(0.45 0.15 27)', 'oklch(0.93 0.05 27)', v.hrate + ' strokes', v.hc, v.hsub, 'decHc', 'incHc', v.addHDisabled, v.hlenText) +
      intensityCard('Hard', 'oklch(0.83 0.12 82)', 'oklch(0.52 0.12 70)', 'oklch(0.93 0.06 82)', v.mrate + ' strokes', v.mc, v.msub, 'decMc', 'incMc', v.addMDisabled, v.mlenText) +
      intensityCard('Medium', 'oklch(0.78 0.09 190)', 'oklch(0.48 0.09 190)', 'oklch(0.93 0.05 190)', v.mdrate + ' strokes', v.mdc, v.mdsub, 'decMdc', 'incMdc', v.addMdDisabled, v.mdlenText) +
      intensityCard('Low', 'oklch(0.80 0.095 158)', 'oklch(0.46 0.09 160)', 'oklch(0.93 0.05 158)', v.lrate + ' strokes', v.lc, v.lsub, 'decLc', 'incLc', v.addLDisabled, v.llenText) +
      intensityCard('Freeform', 'oklch(0.74 0.13 310)', 'oklch(0.48 0.13 310)', 'oklch(0.93 0.05 310)', 'your own pace', v.fc, v.fsub, 'decFc', 'incFc', v.addFDisabled, v.flenText) +
      '</div>' +
      '</div>';
  }
  if (v.showList) {
    return '' +
      '<div class="flex-col h-full">' +
      '<div style="padding:24px 24px 16px;border-bottom:1px solid oklch(0.91 0.006 85);">' +
      '<div class="flex-between" style="align-items:baseline;">' +
      '<div style="font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:oklch(0.58 0.012 70);">Session plan</div>' +
      '<div style="font-family:\'Space Grotesk\';font-size:15px;font-variant-numeric:tabular-nums;color:oklch(0.5 0.012 70);">' + v.overallPctRoundedText + '</div>' +
      '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:12px 18px 20px;display:flex;flex-direction:column;gap:6px;">' +
      v.segViews.map(function(seg) {
        return '<div style="position:relative;display:flex;align-items:center;gap:16px;padding:10px 14px;border-radius:10px;background:' + seg.rowBg + ';border:1px solid ' + seg.rowBorder + ';opacity:' + seg.rowOpacity + ';overflow:hidden;">' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:' + seg.phasePctText + ';background:' + seg.tint + ';opacity:0.6;"></div>' +
          '<span style="position:relative;width:11px;height:11px;border-radius:50%;background:' + seg.color + ';flex:0 0 auto;"></span>' +
          '<span style="position:relative;font-family:\'Space Grotesk\';font-size:14px;color:oklch(0.6 0.012 70);min-width:22px;font-variant-numeric:tabular-nums;">' + seg.idxText + '</span>' +
          '<span style="position:relative;font-size:15px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:' + seg.ink + ';">' + seg.label + '</span>' +
          '<span style="position:relative;margin-left:auto;font-family:\'Space Grotesk\';font-size:16px;font-variant-numeric:tabular-nums;color:oklch(0.4 0.012 70);">' + seg.durText + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '</div>';
  }
  return '';
}

function button_option(act, key, val, isSel, emoji, title, desc, inkColor, bgColor, borderColor) {
  return '<button data-act="' + act + '" data-key="' + key + '" data-val="' + val + '" style="text-align:left;cursor:pointer;border-radius:14px;padding:16px;transition:all 0.2s;display:flex;align-items:center;gap:16px;' +
    (isSel ?
      'background:' + bgColor + ';border:2px solid ' + borderColor + ';box-shadow:0 4px 12px ' + borderColor + ' / 0.15);' :
      'background:oklch(1 0 0);border:1px solid oklch(0.9 0.006 85);') + '">' +
    '<span style="font-size:26px;flex-shrink:0;">' + emoji + '</span>' +
    '<div>' +
    '<div style="font-size:15px;font-weight:700;color:' + inkColor + ';">' + title + '</div>' +
    '<div style="font-size:13px;color:oklch(0.55 0.012 70);margin-top:2px;">' + desc + '</div>' +
    '</div>' +
    '</button>';
}

function builder_goal_option(act, key, val, isSel, emoji, title, desc, inkColor, bgColor, borderColor) {
  return '<button data-act="' + act + '" data-key="' + key + '" data-val="' + val + '" style="text-align:left;cursor:pointer;border-radius:12px;padding:12px 14px;transition:all 0.2s;display:flex;align-items:center;gap:12px;' +
    (isSel ?
      'background:' + bgColor + ';border:2px solid ' + borderColor + ';' :
      'background:oklch(1 0 0);border:1px solid oklch(0.9 0.006 85);') + '">' +
    '<span style="font-size:22px;flex-shrink:0;">' + emoji + '</span>' +
    '<div>' +
    '<div style="font-size:14px;font-weight:700;color:' + inkColor + ';">' + title + '</div>' +
    '<div style="font-size:12px;color:oklch(0.55 0.012 70);margin-top:1px;">' + desc + '</div>' +
    '</div>' +
    '</button>';
}

export function render() {
  var v = renderVals();
  var app = document.getElementById('app');
  if (!app) return;

  var leftEl = app.querySelector('.app-left');
  var rightEl = app.querySelector('.app-right');
  var cardsCol = app.querySelector('#timeline-cards-column');
  var scrollTop = cardsCol ? cardsCol.scrollTop : 0;

  app.setAttribute('data-mode', state.mode);

  if (state.mode !== 'setup' && state.mode !== 'rowlog') {
    app.classList.add('session-active');
  } else {
    app.classList.remove('session-active');
  }

  if (state.mode === 'advance') {
    app.classList.add('mode-advance');
    if (state.enteringAdvance) {
      app.classList.add('mode-advance-entering');
    }
  } else {
    app.classList.remove('mode-advance');
    app.classList.remove('mode-advance-entering');
  }
  app.style.height = '';
  app.style.overflow = '';

  var sheetMode = state.mode === 'running' || state.mode === 'paused' || state.mode === 'done';
  app.classList.toggle('has-sheet', sheetMode);

  if (state.sidebarHidden && sheetMode) {
    app.classList.add('sidebar-hidden');
  } else {
    app.classList.remove('sidebar-hidden');
  }

  if (leftEl) {
    var leftContentEl = leftEl.querySelector('.app-left-content');
    if (leftContentEl) {
      leftContentEl.innerHTML = renderLeft(v);
    } else {
      leftEl.innerHTML = renderLeft(v);
    }
  }

  if (state.mode !== 'advance' && state.mode !== 'rowlog' && rightEl) {
    rightEl.innerHTML = renderRight(v);
  }

  var toggleMountEl = app.querySelector('.sidebar-toggle-mount');
  if (toggleMountEl) {
    toggleMountEl.innerHTML = sheetMode ? sidebarToggleBtn() : '';
  }

  if (cardsCol) {
    var newCardsCol = app.querySelector('#timeline-cards-column');
    if (newCardsCol) {
      newCardsCol.scrollTop = scrollTop;
    }
  }
}