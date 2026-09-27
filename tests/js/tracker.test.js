import assert from "node:assert/strict";
import { test } from "node:test";

import { Tracker } from "../../web/js/engine/tracker.js";

function advert(id, rssi, t, manufacturerData = {}, extra = {}) {
  return { id, address: id, rssi, name: null, txPower: null, manufacturerData, serviceData: {}, serviceUuids: [], t, ...extra };
}

const IPAD = (tag) => ({ 76: `10051318${tag}` });
const IPHONE = (tag) => ({ 76: `10051b1c${tag}` });

test("ingest creates devices, smooths, classifies and drops invalid rssi", () => {
  const tracker = new Tracker({ now: () => 0 });
  assert.equal(tracker.ingest(advert("a", 127, 0)), null);
  assert.equal(tracker.ingest(advert("a", 0, 0)), null);
  assert.equal(tracker.ingest(advert("a", null, 0)), null);
  assert.equal(tracker.ingest({ rssi: -50 }), null);
  const device = tracker.ingest(advert("a", -70, 1000, IPAD("aabbcc")));
  assert.equal(device.count, 1);
  assert.equal(device.smoothed, -70);
  assert.equal(device.classification.kind, "apple-mobile");
  assert.deepEqual(device.companyIds, [0x004c]);
  assert.equal(device.fingerprint, "ni:5:1:24");
  assert.deepEqual(device.linkKeys, ["auth:aabbcc"]);
  tracker.ingest(advert("a", -60, 1250, IPAD("aabbcc")));
  assert.equal(device.count, 2);
  assert.equal(device.advIntervalMs, 250);
  assert.ok(device.smoothed > -70 && device.smoothed < -60);
  assert.equal(device.history.length, 2);
});

test("scan responses without manufacturer data keep what we knew", () => {
  const tracker = new Tracker();
  tracker.ingest(advert("a", -70, 1000, IPAD("aabbcc")));
  const device = tracker.ingest(advert("a", -71, 1100, {}, { name: "Rasmus’ iPad" }));
  assert.equal(device.companyIds[0], 0x004c);
  assert.equal(device.classification.kind, "ipad");
  assert.equal(device.name, "Rasmus’ iPad");
});

test("history is trimmed to historyMs", () => {
  const tracker = new Tracker({ historyMs: 1000 });
  for (let t = 0; t <= 5000; t += 250) tracker.ingest(advert("a", -60, t));
  const history = tracker.get("a").history;
  assert.ok(history[0].t >= 4000);
});

test("list filters, sorts and hides; counts match", () => {
  const tracker = new Tracker();
  tracker.ingest(advert("far-ipad", -85, 1000, IPAD("000001")));
  tracker.ingest(advert("near-phone", -50, 1000, IPHONE("000002")));
  tracker.ingest(advert("watch", -40, 1000, { 76: "0b03aabbcc" }));
  tracker.ingest(advert("pc", -45, 1000, { 6: "0109" }));
  assert.deepEqual(tracker.list().map((d) => d.id), ["near-phone", "far-ipad"]);
  assert.deepEqual(tracker.list({ filter: "apple" }).map((d) => d.id), ["watch", "near-phone", "far-ipad"]);
  assert.deepEqual(tracker.list({ filter: "all" }).map((d) => d.id), ["watch", "pc", "near-phone", "far-ipad"]);
  assert.deepEqual(tracker.counts(), { candidates: 2, apple: 3, all: 4, hidden: 0 });

  tracker.hide("near-phone");
  assert.deepEqual(tracker.list().map((d) => d.id), ["far-ipad"]);
  assert.deepEqual(tracker.list({ includeHidden: true }).map((d) => d.id), ["near-phone", "far-ipad"]);
  assert.deepEqual(tracker.counts(), { candidates: 1, apple: 2, all: 3, hidden: 1 });
  assert.deepEqual(tracker.hiddenIds(), ["near-phone"]);
  tracker.unhide("near-phone");
  assert.equal(tracker.isHidden("near-phone"), false);
  tracker.setHiddenIds(["x", 5, null]);
  assert.deepEqual(tracker.hiddenIds(), ["x"]);
});

