// Parser for Apple "Continuity" BLE advertisements (manufacturer data with
// company id 0x004C). Input is the bytes AFTER the 2-byte company id.
//
// Layout (see furiousMAC/continuity, Celosia & Cunche's "joker" dissector):
// a sequence of TLV messages [type u8][length u8][payload]. Exceptions:
//   * 0x01 "overflow area" has no length byte: 0x01 + 16 bytes, nothing else.
//   * 0x06/0x11 (HomeKit) pack a subtype in the top 3 bits of the length byte.

import { bytesToHex } from "./bytes.js";

export const APPLE_COMPANY_ID = 0x004c;

export const CONTINUITY_TYPES = new Map([
  [0x01, { key: "overflow", name: "Baggrunds-app (overflow)" }],
  [0x02, { key: "ibeacon", name: "iBeacon" }],
  [0x03, { key: "airprint", name: "AirPrint" }],
  [0x05, { key: "airdrop", name: "AirDrop" }],
  [0x06, { key: "homekit", name: "HomeKit" }],
  [0x07, { key: "proximityPairing", name: "Proximity Pairing" }],
  [0x08, { key: "heySiri", name: "Hej Siri" }],
  [0x09, { key: "airplayTarget", name: "AirPlay-modtager" }],
  [0x0a, { key: "airplaySource", name: "AirPlay-kilde" }],
  [0x0b, { key: "magicSwitch", name: "Magic Switch" }],
  [0x0c, { key: "handoff", name: "Handoff" }],
  [0x0d, { key: "tetheringTarget", name: "Wi-Fi-indstillinger (Tethering Target)" }],
  [0x0e, { key: "tetheringSource", name: "Instant Hotspot (Tethering Source)" }],
  [0x0f, { key: "nearbyAction", name: "Nearby Action" }],
  [0x10, { key: "nearbyInfo", name: "Nearby Info" }],
  [0x11, { key: "homekitNotification", name: "HomeKit-notifikation" }],
  [0x12, { key: "findMy", name: "Find My" }],
]);

// Nearby Info action codes (low nibble of the first payload byte). The two
// published tables disagree on a few values, so labels stay cautious.
const NEARBY_ACTIONS = new Map([
  [0x0, { key: "unknown", label: "Aktivitet ukendt", active: null }],
  [0x1, { key: "disabled", label: "Aktivitet skjult", active: null }],
  [0x3, { key: "idle", label: "Låst / ikke i brug", active: false }],
  [0x5, { key: "audio", label: "Spiller lyd (skærm slukket)", active: false }],
  [0x7, { key: "lowActivity", label: "Skærm tændt eller lige låst", active: null }],
  [0x9, { key: "video", label: "Afspiller video", active: true }],
  [0xa, { key: "lockedWatch", label: "Låst", active: false }],
  [0xb, { key: "active", label: "I brug lige nu", active: true }],
  [0xd, { key: "driving", label: "Kører bil (CarPlay)", active: true }],
  [0xe, { key: "call", label: "Telefon- eller FaceTime-opkald", active: true }],
]);

// Proximity Pairing device models (payload[1] << 8 | payload[2]).
export const AUDIO_MODELS = new Map([
  [0x0220, "AirPods"],
  [0x0f20, "AirPods (2. gen)"],
  [0x1320, "AirPods (3. gen)"],
  [0x1920, "AirPods 4"],
  [0x1b20, "AirPods 4 (ANC)"],
  [0x0e20, "AirPods Pro"],
  [0x1420, "AirPods Pro (2. gen)"],
  [0x2420, "AirPods Pro (2. gen, USB-C)"],
  [0x0a20, "AirPods Max"],
  [0x1f20, "AirPods Max (USB-C)"],
  [0x0320, "Powerbeats3"],
  [0x0520, "BeatsX"],
  [0x0620, "Beats Solo3"],
  [0x0920, "Beats Studio3"],
  [0x0b20, "Powerbeats Pro"],
  [0x0c20, "Beats Solo Pro"],
  [0x0d20, "Powerbeats 4"],
  [0x1020, "Beats Flex"],
  [0x1120, "Beats Studio Buds"],
  [0x1220, "Beats Fit Pro"],
  [0x1620, "Beats Studio Buds+"],
  [0x1720, "Beats Studio Pro"],
  [0x1d20, "Powerbeats Pro 2"],
  [0x2520, "Beats Solo 4"],
  [0x2620, "Beats Solo Buds"],
]);

const HEY_SIRI_CLASSES = new Map([
  [0x0002, "iphone"],
  [0x0003, "ipad"],
  [0x0007, "homepod"],
  [0x0009, "mac"],
  [0x000a, "watch"],
]);

