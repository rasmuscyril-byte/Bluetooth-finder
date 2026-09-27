// Turns what we know about a device into a Danish label, an icon and a
// "could this be the lost iPad/phone?" verdict.

import { APPLE_COMPANY_ID, announcedClass } from "./apple.js";
import { companyInfo, serviceInfo } from "./vendors.js";

const MICROSOFT = 0x0006;

const ICONS = {
  ipad: "📱",
  iphone: "📱",
  "apple-mobile": "📱",
  "findmy-device": "📡",
  mac: "💻",
  "apple-watch": "⌚",
  airpods: "🎧",
  airtag: "🏷️",
  "apple-tv": "📺",
  homepod: "🔊",
  "apple-other": "🍏",
  android: "📱",
  samsung: "📱",
  "samsung-offline": "📡",
  phone: "📱",
  tablet: "📱",
  headphones: "🎧",
  wearable: "⌚",
  computer: "💻",
  beacon: "📍",
  tracker: "🏷️",
  tv: "📺",
  printer: "🖨️",
  accessory: "🔌",
  unknown: "❔",
};

const PRIORITY = {
  ipad: 100,
  "findmy-device": 90,
  "samsung-offline": 60,
  "apple-mobile": 80,
  iphone: 70,
  tablet: 55,
  phone: 50,
  samsung: 45,
  android: 40,
};

const CANDIDATE_KINDS = new Set(["ipad", "iphone", "apple-mobile", "findmy-device", "phone", "tablet", "samsung", "samsung-offline", "android"]);

const CLASS_KINDS = {
  ipad: ["ipad", "iPad"],
  iphone: ["iphone", "iPhone"],
  ipod: ["iphone", "iPod touch"],
  mac: ["mac", "Mac"],
  watch: ["apple-watch", "Apple Watch"],
  homepod: ["homepod", "HomePod"],
  appletv: ["apple-tv", "Apple TV"],
};

const FIND_MY_BATTERY = { full: "fuldt", medium: "halvt", low: "lavt", critical: "meget lavt" };

function result(kind, label, { vendor = null, confidence = "mulig", details = [], candidate } = {}) {
  return {
    kind,
    label,
    icon: ICONS[kind] ?? ICONS.unknown,
    vendor,
    candidate: candidate ?? CANDIDATE_KINDS.has(kind),
    confidence,
    details: details.filter(Boolean),
    priority: PRIORITY[kind] ?? 10,
  };
}

function fromModel(model) {
  const m = String(model || "");
  if (/^iPad/i.test(m)) return ["ipad", "iPad"];
  if (/^iPhone/i.test(m)) return ["iphone", "iPhone"];
  if (/^iPod/i.test(m)) return ["iphone", "iPod touch"];
  if (/^Watch/i.test(m)) return ["apple-watch", "Apple Watch"];
  if (/^(Mac|iMac)/i.test(m)) return ["mac", "Mac"];
  if (/^AppleTV/i.test(m)) return ["apple-tv", "Apple TV"];
  if (/^AudioAccessory/i.test(m)) return ["homepod", "HomePod"];
  if (/AirPods/i.test(m)) return ["airpods", "AirPods"];
  return null;
}

function fromName(name, isApple) {
  const n = String(name || "").toLowerCase();
  if (!n) return null;
  // "Keyboard for iPad", "iPad Pro Case" … are accessories, not the iPad.
  const accessory = /keyboard|tastatur|case|cover|pencil|stylus|for ipad|til ipad|charger|oplader|magic/.test(n);
  if (n.includes("ipad") && !accessory) return ["ipad", "iPad"];
  if (n.includes("iphone") && !accessory) return ["iphone", "iPhone"];
  if (/macbook|imac|mac mini|mac studio|mac pro/.test(n)) return ["mac", "Mac"];
  if (n.includes("airpods")) return ["airpods", "AirPods"];
  if (n.includes("apple watch") || (isApple && n.includes("watch"))) return ["apple-watch", "Apple Watch"];
  if (accessory) return ["accessory", "Tilbehør"];
  // Specific product families first, brand names (galaxy, oppo …) last.
  if (/galaxy book|matebook|magicbook|chromebook|thinkpad|laptop|notebook/.test(n)) return ["computer", "Computer"];
  if (/galaxy tab|\btab s\d|tablet|\bpad\b|mediapad|matepad/.test(n)) return ["tablet", "Tablet"];
  if (/buds|headphone|earbuds|\benco\b|freebuds|\bjbl\b|bose|\bwh-|\bwf-|beats|jabra|sennheiser/.test(n)) {
    return ["headphones", "Høretelefoner"];
  }
  if (/watch|\bband\b|galaxy fit|galaxy ring|fitbit|garmin|forerunner|fenix|vivoactive|vivosmart|vivomove|\bvenu\b|amazfit|mi band/.test(n)) {
    return ["wearable", "Ur/fitness"];
  }
  if (/galaxy|pixel|oneplus|xiaomi|redmi|poco|huawei|honor|motorola|\bmoto\b|nokia|oppo|\bvivo\b|realme|nothing phone|xperia|\bphone\b/.test(n)) {
    return ["phone", "Telefon"];
  }
  if (/\btv\b|bravia|chromecast/.test(n)) return ["tv", "TV"];
  return null;
}