test("stale devices sort last and old ones are forgotten (except the followed one)", () => {
  let now = 0;
  const tracker = new Tracker({ staleMs: 10000, forgetMs: 60000, now: () => now });
  tracker.ingest(advert("old", -40, 0, IPAD("000001")));
  tracker.ingest(advert("kept", -45, 0, IPAD("000002")));
  tracker.ingest(advert("fresh", -80, 20000, IPAD("000003")));
  tracker.follow("kept");
  now = 20000;
  tracker.tick();
  assert.deepEqual(tracker.list().map((d) => d.id), ["fresh", "old", "kept"]);
  assert.equal(tracker.get("old").stale, true);
  now = 70000;
  const { removed } = tracker.tick();
  assert.deepEqual(removed, ["old"]);
  assert.ok(tracker.get("kept"));
  assert.equal(tracker.followedId, "kept");
});

test("identity re-classifies; follow ignores unknown ids; hide unfollows", () => {
  const tracker = new Tracker();
  tracker.ingest(advert("a", -60, 0, IPAD("000001")));
  tracker.setIdentity("a", { manufacturer: "Apple Inc.", model: "iPad13,1" });
  assert.equal(tracker.get("a").classification.kind, "ipad");
  assert.equal(tracker.setIdentity("missing", {}), null);
  assert.equal(tracker.follow("missing"), null);
  assert.equal(tracker.follow("a"), "a");
  tracker.hide("a");
  assert.equal(tracker.followedId, null);
});

test("re-acquire after address rotation via the lingering auth tag", () => {
  let now = 0;
  const tracker = new Tracker({ reacquireAfterMs: 8000, now: () => now });
  const events = [];
  tracker.on("reacquired", (event) => events.push(event));
  for (let t = 0; t <= 10000; t += 500) tracker.ingest(advert("old-addr", -70, t, IPAD("aaaaaa")));
  tracker.ingest(advert("my-phone", -45, 10000, IPHONE("bbbbbb")));
  tracker.setIdentity("old-addr", { model: "iPad13,1" });
  tracker.follow("old-addr");
  // New address: first packets still carry the old tag, then a new one.
  tracker.ingest(advert("new-addr", -69, 10300, IPAD("aaaaaa")));
  tracker.ingest(advert("new-addr", -68, 10600, IPAD("cccccc")));
  // A decoy with the same soft fingerprint but no shared tag.
  tracker.ingest(advert("decoy", -72, 10400, IPAD("dddddd")));
  now = 12000;
  assert.equal(tracker.tick().reacquired, null, "too early");
  for (let t = 10900; t <= 20000; t += 500) {
    tracker.ingest(advert("new-addr", -67, t, IPAD("cccccc")));
    tracker.ingest(advert("decoy", -72, t, IPAD("dddddd")));
  }
  now = 20000;
  const { reacquired } = tracker.tick();
  assert.deepEqual(reacquired, { fromId: "old-addr", toId: "new-addr", strong: true });
  assert.deepEqual(events, [reacquired]);
  assert.equal(tracker.followedId, "new-addr");
  const next = tracker.get("new-addr");
  assert.deepEqual(next.previousIds, ["old-addr"]);
  assert.equal(next.identity.model, "iPad13,1");
  assert.equal(next.classification.kind, "ipad");
});

test("soft re-acquire only when exactly one device matches", () => {
  let now = 0;
  const tracker = new Tracker({ now: () => now });
  for (let t = 0; t <= 5000; t += 500) tracker.ingest(advert("old", -70, t, IPAD("aaaaaa")));
  tracker.follow("old");
  for (let t = 6000; t <= 16000; t += 500) tracker.ingest(advert("new", -72, t, IPAD("bbbbbb")));
  now = 16000;
  assert.deepEqual(tracker.tick().reacquired, { fromId: "old", toId: "new", strong: false });

  // Two lookalikes → ambiguous → keep waiting.
  const ambiguous = new Tracker({ now: () => now });
  now = 0;
  for (let t = 0; t <= 5000; t += 500) ambiguous.ingest(advert("old", -70, t, IPAD("aaaaaa")));
  ambiguous.follow("old");
  for (let t = 6000; t <= 16000; t += 500) {
    ambiguous.ingest(advert("n1", -72, t, IPAD("bbbbbb")));
    ambiguous.ingest(advert("n2", -68, t, IPAD("cccccc")));
  }
  now = 16000;
  assert.equal(ambiguous.tick().reacquired, null);
  assert.equal(ambiguous.followedId, "old");

  // Very different signal level is not a match.
  const far = new Tracker({ now: () => now });
  now = 0;
  for (let t = 0; t <= 5000; t += 500) far.ingest(advert("old", -50, t, IPAD("aaaaaa")));
  far.follow("old");
  for (let t = 6000; t <= 16000; t += 500) far.ingest(advert("n1", -90, t, IPAD("bbbbbb")));
  now = 16000;
  assert.equal(far.tick().reacquired, null);
});

