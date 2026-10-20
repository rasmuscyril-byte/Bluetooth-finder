import assert from "node:assert/strict";
import { test } from "node:test";

import { Tracker } from "../../web/js/engine/tracker.js";
import { statusFromBridge } from "../../web/js/sources/bridge.js";
import { createDemoSource } from "../../web/js/sources/demo.js";
import {
  advertisementEventToRaw,
  createWebBluetoothSource,
  isWebBluetoothScanSupported,
} from "../../web/js/sources/webbluetooth.js";

test("bridge status mapping", () => {
  assert.deepEqual(statusFromBridge({ scanning: true, error: null }), { state: "scanning", message: null });
  assert.deepEqual(statusFromBridge({ scanning: false, error: { code: "powered_off", message: "Bluetooth er slået fra." } }), {
    state: "error",
    message: "Bluetooth er slået fra.",
  });
  assert.equal(statusFromBridge({ scanning: false, identifying: true }).state, "identifying");
  assert.equal(statusFromBridge({ scanning: false, hasScanner: false }).state, "error");
  assert.equal(statusFromBridge(null).state, "starting");
});

function view(bytes) {
  const buffer = new Uint8Array([0xee, ...bytes, 0xee]).buffer;
  return new DataView(buffer, 1, bytes.length);
}

test("Web Bluetooth advertising event → RawAdvert", () => {
  const event = {
    device: { id: "abc123==", name: "Cached" },
    rssi: -61,
    txPower: 12,
    name: undefined,
    manufacturerData: new Map([[0x004c, view([0x10, 0x05, 0x03, 0x18, 1, 2, 3])]]),
    serviceData: new Map([["0000fd6f-0000-1000-8000-00805f9b34fb", view([9, 9])]]),
    uuids: ["0000FE2C-0000-1000-8000-00805F9B34FB", "0000fe2c-0000-1000-8000-00805f9b34fb"],
  };
  assert.deepEqual(advertisementEventToRaw(event, 5), {
    id: "abc123==",
    address: null,
    rssi: -61,
    name: "Cached",
    txPower: 12,
    manufacturerData: { 76: "1005031801 0203".replace(" ", "") },
    serviceData: { "0000fd6f-0000-1000-8000-00805f9b34fb": "0909" },
    serviceUuids: ["0000fe2c-0000-1000-8000-00805f9b34fb"],
    t: 5,
  });
  assert.equal(advertisementEventToRaw({ device: {} }), null);
  assert.equal(advertisementEventToRaw({ device: { id: "x" }, rssi: null }).rssi, null);
});

function fakeNavigator({ fail } = {}) {
  const listeners = new Set();
  const scan = { active: true, stop() { this.active = false; } };
  return {
    scan,
    listeners,
    bluetooth: {
      addEventListener: (name, fn) => name === "advertisementreceived" && listeners.add(fn),
      removeEventListener: (name, fn) => listeners.delete(fn),
      requestLEScan: async (options) => {
        if (fail) {
          const error = new Error("denied");
          error.name = fail;
          throw error;
        }
        scan.options = options;
        return scan;
      },
    },
  };
}

