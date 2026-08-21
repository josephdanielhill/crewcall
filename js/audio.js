// Audio module - Web Audio API beeps and cues for CrewCall
"use strict";

import { state, SOUND_ENABLED, COUNTDOWN_BEEPS, COUNTDOWN_WINDOW, freqFor, AUDIO_FALLBACK, setAudioFallback, AUDIO_UNSUPPORTED, setAudioUnsupported, fmt } from './state.js';

var beepCache = {};

export function ensureAudio() {
  if (state.actx && state.actx.state !== 'closed') return;
  try {
    state.actx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) {
    setAudioUnsupported(true);
    console.warn('Web Audio API not available');
  }
}

export function createBeepUrl(freq, dur, type) {
  if (AUDIO_UNSUPPORTED) return '';
  type = type || 'square';
  var osc = state.actx.createOscillator();
  var gain = state.actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, state.actx.currentTime);
  gain.gain.setValueAtTime(0.25, state.actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, state.actx.currentTime + dur);
  osc.connect(gain);
  var dest = state.actx.createMediaStreamDestination();
  gain.connect(dest);
  osc.start(state.actx.currentTime);
  osc.stop(state.actx.currentTime + dur);
  var recorder = new MediaRecorder(dest.stream);
  var chunks = [];
  recorder.ondataavailable = function(ev) { if(ev.data.size>0) chunks.push(ev.data); };
  return new Promise(function(resolve) {
    recorder.onstop = function() {
      var blob = new Blob(chunks, {type:'audio/webm;codecs=opus'});
      resolve(URL.createObjectURL(blob));
    };
    recorder.start();
    setTimeout(function(){ recorder.stop(); }, (dur*1000)+50);
  });
}

export async function getBeepUrl(freq, dur, type) {
  var key = freq+'_'+dur+(type||'square');
  if (beepCache[key]) return beepCache[key];
  var url = await createBeepUrl(freq, dur, type);
  beepCache[key] = url;
  return url;
}

export function beep(freq, dur, type) {
  if (AUDIO_FALLBACK || AUDIO_UNSUPPORTED || !SOUND_ENABLED) return;
  try {
    var osc = state.actx.createOscillator();
    var gain = state.actx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, state.actx.currentTime);
    gain.gain.setValueAtTime(0.2, state.actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.actx.currentTime + dur);
    osc.connect(gain);
    gain.connect(state.actx.destination);
    osc.start(state.actx.currentTime);
    osc.stop(state.actx.currentTime + dur);
  } catch(e) {
    setAudioFallback(true);
  }
}

export function beepAt(freq, dur, when, type) {
  if (AUDIO_FALLBACK || AUDIO_UNSUPPORTED || !SOUND_ENABLED) return;
  var delay = Math.max(0, when - state.actx.currentTime);
  setTimeout(function(){ beep(freq, dur, type); }, delay * 1000);
}

export function transitionBeep(newIntensity) {
  beepAt(freqFor(newIntensity), 0.15, 0, 'sine');
}

export function scheduleTransition(newIntensity, when) {
  beepAt(freqFor(newIntensity), 0.12, when);
}

export function countBeep(secondsRemaining) {
  var freq = secondsRemaining <= 3 ? 820 : 500;
  var dur = secondsRemaining <= 3 ? 0.25 : 0.1;
  beep(freq, dur, 'sine');
}

export function scheduleCountdown(tickCallback, doneCallback) {
  if (!COUNTDOWN_BEEPS) return;
  var remaining = COUNTDOWN_WINDOW;
  var interval = setInterval(function() {
    if (remaining <= 0) {
      clearInterval(interval);
      completeBeep();
      if (doneCallback) doneCallback();
      return;
    }
    countBeep(remaining);
    if (tickCallback) tickCallback(remaining);
    remaining--;
  }, 1000);
  return interval;
}

export function completeBeep() {
  beep(900, 0.4, 'sine');
  setTimeout(function(){ beep(1100, 0.3, 'sine'); }, 100);
}