const SETUP_CLASSES = new Map([
  [0x2, "iphone"],
  [0x4, "ipod"],
  [0x6, "ipad"],
  [0x8, "homepod"],
  [0xa, "mac"],
  [0xc, "appletv"],
  [0xe, "watch"],
]);

const NEARBY_ACTION_TYPES = new Map([
  [0x01, "Apple TV-opsætning"],
  [0x04, "Mobil sikkerhedskopi"],
  [0x05, "Apple Watch-opsætning"],
  [0x06, "Apple TV-parring"],
  [0x07, "Internet-relæ"],
  [0x08, "Deler Wi-Fi-adgangskode"],
  [0x09, "Opsætning af ny enhed"],
  [0x0a, "Reparation"],
  [0x0b, "Højttaler-opsætning"],
  [0x0c, "Apple Pay"],
  [0x0d, "Lyd i hele hjemmet"],
  [0x0e, "Udviklerværktøjer"],
  [0x0f, "Besvarede et opkald"],
  [0x10, "Afsluttede et opkald"],
  [0x13, "Autoudfyld"],
  [0x14, "Companion Link"],
]);

const CELL_TYPES = new Map([
  [0, "4G"],
  [1, "1xRTT"],
  [2, "GPRS"],
  [3, "EDGE"],
  [4, "3G (EV-DO)"],
  [5, "3G"],
  [6, "4G"],
  [7, "LTE"],
]);

const FIND_MY_TYPES = ["apple", "airtag", "accessory", "airpods"];
const FIND_MY_BATTERY = ["full", "medium", "low", "critical"];

function emptyResult() {
  return {
    messages: [],
    types: [],
    overflow: false,
    nearbyInfo: null,
    handoff: null,
    proximityPairing: null,
    findMy: null,
    tetheringSource: null,
    tetheringTarget: false,
    nearbyAction: null,
    heySiri: null,
    ibeacon: null,
    airdrop: false,
    airprint: false,
    airplayTarget: false,
    airplaySource: false,
    magicSwitch: false,
    homekit: false,
  };
}

/** Split Apple manufacturer data into Continuity messages. Never throws. */
export function splitMessages(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length === 17 && data[0] === 0x01) {
    return [{ type: 0x01, length: 16, payload: data.subarray(1), truncated: false }];
  }
  const messages = [];
  let i = 0;
  while (i + 2 <= data.length) {
    const type = data[i];
    const lengthByte = data[i + 1];
    const homekit = type === 0x06 || type === 0x11;
    const length = homekit ? lengthByte & 0x1f : lengthByte;
    const end = i + 2 + length;
    const message = { type, length, payload: data.subarray(i + 2, Math.min(end, data.length)), truncated: end > data.length };
    if (homekit) message.subtype = lengthByte >> 5;
    messages.push(message);
    if (message.truncated) break;
    i = end;
  }
  return messages;
}

function decodeNearbyInfo(p, length) {
  if (p.length < 1) return null;
  const actionCode = p[0] & 0x0f;
  const action = NEARBY_ACTIONS.get(actionCode) || { key: "other", label: `Aktivitet ${actionCode}`, active: null };
  const dataFlags = p.length > 1 ? p[1] : null;
  let authTag = null;
  if (length >= 5 && dataFlags !== null && dataFlags & 0x10) {
    const tagLength = dataFlags & 0x02 ? 4 : 3;
    if (p.length >= 2 + tagLength) authTag = bytesToHex(p.subarray(2, 2 + tagLength));
  }
  return { statusFlags: p[0] >> 4, actionCode, action, dataFlags, authTag, length };
}

function decodeHandoff(p) {
  if (p.length < 4) return { iv: null, data: null };
  return { iv: p[1] | (p[2] << 8), data: bytesToHex(p.subarray(3)) };
}

function decodeProximityPairing(p, length) {
  // Only the normal "paired device status" broadcast carries a model id.
  if (p.length < 3 || p[0] !== 0x01 || length !== 25) return { modelId: null, model: null };
  const modelId = (p[1] << 8) | p[2];
  return { modelId, model: AUDIO_MODELS.get(modelId) ?? null };
}

function decodeFindMy(p, length) {
  if (p.length < 1) return null;
  const status = p[0];
  return {
    variant: length >= 25 ? "separated" : "nearby",
    status,
    deviceType: FIND_MY_TYPES[(status >> 4) & 0x03],
    battery: FIND_MY_BATTERY[(status >> 6) & 0x03],
    ownerConnected: Boolean(status & 0x04),
  };
}

function decodeTetheringSource(p) {
  if (p.length < 6) return null;
  const cellType = p[4];
  return {
    battery: p[2] <= 100 ? p[2] : null,
    cellType,
    cellLabel: CELL_TYPES.get(cellType) ?? `type ${cellType}`,
    bars: p[5] <= 4 ? p[5] : null,
  };
}

