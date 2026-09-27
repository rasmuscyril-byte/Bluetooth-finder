// Keeps track of every device seen: smoothing, history, classification, aging,
// and following one device – including picking it up again after an Apple
// device rotates its random Bluetooth address.

import { APPLE_COMPANY_ID, announcedClass, linkKeys, parseContinuity, stableFingerprint } from "./apple.js";
import { hexToBytes, uuid16 } from "./bytes.js";
import { classify } from "./classify.js";
import { RssiFilter } from "./signal.js";
import { parseMicrosoftBeacon } from "./vendors.js";

const MICROSOFT_COMPANY_ID = 0x0006;

const MAX_DEVICES = 1500;
const MAX_LINK_KEYS = 24;

function validRssi(rssi) {
  // 127 means "not available" in the HCI spec; 0 is reported by some stacks when unknown.
  return Number.isFinite(rssi) && rssi < 0 && rssi > -127;
}

export class Tracker {
  constructor({
    staleMs = 10000,
    forgetMs = 5 * 60 * 1000,
    historyMs = 120000,
    reacquireAfterMs = 8000,
    now = () => Date.now(),
  } = {}) {
    this.staleMs = staleMs;
    this.forgetMs = forgetMs;
    this.historyMs = historyMs;
    this.reacquireAfterMs = reacquireAfterMs;
    this.now = now;
    this._devices = new Map();
    this._filters = new Map();
    this._hidden = new Set();
    this._followedId = null;
    this._listeners = new Map();
  }

  // ---------------------------------------------------------------- ingest

  ingest(raw) {
    if (!raw || typeof raw.id !== "string" || !raw.id || !validRssi(raw.rssi)) return null;
    const t = Number.isFinite(raw.t) ? raw.t : this.now();
    let device = this._devices.get(raw.id);
    if (!device) {
      device = this._create(raw, t);
    }

    if (device.lastSeen !== null && t > device.lastSeen) {
      const gap = t - device.lastSeen;
      if (gap < 30000) {
        device.advIntervalMs = device.advIntervalMs === null ? gap : Math.round(device.advIntervalMs * 0.8 + gap * 0.2);
      }
    }
    device.lastSeen = Math.max(device.lastSeen ?? t, t);
    device.count += 1;
    device.rssi = raw.rssi;
    device.stale = false;
    if (raw.name) device.name = raw.name;
    if (raw.address) device.address = raw.address;
    if (Number.isFinite(raw.txPower)) device.txPower = raw.txPower;

    const filter = this._filters.get(device.id);
    device.smoothed = filter.update(raw.rssi, t);
    device.history.push({ t, rssi: raw.rssi, smoothed: device.smoothed });
    const cutoff = t - this.historyMs;
    let drop = 0;
    while (drop < device.history.length && device.history[drop].t < cutoff) drop++;
    if (drop) device.history.splice(0, drop);

    this._updateData(device, raw);
    return device;
  }

  ingestMany(raws) {
    for (const raw of raws || []) this.ingest(raw);
  }

  _create(raw, t) {
    if (this._devices.size >= MAX_DEVICES) this._evictOldest();
    const device = {
      id: raw.id,
      address: raw.address ?? null,
      name: raw.name ?? null,
      firstSeen: t,
      lastSeen: null,
      count: 0,
      rssi: null,
      smoothed: null,
      txPower: null,
      history: [],
      companyIds: [],
      manufacturerData: {},
      serviceUuids: [],
      apple: null,
      microsoft: null,
      classification: null,
      identity: null,
      stale: false,
      fingerprint: null,
      linkKeys: [],
      hints: { deviceClass: null },
      previousIds: [],
      advIntervalMs: null,
      _dataKey: null,
    };
    this._devices.set(raw.id, device);
    this._filters.set(raw.id, new RssiFilter());
    return device;
  }

  _evictOldest() {
    let oldest = null;
    for (const device of this._devices.values()) {
      if (device.id === this._followedId) continue;
      if (!oldest || device.lastSeen < oldest.lastSeen) oldest = device;
    }
    if (oldest) this._remove(oldest.id);
  }

  _updateData(device, raw) {
    const manufacturerData = raw.manufacturerData && typeof raw.manufacturerData === "object" ? raw.manufacturerData : {};
    const serviceUuids = Array.isArray(raw.serviceUuids) ? raw.serviceUuids : [];
    const dataKey = JSON.stringify([manufacturerData, serviceUuids, device.name]);
    if (dataKey === device._dataKey && device.classification) return;
    device._dataKey = dataKey;

    // Some platforms deliver scan responses separately and without manufacturer
    // data; keep what we already know instead of forgetting it.
    if (Object.keys(manufacturerData).length) device.manufacturerData = { ...manufacturerData };
    for (const uuid of serviceUuids) {
      if (!device.serviceUuids.includes(uuid)) device.serviceUuids.push(uuid);
    }
    device.companyIds = Object.keys(device.manufacturerData)
      .map((key) => Number(key))
      .filter((id) => Number.isInteger(id));

    const microsoftHex = device.manufacturerData[String(MICROSOFT_COMPANY_ID)];
    if (microsoftHex !== undefined) device.microsoft = parseMicrosoftBeacon(hexToBytes(microsoftHex));

    const appleHex = device.manufacturerData[String(APPLE_COMPANY_ID)];
    if (appleHex !== undefined) {
      device.apple = parseContinuity(hexToBytes(appleHex));
      device.fingerprint = stableFingerprint(device.apple) ?? device.fingerprint;
      const announced = announcedClass(device.apple);
      if (announced) device.hints.deviceClass = announced;
      for (const key of linkKeys(device.apple)) {
        if (!device.linkKeys.includes(key)) device.linkKeys.push(key);
      }
      if (device.linkKeys.length > MAX_LINK_KEYS) device.linkKeys.splice(0, device.linkKeys.length - MAX_LINK_KEYS);
    }
    this._classify(device);
  }