test("hey siri class sticks to the device after the message stops", () => {
  const tracker = new Tracker();
  tracker.ingest(advert("a", -60, 0, { 76: "0807aabb1020000301" + "10051318aabbcc" }));
  const device = tracker.ingest(advert("a", -60, 500, IPAD("aabbcc")));
  assert.equal(device.classification.kind, "ipad");
  assert.equal(device.hints.deviceClass, "ipad");
});

test("event listeners can unsubscribe and errors in listeners are contained", () => {
  const tracker = new Tracker();
  const calls = [];
  const off = tracker.on("reacquired", (e) => calls.push(e));
  off();
  tracker._emit("reacquired", 1);
  assert.deepEqual(calls, []);
  const originalError = console.error;
  console.error = () => {};
  try {
    tracker.on("reacquired", () => {
      throw new Error("boom");
    });
    assert.doesNotThrow(() => tracker._emit("reacquired", 2));
  } finally {
    console.error = originalError;
  }
});

test("Microsoft CDP data is parsed by the tracker", () => {
  const tracker = new Tracker();
  const device = tracker.ingest(advert("ms", -60, 0, { 6: "0109200255aa66bb77cc88dd99ee00ff" }));
  assert.equal(device.microsoft.deviceType, 9);
  assert.equal(device.classification.label, "Windows-pc");
  assert.deepEqual(tracker.list({ filter: "all" }).map((d) => d.id), ["ms"]);
  assert.deepEqual(tracker.list().map((d) => d.id), []);
});

test("soft re-acquire never hands the iPad's identity to another device", () => {
  let now = 0;
  const tracker = new Tracker({ now: () => now });
  for (let t = 0; t <= 5000; t += 500) tracker.ingest(advert("ipad", -70, t, IPAD("aaaaaa")));
  tracker.setIdentity("ipad", { model: "iPad13,1" });
  tracker.follow("ipad");
  for (let t = 6000; t <= 16000; t += 500) tracker.ingest(advert("new", -72, t, IPAD("bbbbbb")));
  now = 16000;
  assert.equal(tracker.tick().reacquired.strong, false);
  const next = tracker.get("new");
  assert.equal(next.identity, null);
  assert.notEqual(next.classification.confidence, "sikker");
});

test("devices appearing long after the loss are not taken for the lost one", () => {
  let now = 0;
  const tracker = new Tracker({ now: () => now });
  for (let t = 0; t <= 20000; t += 500) tracker.ingest(advert("ipad", -70, t, IPAD("aaaaaa")));
  tracker.follow("ipad");
  // The user's phone rotates its address three minutes later: same soft fingerprint.
  for (let t = 200000; t <= 210000; t += 500) tracker.ingest(advert("phone-rotated", -72, t, IPAD("cccccc")));
  now = 210000;
  assert.equal(tracker.tick().reacquired, null);
  assert.equal(tracker.followedId, "ipad");
});

test("a device known to be a different kind is never re-acquired", () => {
  let now = 0;
  const tracker = new Tracker({ now: () => now });
  for (let t = 0; t <= 5000; t += 500) tracker.ingest(advert("ipad", -70, t, IPAD("aaaaaa")));
  tracker.setIdentity("ipad", { model: "iPad13,1" });
  tracker.follow("ipad");
  // Announces itself as an iPhone (Hey Siri) but shares the lingering auth tag by coincidence.
  tracker.ingest(advert("iphone", -71, 6000, { 76: "0807aabb1020000201" + "10051318aaaaaa" }));
  for (let t = 6500; t <= 16000; t += 500) tracker.ingest(advert("iphone", -71, t, IPAD("aaaaaa")));
  now = 16000;
  assert.equal(tracker.tick().reacquired, null);
});

test("service data UUIDs count for classification", () => {
  const tracker = new Tracker();
  const device = tracker.ingest(advert("s", -70, 0, {}, { serviceData: { "0000fd69-0000-1000-8000-00805f9b34fb": "0102030405" } }));
  assert.equal(device.classification.kind, "samsung-offline");
  assert.equal(device.classification.candidate, true);
  assert.deepEqual(device.serviceUuids, ["0000fd69-0000-1000-8000-00805f9b34fb"]);
});
