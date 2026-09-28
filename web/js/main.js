// iPad-finder – wires a data source (Python bridge, Web Bluetooth or demo)
// to the tracker engine and the UI.

import { createBeeper } from "./audio.js";
import { Tracker } from "./engine/tracker.js";
import { createBridgeSource, detectBridge } from "./sources/bridge.js";
import { createDemoSource } from "./sources/demo.js";
import { detectPlatform } from "./platform.js";
import { createWebBluetoothSource, isWebBluetoothScanSupported } from "./sources/webbluetooth.js";
import { $, $$, setText, storage } from "./ui/dom.js";
import { createFollowView } from "./ui/follow.js";
import { createDeviceList } from "./ui/list.js";

const HIDDEN_KEY = "ipadfinder.hidden";
const TIP_KEY = "ipadfinder.tipDismissed";
const LIST_RENDER_MS = 250;
const NO_DEVICES_HELP_MS = 15000;

const STATUS_TEXT = {
  starting: "Starter …",
  scanning: "Scanner …",
  identifying: "Identificerer – scanning holder pause",
  error: "Fejl",
  unsupported: "Kan ikke scanne",
  idle: "Klar",
};

const SOURCE_TEXT = {
  bridge: "Bruger computerens Bluetooth",
  webbluetooth: "Bruger browserens Bluetooth (eksperimentel)",
  demo: "DEMO – enhederne er simulerede, ikke rigtige",
};

const state = {
  source: null,
  sourceStatus: { state: "idle", message: null },
  filter: "candidates",
  showHidden: false,
  followId: null,
  identify: new Map(),
  startedAt: Date.now(),
  lastListRender: 0,
  listDirty: true,
  forceSort: false,
};

const tracker = new Tracker();
tracker.setHiddenIds(storage.get(HIDDEN_KEY, []));
const beeper = createBeeper();
let wakeLock = null;

const list = createDeviceList($("#device-list"), {
  onFollow: startFollowing,
  onIdentify: identify,
  onHide: (id) => {
    const label = tracker.get(id)?.classification?.label || "Enheden";
    tracker.hide(id);
    saveHidden();
    showToast(`${label} er skjult.`, {
      action: "Fortryd",
      onAction: () => {
        tracker.unhide(id);
        saveHidden();
        markDirty(true);
      },
    });
    markDirty(true);
  },
  onUnhide: (id) => {
    tracker.unhide(id);
    saveHidden();
    markDirty(true);
  },
});

const follow = createFollowView($("#follow"), {
  onClose: stopFollowing,
  onStop: stopFollowing,
  onIdentify: () => state.followId && identify(state.followId),
  onSound: () => {
    const enabled = beeper.setEnabled(!beeper.enabled);
    follow.setSound(enabled);
    if (!enabled && !beeper.enabled) showToast("Lyden er slået fra.");
  },
});

tracker.on("reacquired", ({ fromId, toId, strong }) => {
  const previous = state.identify.get(fromId);
  if (strong && previous?.state === "ok" && !state.identify.has(toId)) state.identify.set(toId, previous);
  if (state.followId === fromId) {
    state.followId = toId;
    state.source?.setFollowed?.(toId);
  }
  showToast(
    strong
      ? "Fandt den igen – den har skiftet Bluetooth-adresse."
      : "Følger nu en enhed, der ligner den (den skiftede sandsynligvis Bluetooth-adresse).",
  );
  markDirty(true);
});

// ------------------------------------------------------------------ helpers

function saveHidden() {
  storage.set(HIDDEN_KEY, tracker.hiddenIds().slice(-500));
}

function markDirty(forceSort = false) {
  state.listDirty = true;
  if (forceSort) state.forceSort = true;
}

let toastTimer = null;
function showToast(text, { ms = 4000, action = null, onAction = null } = {}) {
  const toast = $("#toast");
  toast.textContent = "";
  toast.append(document.createTextNode(text));
  if (action && onAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn small toast-action";
    button.textContent = action;
    button.addEventListener("click", () => {
      onAction();
      toast.hidden = true;
    });
    toast.append(" ", button);
    ms = Math.max(ms, 7000);
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, ms);
}

function setStatus(status) {
  state.sourceStatus = status;
  renderStatus();
  if (!wantsWakeLock()) releaseWakeLock();
}