function decodeNearbyAction(p) {
  if (p.length < 2) return null;
  const flags = p[0];
  const actionType = p[1];
  const paramsStart = 2 + (flags & 0x80 ? 3 : 0);
  let deviceClass = null;
  if (actionType === 0x09 && p.length > paramsStart) {
    deviceClass = SETUP_CLASSES.get(p[paramsStart] >> 4) ?? null;
  }
  return { flags, actionType, label: NEARBY_ACTION_TYPES.get(actionType) ?? null, deviceClass };
}

function decodeHeySiri(p) {
  if (p.length < 6) return null;
  const classId = (p[4] << 8) | p[5];
  return { classId, deviceClass: HEY_SIRI_CLASSES.get(classId) ?? null };
}

function decodeIBeacon(p) {
  if (p.length < 21) return null;
  const hex = bytesToHex(p.subarray(0, 16));
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const measuredPower = p[20] > 127 ? p[20] - 256 : p[20];
  return { uuid, major: (p[16] << 8) | p[17], minor: (p[18] << 8) | p[19], measuredPower };
}

/** Parse the bytes after company id 0x004C into structured Continuity info. */
export function parseContinuity(bytes) {
  const result = emptyResult();
  let messages;
  try {
    messages = splitMessages(bytes);
  } catch {
    return result;
  }
  for (const message of messages) {
    const info = CONTINUITY_TYPES.get(message.type);
    const entry = {
      type: message.type,
      key: info?.key ?? `type${message.type.toString(16).padStart(2, "0")}`,
      name: info?.name ?? `Ukendt Apple-besked 0x${message.type.toString(16).padStart(2, "0")}`,
      length: message.length,
      payload: message.payload,
      truncated: message.truncated,
    };
    if (message.subtype !== undefined) entry.subtype = message.subtype;
    result.messages.push(entry);
    if (!result.types.includes(message.type)) result.types.push(message.type);

    const p = message.payload;
    try {
      switch (message.type) {
        case 0x01:
          result.overflow = true;
          break;
        case 0x02:
          result.ibeacon = decodeIBeacon(p);
          break;
        case 0x03:
          result.airprint = true;
          break;
        case 0x05:
          result.airdrop = true;
          break;
        case 0x06:
        case 0x11:
          result.homekit = true;
          break;
        case 0x07:
          result.proximityPairing = decodeProximityPairing(p, message.length);
          break;
        case 0x08:
          result.heySiri = decodeHeySiri(p);
          break;
        case 0x09:
          result.airplayTarget = true;
          break;
        case 0x0a:
          result.airplaySource = true;
          break;
        case 0x0b:
          result.magicSwitch = true;
          break;
        case 0x0c:
          result.handoff = decodeHandoff(p);
          break;
        case 0x0d:
          result.tetheringTarget = true;
          break;
        case 0x0e:
          result.tetheringSource = decodeTetheringSource(p);
          break;
        case 0x0f:
          result.nearbyAction = decodeNearbyAction(p);
          break;
        case 0x10:
          result.nearbyInfo = decodeNearbyInfo(p, message.length);
          break;
        case 0x12:
          result.findMy = decodeFindMy(p, message.length);
          break;
        default:
          break;
      }
    } catch {
      /* keep parsing the remaining messages */
    }
  }
  return result;
}

/** Device class announced by the device itself (Hey Siri or setup), if any. */
export function announcedClass(continuity) {
  return continuity?.heySiri?.deviceClass ?? continuity?.nearbyAction?.deviceClass ?? null;
}

/**
 * Soft fingerprint from fields that usually survive the ~15-minute address
 * rotation. Only used to pick a device up again when exactly one matches.
 */
export function stableFingerprint(continuity) {
  if (!continuity) return null;
  const ni = continuity.nearbyInfo;
  if (ni && ni.dataFlags !== null) return `ni:${ni.length}:${ni.statusFlags}:${ni.dataFlags}`;
  if (continuity.proximityPairing?.modelId) return `pp:${continuity.proximityPairing.modelId}`;
  if (continuity.findMy) return `fm:${continuity.findMy.variant}:${continuity.findMy.deviceType}`;
  return null;
}

/**
 * Strong link keys: values that are seen on both the old and the new address
 * right around an address change (Nearby Info auth tag, Handoff counter+data).
 */
export function linkKeys(continuity) {
  const keys = [];
  if (continuity?.nearbyInfo?.authTag) keys.push(`auth:${continuity.nearbyInfo.authTag}`);
  const handoff = continuity?.handoff;
  if (handoff?.data && /[^0]/.test(handoff.data)) keys.push(`handoff:${handoff.iv}:${handoff.data}`);
  return keys;
}
