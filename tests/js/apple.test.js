import assert from "node:assert/strict";
import { test } from "node:test";

import { announcedClass, linkKeys, parseContinuity, splitMessages, stableFingerprint } from "../../web/js/engine/apple.js";
import { hexToBytes } from "../../web/js/engine/bytes.js";

const parse = (hex) => parseContinuity(hexToBytes(hex));

test("Nearby Info from a real macOS capture (furiousMAC)", () => {
  const c = parse("100507 1c767a87");
  assert.deepEqual(c.types, [0x10]);
  assert.equal(c.nearbyInfo.statusFlags, 0);
  assert.equal(c.nearbyInfo.actionCode, 7);
  assert.equal(c.nearbyInfo.dataFlags, 0x1c);
  assert.equal(c.nearbyInfo.authTag, "767a87");
  assert.equal(c.nearbyInfo.action.key, "lowActivity");
});

test("Nearby Info action codes and status nibble", () => {
  assert.equal(parse("10051318aabbcc").nearbyInfo.action.label, "Låst / ikke i brug");
  assert.equal(parse("10051318aabbcc").nearbyInfo.statusFlags, 1);
  assert.equal(parse("10051b1caabbcc").nearbyInfo.action.active, true);
  assert.equal(parse("10050e1caabbcc").nearbyInfo.action.key, "call");
  assert.equal(parse("1005021caabbcc").nearbyInfo.action.key, "other");
});

test("Nearby Info auth tag handling: absent flag, 4-byte flag, short messages", () => {
  assert.equal(parse("10050300aabbcc").nearbyInfo.authTag, null); // flag 0x10 not set
  assert.equal(parse("10060312aabbccdd").nearbyInfo.authTag, "aabbccdd"); // 0x02 → 4-byte tag
  const short = parse("1003031caa");
  assert.equal(short.nearbyInfo.authTag, null);
  assert.equal(short.nearbyInfo.length, 3);
});

test("Handoff followed by Nearby Info in one advert", () => {
  const c = parse("0c0e00" + "2d00" + "aa" + "00112233445566778899" + "10051b1c010203");
  assert.deepEqual(c.types, [0x0c, 0x10]);
  assert.equal(c.handoff.iv, 0x002d);
  assert.equal(c.handoff.data, "aa00112233445566778899");
  assert.equal(c.nearbyInfo.authTag, "010203");
  assert.deepEqual(linkKeys(c), ["auth:010203", "handoff:45:aa00112233445566778899"]);
});

test("Proximity Pairing model (AirPods Pro) only for the 25-byte paired status", () => {
  const enc = "00".repeat(16);
  const c = parse("0719010e205598b8310000" + enc);
  assert.equal(c.proximityPairing.modelId, 0x0e20);
  assert.equal(c.proximityPairing.model, "AirPods Pro");
  assert.equal(parse("0719010a205598b8310000" + enc).proximityPairing.model, "AirPods Max");
  assert.equal(parse("0719019920" + "00".repeat(22)).proximityPairing.model, null);
  // A non-status frame (prefix 0x07) carries no model.
  assert.equal(parse("0719070e20" + "00".repeat(22)).proximityPairing.modelId, null);
});

test("Find My: separated AirTag and offline Apple device", () => {
  const key = "11".repeat(22);
  const airtag = parse("121910" + key + "0100");
  assert.equal(airtag.findMy.variant, "separated");
  assert.equal(airtag.findMy.deviceType, "airtag");
  assert.equal(airtag.findMy.battery, "full");

  const apple = parse("1219c4" + key + "0200");
  assert.equal(apple.findMy.deviceType, "apple");
  assert.equal(apple.findMy.battery, "critical");
  assert.equal(apple.findMy.ownerConnected, true);

  // iPhones in the wild send status 0x00: no battery information.
  const iphone = parse("121900" + key + "0000");
  assert.equal(iphone.findMy.deviceType, "apple");
  assert.equal(iphone.findMy.battery, null);

  const nearby = parse("12022001");
  assert.equal(nearby.findMy.variant, "nearby");
  assert.equal(nearby.findMy.deviceType, "accessory");
  assert.equal(parse("12027003").findMy.deviceType, "airpods");
});

test("Tethering Source (Instant Hotspot)", () => {
  const c = parse("0e0601004000070" + "3");
  assert.deepEqual(c.tetheringSource, { battery: 64, cellType: 7, cellLabel: "LTE", bars: 3 });
});

test("Hey Siri announces the device class", () => {
  assert.equal(parse("0807aabb1020000301").heySiri.deviceClass, "ipad");
  assert.equal(parse("0807aabb1020000201").heySiri.deviceClass, "iphone");
  assert.equal(announcedClass(parse("0807aabb1020000301")), "ipad");
});

test("Nearby Action iOS setup carries the device class", () => {
  // flags 0x80 (auth tag) , type 0x09, tag aabbcc, params: class 0x6 (iPad) model 0, color, os
  const c = parse("0f08" + "80" + "09" + "aabbcc" + "60" + "01" + "0e");
  assert.equal(c.nearbyAction.actionType, 0x09);
  assert.equal(c.nearbyAction.deviceClass, "ipad");
  assert.equal(announcedClass(c), "ipad");
  assert.equal(parse("0f05000800aabb").nearbyAction.label, "Deler Wi-Fi-adgangskode");
});

test("overflow area (no length byte) and HomeKit packed length", () => {
  const overflow = parse("01" + "00".repeat(15) + "80");
  assert.equal(overflow.overflow, true);
  assert.deepEqual(overflow.types, [0x01]);

  // HomeKit: length byte 0x2d = subtype 1, length 13.
  const homekit = splitMessages(hexToBytes("062d" + "00".repeat(13) + "10050300"));
  assert.equal(homekit[0].length, 13);
  assert.equal(homekit[0].subtype, 1);
  assert.equal(homekit[1].type, 0x10);
});

test("iBeacon", () => {
  const c = parse("0215" + "e2c56db5dffb48d2b060d0f5a71096e0" + "0001" + "0002" + "c5");
  assert.equal(c.ibeacon.uuid, "e2c56db5-dffb-48d2-b060-d0f5a71096e0");
  assert.equal(c.ibeacon.major, 1);
  assert.equal(c.ibeacon.minor, 2);
  assert.equal(c.ibeacon.measuredPower, -59);
});

test("never throws on garbage and marks truncation", () => {
  for (const hex of ["", "10", "1005", "10ff0102", "ff", "0719", "12", "0e0201", "0807"]) {
    assert.doesNotThrow(() => parse(hex));
  }
  const truncated = parse("10ff0102");
  assert.equal(truncated.messages[0].truncated, true);
  const unknown = parse("16020102");
  assert.equal(unknown.messages[0].key, "type16");
});

test("stable fingerprint ignores the action nibble but keeps flags", () => {
  const a = stableFingerprint(parse("10051318aabbcc"));
  const b = stableFingerprint(parse("10051b18ddeeff"));
  const c = stableFingerprint(parse("1005131caabbcc"));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(stableFingerprint(parse("0719010e20" + "00".repeat(22))), "pp:3616");
  assert.equal(stableFingerprint(parse("0303aabbcc")), null);
  assert.equal(stableFingerprint(null), null);
});
