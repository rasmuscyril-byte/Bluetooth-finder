// End-to-end test of the whole app in a real browser (Playwright + Chromium).
//
//   node tests/e2e/run-e2e.mjs
//
// Starts the Python bridge with a fake scanner, a plain static server and
// checks the bridge, demo, Web Bluetooth (mocked) and "unsupported" paths.
// Screenshots are written to tests/e2e/screenshots/.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shots = join(root, "tests", "e2e", "screenshots");
mkdirSync(shots, { recursive: true });

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("Playwright not found. Install it (npm i -D playwright) or set PLAYWRIGHT_MODULE.");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...options });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.output = () => output;
  return child;
}

const failures = [];
let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function watchErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

const { chromium } = await loadPlaywright();
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const bridgePort = await freePort();
const staticPort = await freePort();
const bridge = start(python, ["-m", "ipad_finder", "--fake-scanner", "--no-browser", "--port", String(bridgePort)]);
const statics = start(python, ["-m", "http.server", String(staticPort), "--bind", "127.0.0.1", "--directory", "web"]);
// GitHub Pages layout: the repository is served under /Bluetooth-finder/.
const pagesRoot = mkdtempSync(join(tmpdir(), "ipad-finder-pages-"));
symlinkSync(root, join(pagesRoot, "Bluetooth-finder"), "dir");
const pagesPort = await freePort();
const pages = start(python, ["-m", "http.server", String(pagesPort), "--bind", "127.0.0.1", "--directory", pagesRoot]);
const browser = await chromium.launch();

