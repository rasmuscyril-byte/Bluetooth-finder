// Which kind of device/browser is this? Used to show the right instructions.

import { isWebBluetoothScanSupported } from "./sources/webbluetooth.js";

const OTHER_CHROMIUM = /EdgA|Edg\/|OPR\/|Opera|SamsungBrowser|YaBrowser|Vivaldi|DuckDuckGo|Brave|MiuiBrowser|HuaweiBrowser|HeyTapBrowser|UCBrowser/i;
// Browsers built into other apps (Messenger, Facebook, Instagram, the Google app …).
// They are Android WebViews, which never support Web Bluetooth.
const IN_APP = /; wv\)|FB_IAB|FBAN|FBAV|Instagram|GSA\/|Line\/|Snapchat|musical_ly|TikTok/i;

export function detectPlatform(nav = globalThis.navigator) {
  const ua = nav?.userAgent || "";
  const uaData = nav?.userAgentData;
  const brands = (uaData?.brands || []).map((entry) => entry.brand);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1);
  const android = !ios && (/Android/i.test(ua) || uaData?.platform === "Android");
  const inApp = IN_APP.test(ua) || brands.includes("Android WebView");
  let chrome;
  if (brands.length) chrome = brands.includes("Google Chrome"); // client hints are exact
  else chrome = /Chrome\/\d+/.test(ua) && !OTHER_CHROMIUM.test(ua);
  // Brave's user agent looks exactly like Chrome's.
  chrome = chrome && !ios && !inApp && !nav?.brave;
  let kind = "desktop";
  if (ios) kind = "ios";
  else if (android) kind = chrome ? "android-chrome" : "android-other";
  return { kind, ios, android, chrome, inApp, scanning: isWebBluetoothScanSupported(nav) };
}
