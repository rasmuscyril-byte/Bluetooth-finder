// Data source: simulated devices, so the app can be tried without Bluetooth.
// All payloads are realistic and decode with the real parser.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexBytes(random, count) {
  let out = "";
  for (let i = 0; i < count; i++) out += Math.floor(random() * 256).toString(16).padStart(2, "0");
  return out;
}

function gaussian(random) {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Device blueprints. `payload(state)` returns manufacturer data (company id → hex). */
function blueprints(random) {
  const airpodsEnc = hexBytes(random, 16);
  const airtagKey = hexBytes(random, 22);
  return [
    {
      key: "ipad",
      base: -82,
      rate: 2,
      rotateEveryMs: 120000,
      identify: { manufacturer: "Apple Inc.", model: "iPad13,1", name: "iPad" },
      // Nearby Info: status 0x1, action 0x3 (locked), data flags 0x18 (auth tag present), 3-byte auth tag.
      payload: (s) => ({ 76: `10051318${s.tag}` }),
    },
    {
      key: "iphone",
      base: -42,
      rate: 4,
      identify: { manufacturer: "Apple Inc.", model: "iPhone15,2", name: "iPhone" },
      // Handoff + Nearby Info (action 0xB = in use).
      payload: (s) => ({ 76: `0c0e00${s.handoff}` + `10051b1c${s.tag}` }),
    },
    {
      key: "airpods",
      base: -68,
      rate: 3,
      // Proximity Pairing, prefix 0x01, model 0x0E20 (AirPods Pro), 25-byte payload.
      payload: () => ({ 76: `0719010e205598b8310000${airpodsEnc}` }),
    },
    {
      key: "mac",
      base: -87,
      rate: 1.5,
      identify: { manufacturer: "Apple Inc.", model: "MacBookAir10,1", name: null },
      payload: (s) => ({ 76: `1005011c${s.tag}` }),
    },
    {
      key: "airtag",
      base: -84,
      rate: 0.5,
      // Find My, separated (25 bytes): status 0x10 = AirTag, battery full.
      payload: () => ({ 76: `121910${airtagKey}0100` }),
    },
    {
      key: "samsung",
      base: -79,
      rate: 1,
      name: "Galaxy S23",
      payload: () => ({ 117: "42040180603fd1a2b3c4d5e6f7" }),
    },
    {
      key: "windows",
      base: -86,
      rate: 1,
      payload: () => ({ 6: "0109200255aa66bb77cc88dd99ee00ff" }),
    },
    {
      key: "garmin",
      base: -74,
      rate: 1,
      name: "Forerunner 255",
      payload: () => ({ 135: "0a01ff00" }),
    },
    {
      key: "unknown",
      base: -93,
      rate: 0.7,
      payload: () => ({}),
    },
  ];
}

export function createDemoSource({ onAdverts, onStatus, seed = 42, now = () => Date.now(), intervalMs = 200, identifyDelayMs = 1200 } = {}) {
  const random = mulberry32(seed);
  const devices = blueprints(random).map((blueprint, index) => ({
    ...blueprint,
    generation: 1,
    rssi: blueprint.base,
    target: blueprint.base,
    tag: hexBytes(random, 3),
    oldTag: null,
    ids: new Set([`demo-${blueprint.key}`]),
    handoffIv: 40 + index,
    handoffData: hexBytes(random, 11),
    lastRotation: null,
  }));
  let followedId = null;
  let timer = null;

  function idOf(device) {
    return device.generation === 1 ? `demo-${device.key}` : `demo-${device.key}-${device.generation}`;
  }

  function step(t, dtMs = intervalMs) {
    const adverts = [];
    for (const device of devices) {
      if (device.lastRotation === null) device.lastRotation = t;
      if (device.rotateEveryMs && t - device.lastRotation >= device.rotateEveryMs) {
        // New random address. Like real iOS, the first advert from the new
        // address still carries the old Nearby Info auth tag.
        device.generation += 1;
        device.lastRotation = t;
        device.oldTag = device.tag;
        device.tag = hexBytes(random, 3);
        device.ids.add(idOf(device));
      }
      // The physical device doesn't move when its address changes.
      const followed = followedId !== null && device.ids.has(followedId);
      // Walking towards the followed device makes it slowly get "warmer".
      const goal = followed ? -44 : device.base;
      device.target += (goal - device.target) * (followed ? 0.012 : 0.05) * (dtMs / 200);
      device.rssi = device.target + gaussian(random) * 3.5;

      if (random() > device.rate * (dtMs / 1000)) continue;
      if (random() < 0.08) continue; // dropped packets
      const tag = device.oldTag ?? device.tag;
      device.oldTag = null;
      if (device.key === "iphone" && random() < 0.05) device.handoffIv += 1;
      const handoff = (device.handoffIv & 0xff).toString(16).padStart(2, "0") + ((device.handoffIv >> 8) & 0xff).toString(16).padStart(2, "0") + device.handoffData;
      adverts.push({
        id: idOf(device),
        address: null,
        rssi: Math.max(-100, Math.min(-30, Math.round(device.rssi))),
        name: device.name ?? null,
        txPower: null,
        manufacturerData: device.payload({ tag, handoff }),
        serviceData: {},
        serviceUuids: [],
        t,
      });
    }
    return adverts;
  }

  return {
    kind: "demo",
    supportsIdentify: true,

    async start() {
      if (timer) return;
      onStatus?.({ state: "scanning", message: null });
      timer = setInterval(() => {
        const adverts = step(now());
        if (adverts.length) onAdverts?.(adverts);
      }, intervalMs);
    },

    stop() {
      clearInterval(timer);
      timer = null;
    },

    setFollowed(id) {
      followedId = id;
    },

    async identify(id) {
      await new Promise((resolve) => setTimeout(resolve, identifyDelayMs));
      const device = devices.find((candidate) => idOf(candidate) === id);
      if (!device) {
        return { ok: false, id, error: { code: "not_found", message: "Enheden er ikke set for nylig." } };
      }
      if (!device.identify) {
        return { ok: false, id, error: { code: "connect_failed", message: "Enheden tillod ikke forbindelse. Det er helt normalt for mange enheder." } };
      }
      return { ok: true, id, ...device.identify };
    },

    /** For tests: advance the simulation one step at time t. */
    _step: step,
  };
}
