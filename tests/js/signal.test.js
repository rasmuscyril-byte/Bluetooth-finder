import assert from "node:assert/strict";
import { test } from "node:test";

import { beepIntervalMs, estimateDistance, heat, proximity, RssiFilter, signalBars, trend } from "../../web/js/engine/signal.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("RssiFilter starts at the first sample and smooths noise", () => {
  const filter = new RssiFilter();
  assert.equal(filter.value, null);
  assert.equal(filter.update(-70, 0), -70);
  const random = mulberry32(1);
  let maxDeviation = 0;
  for (let i = 1; i <= 200; i++) {
    const value = filter.update(-70 + (random() - 0.5) * 16, i * 250);
    if (i > 20) maxDeviation = Math.max(maxDeviation, Math.abs(value + 70));
  }
  assert.ok(maxDeviation < 4, `smoothed value should stay near -70, max deviation ${maxDeviation}`);
});

test("RssiFilter follows a real change within a few seconds", () => {
  const filter = new RssiFilter();
  for (let i = 0; i < 40; i++) filter.update(-85, i * 250);
  let t = 40 * 250;
  for (let i = 0; i < 16; i++) filter.update(-55, (t += 250)); // 4 seconds
  assert.ok(filter.value > -63, `expected to be close to -55 after 4 s, got ${filter.value}`);
});

test("RssiFilter damps single outliers and ignores non-numbers", () => {
  const filter = new RssiFilter();
  for (let i = 0; i < 20; i++) filter.update(-60, i * 250);
  const after = filter.update(-98, 20 * 250);
  assert.ok(after > -64, `one wild sample should not drag the value far, got ${after}`);
  assert.equal(filter.update(Number.NaN, 21 * 250), after);
  filter.reset();
  assert.equal(filter.value, null);
});

test("proximity levels and boundaries", () => {
  assert.equal(proximity(-45).key, "burning");
  assert.equal(proximity(-50).key, "burning");
  assert.equal(proximity(-50.4).key, "burning"); // rounds like the displayed number
  assert.equal(proximity(-50.6).key, "hot");
  assert.equal(proximity(-65).key, "warm");
  assert.equal(proximity(-75).key, "cool");
  assert.equal(proximity(-85).key, "cold");
  assert.equal(proximity(-95).key, "freezing");
  assert.equal(proximity(null).key, "freezing");
  assert.equal(proximity(-65).label, "Varm");
});

test("heat, bars, beep interval and distance are monotonic", () => {
  assert.equal(heat(-100), 0);
  assert.equal(heat(-40), 1);
  assert.equal(heat(-20), 1);
  assert.equal(heat(-120), 0);
  assert.ok(heat(-60) > heat(-80));
  assert.deepEqual([-55, -65, -75, -85, -95].map(signalBars), [4, 3, 2, 1, 0]);
  assert.equal(beepIntervalMs(-100), 2000);
  assert.equal(beepIntervalMs(-40), 90);
  assert.ok(beepIntervalMs(-60) < beepIntervalMs(-80));
  assert.ok(estimateDistance(-50) < estimateDistance(-70));
  assert.equal(estimateDistance(-59), 1);
  assert.equal(estimateDistance(undefined), null);
  assert.ok(estimateDistance(-20) >= 0.1);
});

test("trend detects warmer, colder and steady", () => {
  const rising = Array.from({ length: 12 }, (_, i) => ({ t: 1000 + i * 500, v: -80 + i }));
  const now = 1000 + 11 * 500;
  assert.equal(trend(rising, now).direction, "warmer");
  const falling = rising.map((s) => ({ t: s.t, v: -s.v - 160 }));
  assert.equal(trend(falling, now).direction, "colder");
  const flat = rising.map((s) => ({ t: s.t, v: -70 }));
  assert.equal(trend(flat, now).direction, "steady");
  assert.equal(trend(rising.slice(0, 2), now).direction, "steady");
  assert.equal(trend([], now).direction, "steady");
  // old samples outside the window are ignored
  const old = rising.map((s) => ({ t: s.t - 60000, v: s.v }));
  assert.equal(trend(old, now).direction, "steady");
});