function renderStatus() {
  const { state: sourceState, message } = state.sourceStatus;
  const shown = sourceState;
  const statusEl = $("#status");
  statusEl.dataset.state = shown;
  setText($("#status-text"), shown === "error" && message ? message : STATUS_TEXT[shown] || shown);
  statusEl.title = message || "";

  const errorPanel = $("#error-panel");
  const showError = (sourceState === "error" || sourceState === "unsupported") && Boolean(message);
  errorPanel.hidden = !showError;
  if (showError) {
    setText($("#error-text"), message);
    setText($("#error-hint"), errorHint(message));
  }
}

function errorHint(message) {
  if (state.source?.kind !== "bridge") return "";
  if (/Bluetooth-programmet/.test(message)) return "Start programmet igen (start-windows.bat / start-mac.command), og genindlæs siden.";
  return "Jeg prøver automatisk igen hvert 5. sekund, så snart problemet er løst.";
}

// ------------------------------------------------------------------ sources

async function useSource(source, { autoStart = true } = {}) {
  state.source?.stop();
  state.source = source;
  tracker.clear();
  state.identify.clear();
  state.startedAt = Date.now();
  const line = $("#source-line");
  line.hidden = false;
  line.classList.toggle("demo", source.kind === "demo");
  setText(line, SOURCE_TEXT[source.kind]);
  $("#toolbar").hidden = false;
  $("#empty").hidden = false;
  markDirty(true);
  if (autoStart) {
    try {
      await source.start();
    } catch {
      /* status already reported through onStatus */
    }
  }
  renderStatus();
}

function onAdverts(adverts) {
  tracker.ingestMany(adverts);
  markDirty();
}

function makeSourceOptions() {
  return { onAdverts, onStatus: setStatus };
}

function startDemo() {
  $("#unsupported-panel").hidden = true;
  $("#start-panel").hidden = true;
  const source = createDemoSource(makeSourceOptions());
  useSource(source);
  return source;
}

async function chooseSource() {
  const params = new URLSearchParams(location.search);
  if (params.has("demo") || location.hash === "#demo") {
    startDemo();
    return;
  }
  if (await detectBridge()) {
    await useSource(createBridgeSource(makeSourceOptions()));
    return;
  }
  if (isWebBluetoothScanSupported()) {
    setStatus({ state: "idle", message: null });
    $("#start-panel").hidden = false;
    $("#start-btn").addEventListener("click", async () => {
      $("#start-panel").hidden = true;
      await useSource(createWebBluetoothSource(makeSourceOptions()));
      if (state.sourceStatus.state !== "scanning") $("#start-panel").hidden = false;
      else requestWakeLock(); // Android stops unfiltered scans when the screen turns off
    });
    return;
  }
  setStatus({ state: "unsupported", message: null });
  showUnsupported(detectPlatform());
}

function showUnsupported(platform) {
  const panel = $("#unsupported-panel");
  for (const variant of $$("[data-platform]", panel)) variant.hidden = variant.dataset.platform !== platform.kind;
  setText($("#page-url"), location.href.replace(/[?#].*$/, ""));
  panel.hidden = false;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or no permission: fall back to a temporary text field.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  }
}

for (const button of $$("[data-copy]")) {
  button.addEventListener("click", async () => {
    const text = document.getElementById(button.dataset.copy)?.textContent.trim() || "";
    const ok = await copyText(text);
    showToast(ok ? "Kopieret. Sæt den ind i adresselinjen i en ny fane." : "Kunne ikke kopiere – markér teksten og kopiér den selv.");
  });
}

// ------------------------------------------------------------------ identify

async function identify(id) {
  const source = state.source;
  if (!source?.supportsIdentify || typeof source.identify !== "function") return;
  if ([...state.identify.values()].some((entry) => entry.state === "pending")) return;
  state.identify.set(id, { state: "pending" });
  markDirty();
  const result = await source.identify(id);
  if (result?.ok) {
    const identity = { manufacturer: result.manufacturer ?? null, model: result.model ?? null, name: result.name ?? null };
    tracker.setIdentity(id, identity);
    state.identify.set(id, { state: "ok", identity });
  } else {
    state.identify.set(id, { state: "error", message: result?.error?.message || "Kunne ikke identificere enheden." });
  }
  markDirty(true);
}

// ------------------------------------------------------------------ follow

function wantsWakeLock() {
  // Android stops unfiltered scans when the screen turns off, so keep it on while scanning.
  const scanningInBrowser = state.source?.kind === "webbluetooth" && ["scanning", "starting"].includes(state.sourceStatus.state);
  return Boolean(state.followId) || scanningInBrowser;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible" && wantsWakeLock()) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener?.("release", () => {
        wakeLock = null;
      });
    }
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

