import asyncio
import json

import pytest

from ipad_finder.fake import FakeScanner
from ipad_finder.server import BridgeServer


async def http(port, method="GET", path="/", headers=None, body=b"", host=None, read_all=True):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    all_headers = {"Host": host if host is not None else f"127.0.0.1:{port}"}
    all_headers.update(headers or {})
    if body:
        all_headers["Content-Length"] = str(len(body))
    head = f"{method} {path} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in all_headers.items() if v is not None)
    writer.write(head.encode("latin-1") + b"\r\n" + body)
    await writer.drain()
    if not read_all:
        return reader, writer
    data = await asyncio.wait_for(reader.read(), timeout=5)
    writer.close()
    head_bytes, _, payload = data.partition(b"\r\n\r\n")
    lines = head_bytes.decode("latin-1").split("\r\n")
    status = int(lines[0].split(" ")[1])
    response_headers = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        response_headers[name.strip().lower()] = value.strip()
    return status, response_headers, payload


def run_with_server(scenario, scanner=None, **kwargs):
    async def runner():
        server = BridgeServer(scanner, port=0, **kwargs)
        await server.start()
        try:
            await scenario(server)
        finally:
            await server.close()

    asyncio.run(runner())


@pytest.fixture
def web_root(tmp_path):
    root = tmp_path / "web"
    (root / "js").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><title>iPad-finder</title>", encoding="utf-8")
    (root / "js" / "main.js").write_text("export {};", encoding="utf-8")
    (root / ".secret").write_text("nope", encoding="utf-8")
    (tmp_path / "outside.txt").write_text("outside", encoding="utf-8")
    return root


def test_serves_static_files_with_security_headers(web_root):
    async def scenario(server):
        status, headers, body = await http(server.port, path="/")
        assert status == 200
        assert headers["content-type"].startswith("text/html")
        assert "default-src 'self'" in headers["content-security-policy"]
        assert headers["cache-control"] == "no-store"
        assert headers["x-content-type-options"] == "nosniff"
        assert b"iPad-finder" in body

        status, headers, body = await http(server.port, path="/js/main.js?v=1")
        assert status == 200 and headers["content-type"].startswith("text/javascript")

        status, headers, body = await http(server.port, method="HEAD", path="/index.html")
        assert status == 200 and body == b"" and int(headers["content-length"]) > 0

    run_with_server(scenario, web_root=web_root)


@pytest.mark.parametrize(
    "path",
    ["/../outside.txt", "/%2e%2e/outside.txt", "/.secret", "/js/../../outside.txt", "/js/..%5c..%5coutside.txt", "/nope.html"],
)
def test_static_rejects_traversal_and_dotfiles(web_root, path):
    async def scenario(server):
        status, _, body = await http(server.port, path=path)
        assert status == 404
        assert b"outside" not in body and b"nope" not in body

    run_with_server(scenario, web_root=web_root)


@pytest.mark.parametrize(
    "host, expected",
    [("evil.example", 403), ("evil.example:80", 403), ("localhost", 200), ("LOCALHOST:1234", 200), ("[::1]:8765", 200), ("", 403)],
)
def test_host_header_allowlist(web_root, host, expected):
    async def scenario(server):
        status, _, _ = await http(server.port, path="/api/status", host=host)
        assert status == expected

    run_with_server(scenario, web_root=web_root)


def test_missing_host_header_is_rejected(web_root):
    async def scenario(server):
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        writer.write(b"GET /api/status HTTP/1.1\r\n\r\n")
        data = await asyncio.wait_for(reader.read(), timeout=5)
        writer.close()
        assert data.startswith(b"HTTP/1.1 403")

    run_with_server(scenario, web_root=web_root)


def test_malformed_and_oversized_requests(web_root):
    async def scenario(server):
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        writer.write(b"garbage\r\n\r\n")
        assert (await asyncio.wait_for(reader.read(), timeout=5)).startswith(b"HTTP/1.1 400")
        writer.close()

        status, _, _ = await http(
            server.port, method="POST", path="/api/identify",
            headers={"Content-Type": "application/json", "Content-Length": str(10 ** 7)},
        )
        assert status == 413

        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        writer.write(b"GET / HTTP/1.1\r\nX-Big: " + b"a" * 40000 + b"\r\n\r\n")
        data = await asyncio.wait_for(reader.read(), timeout=5)
        writer.close()
        assert data.startswith(b"HTTP/1.1 413")

    run_with_server(scenario, web_root=web_root)


