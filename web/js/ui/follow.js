// The "Find den" view: a big hot/cold gauge, trend, sparkline and warnings.

import { estimateDistance, heat, proximity, trend } from "../engine/signal.js";
import { $, formatAgo, formatDbm, setText, shortId } from "./dom.js";
import { identifyText } from "./list.js";

const SPARK_WINDOW_MS = 60000;
const LOST_AFTER_MS = 8000;
const ANNOUNCE_EVERY_MS = 3000;
const PEAK_WINDOW_MS = 5000;

export function createFollowView(root, { onClose, onStop, onIdentify, onSound }) {
  const els = {
    title: $("#follow-title", root),
    sub: $("#follow-sub", root),
    fill: $("#gauge-fill", root),
    needle: $("#gauge-needle", root),
    level: $("#follow-level", root),
    dbm: $("#follow-dbm", root),
    hint: $("#follow-hint", root),
    trend: $("#follow-trend", root),
    seen: $("#follow-seen", root),
    peak: $("#follow-peak", root),
    spark: $("#spark-line", root),
    warning: $("#follow-warning", root),
    sound: $("#sound-btn", root),
    identify: $("#follow-identify-btn", root),
    identifyResult: $("#follow-identify-result", root),
    live: document.getElementById("sr-live"),
  };
  let lastAnnounced = { level: null, t: 0 };
  let returnFocus = null;

  $("#follow-close", root).addEventListener("click", () => onClose());
  $("#stop-btn", root).addEventListener("click", () => onStop());
  els.sound.addEventListener("click", () => onSound());
  els.identify.addEventListener("click", () => onIdentify());
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") onClose();
  });

  function open() {
    returnFocus = document.activeElement;
    root.hidden = false;
    document.body.style.overflow = "hidden";
    lastAnnounced = { level: null, t: 0 };
    $("#follow-close", root).focus();
  }

  function close() {
    root.hidden = true;
    document.body.style.overflow = "";
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  function setSound(enabled) {
    els.sound.setAttribute("aria-pressed", String(enabled));
    els.sound.textContent = enabled ? "🔊 Lyd er slået til" : "🔈 Slå lyd til";
  }

  function sparkPoints(history, now) {
    const start = now - SPARK_WINDOW_MS;
    return history
      .filter((sample) => sample.t >= start && Number.isFinite(sample.smoothed))
      .map((sample) => {
        const x = ((sample.t - start) / SPARK_WINDOW_MS) * 300;
        const clamped = Math.min(-30, Math.max(-100, sample.smoothed));
        const y = 70 - ((clamped + 100) / 70) * 70;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  function update(device, ctx) {
    if (!device) return;
    const c = device.classification || {};
    const now = ctx.now;
    const age = now - device.lastSeen;
    const lost = age > LOST_AFTER_MS;
    const smoothed = device.smoothed;
    const level = proximity(smoothed);
    const h = lost ? 0 : heat(smoothed);

    setText(els.title, `${c.icon || "📡"} ${c.label || "Ukendt enhed"}`);
    const sub = [...(c.details || [])];
    if (device.name) sub.unshift(`"${device.name}"`);
    sub.push(`ID ${shortId(device.id)}`);
    setText(els.sub, sub.join(" · "));

    root.dataset.level = lost ? "0" : String(level.level);
    root.style.setProperty("--heat", String(h));
    els.fill.setAttribute("stroke-dasharray", `${(h * 100).toFixed(1)} 100`);
    els.needle.setAttribute("transform", `rotate(${(-90 + h * 180).toFixed(1)} 110 115)`);

    if (lost) {
      setText(els.level, "Signal væk");
      setText(els.dbm, `Sidst: ${formatDbm(smoothed)}`);
      setText(els.hint, "Bliv hvor du er et øjeblik, eller gå tilbage til hvor signalet var stærkest.");
    } else {
      setText(els.level, level.label);
      setText(els.dbm, formatDbm(smoothed));
      const meters = estimateDistance(smoothed);
      const distance = meters === null ? "" : `: ~${meters < 10 ? meters.toFixed(1).replace(".", ",") : Math.round(meters)}\u00a0m`;
      setText(els.hint, `${level.hint} (skøn${distance})`);
    }

    const samples = device.history.map((sample) => ({ t: sample.t, v: sample.smoothed }));
    const direction = lost ? { direction: "steady", label: "Venter på signal …" } : trend(samples, now);
    els.trend.dataset.direction = direction.direction;
    setText(els.trend, direction.label);
    setText(els.seen, `Sidst hørt ${formatAgo(age)}`);
    // Fades only ever make the signal weaker, so the best recent reading is a useful hint.
    const recent = device.history.filter((sample) => sample.t >= now - PEAK_WINDOW_MS);
    const peak = recent.length ? Math.max(...recent.map((sample) => sample.rssi)) : null;
    setText(els.peak, peak === null ? "" : `Bedst (5 s): ${formatDbm(peak)}`);
    els.spark.setAttribute("points", sparkPoints(device.history, now));

    els.warning.hidden = !lost;
    if (lost) {
      setText(
        els.warning,
        device.fingerprint
          ? "Signalet er væk lige nu. Apple-enheder skifter jævnligt Bluetooth-adresse – jeg holder øje med, om den dukker op igen under en ny adresse."
          : "Signalet er væk lige nu. Enheden kan være uden for rækkevidde, eller den har skiftet Bluetooth-adresse. Gå tilbage til listen, hvis den ikke dukker op igen.",
      );
    }

    els.identify.hidden = !ctx.canIdentify;
    const identifyState = ctx.identify.get(device.id);
    els.identify.disabled = identifyState?.state === "pending" || ctx.identifyBusy;
    setText(els.identify, identifyState?.state === "pending" ? "Identificerer …" : "Identificér");
    const text = identifyText(identifyState);
    els.identifyResult.hidden = !text;
    els.identifyResult.dataset.state = identifyState?.state || "";
    setText(els.identifyResult, text);

    const announceLevel = lost ? "lost" : level.key;
    if (els.live && announceLevel !== lastAnnounced.level && now - lastAnnounced.t >= ANNOUNCE_EVERY_MS) {
      lastAnnounced = { level: announceLevel, t: now };
      els.live.textContent = lost ? "Signalet er væk." : `${level.label}. ${level.hint}.`;
    }
    return { heat: h, lost };
  }

  return { open, close, update, setSound, get isOpen() { return !root.hidden; } };
}
