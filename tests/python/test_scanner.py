import asyncio
import enum
import sys
import types
from types import SimpleNamespace

import pytest

from ipad_finder import scanner as scanner_module
from ipad_finder.scanner import BleScanner, BluetoothUnavailable, describe_error


class Reason(enum.Enum):
    NO_BLUETOOTH = 1
    POWERED_OFF = 2
    DENIED_BY_USER = 3


class NotAvailable(Exception):
    def __init__(self, reason):
        super().__init__("not available", reason)
        self.reason = reason


@pytest.mark.parametrize(
    "exc, code",
    [
        (NotAvailable(Reason.POWERED_OFF), "powered_off"),
        (NotAvailable(Reason.DENIED_BY_USER), "denied"),
        (NotAvailable(Reason.NO_BLUETOOTH), "no_bluetooth"),
        (Exception("Bluetooth device is turned off"), "powered_off"),  # bleak 1.x CoreBluetooth
        (Exception("BLE is not authorized - check macOS privacy settings"), "denied"),
        (Exception("No powered Bluetooth adapters found."), "powered_off"),  # bleak 1.x BlueZ
        (Exception("No Bluetooth adapters found."), "no_bluetooth"),
        (Exception("Failed to start scanner. Is Bluetooth turned on?"), "powered_off"),  # WinRT
        (FileNotFoundError("/var/run/dbus/system_bus_socket"), "bluez"),
        (RuntimeError("something odd"), "unknown"),
    ],
)
def test_describe_error_maps_to_danish_messages(exc, code):
    got_code, message = describe_error(exc)
    assert got_code == code
    assert message and isinstance(message, str)
    if code == "unknown":
        assert "something odd" in message


class FakeBleakScanner:
    instances = []
    fail_with = None

    def __init__(self, detection_callback=None, **kwargs):
        self.callback = detection_callback
        self.started = 0
        self.stopped = 0
        FakeBleakScanner.instances.append(self)

    async def start(self):
        if FakeBleakScanner.fail_with is not None:
            raise FakeBleakScanner.fail_with
        self.started += 1

    async def stop(self):
        self.stopped += 1


class FakeBleakClient:
    behaviour = "ok"
    reads = {}
    connected = []
    disconnected = []

    def __init__(self, device, timeout=10.0, **kwargs):
        self.device = device

    async def connect(self):
        if FakeBleakClient.behaviour == "fail":
            raise Exception("connection refused")
        if FakeBleakClient.behaviour == "hang":
            await asyncio.sleep(10)
        FakeBleakClient.connected.append(self.device.address)

    async def read_gatt_char(self, uuid):
        value = FakeBleakClient.reads.get(uuid)
        if value is None:
            raise Exception("characteristic not found")
        return value

    async def disconnect(self):
        FakeBleakClient.disconnected.append(self.device.address)


@pytest.fixture
def fake_bleak(monkeypatch):
    module = types.ModuleType("bleak")
    module.BleakScanner = FakeBleakScanner
    module.BleakClient = FakeBleakClient
    monkeypatch.setitem(sys.modules, "bleak", module)
    FakeBleakScanner.instances = []
    FakeBleakScanner.fail_with = None
    FakeBleakClient.behaviour = "ok"
    FakeBleakClient.reads = {}
    FakeBleakClient.connected = []
    FakeBleakClient.disconnected = []
    return module


def adv(rssi=-60, manufacturer=None):
    return SimpleNamespace(
        local_name=None,
        manufacturer_data=manufacturer or {},
        service_data={},
        service_uuids=[],
        tx_power=None,
        rssi=rssi,
    )


def test_scanner_forwards_adverts(fake_bleak):
    received = []

    async def scenario():
        scanner = BleScanner(received.append)
        await scanner.start()
        assert scanner.scanning and scanner.error is None
        callback = FakeBleakScanner.instances[0].callback
        callback(SimpleNamespace(address="11:22:33:44:55:66", name=None), adv(-55, {76: b"\x10\x05\x03\x00\x00\x00\x00"}))
        await scanner.stop()
        assert not scanner.scanning

    asyncio.run(scenario())
    assert len(received) == 1
    assert received[0]["id"] == "11:22:33:44:55:66"
    assert received[0]["manufacturerData"] == {"76": "10050300000000"}


def test_scanner_start_failure_sets_error(fake_bleak):
    FakeBleakScanner.fail_with = Exception("Bluetooth device is turned off")

    async def scenario():
        scanner = BleScanner()
        with pytest.raises(BluetoothUnavailable) as info:
            await scanner.start()
        assert info.value.code == "powered_off"
        assert scanner.error == {"code": "powered_off", "message": info.value.message}
        assert not scanner.scanning
        FakeBleakScanner.fail_with = None
        await scanner.start()
        assert scanner.scanning and scanner.error is None

    asyncio.run(scenario())


