// Tiny DOM and formatting helpers shared by the UI modules.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Create an element: h("div", { class: "x", dataset: { id } }, "text", child). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Set textContent only when it changed (avoids needless layout work). */
export function setText(el, text) {
  const value = text ?? "";
  if (el && el.textContent !== value) el.textContent = value;
}

export function formatDbm(rssi) {
  if (!Number.isFinite(rssi)) return "– dBm";
  return `${Math.round(rssi)} dBm`.replace("-", "−");
}

export function formatAgo(ms) {
  if (!Number.isFinite(ms) || ms < 2000) return "lige nu";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `for ${seconds} s siden`;
  const minutes = Math.round(seconds / 60);
  return `for ${minutes} min siden`;
}

/** A short, stable tag for an id: the MAC tail, or a 4-character hash of other ids. */
export function shortId(id) {
  if (!id) return "";
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(id)) return "…" + id.slice(-5).toUpperCase();
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

export const storage = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be unavailable (private mode, blocked) – that's fine */
    }
  },
};