try {
  await waitFor(`http://127.0.0.1:${bridgePort}/api/status`);
  await waitFor(`http://127.0.0.1:${staticPort}/index.html`);
  await waitFor(`http://127.0.0.1:${pagesPort}/Bluetooth-finder/index.html`);

  // ---------------------------------------------------------------- bridge
  console.log("Bridge mode (fake scanner, phone-sized screen)");
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = watchErrors(page);
    await page.goto(`http://127.0.0.1:${bridgePort}/`);
    await page.waitForSelector(".device", { timeout: 10000 });
    await page.waitForTimeout(1200);
    check((await page.locator("#source-line").innerText()).includes("computerens Bluetooth"), "source line says the computer's Bluetooth is used");
    check((await page.locator("#status").getAttribute("data-state")) === "scanning", "status shows scanning");
    const labels = await page.locator(".device .label").allInnerTexts();
    check(labels.length === 3, `three candidate devices listed (got ${labels.length}: ${labels.join(", ")})`);
    check(labels[0] === "iPhone, iPad eller Mac", "strongest candidate first (the phone in your hand)");
    check(await noHorizontalScroll(page), "no horizontal scrolling at 390 px");
    await page.screenshot({ path: join(shots, "bridge-list.png"), fullPage: true });

    const ipadCard = page.locator('.device[data-id="AA:BB:CC:00:00:01"]');
    await ipadCard.locator('[data-action="identify"]').click();
    await page.waitForFunction(() => document.querySelector('.device[data-id="AA:BB:CC:00:00:01"] .identify-result')?.dataset.state === "ok", null, { timeout: 10000 });
    await page.waitForTimeout(400);
    check((await ipadCard.locator(".label").innerText()) === "iPad", "identify turns the card into an iPad");
    check((await ipadCard.locator(".badge").innerText()).toLowerCase() === "sikker", "identified iPad is marked as certain");
    check((await ipadCard.locator(".identify-result").innerText()).includes("iPad13,1"), "identify result shows the model number");
    check(await ipadCard.evaluate((el) => el.classList.contains("likely")), "identified iPad card is highlighted");

    const samsung = page.locator('.device[data-id="AA:BB:CC:00:00:04"]');
    await samsung.locator('[data-action="identify"]').click();
    await page.waitForFunction(() => document.querySelector('.device[data-id="AA:BB:CC:00:00:04"] .identify-result')?.dataset.state === "error", null, { timeout: 10000 });
    check((await samsung.locator(".identify-result").innerText()).includes("tillod ikke forbindelse"), "failed identify shows a Danish explanation");

    await page.locator('.device[data-id="AA:BB:CC:00:00:02"] [data-action="hide"]').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    check((await page.locator('.device[data-id="AA:BB:CC:00:00:02"]').count()) === 0, "hidden device disappears from the list");
    check((await page.locator("#toast").innerText()).includes("er skjult"), "hide toast names what was hidden");
    await page.locator("#toast .toast-action").click();
    await page.waitForTimeout(700);
    check((await page.locator('.device[data-id="AA:BB:CC:00:00:02"]').count()) === 1, "'Fortryd' brings a hidden device back");
    await page.locator('.device[data-id="AA:BB:CC:00:00:02"] [data-action="hide"]').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    check((await page.locator('[data-count="hidden"]').innerText()) === "1", "hidden counter shows 1");
    await page.locator("#show-hidden").check();
    await page.waitForTimeout(700);
    check((await page.locator('.device[data-id="AA:BB:CC:00:00:02"] [data-action="unhide"]').count()) === 1, "'Vis skjulte' shows it again with an unhide button");
    await page.locator("#show-hidden").uncheck();

    await page.locator('[data-filter="all"]').click();
    await page.waitForTimeout(700);
    check((await page.locator(".device").count()) === 4, "the 'Alle' tab lists every visible device");
    check((await page.locator(".device .label").allInnerTexts()).includes("AirPods Pro"), "AirPods are recognised by model");
    await page.locator('[data-filter="candidates"]').click();
    await page.waitForTimeout(500);

    // A resting mouse must not freeze the "strongest first" order.
    const firstCard = page.locator(".device").first();
    const box = await firstCard.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.evaluate(() => {
      const t = Date.now();
      window.ipadFinder.tracker.ingestMany(
        Array.from({ length: 12 }, (_, i) => ({ id: "ZZ:ZZ:ZZ:00:00:99", rssi: -30, name: "Galaxy S24", manufacturerData: {}, serviceData: {}, serviceUuids: [], t: t + i })),
      );
    });
    await page.waitForTimeout(4500);
    check((await page.locator(".device").first().getAttribute("data-id")) === "ZZ:ZZ:ZZ:00:00:99", "list re-sorts even while the mouse rests on it");
    await page.mouse.move(0, 0);

    await ipadCard.locator('[data-action="follow"]').click();
    await page.waitForSelector("#follow:not([hidden])");
    await page.waitForTimeout(2500);
    check((await page.locator("#follow-title").innerText()).includes("iPad"), "follow view shows the iPad");
    check(/dBm/.test(await page.locator("#follow-dbm").innerText()), "follow view shows dBm");
    check((await page.locator("#gauge-fill").getAttribute("stroke-dasharray")) !== "0 100", "gauge is filled");
    check((await page.locator("#spark-line").getAttribute("points")).split(" ").length > 3, "sparkline has points");
    check((await page.locator("#follow-peak").innerText()).startsWith("Bedst"), "peak-hold readout is shown");
    await page.locator("#sound-btn").click();
    check((await page.locator("#sound-btn").getAttribute("aria-pressed")) === "true", "sound can be switched on");
    await page.screenshot({ path: join(shots, "bridge-follow.png") });
    // Keyboard focus must stay inside the follow view.
    let escaped = false;
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press(i % 2 ? "Tab" : "Shift+Tab");
      if (!(await page.evaluate(() => document.getElementById("follow").contains(document.activeElement) || document.activeElement === document.body))) escaped = true;
    }
    check(!escaped, "Tab never leaves the follow view (background is inert)");
    check(await page.evaluate(() => document.querySelector("main").inert === true), "the list behind the follow view is inert");
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(await page.locator("#follow").isHidden(), "Escape closes the follow view");
    check(await page.evaluate(() => document.querySelector("main").inert === false), "the list is usable again after closing");

    await page.locator("#help-btn").click();
    check(await page.locator("#help-dialog").isVisible(), "help dialog opens");
    check((await page.evaluate(() => document.getElementById("help-dialog").scrollTop)) === 0, "help dialog opens at the top");
    check((await page.evaluate(() => document.activeElement?.id)) === "help-title", "help dialog focuses its title");
    await page.screenshot({ path: join(shots, "help.png") });
    await page.locator('#help-dialog button[value="close"]').click();

    await page.locator("#tip-dismiss").click();
    await page.reload();
    await page.waitForSelector(".device", { timeout: 10000 });
    check(await page.locator("#findmy-tip").isHidden(), "dismissed Find My tip stays hidden after reload");
    check((await page.locator('[data-count="hidden"]').innerText()) === "1", "hidden devices are remembered after reload");
    check(errors.length === 0, `no console errors in bridge mode (${errors.join(" | ")})`);
    await page.close();
  }

  // ---------------------------------------------------------------- demo, desktop, light + dark
  for (const colorScheme of ["light", "dark"]) {
    console.log(`Demo mode (desktop, ${colorScheme})`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme });
    const errors = watchErrors(page);
    await page.goto(`http://127.0.0.1:${bridgePort}/?demo`);
    await page.waitForSelector(".device");
    await page.waitForTimeout(3500);
    check((await page.locator("#source-line").innerText()).startsWith("DEMO"), "demo banner is shown");
    check((await page.locator(".device").count()) >= 3, "demo shows candidate devices");
    await page.screenshot({ path: join(shots, `demo-list-${colorScheme}.png`), fullPage: true });
    await page.locator(".device").nth(1).locator('[data-action="follow"]').click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(shots, `demo-follow-${colorScheme}.png`) });
    check(errors.length === 0, `no console errors in demo (${colorScheme}) (${errors.join(" | ")})`);
    await page.close();
  }

  // ---------------------------------------------------------------- narrow phone
  console.log("Demo mode (360 px)");
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
    await page.goto(`http://127.0.0.1:${bridgePort}/?demo`);
    await page.waitForSelector(".device");
    await page.waitForTimeout(1500);
    check(await noHorizontalScroll(page), "no horizontal scrolling at 360 px (list)");
    check(
      await page.evaluate(() => {
        const el = document.querySelector(".segmented");
        return el.scrollWidth <= el.clientWidth + 1;
      }),
      "filter buttons fit at 360 px",
    );
    // Keyboard focus survives the list re-sorting underneath it.
    await page.locator('[data-filter="all"]').click();
    await page.locator('.device [data-action="hide"]').last().focus();
    const focusedId = await page.evaluate(() => document.activeElement.closest(".device").dataset.id);
    await page.waitForTimeout(5000);
    check(
      (await page.evaluate(() => document.activeElement?.closest?.(".device")?.dataset.id)) === focusedId,
      "focus stays on the same card while the list updates",
    );
    await page.locator('[data-filter="candidates"]').click();
    await page.locator('.device [data-action="follow"]').first().click();
    await page.waitForTimeout(800);
    check(await noHorizontalScroll(page), "no horizontal scrolling at 360 px (follow view)");
    await page.screenshot({ path: join(shots, "demo-follow-360.png") });
    await page.close();
  }

  // ---------------------------------------------------------------- opened as a file
  console.log("Opened directly from disk (file://)");
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`file://${join(root, "web", "index.html")}`);
    await page.waitForTimeout(3500);
    check(await page.locator("#boot-fallback").isVisible(), "file:// shows how to start the program instead of a dead page");
    check((await page.evaluate(() => getComputedStyle(document.getElementById("boot-fallback")).opacity)) === "1", "file:// fallback is fully visible");
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${bridgePort}/`);
    await page.waitForTimeout(3000);
    check((await page.locator("#boot-fallback").count()) === 0, "the fallback message is removed when the app starts");
    await page.close();
  }

  // ---------------------------------------------------------------- unsupported browser
  console.log("Plain static hosting without Web Bluetooth");
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = watchErrors(page);
    await page.goto(`http://127.0.0.1:${staticPort}/index.html`);
    await page.waitForSelector("#unsupported-panel:not([hidden])", { timeout: 8000 });
    check(true, "unsupported panel is shown when neither bridge nor Web Bluetooth is available");
    await page.screenshot({ path: join(shots, "unsupported.png"), fullPage: true });
    await page.locator("#demo-btn").click();
    await page.waitForSelector(".device", { timeout: 8000 });
    check(await page.locator("#unsupported-panel").isHidden(), "'Prøv demo' starts the demo");
    // 404 for /api/status is expected here; only count real errors.
    const real = errors.filter((text) => !text.includes("404"));
    check(real.length === 0, `no console errors on static hosting (${real.join(" | ")})`);
    await page.close();
  }

  // ---------------------------------------------------------------- Web Bluetooth (mocked)
  console.log("Web Bluetooth scanning (mocked navigator.bluetooth)");
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      const target = new EventTarget();
      const view = (hex) => new DataView(new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16))).buffer);
      window.__scanStarts = 0;
      target.requestLEScan = async (options) => {
        window.__scanOptions = options;
        window.__scanStarts += 1;
        const scan = { active: true, stop() { this.active = false; } };
        window.__stopMockScan = () => {
          scan.active = false;
        };
        let i = 0;
        setInterval(() => {
          if (!scan.active) return;
          i += 1;
          const event = new Event("advertisementreceived");
          Object.assign(event, {
            device: { id: "webbt-device-1", name: null },
            rssi: -60 - (i % 5),
            txPower: null,
            name: null,
            manufacturerData: new Map([[0x004c, view("10051318a1b2c3")]]),
            serviceData: new Map(),
            uuids: [],
          });
          target.dispatchEvent(event);
        }, 100);
        return scan;
      };
      Object.defineProperty(navigator, "bluetooth", { value: target, configurable: true });
    });
    await page.goto(`http://127.0.0.1:${staticPort}/index.html`);
    await page.waitForSelector("#start-panel:not([hidden])", { timeout: 8000 });
    await page.locator("#start-btn").click();
    await page.waitForSelector(".device", { timeout: 8000 });
    check((await page.locator("#source-line").innerText()).includes("browserens Bluetooth"), "Web Bluetooth source is used");
    check((await page.evaluate(() => window.__scanOptions?.acceptAllAdvertisements)) === true, "requestLEScan asked for all adverts");
    check((await page.locator(".device").count()) === 1, "the mocked device is listed");
    check((await page.locator('.device [data-action="identify"]').isHidden()), "identify is hidden without the computer program");
    // Chrome stops the scan when the screen turns off: the follow view must offer a restart.
    await page.locator('.device [data-action="follow"]').first().click();
    await page.evaluate(() => {
      window.__stopMockScan();
    });
    await page.waitForSelector("#follow-restart:not([hidden])", { timeout: 5000 });
    check(true, "follow view offers 'Fortsæt scanning' when the scan was stopped");
    await page.locator("#follow-restart-btn").click();
    await page.waitForTimeout(1500);
    check(await page.locator("#follow-restart").isHidden(), "'Fortsæt scanning' restarts the scan");
    check((await page.evaluate(() => window.__scanStarts)) === 2, "requestLEScan was called again");
    const real = errors.filter((text) => !text.includes("404"));
    check(real.length === 0, `no console errors with Web Bluetooth (${real.join(" | ")})`);
    await page.close();
  }
  // ---------------------------------------------------------------- the phone (GitHub Pages)
  // Playwright changes navigator.userAgent but not the client hints, so fake
  // navigator.userAgentData the way the real browser reports it.
  const fakeClientHints = (context, brands) =>
    context.addInitScript((brandList) => {
      const value = brandList ? { brands: brandList.map((brand) => ({ brand, version: "129" })), mobile: true, platform: "Android" } : undefined;
      Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => value, configurable: true });
    }, brands);
  const CHROME_BRANDS = ["Google Chrome", "Chromium", "Not=A?Brand"];
  const ANDROID_CHROME_UA =
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
  console.log("Phone: Android Chrome on the GitHub Pages address");
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: ANDROID_CHROME_UA,
      isMobile: true,
      hasTouch: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await fakeClientHints(context, CHROME_BRANDS);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`http://127.0.0.1:${pagesPort}/Bluetooth-finder/`);
    await page.waitForURL(/\/Bluetooth-finder\/web\/$/, { timeout: 8000 });
    check(true, "the Pages address opens the app in web/");
    await page.waitForSelector('#unsupported-panel [data-platform="android-chrome"]:not([hidden])', { timeout: 8000 });
    check(true, "Android Chrome without the flag gets the step-by-step Chrome guide");
    check(await page.locator('#unsupported-panel [data-platform="ios"]').isHidden(), "the iPhone text is not shown on Android");
    await page.locator('[data-copy="flag-url"]').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(clip === "chrome://flags/#enable-experimental-web-platform-features", "'Kopiér' copies the chrome://flags address");
    check(await noHorizontalScroll(page), "no horizontal scrolling in the Chrome guide");
    await page.screenshot({ path: join(shots, "phone-android-guide.png"), fullPage: true });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      event.prompt = () => {};
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(event);
    });
    await page.waitForTimeout(200);
    check(await page.locator("#install-btn").isVisible(), "the Installér button appears when Chrome offers installation");
    check(
      (await page.evaluate(() => document.getElementById("status-text").getBoundingClientRect().width)) >= 80,
      "the status stays readable next to the install button at 360 px",
    );
    await page.setViewportSize({ width: 390, height: 844 });

    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      const json = await (await fetch(href)).json();
      const icons = await Promise.all(json.icons.map(async (icon) => (await fetch(new URL(icon.src, href))).status));
      return { json, icons };
    });
    check(manifest.json.display === "standalone" && manifest.json.lang === "da", "web app manifest is valid");
    check(manifest.icons.every((status) => status === 200), "all app icons load");
    const real = errors.filter((text) => !text.includes("404"));
    check(real.length === 0, `no console errors on the phone (${real.join(" | ")})`);
    await context.close();
  }

  console.log("Phone: scanning available, installable, works offline");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_CHROME_UA, isMobile: true, hasTouch: true });
    await fakeClientHints(context, CHROME_BRANDS);
    await context.addInitScript(() => {
      const target = new EventTarget();
      target.requestLEScan = async () => {
        setInterval(() => {
          const event = new Event("advertisementreceived");
          Object.assign(event, {
            device: { id: "phone-device-1", name: null },
            rssi: -64,
            manufacturerData: new Map([[0x004c, new DataView(new Uint8Array([0x10, 0x05, 0x13, 0x18, 1, 2, 3]).buffer)]]),
            serviceData: new Map(),
            uuids: [],
          });
          target.dispatchEvent(event);
        }, 150);
        return { active: true, stop() { this.active = false; } };
      };
      Object.defineProperty(navigator, "bluetooth", { value: target, configurable: true });
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    const appUrl = `http://127.0.0.1:${pagesPort}/Bluetooth-finder/web/?sw`;
    await page.goto(appUrl);
    await page.waitForSelector("#start-panel:not([hidden])", { timeout: 8000 });
    check((await page.locator("#start-panel").innerText()).includes("Enheder i nærheden"), "start panel explains the Android permission");
    await page.locator("#start-btn").click();
    await page.waitForSelector(".device", { timeout: 8000 });
    check((await page.locator(".device .label").first().innerText()) === "iPhone, iPad eller Mac", "scanning on the phone lists the iPad candidate");
    await page.screenshot({ path: join(shots, "phone-scanning.png"), fullPage: true });

    const swReady = await page.evaluate(async () => {
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
      return Boolean(registration?.active);
    });
    check(swReady, "the service worker is installed (offline support)");
    await page.reload();
    await page.waitForTimeout(1000);
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector("#start-panel:not([hidden])", { timeout: 8000 });
    check(true, "the app still opens without a network connection");
    await context.setOffline(false);
    const real = errors.filter((text) => !text.includes("404") && !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(text));
    check(real.length === 0, `no console errors while scanning on the phone (${real.join(" | ")})`);
    await context.close();
  }

  console.log("Phone: Chrome lacks the Android 'Nearby devices' permission");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_CHROME_UA, isMobile: true, hasTouch: true });
    await fakeClientHints(context, CHROME_BRANDS);
    await context.addInitScript(() => {
      const target = new EventTarget();
      let granted = false;
      window.__requestDeviceCalls = 0;
      target.requestDevice = async () => {
        window.__requestDeviceCalls += 1;
        granted = true; // the user tapped the permission link in Chrome's chooser
        throw Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" });
      };
      target.requestLEScan = async () => {
        if (!granted) throw Object.assign(new Error("Bluetooth adapter not available."), { name: "NotFoundError" });
        setInterval(() => {
          const event = new Event("advertisementreceived");
          const apple = new DataView(new Uint8Array([0x10, 0x05, 0x13, 0x18, 9, 9, 9]).buffer);
          Object.assign(event, { device: { id: "perm-device" }, rssi: -60, manufacturerData: new Map([[0x004c, apple]]), serviceData: new Map(), uuids: [] });
          target.dispatchEvent(event);
        }, 150);
        return { active: true, stop() { this.active = false; } };
      };
      Object.defineProperty(navigator, "bluetooth", { value: target, configurable: true });
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`http://127.0.0.1:${pagesPort}/Bluetooth-finder/web/`);
    await page.locator("#start-btn").click();
    await page.waitForSelector("#permission-help:not([hidden])", { timeout: 5000 });
    check(true, "a missing permission shows the 'Giv Chrome adgang' help");
    check((await page.locator("#error-hint").innerText()).includes("NotFoundError"), "the technical error is shown for troubleshooting");
    await page.screenshot({ path: join(shots, "phone-permission.png"), fullPage: true });
    await page.locator("#permission-btn").click();
    await page.waitForTimeout(300);
    check((await page.evaluate(() => window.__requestDeviceCalls)) === 1, "the button opens Chrome's device chooser (requestDevice)");
    await page.locator("#start-btn").click();
    await page.waitForSelector(".device", { timeout: 5000 });
    check(await page.locator("#error-panel").isHidden(), "after granting, scanning starts and the error goes away");
    const real = errors.filter((text) => !text.includes("404"));
    check(real.length === 0, `no console errors in the permission flow (${real.join(" | ")})`);
    await context.close();
  }

  for (const [label, userAgent, kind, brands] of [
    ["Samsung Internet", "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "android-other", ["Samsung Internet", "Chromium"]],
    ["Messenger in-app browser", "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]", "android-other", ["Android WebView", "Chromium"]],
    ["iPhone Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "ios", null],
  ]) {
    console.log(`Phone: ${label}`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent, isMobile: true, hasTouch: true });
    await fakeClientHints(context, brands);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${pagesPort}/Bluetooth-finder/web/`);
    await page.waitForSelector(`#unsupported-panel [data-platform="${kind}"]:not([hidden])`, { timeout: 8000 });
    check(true, `${label} gets its own instructions`);
    if (kind === "android-other") {
      check((await page.locator("#page-url").innerText()).endsWith("/Bluetooth-finder/web/"), "the page address to open in Chrome is shown");
    }
    await page.screenshot({ path: join(shots, `phone-${label.replace(/\W+/g, "-").toLowerCase()}.png`), fullPage: true });
    await context.close();
  }
} catch (error) {
  failures.push(`Unexpected error: ${error.stack || error}`);
  console.error(error);
  console.error("Bridge output:\n" + bridge.output());
} finally {
  await browser.close();
  bridge.kill();
  statics.kill();
  pages.kill();
  rmSync(pagesRoot, { recursive: true, force: true });
}

console.log(`\n${checks - failures.length}/${checks} checks passed. Screenshots in ${shots}`);
if (failures.length) {
  console.error("Failures:\n- " + failures.join("\n- "));
  process.exit(1);
}