test("Web Bluetooth source batches adverts and reports status", async () => {
  const nav = fakeNavigator();
  const batches = [];
  const statuses = [];
  const source = createWebBluetoothSource({ onAdverts: (a) => batches.push(a), onStatus: (s) => statuses.push(s), batchMs: 10, nav });
  assert.equal(isWebBluetoothScanSupported(nav), true);
  assert.equal(isWebBluetoothScanSupported({}), false);
  await source.start();
  assert.deepEqual(nav.scan.options, { acceptAllAdvertisements: true, keepRepeatedDevices: true });
  for (const fn of nav.listeners) {
    fn({ device: { id: "d1" }, rssi: -50, manufacturerData: new Map(), serviceData: new Map(), uuids: [] });
    fn({ device: { id: "d1" }, rssi: -52, manufacturerData: new Map(), serviceData: new Map(), uuids: [] });
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(batches.flat().length, 2);
  assert.deepEqual(statuses.map((s) => s.state), ["starting", "scanning"]);
  source.stop();
  assert.equal(nav.scan.active, false);
  assert.equal(nav.listeners.size, 0);
});

test("Web Bluetooth source maps permission errors to Danish", async () => {
  const nav = fakeNavigator({ fail: "NotAllowedError" });
  const statuses = [];
  const source = createWebBluetoothSource({ onAdverts: () => {}, onStatus: (s) => statuses.push(s), nav });
  await assert.rejects(source.start());
  assert.equal(statuses.at(-1).state, "error");
  assert.match(statuses.at(-1).message, /ikke tilladt/);
  assert.equal(nav.listeners.size, 0);

  const unsupported = [];
  const none = createWebBluetoothSource({ onAdverts: () => {}, onStatus: (s) => unsupported.push(s), nav: {} });
  await assert.rejects(none.start());
  assert.equal(unsupported[0].state, "unsupported");
});

test("demo source produces parser-valid, realistic devices", () => {
  const demo = createDemoSource({ seed: 1 });
  const tracker = new Tracker({ now: () => 0 });
  for (let t = 0; t < 30000; t += 200) tracker.ingestMany(demo._step(t));
  const kinds = new Map(tracker.list({ filter: "all" }).map((d) => [d.id, d.classification.kind]));
  assert.equal(kinds.get("demo-ipad"), "apple-mobile");
  assert.equal(kinds.get("demo-iphone"), "apple-mobile");
  assert.equal(kinds.get("demo-airpods"), "airpods");
  assert.equal(kinds.get("demo-airtag"), "airtag");
  assert.equal(kinds.get("demo-samsung"), "phone");
  assert.equal(kinds.get("demo-windows"), "computer");
  assert.equal(kinds.get("demo-garmin"), "wearable");
  assert.equal(kinds.get("demo-unknown"), "unknown");
  assert.equal(tracker.get("demo-airpods").classification.label, "AirPods Pro");
  const iphone = tracker.get("demo-iphone");
  assert.ok(iphone.smoothed > -50, "the phone in your hand is strong");
  assert.ok(tracker.get("demo-ipad").smoothed < -70, "the lost iPad starts far away");
});

test("demo: following the iPad makes it warmer and its address rotation is re-acquired", () => {
  const demo = createDemoSource({ seed: 3 });
  let now = 0;
  const tracker = new Tracker({ now: () => now });
  for (; now < 20000; now += 200) tracker.ingestMany(demo._step(now));
  const before = tracker.get("demo-ipad").smoothed;
  tracker.follow("demo-ipad");
  demo.setFollowed("demo-ipad");
  let reacquired = null;
  for (; now < 150000; now += 200) {
    tracker.ingestMany(demo._step(now));
    if (now % 1000 === 0) {
      const result = tracker.tick(now);
      if (result.reacquired) {
        reacquired = result.reacquired;
        demo.setFollowed(result.reacquired.toId);
      }
    }
  }
  assert.deepEqual(reacquired, { fromId: "demo-ipad", toId: "demo-ipad-2", strong: true });
  const after = tracker.get(tracker.followedId).smoothed;
  assert.ok(after > before + 20, `expected warmer: before ${before}, after ${after}`);
});

test("demo identify answers like the bridge", async () => {
  const demo = createDemoSource({ seed: 1, identifyDelayMs: 0 });
  demo._step(0);
  const ok = await demo.identify("demo-ipad");
  assert.deepEqual(ok, { ok: true, id: "demo-ipad", manufacturer: "Apple Inc.", model: "iPad13,1", name: "iPad" });
  const refused = await demo.identify("demo-airtag");
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "connect_failed");
  assert.equal((await demo.identify("nope")).error.code, "not_found");
});

test("Web Bluetooth source asks for a restart when Android pauses the scan", async () => {
  const nav = fakeNavigator();
  const source = createWebBluetoothSource({ onAdverts: () => {}, onStatus: () => {}, batchMs: 10, nav });
  assert.equal(source.needsRestart(), false, "not scanning yet");
  await source.start();
  const now = Date.now();
  assert.equal(source.needsRestart(now), false);
  assert.equal(source.needsRestart(now + 25000), true, "no adverts for a while");
  for (const fn of nav.listeners) fn({ device: { id: "d1" }, rssi: -50 });
  assert.equal(source.needsRestart(Date.now() + 5000), false, "adverts are flowing");
  assert.equal(source.needsRestart(now + 10 * 60 * 1000), true, "Android's ~10 minute limit");
  nav.scan.active = false; // Chrome stopped it (screen off / app switch)
  assert.equal(source.needsRestart(Date.now()), true, "a scan Chrome stopped needs a restart");
  source.stop();
  assert.equal(source.needsRestart(), false, "a scan we stopped ourselves does not");
});

test("permission helper opens Chrome's device chooser and treats 'cancelled' as done", async () => {
  const { requestBluetoothPermission } = await import("../../web/js/sources/webbluetooth.js");
  const calls = [];
  const cancelled = Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" });
  const nav = { bluetooth: { requestDevice: async (options) => { calls.push(options); throw cancelled; } } };
  assert.deepEqual(await requestBluetoothPermission(nav), { ok: true, errorName: "NotFoundError" });
  assert.deepEqual(calls, [{ acceptAllDevices: true }]);
  const denied = { bluetooth: { requestDevice: async () => { throw Object.assign(new Error("x"), { name: "SecurityError" }); } } };
  assert.equal((await requestBluetoothPermission(denied)).ok, false);
  assert.equal((await requestBluetoothPermission({})).ok, false);
});

test("scan errors carry the technical name for the UI", async () => {
  const nav = fakeNavigator({ fail: "NotFoundError" });
  const statuses = [];
  const source = createWebBluetoothSource({ onAdverts: () => {}, onStatus: (s) => statuses.push(s), nav });
  await assert.rejects(source.start());
  const last = statuses.at(-1);
  assert.equal(last.errorName, "NotFoundError");
  assert.match(last.detail, /NotFoundError/);
  assert.match(last.message, /Bluetooth/);
});
