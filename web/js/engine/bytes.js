// Small helpers for converting between hex strings, bytes and Bluetooth UUIDs.

const BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

export function hexToBytes(hex) {
  if (typeof hex !== "string") return new Uint8Array(0);
  const clean = hex.replace(/^0x/i, "").replace(/[\s:-]/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < (bytes?.length ?? 0); i++) {
    out += (bytes[i] & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

export function dataViewToHex(view) {
  if (!view) return "";
  return bytesToHex(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/** Expand 16/32-bit UUIDs (numbers or short hex strings) to full 128-bit lowercase form. */
export function normalizeUuid(uuid) {
  if (typeof uuid === "number") {
    return uuid.toString(16).padStart(8, "0") + BASE_UUID_SUFFIX;
  }
  let text = String(uuid ?? "").trim().toLowerCase();
  if (text.startsWith("0x")) text = text.slice(2);
  if (/^[0-9a-f]{4}$/.test(text)) return "0000" + text + BASE_UUID_SUFFIX;
  if (/^[0-9a-f]{8}$/.test(text)) return text + BASE_UUID_SUFFIX;
  return text;
}

/** The 16-bit value of a UUID built on the Bluetooth base UUID, else null. */
export function uuid16(uuid) {
  const full = normalizeUuid(uuid);
  const match = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(full);
  return match ? parseInt(match[1], 16) : null;
}