function startFollowing(id) {
  if (!tracker.get(id)) return;
  state.followId = id;
  tracker.follow(id);
  state.source?.setFollowed?.(id);
  follow.setSound(beeper.enabled);
  follow.open();
  requestWakeLock();
  renderFollow();
}

function stopFollowing() {
  state.followId = null;
  tracker.unfollow();
  state.source?.setFollowed?.(null);
  beeper.setEnabled(false);
  beeper.setRssi(null);
  follow.setSound(false);
  follow.close();
  if (!wantsWakeLock()) releaseWakeLock();
  markDirty(true);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") requestWakeLock();
});

// ------------------------------------------------------------------ rendering

function renderList(now) {
  const devices = tracker.list({ filter: state.filter, includeHidden: state.showHidden });
  const identifyBusy = [...state.identify.values()].some((entry) => entry.state === "pending");
  list.render(devices, {
    now,
    hiddenIds: new Set(tracker.hiddenIds()),
    identify: state.identify,
    canIdentify: Boolean(state.source?.supportsIdentify),
    identifyBusy,
    forceSort: state.forceSort,
  });
  state.forceSort = false;

  const counts = tracker.counts();
  for (const el of $$("[data-count]")) setText(el, String(counts[el.dataset.count] ?? 0));

  const empty = $("#empty");
  const scanning = ["scanning", "starting", "identifying"].includes(state.sourceStatus.state);
  empty.hidden = devices.length > 0 || !state.source || state.sourceStatus.state === "unsupported";
  if (!empty.hidden) {
    const any = counts.all + counts.hidden > 0;
    let text = "Leder efter Bluetooth-enheder i nærheden …";
    if (!scanning) text = "Venter på Bluetooth …";
    else if (any && state.filter === "candidates") text = "Ingen mulige iPads eller telefoner endnu. Prøv fanen “Alle”, eller gå lidt rundt.";
    else if (any) text = "Ingen enheder i denne visning endnu.";
    setText($("#empty-text"), text);
    $("#empty-help").hidden = any || now - state.startedAt < NO_DEVICES_HELP_MS || !scanning;
    if (!$("#empty-help").hidden && !$("#empty-help").childElementCount) fillEmptyHelp();
  }
}

function fillEmptyHelp() {
  const help = $("#empty-help");
  const items =
    state.source?.kind === "webbluetooth"
      ? [
          "Er Bluetooth og Placering slået til på telefonen?",
          "Har du givet Chrome lov til at bruge Bluetooth og placering?",
          "Prøv at genindlæse siden og trykke Start igen.",
        ]
      : [
          "Er Bluetooth slået til på computeren?",
          "Mac: Har Terminal fået adgang under Systemindstillinger → Anonymitet og sikkerhed → Bluetooth?",
          "Linux: Kører Bluetooth-tjenesten? (sudo systemctl start bluetooth)",
          "Prøv at genstarte programmet.",
        ];
  const ul = document.createElement("ul");
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text;
    ul.append(li);
  }
  const heading = document.createElement("p");
  heading.textContent = "Der er ikke fundet nogen enheder endnu. Tjek:";
  help.append(heading, ul);
}

function renderFollow() {
  if (!state.followId || !follow.isOpen) return;
  const device = tracker.get(state.followId);
  if (!device) {
    stopFollowing();
    showToast("Enheden er ikke set i lang tid og blev fjernet fra listen.");
    return;
  }
  const identifyBusy = [...state.identify.values()].some((entry) => entry.state === "pending");
  const result = follow.update(device, {
    now: Date.now(),
    identify: state.identify,
    canIdentify: Boolean(state.source?.supportsIdentify),
    identifyBusy,
  });
  beeper.setRssi(result && !result.lost ? device.smoothed : null);
  // The list's restart prompt is hidden behind this view, so show it here too.
  $("#follow-restart").hidden = !(state.source?.kind === "webbluetooth" && state.source.needsRestart?.());
}