def seen_device(scanner, address="AA:AA:AA:AA:AA:01"):
    scanner._detected(SimpleNamespace(address=address, name=None), adv())
    return address


def test_identify_reads_model_and_resumes_scanning(fake_bleak):
    FakeBleakClient.reads = {
        scanner_module.MANUFACTURER_NAME_CHAR: bytearray(b"Apple Inc.\x00"),
        scanner_module.MODEL_NUMBER_CHAR: b"iPad13,1",
    }

    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        address = seen_device(scanner)
        result = await scanner.identify(address)
        assert result == {"ok": True, "id": address, "manufacturer": "Apple Inc.", "model": "iPad13,1", "name": None}
        bleak_scanner = FakeBleakScanner.instances[0]
        assert bleak_scanner.stopped == 1 and bleak_scanner.started == 2
        assert scanner.scanning and not scanner.identifying
        assert FakeBleakClient.disconnected == [address]

    asyncio.run(scenario())


def test_identify_errors(fake_bleak):
    async def scenario():
        scanner = BleScanner(identify_timeout=0.2)
        await scanner.start()
        assert (await scanner.identify("unknown"))["error"]["code"] == "not_found"

        address = seen_device(scanner)
        FakeBleakClient.behaviour = "fail"
        result = await scanner.identify(address)
        assert result["ok"] is False and result["error"]["code"] == "connect_failed"
        assert scanner.scanning

        FakeBleakClient.behaviour = "ok"
        FakeBleakClient.reads = {}
        assert (await scanner.identify(address))["error"]["code"] == "no_info"

        FakeBleakClient.behaviour = "hang"
        result = await scanner.identify(address)
        assert result["error"]["code"] == "timeout"
        assert scanner.scanning and not scanner.identifying

    asyncio.run(scenario())


def test_identify_is_exclusive(fake_bleak):
    FakeBleakClient.behaviour = "hang"

    async def scenario():
        scanner = BleScanner(identify_timeout=0.3)
        await scanner.start()
        address = seen_device(scanner)
        first = asyncio.ensure_future(scanner.identify(address))
        await asyncio.sleep(0.01)
        second = await scanner.identify(address)
        assert second["error"]["code"] == "busy"
        assert (await first)["error"]["code"] == "timeout"

    asyncio.run(scenario())


def test_remembered_devices_are_bounded(fake_bleak, monkeypatch):
    monkeypatch.setattr(scanner_module, "MAX_REMEMBERED_DEVICES", 3)
    scanner = BleScanner()
    for index in range(5):
        seen_device(scanner, f"00:00:00:00:00:0{index}")
    assert list(scanner._devices) == ["00:00:00:00:00:02", "00:00:00:00:00:03", "00:00:00:00:00:04"]


def test_bluez_rssi_filter_is_requested(fake_bleak):
    created = {}

    class RecordingScanner(FakeBleakScanner):
        def __init__(self, detection_callback=None, **kwargs):
            super().__init__(detection_callback, **kwargs)
            created.update(kwargs)

    fake_bleak.BleakScanner = RecordingScanner

    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        await scanner.stop()

    asyncio.run(scenario())
    assert created["bluez"] == {"filters": {"DuplicateData": True, "RSSI": -127}}


def test_macos_enables_duplicate_adverts(fake_bleak, monkeypatch):
    calls = []

    class CentralManager:
        def scanForPeripheralsWithServices_options_(self, services, options):
            calls.append((services, options))

    class MacScanner(FakeBleakScanner):
        def __init__(self, detection_callback=None, **kwargs):
            super().__init__(detection_callback, **kwargs)
            self._backend = SimpleNamespace(_manager=SimpleNamespace(central_manager=CentralManager()))

    corebluetooth = types.ModuleType("CoreBluetooth")
    corebluetooth.CBCentralManagerScanOptionAllowDuplicatesKey = "kCBScanOptionAllowDuplicates"
    monkeypatch.setitem(sys.modules, "CoreBluetooth", corebluetooth)
    monkeypatch.setattr(scanner_module.sys, "platform", "darwin")
    fake_bleak.BleakScanner = MacScanner

    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        assert scanner._refresh_task is None
        await scanner.stop()

    asyncio.run(scenario())
    assert calls == [(None, {"kCBScanOptionAllowDuplicates": True})]