function continuityDetails(apple) {
  const details = [];
  if (!apple) return details;
  if (apple.nearbyInfo) details.push(apple.nearbyInfo.action.label);
  if (apple.tetheringSource) {
    const t = apple.tetheringSource;
    if (t.battery !== null) details.push(`Batteri ${t.battery} %`);
    details.push(`Mobildata ${t.cellLabel}${t.bars !== null ? ` (${t.bars}/4)` : ""}`);
  }
  if (apple.findMy) {
    details.push(apple.findMy.variant === "separated" ? "Find My-signal (uden internet eller meldt mistet)" : "Find My-signal");
    const battery = FIND_MY_BATTERY[apple.findMy.battery];
    if (battery) details.push(`Batteri ${battery}`);
  }
  if (apple.heySiri) details.push("Reagerede på “Hej Siri”");
  if (apple.handoff) details.push("Handoff aktiv");
  if (apple.airdrop) details.push("AirDrop åben");
  if (apple.nearbyAction?.label) details.push(apple.nearbyAction.label);
  if (apple.overflow) details.push("App i baggrunden");
  return details;
}

function classifyApple(apple, extraDetails, hintClass) {
  const vendor = "Apple";
  const details = [...extraDetails, ...continuityDetails(apple)];
  const announced = hintClass ?? announcedClass(apple);
  if (announced && CLASS_KINDS[announced]) {
    const [kind, label] = CLASS_KINDS[announced];
    return result(kind, label, { vendor, confidence: "sandsynlig", details });
  }
  if (!apple) return result("apple-other", "Apple-enhed", { vendor, details });

  if (apple.proximityPairing) {
    const model = apple.proximityPairing.model;
    return result("airpods", model ?? "AirPods/Beats", { vendor, confidence: model ? "sandsynlig" : "mulig", details });
  }
  if (apple.findMy) {
    const type = apple.findMy.deviceType;
    if (type === "airtag") return result("airtag", "AirTag", { vendor, confidence: "sandsynlig", details });
    if (type === "airpods") return result("airpods", "AirPods (Find My)", { vendor, confidence: "sandsynlig", details });
    if (type === "accessory") return result("tracker", "Find My-tilbehør (AirTag 2, nyere AirPods o.l.)", { vendor, confidence: "sandsynlig", details });
    return result("findmy-device", "iPhone, iPad eller Mac uden internet (Find My)", { vendor, confidence: "mulig", details });
  }
  if (apple.magicSwitch) return result("apple-watch", "Apple Watch", { vendor, confidence: "sandsynlig", details });
  if (apple.tetheringSource) {
    return result("apple-mobile", "iPhone eller iPad med mobildata", {
      vendor,
      details: [...details, "Hører til dit Apple-ID (svarede på Wi-Fi-indstillinger)"],
    });
  }
  if (apple.nearbyInfo || apple.handoff || apple.airdrop) {
    return result("apple-mobile", "iPhone, iPad eller Mac", { vendor, details });
  }
  if (apple.airplayTarget) return result("apple-tv", "Apple TV, HomePod eller Mac (AirPlay)", { vendor, details });
  if (apple.ibeacon) return result("beacon", "iBeacon", { vendor, details });
  if (apple.airprint) return result("printer", "Printer (AirPrint)", { vendor: null, details });
  if (apple.homekit) return result("accessory", "HomeKit-tilbehør", { vendor: null, details });
  if (apple.overflow) {
    return result("apple-mobile", "iPhone eller iPad (app i baggrunden)", { vendor, details, candidate: true });
  }
  return result("apple-other", "Apple-enhed", { vendor, details });
}