def test_status_without_scanner(web_root):
    async def scenario(server):
        status, headers, body = await http(server.port, path="/api/status")
        payload = json.loads(body)
        assert status == 200 and headers["content-type"].startswith("application/json")
        assert payload["mode"] == "bridge"
        assert payload["scanning"] is False
        assert payload["supportsIdentify"] is False
        assert payload["hasScanner"] is False

    run_with_server(scenario, web_root=web_root)


def test_method_not_allowed(web_root):
    async def scenario(server):
        status, headers, _ = await http(server.port, method="POST", path="/api/status")
        assert status == 405 and headers["allow"] == "GET, HEAD"
        status, _, _ = await http(server.port, method="GET", path="/api/identify")
        assert status == 405
        status, _, _ = await http(server.port, method="DELETE", path="/index.html")
        assert status == 405
        status, _, _ = await http(server.port, method="GET", path="/api/unknown")
        assert status == 404

    run_with_server(scenario, web_root=web_root)


def identify_request(port, payload, content_type="application/json", origin=None):
    body = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
    headers = {"Content-Type": content_type}
    if origin is not None:
        headers["Origin"] = origin
    return http(port, method="POST", path="/api/identify", headers=headers, body=body)


def test_identify_endpoint(web_root):
    scanner = FakeScanner(autostart_emitting=False)

    async def scenario(server):
        await server.start_scanner()
        origin = f"http://127.0.0.1:{server.port}"
        status, _, body = await identify_request(server.port, {"id": "AA:BB:CC:00:00:01"}, origin=origin)
        assert status == 200
        assert json.loads(body) == {"ok": True, "id": "AA:BB:CC:00:00:01", "manufacturer": "Apple Inc.", "model": "iPad13,1", "name": None}

        status, _, body = await identify_request(server.port, {"id": "AA:BB:CC:00:00:05"}, origin=f"http://localhost:{server.port}")
        result = json.loads(body)
        assert result["ok"] is False and result["error"]["code"] == "connect_failed" and result["error"]["message"]

        status, _, _ = await identify_request(server.port, {"id": "x"}, origin="http://evil.example")
        assert status == 403
        status, _, _ = await identify_request(server.port, {"id": "x"}, origin=f"http://127.0.0.1:{server.port + 1}")
        assert status == 403
        status, _, _ = await identify_request(server.port, {"id": "x"}, content_type="text/plain")
        assert status == 415
        status, _, body = await identify_request(server.port, b"{not json")
        assert status == 400 and json.loads(body)["error"]["code"] == "bad_request"
        status, _, _ = await identify_request(server.port, {"id": ""})
        assert status == 400
        status, _, _ = await identify_request(server.port, {"id": "x" * 500})
        assert status == 400
        assert scanner.identify_calls == ["AA:BB:CC:00:00:01", "AA:BB:CC:00:00:05"]

    run_with_server(scenario, scanner=scanner, web_root=web_root)


def test_identify_without_scanner_is_unavailable(web_root):
    async def scenario(server):
        status, _, body = await identify_request(server.port, {"id": "AA"})
        assert status == 200 and json.loads(body)["error"]["code"] == "unavailable"

    run_with_server(scenario, web_root=web_root)


async def read_events(reader, count, timeout=5):
    events = []
    buffer = b""
    while len(events) < count:
        chunk = await asyncio.wait_for(reader.read(65536), timeout=timeout)
        if not chunk:
            break
        buffer += chunk
        while b"\n\n" in buffer:
            block, buffer = buffer.split(b"\n\n", 1)
            name, data = None, None
            for line in block.decode("utf-8").split("\n"):
                if line.startswith("event: "):
                    name = line[7:]
                elif line.startswith("data: "):
                    data = json.loads(line[6:])
            if name:
                events.append((name, data))
    return events


def test_event_stream_sends_status_and_batched_adverts(web_root):
    scanner = FakeScanner(autostart_emitting=False)

    async def scenario(server):
        await server.start_scanner()
        reader, writer = await http(server.port, path="/api/events", read_all=False)
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5)
        assert b"200 OK" in head and b"text/event-stream" in head
        [(name, status)] = await read_events(reader, 1)
        assert name == "status" and status["scanning"] is True

        scanner.emit_canned()
        scanner.emit_canned()
        events = await read_events(reader, 1)
        assert events[0][0] == "adverts"
        adverts = events[0][1]["adverts"]
        assert len(adverts) == 10
        assert {a["id"] for a in adverts} >= {"AA:BB:CC:00:00:01", "AA:BB:CC:00:00:02"}
        assert all(set(a) == {"id", "address", "rssi", "name", "txPower", "manufacturerData", "serviceData", "serviceUuids", "t"} for a in adverts)

        await scanner.stop()
        events = await read_events(reader, 1, timeout=4)
        assert events[0][0] == "status" and events[0][1]["scanning"] is False
        writer.close()

    run_with_server(scenario, scanner=scanner, web_root=web_root, batch_interval=0.05)


