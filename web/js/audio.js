// "Geiger counter" beeper: ticks faster and higher the stronger the signal.
// Must be enabled from a user gesture (browsers block audio otherwise).

import { beepIntervalMs, heat } from "./engine/signal.js";

export function createBeeper() {
  let context = null;
  let enabled = false;
  let rssi = null;
  let timer = null;

  function beep() {
    if (!context || rssi === null) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 520 + heat(rssi) * 900;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!enabled) return;
    const wait = rssi === null ? 500 : beepIntervalMs(rssi);
    timer = setTimeout(() => {
      beep();
      schedule();
    }, wait);
  }

  return {
    get enabled() {
      return enabled;
    },
    /** Returns false if audio is not available in this browser. */
    setEnabled(value) {
      enabled = Boolean(value);
      if (enabled) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) {
            enabled = false;
            return false;
          }
          context = context || new AudioContextClass();
          if (context.state === "suspended") context.resume();
        } catch {
          enabled = false;
          return false;
        }
        beep();
      }
      schedule();
      return enabled;
    },
    /** Pass the smoothed RSSI, or null when the device is not heard right now. */
    setRssi(value) {
      rssi = Number.isFinite(value) ? value : null;
    },
    dispose() {
      enabled = false;
      clearTimeout(timer);
      timer = null;
      if (context) {
        context.close().catch(() => {});
        context = null;
      }
    },
  };
}