function companyLabel(info) {
  switch (info.kind) {
    case "phone":
      return ["phone", `${info.name}-enhed`];
    case "headphones":
      return ["headphones", `${info.name} (lyd)`];
    case "wearable":
      return ["wearable", `${info.name} (ur/fitness)`];
    case "computer":
      return ["computer", info.name === "Microsoft" ? "Windows-pc eller Microsoft-enhed" : `${info.name}-enhed`];
    case "tracker":
      return ["tracker", `${info.name}-tracker`];
    case "tv":
      return ["tv", `${info.name}-enhed`];
    default:
      return null;
  }
}

/**
 * input = { name, companyIds, apple, microsoft, serviceUuids16, identity, hints }
 * hints.deviceClass: a class the device announced earlier (sticky across adverts)
 */
export function classify(input = {}) {
  const { name = null, companyIds = [], apple = null, microsoft = null, serviceUuids16 = [], identity = null, hints = null } = input;
  const isApple = companyIds.includes(APPLE_COMPANY_ID) || Boolean(apple);
  const extra = [];

  // 1. The device told us its model over GATT: that settles it.
  const byModel = identity?.model ? fromModel(identity.model) : null;
  if (byModel) {
    const [kind, label] = byModel;
    const details = [`Model ${identity.model}`, ...continuityDetails(apple)];
    if (identity.name) details.unshift(`“${identity.name}”`);
    return result(kind, label, { vendor: "Apple", confidence: "sikker", details });
  }
  if (identity?.model) extra.push(`Model ${identity.model}`);
  if (identity?.name) extra.push(`“${identity.name}”`);

  // 2. Names (advertised or from GATT).
  const byName = fromName(identity?.name || name, isApple);
  if (byName) {
    const [kind, label] = byName;
    const vendor = isApple ? "Apple" : companyInfo(companyIds.find((id) => companyInfo(id)))?.name ?? null;
    return result(kind, label, { vendor, confidence: "sandsynlig", details: [...extra, ...continuityDetails(apple)] });
  }

  // 3. Apple Continuity.
  if (isApple) return classifyApple(apple, extra, hints?.deviceClass ?? null);

  // 4. Other manufacturers. Microsoft's CDP beacon names the device type.
  if (microsoft?.device) {
    const { kind, label } = microsoft.device;
    return result(kind, label, { vendor: "Microsoft", confidence: "sandsynlig", details: extra });
  }
  if (microsoft?.scenario === "swiftPair") {
    return result("accessory", "Tilbehør klar til parring (Swift Pair)", { vendor: "Microsoft", details: extra });
  }
  if (serviceUuids16.includes(0xfd69)) {
    return result("samsung-offline", "Samsung-telefon/tablet uden internet (Find My Mobile)", { vendor: "Samsung", details: extra });
  }
  if (companyIds.includes(0x0075)) {
    return result("samsung", "Samsung-enhed (telefon, tablet, ur eller høretelefoner)", { vendor: "Samsung", details: extra });
  }
  if (companyIds.includes(0x00e0)) {
    return result("android", "Google/Android-enhed", { vendor: "Google", details: extra });
  }
  for (const id of companyIds) {
    const info = companyInfo(id);
    const mapped = info && companyLabel(info);
    if (mapped) return result(mapped[0], mapped[1], { vendor: info.name, details: extra });
  }

  // 5. Service UUIDs.
  for (const uuid of serviceUuids16) {
    const info = serviceInfo(uuid);
    if (!info?.kind) continue;
    const kind = info.kind === "other" ? "accessory" : info.kind;
    return result(kind, info.name, { details: extra });
  }

  const vendorId = companyIds.find((id) => companyInfo(id));
  const vendor = vendorId !== undefined ? companyInfo(vendorId).name : null;
  return result("unknown", vendor ? `Ukendt enhed (${vendor})` : "Ukendt enhed", { vendor, details: extra });
}
