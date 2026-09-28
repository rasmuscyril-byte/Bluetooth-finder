// Which kind of device/browser is this? Used to show the right instructions.

import { isWebBluetoothScanSupported } from "./sources/webbluetooth.js";

const OTHER_CHROMIUM = /EdgA|Edg\/|OPR\/|Opera|SamsungBrowser|YaBrowser|Vivaldi|DuckDuckGo|Brave|MiuiBrowser|HuaweiBrowser|UCBrowser/i;

export function detectPlatform(nav = globalThis.navigator) {
  const ua = nav?.userAgent || "";
  const uaData = nav?.userAgentData;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1);
  const android = !ios && (/Android/i.test(ua) || uaData?.platform === "Android");
  const brands = (uaData?.brands || []).map((entry) => entry.brand);
  const chrome = !ios && (brands.includes("Google Chrome") || (/Chrome\/\d+/.test(ua) && !OTHER_CHROMIUM.test(ua)));
  let kind = "desktop";
  if (ios) kind = "ios";
  else if (android) kind = chrome ? "android-chrome" : "android-other";
  return { kind, ios, android, chrome, scanning: isWebBluetoothScanSupported(nav) };
}
