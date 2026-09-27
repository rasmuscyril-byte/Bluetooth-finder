// Bluetooth SIG company identifiers and 16-bit service UUIDs that help tell
// devices apart (Bluetooth SIG assigned numbers: company_identifiers.yaml and
// member_uuids.yaml).
//
// `kind` is a hint for classify.js: phone | headphones | wearable | computer |
// tracker | tv | chip | other.

export const COMPANIES = new Map([
  [0x0001, { name: "Nokia", kind: "phone" }],
  [0x0002, { name: "Intel", kind: "chip" }],
  [0x0006, { name: "Microsoft", kind: "computer" }],
  [0x0008, { name: "Motorola", kind: "phone" }],
  [0x000a, { name: "Qualcomm", kind: "chip" }],
  [0x000d, { name: "Texas Instruments", kind: "chip" }],
  [0x000f, { name: "Broadcom", kind: "chip" }],
  [0x0046, { name: "MediaTek", kind: "chip" }],
  [0x004c, { name: "Apple", kind: "apple" }],
  [0x0055, { name: "Plantronics", kind: "headphones" }],
  [0x0057, { name: "Harman (JBL)", kind: "headphones" }],
  [0x0059, { name: "Nordic Semiconductor", kind: "chip" }],
  [0x005d, { name: "Realtek", kind: "chip" }],
  [0x0067, { name: "Jabra (GN)", kind: "headphones" }],
  [0x006b, { name: "Polar", kind: "wearable" }],
  [0x0075, { name: "Samsung", kind: "phone" }],
  [0x0078, { name: "Nike", kind: "wearable" }],
  [0x0082, { name: "Sennheiser", kind: "headphones" }],
  [0x0087, { name: "Garmin", kind: "wearable" }],
  [0x0089, { name: "GN Hearing", kind: "headphones" }],
  [0x0094, { name: "Airoha", kind: "chip" }],
  [0x009e, { name: "Bose", kind: "headphones" }],
  [0x009f, { name: "Suunto", kind: "wearable" }],
  [0x00c4, { name: "LG", kind: "tv" }],
  [0x00cc, { name: "Beats", kind: "headphones" }],
  [0x00d7, { name: "Qualcomm", kind: "chip" }],
  [0x00e0, { name: "Google", kind: "phone" }],
  [0x0103, { name: "Bang & Olufsen", kind: "headphones" }],
  [0x012d, { name: "Sony", kind: "headphones" }],
  [0x0131, { name: "Cypress", kind: "chip" }],
  [0x0157, { name: "Amazfit (Huami)", kind: "wearable" }],
  [0x0171, { name: "Amazon", kind: "other" }],
  [0x018e, { name: "Google (Fitbit)", kind: "wearable" }],
  [0x01ab, { name: "Meta", kind: "other" }],
  [0x01da, { name: "Logitech", kind: "computer" }],
  [0x0211, { name: "Telink", kind: "chip" }],
  [0x022b, { name: "Tesla", kind: "other" }],
  [0x027d, { name: "Huawei", kind: "phone" }],
  [0x02b0, { name: "Bestechnic", kind: "chip" }],
  [0x02b2, { name: "Oura", kind: "wearable" }],
  [0x02c5, { name: "Lenovo", kind: "computer" }],
  [0x02e5, { name: "Espressif", kind: "chip" }],
  [0x02ed, { name: "HTC", kind: "phone" }],
  [0x02ff, { name: "Silicon Labs", kind: "chip" }],
  [0x0304, { name: "Oura", kind: "wearable" }],
  [0x0381, { name: "Sharp", kind: "phone" }],
  [0x038f, { name: "Xiaomi", kind: "phone" }],
  [0x0397, { name: "LEGO", kind: "other" }],
  [0x03e0, { name: "Actions", kind: "chip" }],
  [0x03ff, { name: "Withings", kind: "wearable" }],
  [0x0494, { name: "Sennheiser", kind: "headphones" }],
  [0x0499, { name: "Ruuvi", kind: "other" }],
  [0x0553, { name: "Nintendo", kind: "tv" }],
  [0x058e, { name: "Meta", kind: "other" }],
  [0x05a7, { name: "Sonos", kind: "headphones" }],
  [0x0642, { name: "Bluetrum", kind: "chip" }],
  [0x065a, { name: "Marshall", kind: "headphones" }],
  [0x067c, { name: "Tile", kind: "tracker" }],
  [0x072f, { name: "OnePlus", kind: "phone" }],
  [0x075a, { name: "Harman", kind: "headphones" }],
  [0x079a, { name: "Oppo", kind: "phone" }],
  [0x07c9, { name: "Skullcandy", kind: "headphones" }],
  [0x07e3, { name: "Airoha", kind: "chip" }],
  [0x0837, { name: "vivo", kind: "phone" }],
  [0x08a4, { name: "Realme", kind: "phone" }],
  [0x08c3, { name: "Chipolo", kind: "tracker" }],
  [0x0942, { name: "Transsion", kind: "phone" }],
  [0x0958, { name: "ZTE", kind: "phone" }],
  [0x09c6, { name: "Honor", kind: "phone" }],
  [0x0bc6, { name: "TCL", kind: "phone" }],
  [0x0cc2, { name: "Anker", kind: "headphones" }],
  [0x0cc3, { name: "HMD (Nokia)", kind: "phone" }],
  [0x0ccb, { name: "Nothing", kind: "phone" }],
  [0x0e41, { name: "Asus", kind: "phone" }],
  [0x10ca, { name: "Fairphone", kind: "phone" }],
]);