  _classify(device) {
    device.classification = classify({
      name: device.name,
      companyIds: device.companyIds,
      apple: device.apple,
      microsoft: device.microsoft,
      serviceUuids16: device.serviceUuids.map(uuid16).filter((value) => value !== null),
      identity: device.identity,
      hints: device.hints,
    });
  }

  // ---------------------------------------------------------------- aging

  tick(now = this.now()) {
    const removed = [];
    for (const device of this._devices.values()) {
      const age = now - device.lastSeen;
      device.stale = age > this.staleMs;
      if (age > this.forgetMs && device.id !== this._followedId) removed.push(device.id);
    }
    for (const id of removed) this._remove(id);
    const reacquired = this._reacquire(now);
    return { removed, reacquired };
  }

  _remove(id) {
    this._devices.delete(id);
    this._filters.delete(id);
  }

  _reacquire(now) {
    const followed = this._followedId ? this._devices.get(this._followedId) : null;
    if (!followed || !(followed.fingerprint || followed.linkKeys.length)) return null;
    if (now - followed.lastSeen <= this.reacquireAfterMs) return null;
    const fresh = [];
    for (const device of this._devices.values()) {
      if (device.id === followed.id || device.stale) continue;
      if (this._hidden.has(device.id)) continue;
      if (device.firstSeen < followed.lastSeen - 3000) continue;
      fresh.push(device);
    }
    // Strong: the new address repeated a Nearby Info auth tag or Handoff data
    // that we last heard from the old address.
    const followedKeys = new Set(followed.linkKeys);
    let candidates = fresh.filter((device) => device.linkKeys.some((key) => followedKeys.has(key)));
    // Soft: same stable fields and a similar signal level – only if unique.
    if (candidates.length === 0 && followed.fingerprint) {
      candidates = fresh.filter(
        (device) => device.fingerprint === followed.fingerprint && Math.abs(device.smoothed - followed.smoothed) <= 20,
      );
    }
    if (candidates.length !== 1) return null;
    const next = candidates[0];
    next.previousIds = [...followed.previousIds, followed.id].slice(-20);
    if (!next.hints.deviceClass && followed.hints.deviceClass) next.hints.deviceClass = followed.hints.deviceClass;
    if (followed.identity && !next.identity) next.identity = followed.identity;
    this._classify(next);
    this._followedId = next.id;
    const event = { fromId: followed.id, toId: next.id };
    this._emit("reacquired", event);
    return event;
  }

  // ---------------------------------------------------------------- queries

  get(id) {
    return this._devices.get(id);
  }

  _matches(device, filter) {
    if (filter === "all") return true;
    if (filter === "apple") return device.companyIds.includes(APPLE_COMPANY_ID) || device.classification?.vendor === "Apple";
    return Boolean(device.classification?.candidate);
  }

  list({ filter = "candidates", includeHidden = false } = {}) {
    const result = [];
    for (const device of this._devices.values()) {
      if (!includeHidden && this._hidden.has(device.id)) continue;
      if (!this._matches(device, filter)) continue;
      result.push(device);
    }
    result.sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? 1 : -1;
      if (a.smoothed !== b.smoothed) return (b.smoothed ?? -999) - (a.smoothed ?? -999);
      return (b.classification?.priority ?? 0) - (a.classification?.priority ?? 0);
    });
    return result;
  }

  counts() {
    const counts = { candidates: 0, apple: 0, all: 0, hidden: 0 };
    for (const device of this._devices.values()) {
      if (this._hidden.has(device.id)) {
        counts.hidden += 1;
        continue;
      }
      counts.all += 1;
      if (this._matches(device, "apple")) counts.apple += 1;
      if (this._matches(device, "candidates")) counts.candidates += 1;
    }
    return counts;
  }

  // ---------------------------------------------------------------- follow / hide / identity

  get followedId() {
    return this._followedId;
  }

  follow(id) {
    this._followedId = this._devices.has(id) ? id : null;
    return this._followedId;
  }

  unfollow() {
    this._followedId = null;
  }

  hide(id) {
    this._hidden.add(id);
    if (this._followedId === id) this._followedId = null;
  }

  unhide(id) {
    this._hidden.delete(id);
  }

  isHidden(id) {
    return this._hidden.has(id);
  }

  hiddenIds() {
    return [...this._hidden];
  }

  setHiddenIds(ids) {
    this._hidden = new Set((ids || []).filter((id) => typeof id === "string"));
  }

  setIdentity(id, identity) {
    const device = this._devices.get(id);
    if (!device) return null;
    device.identity = identity ? { manufacturer: identity.manufacturer ?? null, model: identity.model ?? null, name: identity.name ?? null } : null;
    this._classify(device);
    return device;
  }

  clear() {
    this._devices.clear();
    this._filters.clear();
    this._followedId = null;
  }

  // ---------------------------------------------------------------- events

  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(callback);
    return () => this._listeners.get(event)?.delete(callback);
  }

  _emit(event, payload) {
    for (const callback of this._listeners.get(event) ?? []) {
      try {
        callback(payload);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
