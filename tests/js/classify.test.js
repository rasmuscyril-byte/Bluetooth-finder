import assert from "node:assert/strict";
import { test } from "node:test";

import { parseContinuity } from "../../web/js/engine/apple.js";
import { hexToBytes } from "../../web/js/engine/bytes.js";
import { classify } from "../../web/js/engine/classify.js";

const APPLE = 0x004c;
const apple = (hex, extra = {}) => classify({ companyIds: [APPLE], apple: parseContinuity(hexToBytes(hex)), ...extra });

test("GATT model number is authoritative", () => {
  const c = apple("10051318aabbcc", { identity: { manufacturer: "Apple Inc.", model: "iPad13,1", name: "Rasmus’ iPad" } });
  assert.equal(c.kind, "ipad");
  assert.equal(c.label, "iPad");
  assert.equal(c.confidence, "sikker");
  assert.equal(c.candidate, true);
  assert.equal(c.priority, 100);
  assert.ok(c.details.includes("Model iPad13,1"));
  assert.ok(c.details.includes("“Rasmus’ iPad”"));

  assert.equal(apple("10051318aabbcc", { identity: { model: "iPhone15,2" } }).kind, "iphone");
  assert.equal(apple("10051318aabbcc", { identity: { model: "MacBookAir10,1" } }).kind, "mac");
  assert.equal(apple("10051318aabbcc", { identity: { model: "MacBookAir10,1" } }).candidate, false);
  assert.equal(apple("10051318aabbcc", { identity: { model: "Watch6,1" } }).kind, "apple-watch");
  assert.equal(apple("10051318aabbcc", { identity: { model: "AudioAccessory5,1" } }).kind, "homepod");
});

test("Nearby Info devices are iPhone/iPad/Mac candidates with activity details", () => {
  const c = apple("10051318aabbcc");
  assert.equal(c.kind, "apple-mobile");
  assert.equal(c.vendor, "Apple");
  assert.equal(c.candidate, true);
  assert.equal(c.confidence, "mulig");
  assert.deepEqual(c.details, ["Låst / ikke i brug"]);
});

test("device class announced via Hey Siri, also as a sticky hint", () => {
  assert.equal(apple("0807aabb1020000301").kind, "ipad");
  assert.equal(apple("0807aabb1020000301").confidence, "sandsynlig");
  const later = apple("10051318aabbcc", { hints: { deviceClass: "ipad" } });
  assert.equal(later.kind, "ipad");
  assert.equal(later.label, "iPad");
});

test("things that are not the iPad", () => {
  assert.equal(apple("0719010e205598b8310000" + "00".repeat(16)).label, "AirPods Pro");
  assert.equal(apple("0719010e205598b8310000" + "00".repeat(16)).candidate, false);
  assert.equal(apple("121910" + "00".repeat(22) + "0000").kind, "airtag");
  assert.equal(apple("0b03aabbcc").kind, "apple-watch");
  assert.equal(apple("0906000000000000").kind, "apple-tv");
  assert.equal(apple("0303aabbcc").kind, "printer");
  assert.equal(apple("0215" + "00".repeat(21)).kind, "beacon");
});

test("Find My from an Apple device without internet is a strong candidate", () => {
  const c = apple("121900" + "00".repeat(22) + "0000");
  assert.equal(c.kind, "findmy-device");
  assert.equal(c.candidate, true);
  assert.equal(c.priority, 90);
  assert.ok(c.details.some((d) => d.startsWith("Find My-signal")));
});

test("Tethering source means an iPhone/iPad with cellular on your Apple ID", () => {
  const c = apple("0e060100400007" + "03");
  assert.equal(c.kind, "apple-mobile");
  assert.ok(c.details.includes("Batteri 64 %"));
  assert.ok(c.details.some((d) => d.includes("Apple-ID")));
});

test("names help, for Apple and others", () => {
  assert.equal(classify({ name: "Rasmus’ iPad", companyIds: [APPLE] }).kind, "ipad");
  assert.equal(classify({ name: "Galaxy S23", companyIds: [0x0075] }).kind, "phone");
  assert.equal(classify({ name: "Galaxy S23", companyIds: [0x0075] }).vendor, "Samsung");
  assert.equal(classify({ name: "Galaxy Tab S9", companyIds: [] }).kind, "tablet");
  assert.equal(classify({ name: "Galaxy Buds2 Pro", companyIds: [] }).kind, "headphones");
  assert.equal(classify({ name: "Galaxy Watch6", companyIds: [] }).kind, "wearable");
  assert.equal(classify({ name: "Forerunner 255", companyIds: [0x0087] }).kind, "wearable");
});

test("company ids and service uuids", () => {
  assert.equal(classify({ companyIds: [0x0075] }).kind, "samsung");
  assert.equal(classify({ companyIds: [0x0075] }).candidate, true);
  assert.equal(classify({ companyIds: [0x00e0] }).kind, "android");
  assert.equal(classify({ companyIds: [0x0006] }).label, "Windows-pc eller Microsoft-enhed");
  assert.equal(classify({ companyIds: [0x0006] }).candidate, false);
  assert.equal(classify({ companyIds: [0x0087] }).kind, "wearable");
  assert.equal(classify({ companyIds: [0x067c] }).kind, "tracker");
  assert.equal(classify({ companyIds: [], serviceUuids16: [0xfe2c] }).kind, "headphones");
  assert.equal(classify({ companyIds: [], serviceUuids16: [0xfeed] }).kind, "tracker");
  assert.equal(classify({ companyIds: [0x0059] }).label, "Ukendt enhed (Nordic Semiconductor)");
  const unknown = classify({});
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.candidate, false);
  assert.equal(unknown.icon, "❔");
});

test("Microsoft CDP beacon reveals iPads running Microsoft apps", async () => {
  const { parseMicrosoftBeacon } = await import("../../web/js/engine/vendors.js");
  const ipad = classify({ companyIds: [0x0006], microsoft: parseMicrosoftBeacon(hexToBytes("0107200255aa66bb")) });
  assert.equal(ipad.kind, "ipad");
  assert.equal(ipad.vendor, "Apple");
  assert.equal(ipad.candidate, true);
  assert.ok(ipad.details.includes("Fundet via Microsoft-app"));
  assert.equal(classify({ companyIds: [0x0006], microsoft: parseMicrosoftBeacon(hexToBytes("0109")) }).label, "Windows-pc");
  assert.equal(classify({ companyIds: [0x0006], microsoft: parseMicrosoftBeacon(hexToBytes("0300803132")) }).kind, "accessory");
  assert.equal(parseMicrosoftBeacon(hexToBytes("")), null);
  assert.equal(parseMicrosoftBeacon(hexToBytes("0199")).device, null);
});

test("phone-ish service UUIDs", () => {
  const samsungOffline = classify({ companyIds: [], serviceUuids16: [0xfd69] });
  assert.equal(samsungOffline.kind, "samsung-offline");
  assert.equal(samsungOffline.candidate, true);
  assert.equal(classify({ companyIds: [], serviceUuids16: [0xfef3] }).kind, "android");
  assert.equal(classify({ companyIds: [], serviceUuids16: [0xfef3] }).candidate, true);
  assert.equal(classify({ companyIds: [], serviceUuids16: [0xfe07] }).kind, "headphones");
  assert.equal(classify({ companyIds: [], serviceUuids16: [0xfe00] }).kind, "accessory");
  assert.equal(classify({ companyIds: [0x018e] }).kind, "wearable");
});