export function companyInfo(id) {
  return COMPANIES.get(id) ?? null;
}

export function companyName(id) {
  return COMPANIES.get(id)?.name ?? null;
}

// 16-bit service UUIDs seen in adverts. `candidate` marks services that are
// typically sent by phones/tablets themselves.
export const SERVICES = new Map([
  [0x180d, { name: "Pulsmåler", kind: "wearable" }],
  [0x1812, { name: "Tastatur/mus", kind: "computer" }],
  [0xfcb2, { name: "Tracker (DULT)", kind: "tracker" }],
  [0xfcf7, { name: "Honor-telefon", kind: "phone" }],
  [0xfcf8, { name: "Honor-telefon", kind: "phone" }],
  [0xfd5a, { name: "Samsung SmartTag", kind: "tracker" }],
  [0xfd5f, { name: "Meta-enhed", kind: "other" }],
  [0xfd69, { name: "Samsung-enhed uden internet (Find My Mobile)", kind: "samsung-offline" }],
  [0xfd6f, { name: "Telefon med smitte-app", kind: "phone" }],
  [0xfd70, { name: "Oppo-telefon", kind: "phone" }],
  [0xfd84, { name: "Tile-tracker", kind: "tracker" }],
  [0xfdd2, { name: "Bose (lyd)", kind: "headphones" }],
  [0xfe00, { name: "Amazon-enhed (fx Echo)", kind: "other" }],
  [0xfe03, { name: "Amazon-enhed (fx Echo)", kind: "other" }],
  [0xfe07, { name: "Sonos-højttaler", kind: "headphones" }],
  [0xfe08, { name: "Microsoft-enhed", kind: "computer" }],
  [0xfe15, { name: "Amazon-enhed (fx Echo)", kind: "other" }],
  [0xfe1f, { name: "Garmin (ur/fitness)", kind: "wearable" }],
  [0xfe21, { name: "Bose (lyd)", kind: "headphones" }],
  [0xfe2c, { name: "Bluetooth-tilbehør (Google Fast Pair)", kind: "headphones" }],
  [0xfe33, { name: "Chipolo-tracker", kind: "tracker" }],
  [0xfe35, { name: "Huawei-enhed", kind: "phone" }],
  [0xfe36, { name: "Huawei-enhed", kind: "phone" }],
  [0xfe86, { name: "Huawei-enhed", kind: "phone" }],
  [0xfe95, { name: "Xiaomi-enhed", kind: "other" }],
  [0xfe9f, { name: "Google-enhed", kind: "other" }],
  [0xfeaa, { name: "Google Find Hub/Eddystone-signal", kind: "beacon" }],
  [0xfeb2, { name: "Microsoft-enhed", kind: "computer" }],
  [0xfeb7, { name: "Meta-enhed", kind: "other" }],
  [0xfeb8, { name: "Meta-enhed", kind: "other" }],
  [0xfebe, { name: "Bose (lyd)", kind: "headphones" }],
  [0xfec7, { name: "Apple-tjeneste", kind: "other" }],
  [0xfee0, { name: "Amazfit (ur/fitness)", kind: "wearable" }],
  [0xfeec, { name: "Tile-tracker", kind: "tracker" }],
  [0xfeed, { name: "Tile-tracker", kind: "tracker" }],
  [0xfef3, { name: "Android-telefon (Quick Share/Nearby)", kind: "android" }],
]);

export function serviceInfo(id) {
  return SERVICES.get(id) ?? null;
}

// Microsoft beacons (company 0x0006). CDP = Connected Devices Platform,
// sent by Windows PCs and by phones/tablets running Microsoft apps.
const CDP_DEVICE_TYPES = new Map([
  [1, { kind: "tv", label: "Xbox" }],
  [6, { kind: "iphone", label: "iPhone" }],
  [7, { kind: "ipad", label: "iPad" }],
  [8, { kind: "android", label: "Android-enhed" }],
  [9, { kind: "computer", label: "Windows-pc" }],
  [11, { kind: "phone", label: "Windows-telefon" }],
  [12, { kind: "computer", label: "Linux-pc" }],
  [13, { kind: "computer", label: "Windows IoT-enhed" }],
  [14, { kind: "computer", label: "Surface Hub" }],
]);

/** Decode Microsoft manufacturer data (bytes after company id 0x0006). */
export function parseMicrosoftBeacon(bytes) {
  if (!bytes || bytes.length < 1) return null;
  if (bytes[0] === 0x03) return { scenario: "swiftPair", deviceType: null, device: null };
  if (bytes[0] === 0x01 && bytes.length >= 2) {
    const deviceType = bytes[1] & 0x1f;
    return { scenario: "cdp", deviceType, device: CDP_DEVICE_TYPES.get(deviceType) ?? null };
  }
  return { scenario: null, deviceType: null, device: null };
}
