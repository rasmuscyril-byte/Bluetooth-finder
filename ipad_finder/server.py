"""Tiny asyncio HTTP server (stdlib only) that serves the web UI and streams adverts.

Endpoints:
  GET  /               the web app (static files from web/)
  GET  /api/status     JSON status
  GET  /api/events     Server-Sent Events: "status" and batched "adverts"
  POST /api/identify   {"id": "..."} → read model number over GATT
"""

from __future__ import annotations

import asyncio
import errno
import json
import logging
import platform
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlsplit

from . import __version__
from .scanner import BluetoothUnavailable, identify_error

log = logging.getLogger(__name__)

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

MAX_HEAD_BYTES = 16 * 1024
MAX_BODY_BYTES = 64 * 1024
MAX_BATCH = 2000
SUBSCRIBER_QUEUE = 100
PING_SECONDS = 15.0
RETRY_SECONDS = 5.0
# No advert at all for this long while "scanning" means the scan died silently
# (Bluetooth switched off and on, laptop sleep). Restart it.
STALL_SECONDS = 20.0

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}

CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)

STATUS_TEXT = {
    200: "OK",
    204: "No Content",
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
}


def _bleak_version() -> Optional[str]:
    try:
        from importlib.metadata import version

        return version("bleak")
    except Exception:
        return None


