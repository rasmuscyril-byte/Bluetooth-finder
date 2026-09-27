import assert from "node:assert/strict";
import { test } from "node:test";

import { bytesToHex, dataViewToHex, hexToBytes, normalizeUuid, uuid16 } from "../../web/js/engine/bytes.js";

test("hexToBytes parses and tolerates separators", () => {
  assert.deepEqual([...hexToBytes("10 05 03")], [0x10, 0x05, 0x03]);
  assert.deepEqual([...hexToBytes("AA:bb:0C")], [0xaa, 0xbb, 0x0c]);
  assert.deepEqual([...hexToBytes("0x4c00")], [0x4c, 0x00]);
  assert.equal(hexToBytes("abc").length, 0);
  assert.equal(hexToBytes("zz").length, 0);
  assert.equal(hexToBytes(undefined).length, 0);
});

test("bytesToHex and dataViewToHex", () => {
  assert.equal(bytesToHex(new Uint8Array([0, 15, 255])), "000fff");
  const buffer = new Uint8Array([9, 1, 2, 3, 9]).buffer;
  assert.equal(dataViewToHex(new DataView(buffer, 1, 3)), "010203");
  assert.equal(dataViewToHex(null), "");
});

test("normalizeUuid and uuid16", () => {
  const base = "-0000-1000-8000-00805f9b34fb";
  assert.equal(normalizeUuid("FE2C"), "0000fe2c" + base);
  assert.equal(normalizeUuid(0x180a), "0000180a" + base);
  assert.equal(normalizeUuid("0000FD6F"), "0000fd6f" + base);
  assert.equal(uuid16("0000fe2c" + base), 0xfe2c);
  assert.equal(uuid16("fef3"), 0xfef3);
  assert.equal(uuid16("d0611e78-bbb4-4591-a5f8-487910ae4366"), null);
});