def test_macos_falls_back_to_restarting_the_scan(fake_bleak, monkeypatch):
    monkeypatch.setitem(sys.modules, "CoreBluetooth", None)  # import fails
    monkeypatch.setattr(scanner_module.sys, "platform", "darwin")
    monkeypatch.setattr(scanner_module, "MACOS_REFRESH_SECONDS", 0.01)

    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        assert scanner._refresh_task is not None
        await asyncio.sleep(0.08)
        bleak_scanner = FakeBleakScanner.instances[0]
        assert bleak_scanner.stopped >= 2 and bleak_scanner.started >= 3
        await scanner.stop()
        assert scanner._refresh_task is None
        stopped = bleak_scanner.stopped
        await asyncio.sleep(0.05)
        assert bleak_scanner.stopped == stopped

    asyncio.run(scenario())


@pytest.mark.parametrize("client_name, expected", [("Rasmus’ iPad", "Rasmus’ iPad"), ("AA-BB-CC-DD-EE-FF", None), ("", None), (None, None)])
def test_identify_falls_back_to_client_name(fake_bleak, client_name, expected):
    FakeBleakClient.reads = {scanner_module.MODEL_NUMBER_CHAR: b"iPad13,1"}
    FakeBleakClient.name = client_name

    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        address = seen_device(scanner)
        return await scanner.identify(address)

    try:
        result = asyncio.run(scenario())
    finally:
        del FakeBleakClient.name
    assert result["ok"] is True
    assert result["model"] == "iPad13,1"
    assert result["name"] == expected


def test_concurrent_starts_start_bleak_once(fake_bleak):
    class SlowScanner(FakeBleakScanner):
        async def start(self):
            await asyncio.sleep(0.05)
            await super().start()

    fake_bleak.BleakScanner = SlowScanner

    async def scenario():
        scanner = BleScanner()
        await asyncio.gather(scanner.start(), scanner.start(), scanner.start())
        assert scanner.scanning
        assert len(FakeBleakScanner.instances) == 1
        assert FakeBleakScanner.instances[0].started == 1

    asyncio.run(scenario())


def test_identify_keeps_busy_until_scanning_resumed(fake_bleak):
    FakeBleakClient.reads = {scanner_module.MODEL_NUMBER_CHAR: b"iPad13,1"}
    observed = []

    class ObservingScanner(FakeBleakScanner):
        async def start(self):
            observed.append(current.identifying)
            await super().start()

    fake_bleak.BleakScanner = ObservingScanner
    current = None

    async def scenario():
        nonlocal current
        current = BleScanner()
        await current.start()
        address = seen_device(current)
        await current.identify(address)
        assert not current.busy

    asyncio.run(scenario())
    # The restart after identify happens while still marked as identifying.
    assert observed == [False, True]


def test_cancelled_identify_does_not_restart_scanning(fake_bleak):
    FakeBleakClient.behaviour = "hang"

    async def scenario():
        scanner = BleScanner(identify_timeout=5)
        await scanner.start()
        address = seen_device(scanner)
        task = asyncio.ensure_future(scanner.identify(address))
        await asyncio.sleep(0.05)
        await scanner.shutdown()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not scanner.scanning
        assert not scanner.identifying
        assert FakeBleakScanner.instances[0].started == 1

    asyncio.run(scenario())


def test_restart_recreates_the_bleak_scanner(fake_bleak):
    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        await scanner.restart()
        assert scanner.scanning
        assert len(FakeBleakScanner.instances) == 2
        assert FakeBleakScanner.instances[0].stopped == 1

    asyncio.run(scenario())


def test_name_fallback_errors_do_not_lose_the_model(fake_bleak):
    FakeBleakClient.reads = {scanner_module.MODEL_NUMBER_CHAR: b"iPad13,1"}

    def broken_name(self):
        raise Exception("Not connected")

    FakeBleakClient.name = property(broken_name)

    async def scenario():
        scanner = BleScanner()
        await scanner.start()
        return await scanner.identify(seen_device(scanner))

    try:
        result = asyncio.run(scenario())
    finally:
        del FakeBleakClient.name
    assert result["ok"] is True and result["model"] == "iPad13,1" and result["name"] is None


def test_restart_waits_for_identify(fake_bleak):
    FakeBleakClient.behaviour = "hang"

    async def scenario():
        scanner = BleScanner(identify_timeout=0.3)
        await scanner.start()
        task = asyncio.ensure_future(scanner.identify(seen_device(scanner)))
        await asyncio.sleep(0.05)
        assert scanner.busy
        await scanner.restart()  # must not start a scan in the middle of the connection
        assert len(FakeBleakScanner.instances) == 1
        assert (await task)["error"]["code"] == "timeout"

    asyncio.run(scenario())
