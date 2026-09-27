// Device list: keyed cards that update in place and re-sort at a calm pace,
// so buttons don't jump away under your finger.

import { proximity, signalBars } from "../engine/signal.js";
import { formatAgo, formatDbm, h, setText, shortId } from "./dom.js";

const RESORT_MS = 2000;

export function identifyText(state) {
  if (!state) return "";
  if (state.state === "pending") return "Spørger enheden om dens model … (scanningen holder kort pause)";
  if (state.state === "error") return state.message || "Kunne ikke identificere enheden.";
  const identity = state.identity || {};
  const parts = [];
  if (identity.model) parts.push(`Model: ${identity.model}`);
  if (identity.manufacturer) parts.push(`Producent: ${identity.manufacturer}`);
  if (identity.name) parts.push(`Navn: ${identity.name}`);
  return parts.length ? `Identificeret – ${parts.join(" · ")}` : "Identificeret.";
}

export function createDeviceList(root, { onFollow, onIdentify, onHide, onUnhide }) {
  const entries = new Map();
  let order = [];
  let lastSort = -Infinity;
  // Don't shuffle cards while someone is about to tap or has keyboard focus in the list.
  let pointerInside = false;
  root.addEventListener("pointerenter", () => (pointerInside = true));
  root.addEventListener("pointerleave", () => (pointerInside = false));
  root.addEventListener("pointerdown", () => (pointerInside = true));
  const userIsHere = () => pointerInside || root.contains(document.activeElement);

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !root.contains(button)) return;
    const card = button.closest("[data-id]");
    const id = card?.dataset.id;
    if (!id) return;
    const action = button.dataset.action;
    if (action === "follow") onFollow(id);
    else if (action === "identify") onIdentify(id);
    else if (action === "hide") onHide(id);
    else if (action === "unhide") onUnhide(id);
  });

  function build(id) {
    const refs = {};
    refs.icon = h("span", { class: "device-icon", "aria-hidden": "true" });
    refs.label = h("span", { class: "label" });
    refs.badge = h("span", { class: "badge" });
    refs.details = h("div", { class: "device-details" });
    refs.meta = h("div", { class: "device-meta" });
    refs.bars = h("span", { class: "bars", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
    refs.dbm = h("span", { class: "dbm" });
    refs.prox = h("span", { class: "prox" });
    refs.follow = h("button", { type: "button", class: "btn primary", dataset: { action: "follow" } }, "Find den");
    refs.identify = h("button", { type: "button", class: "btn", dataset: { action: "identify" } }, "Identificér");
    refs.hide = h("button", { type: "button", class: "btn ghost", dataset: { action: "hide" } }, "Ikke den");
    refs.result = h("p", { class: "identify-result", hidden: true, role: "status" });
    const el = h(
      "li",
      { class: "device", dataset: { id } },
      h(
        "div",
        { class: "device-main" },
        refs.icon,
        h("div", { class: "device-text" }, h("div", { class: "device-title" }, refs.label, refs.badge), refs.details, refs.meta),
        h("div", { class: "device-signal" }, refs.bars, refs.dbm, refs.prox),
      ),
      h("div", { class: "device-actions" }, refs.follow, refs.identify, refs.hide),
      refs.result,
    );
    return { el, refs };
  }

  function update({ el, refs }, device, ctx) {
    const c = device.classification || {};
    const age = ctx.now - device.lastSeen;
    const hidden = ctx.hiddenIds.has(device.id);
    const level = proximity(device.smoothed);

    setText(refs.icon, c.icon || "❔");
    setText(refs.label, c.label || "Ukendt enhed");
    setText(refs.badge, c.confidence || "");
    refs.badge.hidden = !c.confidence;
    refs.badge.classList.toggle("sure", c.confidence === "sikker");

    const details = [...(c.details || [])];
    if (device.name && !details.includes(device.name) && device.name !== c.label) details.unshift(`"${device.name}"`);
    setText(refs.details, details.join(" · ") || " ");

    const meta = [];
    if (c.vendor) meta.push(c.vendor);
    meta.push(device.stale ? `Ikke set ${formatAgo(age).replace("for ", "i ").replace(" siden", "")}` : `Set ${formatAgo(age)}`);
    meta.push(`ID ${shortId(device.id)}`);
    setText(refs.meta, meta.join(" · "));

    refs.bars.dataset.bars = String(device.stale ? 0 : signalBars(device.smoothed));
    setText(refs.dbm, formatDbm(device.smoothed));
    setText(refs.prox, device.stale ? "Forsvundet" : level.label);
    refs.prox.dataset.level = device.stale ? "0" : String(level.level);

    el.classList.toggle("stale", Boolean(device.stale));
    el.classList.toggle("likely", Boolean(c.kind === "ipad" || c.kind === "findmy-device"));
    el.classList.toggle("hidden-device", hidden);

    refs.hide.dataset.action = hidden ? "unhide" : "hide";
    setText(refs.hide, hidden ? "Vis igen" : "Ikke den");

    const identifyState = ctx.identify.get(device.id);
    refs.identify.hidden = !ctx.canIdentify;
    refs.identify.disabled = identifyState?.state === "pending" || ctx.identifyBusy;
    refs.identify.textContent = "";
    if (identifyState?.state === "pending") refs.identify.append(h("span", { class: "spinner", "aria-hidden": "true" }), " Identificerer");
    else refs.identify.append("Identificér");

    const text = identifyText(identifyState);
    refs.result.hidden = !text;
    refs.result.dataset.state = identifyState?.state || "";
    setText(refs.result, text);

    refs.follow.setAttribute("aria-label", `Find den – ${c.label || "ukendt enhed"} (${shortId(device.id)})`);
  }

  function render(devices, ctx) {
    const ids = devices.map((device) => device.id);
    const orderSet = new Set(order);
    const membershipChanged = ids.length !== order.length || ids.some((id) => !orderSet.has(id));
    const due = ctx.now - lastSort >= RESORT_MS || ctx.forceSort;
    if (membershipChanged && userIsHere()) {
      // Keep existing cards where they are; new ones go to the end.
      const idSet = new Set(ids);
      order = [...order.filter((id) => idSet.has(id)), ...ids.filter((id) => !orderSet.has(id))];
    } else if (membershipChanged || (due && !userIsHere())) {
      order = ids;
      lastSort = ctx.now;
    }
    const byId = new Map(devices.map((device) => [device.id, device]));

    for (const [id, entry] of entries) {
      if (!byId.has(id)) {
        entry.el.remove();
        entries.delete(id);
      }
    }

    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    order.forEach((id, index) => {
      const device = byId.get(id);
      if (!device) return;
      let entry = entries.get(id);
      if (!entry) {
        entry = build(id);
        entries.set(id, entry);
      }
      update(entry, device, ctx);
      if (root.children[index] !== entry.el) root.insertBefore(entry.el, root.children[index] || null);
    });
    // Moving a node drops its focus; put it back.
    if (focused && document.activeElement !== focused && root.contains(focused)) focused.focus({ preventScroll: true });
  }

  return { render };
}
