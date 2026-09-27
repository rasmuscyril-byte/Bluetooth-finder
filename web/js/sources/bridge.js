// Data source: the local Python program (python -m ipad_finder), which scans
// with the computer's Bluetooth and streams adverts over Server-Sent Events.

const LOST_CONNECTION = "Forbindelsen til Bluetooth-programmet blev afbrudt. Kører det stadig? (Jeg prøver at forbinde igen.)";

export function statusFromBridge(status) {
  if (!status || typeof status !== "object") return { state: "starting", message: null };
  if (status.error && status.error.message) return { state: "error", message: status.error.message };
  if (status.identifying) return { state: "identifying", message: null };
  if (status.scanning) return { state: "scanning", message: null };
  if (status.hasScanner === false) return { state: "error", message: "Programmet kører uden Bluetooth-scanning." };
  return { state: "starting", message: null };
}

export async function detectBridge(baseUrl = "", timeoutMs = 1500) {
  if (typeof fetch !== "function" || !/^https?:$/.test(globalThis.location?.protocol ?? "http:")) return false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${baseUrl}/api/status`, { cache: "no-store", signal: controller?.signal });
    if (!response.ok) return false;
    const json = await response.json();
    return json?.mode === "bridge";
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createBridgeSource({ onAdverts, onStatus, baseUrl = "" }) {
  let events = null;

  return {
    kind: "bridge",
    supportsIdentify: true,

    async start() {
      if (events) return;
      onStatus({ state: "starting", message: null });
      events = new EventSource(`${baseUrl}/api/events`);
      events.addEventListener("adverts", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data?.adverts)) onAdverts(data.adverts);
        } catch {
          /* ignore a malformed batch */
        }
      });
      events.addEventListener("status", (event) => {
        try {
          const status = JSON.parse(event.data);
          this.supportsIdentify = Boolean(status?.supportsIdentify);
          onStatus(statusFromBridge(status));
        } catch {
          /* ignore */
        }
      });
      events.addEventListener("error", () => {
        onStatus({ state: "error", message: LOST_CONNECTION });
      });
    },

    stop() {
      if (events) events.close();
      events = null;
    },

    async identify(id) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 45000) : null;
      try {
        const response = await fetch(`${baseUrl}/api/identify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          signal: controller?.signal,
        });
        const json = await response.json().catch(() => null);
        if (json && typeof json === "object" && "ok" in json) return json;
        return { ok: false, id, error: { code: "http", message: `Programmet svarede med fejl ${response.status}.` } };
      } catch {
        return { ok: false, id, error: { code: "network", message: "Kunne ikke nå Bluetooth-programmet." } };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
