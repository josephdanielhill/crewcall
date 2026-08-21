// Tracking and utility module
"use strict";

export function isMobile() {
  return window.innerWidth < 900;
}

export function trackEvent(name, data) {
  if (typeof window.fathom !== 'undefined' && window.fathom.trackEvent) {
    try {
      var obj = {};
      if (data) obj._data = data;
      obj._name = name;
      window.fathom.trackEvent(name, obj);
    } catch(e) { /* silently fail */ }
  }
}