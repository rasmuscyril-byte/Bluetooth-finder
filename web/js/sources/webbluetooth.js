// Data source: the experimental Web Bluetooth Scanning API
// (navigator.bluetooth.requestLEScan). Chrome only, behind the flag
// chrome://flags/#enable-experimental-web-platform-features.

import { dataViewToHex, normalizeUuid } from "../engine/bytes.js";

export const UNSUPPORTED_MESSAGE =
  "Denne browser kan ikke scanne efter Bluetooth-signaler. Brug Chrome og slå " +
  "'Experimental Web Platform features' til under chrome://flags – eller brug programmet på en computer.";

export function isWebBluetoothScanSupported(nav = globalThis.navigator) {
  return Boolean(nav?.bluetooth && typeof nav.bluetooth.requestLEScan === "function");
}

function mapToObject(map, keyFn) {
  const result = {};
  if (!map || typeof map.forEach !== "function") return result;
  map.forEach((value, key) => {
    try {
      result[keyFn(key)] = dataViewToHex(value);
    } catch {
      /* skip odd entries */
    }
  });
  return result;
}

/** Convert a BluetoothAdvertisingEvent into a RawAdvert. */
export function advertisementEventToRaw(event, now = Date.now()) {
  const device = event?.device;
  const id = device?.id;
  if (!id) return null;
  const rssi = Number.isFinite(event.rssi) ? event.rssi : null;
  return {
    id,
    address: null,
    rssi,
    name: event.name || device.name || null,
    txPower: Number.isFinite(event.txPower) ? event.txPower : null,
    manufacturerData: mapToObject(event.manufacturerData, (key) => String(Number(key))),
    serviceData: mapToObject(event.serviceData, (key) => normalizeUuid(key)),
    serviceUuids: Array.from(new Set((event.uuids || []).map((uuid) => normalizeUuid(uuid)))).sort(),
    t: now,
  };
}

function describeError(error) {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Scanning blev ikke tilladt. Giv siden adgang til Bluetooth og prøv igen (siden skal åbnes via https).";
  }
  if (name === "NotFoundError" || name === "NotSupportedError") {
    return "Telefonens Bluetooth er slået fra eller kan ikke bruges. Slå Bluetooth (og placering) til og prøv igen.";
  }
  if (name === "InvalidStateError") {
    return "Bluetooth er optaget. Luk andre sider, der bruger Bluetooth, og prøv igen.";
  }
  return `Scanning kunne ikke starte: ${error?.message || name || "ukendt fejl"}`;
}

export function createWebBluetoothSource({ onAdverts, onStatus, batchMs = 250, nav = globalThis.navigator }) {
  let scan = null;
  let pending = [];
  let timer = null;
  let handler = null;

  function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    onAdverts(batch);
  }

  function cleanup() {
    if (handler) nav?.bluetooth?.removeEventListener?.("advertisementreceived", handler);
    handler = null;
    if (timer) clearInterval(timer);
    timer = null;
    pending = [];
  }

  return {
    kind: "webbluetooth",
    supportsIdentify: false,

    /** Must be called from a user gesture (click). */
    async start() {
      if (!isWebBluetoothScanSupported(nav)) {
        onStatus({ state: "unsupported", message: UNSUPPORTED_MESSAGE });
        throw new Error("unsupported");
      }
      if (scan?.active) return;
      onStatus({ state: "starting", message: null });
      handler = (event) => {
        const raw = advertisementEventToRaw(event);
        if (raw) pending.push(raw);
        if (pending.length > 4000) pending.splice(0, pending.length - 4000);
      };
      nav.bluetooth.addEventListener("advertisementreceived", handler);
      try {
        scan = await nav.bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
      } catch (error) {
        cleanup();
        onStatus({ state: "error", message: describeError(error) });
        throw error;
      }
      timer = setInterval(flush, batchMs);
      onStatus({ state: "scanning", message: null });
    },

    stop() {
      try {
        if (scan?.active) scan.stop();
      } catch {
        /* ignore */
      }
      scan = null;
      cleanup();
    },
  };
}