let lastFollowRender = 0;
function frame(time) {
  const now = Date.now();
  if (state.listDirty && now - state.lastListRender >= LIST_RENDER_MS && !follow.isOpen) {
    state.listDirty = false;
    state.lastListRender = now;
    renderList(now);
  }
  if (follow.isOpen && time - lastFollowRender >= 100) {
    lastFollowRender = time;
    renderFollow();
  }
  requestAnimationFrame(frame);
}

setInterval(() => {
  const { removed } = tracker.tick();
  for (const id of removed) state.identify.delete(id);
  markDirty();
  const source = state.source;
  $("#restart-panel").hidden = !(source?.kind === "webbluetooth" && source.needsRestart?.());
  if (document.hidden && state.followId) renderFollow(); // keep the beeper in sync in background tabs
}, 1000);

// ------------------------------------------------------------------ controls

function setFilter(filter) {
  state.filter = filter;
  for (const button of $$(".segmented [data-filter]")) {
    const checked = button.dataset.filter === filter;
    button.setAttribute("aria-checked", String(checked));
    button.tabIndex = checked ? 0 : -1;
  }
  markDirty(true);
}

for (const button of $$(".segmented [data-filter]")) {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
}

$(".segmented").addEventListener("keydown", (event) => {
  const buttons = $$(".segmented [data-filter]");
  const index = Math.max(0, buttons.indexOf(event.target.closest("[data-filter]")));
  const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 };
  if (!(event.key in moves)) return;
  const next = buttons[(moves[event.key] + buttons.length) % buttons.length];
  setFilter(next.dataset.filter);
  next.focus();
  event.preventDefault();
});
setFilter(state.filter);

$("#show-hidden").addEventListener("change", (event) => {
  state.showHidden = event.target.checked;
  markDirty(true);
});

function openHelp(sectionId = null) {
  const dialog = $("#help-dialog");
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  const target = (sectionId && document.getElementById(sectionId)) || $("#help-title");
  target.focus();
  if (!sectionId) dialog.scrollTop = 0;
  else target.scrollIntoView({ block: "start" });
}

$("#help-btn").addEventListener("click", () => openHelp());
for (const link of $$("[data-open-help]")) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openHelp(link.dataset.openHelp);
  });
}

$("#demo-btn").addEventListener("click", () => startDemo());

async function restartScan() {
  const source = state.source;
  if (!source) return;
  $("#restart-panel").hidden = true;
  $("#follow-restart").hidden = true;
  source.stop();
  try {
    await source.start(); // keeps the devices found so far
  } catch {
    /* reported through onStatus */
  }
  requestWakeLock();
}

$("#restart-btn").addEventListener("click", restartScan);
$("#follow-restart-btn").addEventListener("click", restartScan);

if (storage.get(TIP_KEY, false)) $("#findmy-tip").hidden = true;
$("#tip-dismiss").addEventListener("click", () => {
  $("#findmy-tip").hidden = true;
  storage.set(TIP_KEY, true);
});

// ------------------------------------------------------------------ install as an app

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#install-btn").hidden = false;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("#install-btn").hidden = true;
  showToast("iPad-finder ligger nu på din startskærm.");
});
$("#install-btn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try {
    await installPrompt.userChoice;
  } catch {
    /* ignore */
  }
  installPrompt = null;
  $("#install-btn").hidden = true;
});

function registerServiceWorker() {
  // Only for the web version (https). The computer program serves the page
  // over http://127.0.0.1 and must never get a cached copy in between.
  const forced = new URLSearchParams(location.search).has("sw");
  if (!("serviceWorker" in navigator) || (location.protocol !== "https:" && !forced)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {
    /* offline support is a bonus */
  });
}

// ------------------------------------------------------------------ go

window.__ipadFinderStarted = true;
$("#boot-fallback")?.remove();
registerServiceWorker();
renderStatus();
requestAnimationFrame(frame);
chooseSource();

// Handy for debugging in the console.
globalThis.ipadFinder = { tracker, state };
