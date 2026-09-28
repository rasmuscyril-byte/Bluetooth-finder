import assert from "node:assert/strict";
import { test } from "node:test";

import { detectPlatform } from "../../web/js/platform.js";

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

test("detects the platform from the user agent", () => {
  assert.equal(detectPlatform({ userAgent: UA.androidChrome }).kind, "android-chrome");
  assert.equal(detectPlatform({ userAgent: UA.samsungInternet }).kind, "android-other");
  assert.equal(detectPlatform({ userAgent: UA.androidFirefox }).kind, "android-other");
  assert.equal(detectPlatform({ userAgent: UA.iphone }).kind, "ios");
  assert.equal(detectPlatform({ userAgent: UA.iphoneChrome }).kind, "ios");
  assert.equal(detectPlatform({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 }).kind, "ios");
  assert.equal(detectPlatform({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 0 }).kind, "desktop");
  assert.equal(detectPlatform({ userAgent: UA.windowsChrome }).kind, "desktop");
  assert.equal(detectPlatform(undefined).kind, "desktop");
});

test("client hints are used when present", () => {
  const nav = { userAgent: "Mozilla/5.0", userAgentData: { platform: "Android", brands: [{ brand: "Google Chrome", version: "129" }] } };
  assert.equal(detectPlatform(nav).kind, "android-chrome");
});

test("reports whether Web Bluetooth scanning is available", () => {
  assert.equal(detectPlatform({ userAgent: UA.androidChrome }).scanning, false);
  const nav = { userAgent: UA.androidChrome, bluetooth: { requestLEScan() {} } };
  assert.equal(detectPlatform(nav).scanning, true);
});