def test_adverts_are_not_buffered_without_subscribers(web_root):
    scanner = FakeScanner(autostart_emitting=False)

    async def scenario(server):
        scanner.emit_canned()
        assert server._pending == []

    run_with_server(scenario, scanner=scanner, web_root=web_root)


def test_supervisor_retries_failed_scanner(web_root, monkeypatch):
    from ipad_finder import server as server_module

    monkeypatch.setattr(server_module, "RETRY_SECONDS", 1.0)
    scanner = FakeScanner(autostart_emitting=False)
    scanner.fail_start = ("powered_off", "Bluetooth er slået fra.")

    async def scenario(server):
        await server.start_scanner()
        assert scanner.error["code"] == "powered_off"
        status, _, body = await http(server.port, path="/api/status")
        assert json.loads(body)["error"]["code"] == "powered_off"
        scanner.fail_start = None
        for _ in range(40):
            await asyncio.sleep(0.1)
            if scanner.scanning:
                break
        assert scanner.scanning and scanner.error is None

    run_with_server(scenario, scanner=scanner, web_root=web_root)


def test_port_fallback_when_busy(web_root):
    async def scenario():
        first = BridgeServer(None, port=0, web_root=web_root)
        port = await first.start()
        second = BridgeServer(None, port=port, web_root=web_root)
        try:
            other = await second.start()
            assert other != port
            status, _, _ = await http(other, path="/api/status")
            assert status == 200
        finally:
            await second.close()
            await first.close()

    asyncio.run(scenario())


def test_url_formatting():
    assert BridgeServer(None, host="127.0.0.1", port=8765).url == "http://127.0.0.1:8765/"
    assert BridgeServer(None, host="0.0.0.0", port=8765).url == "http://127.0.0.1:8765/"
    assert BridgeServer(None, host="::1", port=8765).url == "http://[::1]:8765/"


def test_explicit_host_is_allowed(web_root):
    server = BridgeServer(None, host="192.168.1.20", port=8765, web_root=web_root)
    assert server._host_allowed("192.168.1.20:8765")
    assert server._host_allowed("localhost:8765")
    assert not server._host_allowed("evil.example")


def test_supervisor_restarts_a_silently_dead_scan(web_root, monkeypatch):
    from ipad_finder import server as server_module

    monkeypatch.setattr(server_module, "STALL_SECONDS", 0.5)
    scanner = FakeScanner(autostart_emitting=False)

    async def scenario(server):
        await server.start_scanner()
        for _ in range(40):
            await asyncio.sleep(0.1)
            if scanner.restarts:
                break
        assert scanner.restarts >= 1
        assert scanner.scanning

    run_with_server(scenario, scanner=scanner, web_root=web_root)


def test_supervisor_leaves_a_busy_scanner_alone(web_root, monkeypatch):
    from ipad_finder import server as server_module

    monkeypatch.setattr(server_module, "RETRY_SECONDS", 1.0)
    scanner = FakeScanner(autostart_emitting=False)

    async def scenario(server):
        scanner.busy = True  # identify in progress, scanning paused on purpose
        await asyncio.sleep(2.5)
        assert not scanner.scanning
        scanner.busy = False
        for _ in range(30):
            await asyncio.sleep(0.1)
            if scanner.scanning:
                break
        assert scanner.scanning

    run_with_server(scenario, scanner=scanner, web_root=web_root)


def test_hostile_identify_bodies_get_clean_answers(web_root):
    async def scenario(server):
        status, _, body = await identify_request(server.port, b"[" * 60000)
        assert status == 400 and json.loads(body)["error"]["code"] == "bad_request"
        status, _, _ = await identify_request(server.port, {"id": "x"}, origin="http://127.0.0.1:99999")
        assert status == 403
        status, _, _ = await identify_request(server.port, {"id": "x"}, origin="http://localhost:abc")
        assert status == 403

    run_with_server(scenario, web_root=web_root)


def test_close_does_not_hang_on_a_client_that_stopped_reading(web_root):
    scanner = FakeScanner(autostart_emitting=False)

    async def scenario():
        server = BridgeServer(scanner, port=0, web_root=web_root, batch_interval=0.01)
        await server.start()
        await server.start_scanner()
        reader, writer = await http(server.port, path="/api/events", read_all=False)
        # Never read: flood the stream until the socket buffers are full.
        for _ in range(300):
            for _ in range(20):
                scanner.emit_canned()
            await asyncio.sleep(0.005)
        await asyncio.wait_for(server.close(), timeout=5)
        writer.close()

    asyncio.run(scenario())
