// Signal strength helpers: smoothing, "hot/cold" levels, distance guess, trend.
//
// RSSI from phones and tablets jumps around by ±5–10 dB from one advert to the
// next (bodies, walls, antenna orientation), so everything shown to the user
// is based on the Kalman-smoothed value.

/** 1-D Kalman filter for RSSI with process noise that grows with elapsed time. */
export class RssiFilter {
  constructor({ processNoisePerSec = 1.5, measurementNoise = 16 } = {}) {
    this.processNoisePerSec = processNoisePerSec;
    this.measurementNoise = measurementNoise;
    this.reset();
  }

  reset() {
    this._value = null;
    this._variance = 0;
    this._lastT = null;
  }

  get value() {
    return this._value;
  }

  update(rssi, tMs) {
    if (!Number.isFinite(rssi)) return this._value;
    if (this._value === null) {
      this._value = rssi;
      this._variance = this.measurementNoise;
      this._lastT = tMs;
      return this._value;
    }
    const dt = Number.isFinite(tMs) && Number.isFinite(this._lastT) ? Math.max(0, (tMs - this._lastT) / 1000) : 0.25;
    this._lastT = Number.isFinite(tMs) ? tMs : this._lastT;
    // Predict: the true signal may drift while we move around.
    const predictedVariance = this._variance + this.processNoisePerSec * Math.max(dt, 0.05);
    // Single wild samples (reflections, body blocking) count for less.
    const noise = Math.abs(rssi - this._value) > 25 ? this.measurementNoise * 4 : this.measurementNoise;
    const gain = predictedVariance / (predictedVariance + noise);
    this._value = this._value + gain * (rssi - this._value);
    this._variance = (1 - gain) * predictedVariance;
    return this._value;
  }
}

const LEVELS = [
  { min: -50, level: 5, key: "burning", label: "Brændende varm!", hint: "Under 1 meter – kig lige her" },
  { min: -60, level: 4, key: "hot", label: "Meget varm", hint: "Ca. 1–2 meter" },
  { min: -70, level: 3, key: "warm", label: "Varm", hint: "Ca. 2–5 meter" },
  { min: -80, level: 2, key: "cool", label: "Lunken", hint: "Ca. 5–10 meter eller bag en væg" },
  { min: -90, level: 1, key: "cold", label: "Kold", hint: "Over 10 meter eller flere vægge" },
  { min: -Infinity, level: 0, key: "freezing", label: "Iskold", hint: "Meget langt væk eller skjult" },
];

/** Hot/cold level for a (smoothed) RSSI value. */
export function proximity(rssi) {
  // Round first so the label always agrees with the whole-number dBm shown next to it.
  const value = Number.isFinite(rssi) ? Math.round(rssi) : -Infinity;
  const found = LEVELS.find((entry) => value >= entry.min);
  const { level, key, label, hint } = found;
  return { level, key, label, hint };
}

/** 0 (ice cold, -100 dBm) … 1 (on top of it, -40 dBm). */
export function heat(rssi) {
  if (!Number.isFinite(rssi)) return 0;
  return Math.min(1, Math.max(0, (rssi + 100) / 60));
}

/** Least-squares slope of recent samples → getting warmer or colder. */
export function trend(samples, now, windowMs = 6000) {
  const recent = (samples || []).filter((s) => s && Number.isFinite(s.v) && s.t >= now - windowMs && s.t <= now);
  const steady = { slope: 0, direction: "steady", label: "Stabilt" };
  if (recent.length < 3) return steady;
  const span = recent[recent.length - 1].t - recent[0].t;
  if (span < 1500) return steady;
  const meanT = recent.reduce((sum, s) => sum + s.t, 0) / recent.length;
  const meanV = recent.reduce((sum, s) => sum + s.v, 0) / recent.length;
  let num = 0;
  let den = 0;
  for (const s of recent) {
    num += (s.t - meanT) * (s.v - meanV);
    den += (s.t - meanT) ** 2;
  }
  if (den === 0) return steady;
  const slope = (num / den) * 1000; // dB per second
  if (slope >= 0.4) return { slope, direction: "warmer", label: "Varmere 🔥" };
  if (slope <= -0.4) return { slope, direction: "colder", label: "Koldere ❄️" };
  return { ...steady, slope };
}

/** Geiger counter pace: faster ticks when the signal is stronger. */
export function beepIntervalMs(rssi) {
  const h = heat(rssi);
  const slow = 2000;
  const fast = 90;
  return Math.round(slow * Math.pow(fast / slow, h));
}

/** 0–4 bars like on a phone. */
export function signalBars(rssi) {
  if (!Number.isFinite(rssi)) return 0;
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  if (rssi >= -90) return 1;
  return 0;
}