class RequestError(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(status)
        self.status = status


class Request:
    def __init__(self, method: str, path: str, headers: dict[str, str], body: bytes) -> None:
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body


class BridgeServer:
    """Serves ``web/`` and bridges scanner adverts to browsers over SSE."""

    def __init__(
        self,
        scanner: Any = None,
        *,
        host: str = "127.0.0.1",
        port: int = 8765,
        web_root: Path = WEB_ROOT,
        batch_interval: float = 0.25,
        port_attempts: int = 21,
    ) -> None:
        self.scanner = scanner
        self.host = host
        self.port = port
        self.web_root = Path(web_root).resolve()
        self.batch_interval = batch_interval
        self.port_attempts = port_attempts
        self.allowed_hosts = set(LOCAL_HOSTS)
        if host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0", "::", ""):
            self.allowed_hosts.add(host.lower())
        self._server: Optional[asyncio.AbstractServer] = None
        self._pending: list[dict[str, Any]] = []
        self._subscribers: set[asyncio.Queue[bytes]] = set()
        self._tasks: list[asyncio.Task[Any]] = []
        self._connections: set[asyncio.Task[Any]] = set()
        self._writers: set[asyncio.StreamWriter] = set()
        self._last_status: Optional[dict[str, Any]] = None
        self._closing = False
        if scanner is not None:
            scanner.on_advert = self.queue_advert

    # ------------------------------------------------------------------ lifecycle

    @property
    def url(self) -> str:
        host = self.host
        if host in ("0.0.0.0", "::", ""):
            host = "127.0.0.1"
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        return f"http://{host}:{self.port}/"

    async def start(self) -> int:
        """Bind (trying the next ports if busy), start background tasks, return the port."""
        last_error: Optional[OSError] = None
        for offset in range(self.port_attempts):
            port = self.port + offset
            try:
                self._server = await asyncio.start_server(
                    self._on_connection, self.host, port, limit=MAX_HEAD_BYTES
                )
            except OSError as exc:
                if exc.errno not in (errno.EADDRINUSE, errno.EACCES, getattr(errno, "WSAEADDRINUSE", -1), 10013):
                    raise
                last_error = exc
                continue
            sockets = self._server.sockets or []
            self.port = sockets[0].getsockname()[1] if sockets else port
            break
        else:
            raise OSError(f"Ingen ledig port fundet fra {self.port} til {self.port + self.port_attempts - 1}") from last_error

        loop = asyncio.get_running_loop()
        self._tasks.append(loop.create_task(self._flush_loop()))
        self._tasks.append(loop.create_task(self._supervise_loop()))
        return self.port

    async def close(self) -> None:
        self._closing = True
        if self.scanner is not None:
            shutdown = getattr(self.scanner, "shutdown", None)
            await (shutdown() if shutdown is not None else self.scanner.stop())
        for task in self._tasks:
            task.cancel()
        for task in list(self._connections):
            task.cancel()
        for writer in list(self._writers):
            # Abort instead of a graceful close: a browser tab that stopped reading
            # would otherwise keep the server (and Ctrl+C) waiting forever.
            try:
                writer.transport.abort()
            except Exception:
                pass
        for task in self._tasks + list(self._connections):
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()
        if self._server is not None:
            self._server.close()
            try:
                await asyncio.wait_for(self._server.wait_closed(), 2.0)
            except asyncio.TimeoutError:
                pass
            self._server = None

    # ------------------------------------------------------------------ scanner side

    def queue_advert(self, advert: dict[str, Any]) -> None:
        """Called by the scanner for every advert (on the event loop)."""
        if not self._subscribers:
            return
        self._pending.append(advert)
        if len(self._pending) > MAX_BATCH:
            del self._pending[: len(self._pending) - MAX_BATCH]

    def status(self) -> dict[str, Any]:
        scanner = self.scanner
        return {
            "mode": "bridge",
            "version": __version__,
            "platform": sys.platform,
            "system": platform.system(),
            "bleak": _bleak_version(),
            "scanning": bool(getattr(scanner, "scanning", False)),
            "identifying": bool(getattr(scanner, "identifying", False)),
            "error": getattr(scanner, "error", None),
            "supportsIdentify": bool(getattr(scanner, "supports_identify", False)),
            "hasScanner": scanner is not None,
        }

    async def start_scanner(self) -> None:
        if self.scanner is None:
            return
        try:
            await self.scanner.start()
        except BluetoothUnavailable as exc:
            log.warning("Bluetooth: %s", exc.message)

    async def _supervise_loop(self) -> None:
        """Broadcast status changes, retry a scanner that failed to start and
        restart a scan that died silently."""
        since_retry = 0.0
        while True:
            await asyncio.sleep(1.0)
            scanner = self.scanner
            if scanner is not None and not getattr(scanner, "busy", False):
                if scanner.scanning:
                    since_retry = 0.0
                    last = max(getattr(scanner, "last_advert_at", None) or 0.0, getattr(scanner, "started_at", None) or 0.0)
                    if last and time.monotonic() - last > STALL_SECONDS and hasattr(scanner, "restart"):
                        log.info("No adverts for %.0f s; restarting the scan", STALL_SECONDS)
                        await scanner.restart()
                else:
                    since_retry += 1.0
                    if since_retry >= RETRY_SECONDS:
                        since_retry = 0.0
                        await self.start_scanner()
            self.broadcast_status_if_changed()

    def broadcast_status_if_changed(self) -> None:
        current = self.status()
        if current != self._last_status:
            self._last_status = current
            self._broadcast(_sse("status", current))

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self.batch_interval)
            self.flush()

    def flush(self) -> None:
        if not self._pending:
            return
        batch, self._pending = self._pending, []
        self._broadcast(_sse("adverts", {"adverts": batch}))

    def _broadcast(self, message: bytes) -> None:
        for queue in list(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()  # drop the oldest message for slow clients
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass

    # ------------------------------------------------------------------ HTTP

    async def _on_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._connections.add(task)
        self._writers.add(writer)
        try:
            await self._handle(reader, writer)
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Request failed")
        finally:
            if task is not None:
                self._connections.discard(task)
            self._writers.discard(writer)
            try:
                writer.close()
            except Exception:
                pass

    async def _read_request(self, reader: asyncio.StreamReader) -> Request:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10.0)
        except asyncio.LimitOverrunError:
            raise RequestError(413)
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ValueError):
            raise RequestError(400)
        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) != 3 or not parts[2].startswith("HTTP/"):
            raise RequestError(400)
        method, target, _version = parts
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if not line:
                continue
            name, sep, value = line.partition(":")
            if not sep:
                raise RequestError(400)
            headers[name.strip().lower()] = value.strip()
        body = b""
        length_text = headers.get("content-length")
        if length_text:
            try:
                length = int(length_text)
            except ValueError:
                raise RequestError(400)
            if length < 0 or length > MAX_BODY_BYTES:
                raise RequestError(413)
            if length:
                try:
                    body = await asyncio.wait_for(reader.readexactly(length), timeout=10.0)
                except (asyncio.IncompleteReadError, asyncio.TimeoutError):
                    raise RequestError(400)
        try:
            path = unquote(urlsplit(target).path or "/")
        except ValueError:  # e.g. "http://[::1/"
            raise RequestError(400)
        return Request(method.upper(), path, headers, body)

    def _host_allowed(self, host_header: Optional[str]) -> bool:
        if not host_header:
            return False
        host = host_header.strip().lower()
        if host.startswith("["):
            end = host.find("]")
            name = host[: end + 1] if end != -1 else host
        else:
            name = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
        return name in self.allowed_hosts

    def _origin_allowed(self, origin: Optional[str]) -> bool:
        if origin is None:
            return True
        try:
            parsed = urlsplit(origin)
            hostname = (parsed.hostname or "").lower()
            port = parsed.port
        except ValueError:  # e.g. "http://[::1" or "http://127.0.0.1:99999"
            return False
        if parsed.scheme != "http" or not hostname:
            return False
        if ":" in hostname:
            hostname = f"[{hostname}]"
        return hostname in self.allowed_hosts and port == self.port

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request = await self._read_request(reader)
        except RequestError as exc:
            await self._send(writer, exc.status, STATUS_TEXT[exc.status].encode(), "text/plain; charset=utf-8")
            return
        if not self._host_allowed(request.headers.get("host")):
            await self._send(writer, 403, b"Forbidden host", "text/plain; charset=utf-8")
            return

        path = request.path
        if path == "/api/status":
            if request.method not in ("GET", "HEAD"):
                await self._method_not_allowed(writer, "GET, HEAD")
                return
            await self._send_json(writer, 200, self.status(), head_only=request.method == "HEAD")
        elif path == "/api/events":
            if request.method != "GET":
                await self._method_not_allowed(writer, "GET")
                return
            await self._stream_events(writer)
        elif path == "/api/identify":
            if request.method != "POST":
                await self._method_not_allowed(writer, "POST")
                return
            await self._identify(writer, request)
        elif path.startswith("/api/"):
            await self._send(writer, 404, b"Not found", "text/plain; charset=utf-8")
        elif path == "/favicon.ico":
            await self._send(writer, 204, b"", None)
        else:
            if request.method not in ("GET", "HEAD"):
                await self._method_not_allowed(writer, "GET, HEAD")
                return
            await self._static(writer, path, head_only=request.method == "HEAD")

    async def _identify(self, writer: asyncio.StreamWriter, request: Request) -> None:
        content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            await self._send(writer, 415, b"Use application/json", "text/plain; charset=utf-8")
            return
        if not self._origin_allowed(request.headers.get("origin")):
            await self._send(writer, 403, b"Forbidden origin", "text/plain; charset=utf-8")
            return
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            payload = None
        device_id = payload.get("id") if isinstance(payload, dict) else None
        if not isinstance(device_id, str) or not device_id or len(device_id) > 200:
            await self._send_json(writer, 400, {"ok": False, "error": {"code": "bad_request", "message": "Ugyldig forespørgsel."}})
            return
        scanner = self.scanner
        if scanner is None or not getattr(scanner, "supports_identify", False):
            result = identify_error(device_id, "unavailable")
        else:
            identify_task = asyncio.ensure_future(scanner.identify(device_id))
            # Let the UI see "identifying" (scanning paused) while it runs.
            await asyncio.sleep(0)
            self.broadcast_status_if_changed()
            try:
                result = await asyncio.shield(identify_task)
            finally:
                self.broadcast_status_if_changed()
        await self._send_json(writer, 200, result)

    async def _stream_events(self, writer: asyncio.StreamWriter) -> None:
        writer.write(
            self._head(200, "text/event-stream; charset=utf-8", None, extra={"Connection": "keep-alive", "X-Accel-Buffering": "no"})
        )
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE)
        self._subscribers.add(queue)
        try:
            writer.write(b"retry: 3000\n\n" + _sse("status", self.status()))
            await writer.drain()
            while not self._closing:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=PING_SECONDS)
                except asyncio.TimeoutError:
                    message = b": ping\n\n"
                writer.write(message)
                await writer.drain()
        finally:
            self._subscribers.discard(queue)
            if not self._subscribers:
                self._pending.clear()

    async def _static(self, writer: asyncio.StreamWriter, path: str, head_only: bool) -> None:
        file_path = self._resolve_static(path)
        if file_path is None:
            await self._send(writer, 404, "Siden findes ikke.".encode("utf-8"), "text/plain; charset=utf-8")
            return
        content_type = CONTENT_TYPES.get(file_path.suffix.lower(), "application/octet-stream")
        body = file_path.read_bytes()
        extra = {"Content-Security-Policy": CSP} if file_path.suffix.lower() == ".html" else None
        await self._send(writer, 200, body, content_type, head_only=head_only, extra=extra)

    def _resolve_static(self, path: str) -> Optional[Path]:
        relative = path.lstrip("/")
        if relative == "" or relative.endswith("/"):
            relative += "index.html"
        if "\\" in relative or "\0" in relative:
            return None
        parts = relative.split("/")
        if any(part in ("", ".", "..") or part.startswith(".") for part in parts):
            return None
        try:
            candidate = (self.web_root / relative).resolve()
        except (OSError, RuntimeError):
            return None
        try:
            candidate.relative_to(self.web_root)
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        return candidate

    # ------------------------------------------------------------------ response helpers

    def _head(
        self,
        status: int,
        content_type: Optional[str],
        length: Optional[int],
        extra: Optional[dict[str, str]] = None,
    ) -> bytes:
        lines = [f"HTTP/1.1 {status} {STATUS_TEXT.get(status, 'OK')}"]
        if content_type:
            lines.append(f"Content-Type: {content_type}")
        if length is not None:
            lines.append(f"Content-Length: {length}")
        lines += [
            "Cache-Control: no-store",
            "X-Content-Type-Options: nosniff",
            "Referrer-Policy: no-referrer",
        ]
        headers = {"Connection": "close"}
        headers.update(extra or {})
        lines += [f"{name}: {value}" for name, value in headers.items()]
        return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")

    async def _send(
        self,
        writer: asyncio.StreamWriter,
        status: int,
        body: bytes,
        content_type: Optional[str],
        head_only: bool = False,
        extra: Optional[dict[str, str]] = None,
    ) -> None:
        writer.write(self._head(status, content_type, len(body), extra))
        if body and not head_only:
            writer.write(body)
        await writer.drain()

    async def _send_json(self, writer: asyncio.StreamWriter, status: int, payload: Any, head_only: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        await self._send(writer, status, body, "application/json; charset=utf-8", head_only=head_only)

    async def _method_not_allowed(self, writer: asyncio.StreamWriter, allow: str) -> None:
        await self._send(writer, 405, b"Method not allowed", "text/plain; charset=utf-8", extra={"Allow": allow})


def _sse(event: str, payload: Any) -> bytes:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {data}\n\n".encode("utf-8")
