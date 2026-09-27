// iPad-finder – wires a data source (Python bridge, Web Bluetooth or demo)
// to the tracker engine and the UI.

import { createBeeper } from "./audio.js";
import { Tracker } from "./engine/tracker.js";
import { createBridgeSource, detectBridge } from "./sources/bridge.js";
import { createDemoSource } from "./sources/demo.js";
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
  paused: "På pause",
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
  paused: false,
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
    tracker.hide(id);
    saveHidden();
    showToast("Skjult. Du kan finde den igen under “Vis skjulte”.");
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

tracker.on("reacquired", ({ fromId, toId }) => {
  const previous = state.identify.get(fromId);
  if (previous && !state.identify.has(toId)) state.identify.set(toId, previous);
  if (state.followId === fromId) state.followId = toId;
  showToast("Fandt den igen – den har skiftet Bluetooth-adresse.");
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
function showToast(text, ms = 3500) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, ms);
}

function setStatus(status) {
  state.sourceStatus = status;
  renderStatus();
}

function renderStatus() {
  const { state: sourceState, message } = state.sourceStatus;
  const shown = state.paused && sourceState === "scanning" ? "paused" : sourceState;
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
  const pauseButton = $("#pause-btn");
  pauseButton.hidden = !state.source || sourceState === "unsupported";
  pauseButton.dataset.paused = String(state.paused);
  pauseButton.setAttribute("aria-label", state.paused ? "Fortsæt scanning" : "Sæt scanning på pause");
  pauseButton.title = pauseButton.getAttribute("aria-label");
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
  if (state.paused) return;
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
    });
    return;
  }
  setStatus({ state: "unsupported", message: null });
  $("#unsupported-panel").hidden = false;
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

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible") {
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
  releaseWakeLock();
  markDirty(true);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.followId) requestWakeLock();
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
    if (state.paused) text = "Scanningen er sat på pause.";
    else if (!scanning) text = "Venter på Bluetooth …";
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
  tracker.tick();
  markDirty();
  if (document.hidden && state.followId) renderFollow(); // keep the beeper in sync in background tabs
}, 1000);

// ------------------------------------------------------------------ controls

function setFilter(filter) {
  state.filter = filter;
  for (const button of $$(".segmented [data-filter]")) {
    button.setAttribute("aria-checked", String(button.dataset.filter === filter));
  }
  markDirty(true);
}

for (const button of $$(".segmented [data-filter]")) {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
}

$(".segmented").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  const buttons = $$(".segmented [data-filter]");
  const index = buttons.findIndex((button) => button.dataset.filter === state.filter);
  const next = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
  setFilter(next.dataset.filter);
  next.focus();
  event.preventDefault();
});

$("#show-hidden").addEventListener("change", (event) => {
  state.showHidden = event.target.checked;
  markDirty(true);
});

$("#pause-btn").addEventListener("click", () => {
  state.paused = !state.paused;
  renderStatus();
  markDirty();
});

$("#help-btn").addEventListener("click", () => {
  const dialog = $("#help-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
});

$("#demo-btn").addEventListener("click", () => startDemo());

if (storage.get(TIP_KEY, false)) $("#findmy-tip").hidden = true;
$("#tip-dismiss").addEventListener("click", () => {
  $("#findmy-tip").hidden = true;
  storage.set(TIP_KEY, true);
});

// ------------------------------------------------------------------ go

renderStatus();
requestAnimationFrame(frame);
chooseSource();

// Handy for debugging in the console.
globalThis.ipadFinder = { tracker, state };
