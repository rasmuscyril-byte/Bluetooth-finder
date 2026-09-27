"""A deterministic stand-in for BleScanner, used by tests and ``--fake-scanner``.

It emits a handful of canned adverts with slowly drifting signal strength so
the whole bridge → browser pipeline can be exercised without Bluetooth.
"""

from __future__ import annotations

import asyncio
import random
import time
from typing import Any, Callable, Optional

from .scanner import identify_error

# (id, name, manufacturerData, serviceUuids, base rssi, identify model)
CANNED_DEVICES: list[tuple[str, Optional[str], dict[str, str], list[str], int, Optional[str]]] = [
    # Apple, Continuity "Nearby Info" (type 0x10), screen off.
    ("AA:BB:CC:00:00:01", None, {"76": "1005031c3a2b1f"}, [], -74, "iPad13,1"),
    # Apple, Nearby Info, screen on (the phone in your hand).
    ("AA:BB:CC:00:00:02", None, {"76": "1005071c9d4e21"}, [], -45, "iPhone15,2"),
    # Apple, Proximity Pairing (AirPods Pro, model 0x0e20), 25-byte status message.
    ("AA:BB:CC:00:00:03", None, {"76": "0719010e205598b8310000" + "5a" * 16}, [], -68, None),
    # Samsung phone.
    ("AA:BB:CC:00:00:04", "Galaxy S23", {"117": "42040180"}, [], -80, None),
    # Anonymous device without data.
    ("AA:BB:CC:00:00:05", None, {}, [], -92, None),
]


class FakeScanner:
    supports_identify = True

    def __init__(
        self,
        on_advert: Optional[Callable[[dict[str, Any]], None]] = None,
        *,
        interval: float = 0.2,
        seed: int = 7,
        autostart_emitting: bool = True,
    ) -> None:
        self.on_advert = on_advert
        self.interval = interval
        self.scanning = False
        self.identifying = False
        self.error: Optional[dict[str, str]] = None
        self.fail_start: Optional[tuple[str, str]] = None
        self.identify_calls: list[str] = []
        self._random = random.Random(seed)
        self._rssi = {device[0]: float(device[4]) for device in CANNED_DEVICES}
        self._task: Optional[asyncio.Task[None]] = None
        self._autostart_emitting = autostart_emitting

    async def start(self) -> None:
        if self.fail_start is not None:
            from .scanner import BluetoothUnavailable

            code, message = self.fail_start
            self.error = {"code": code, "message": message}
            raise BluetoothUnavailable(code, message)
        self.scanning = True
        self.error = None
        if self._autostart_emitting and self._task is None:
            self._task = asyncio.ensure_future(self._run())

    async def stop(self) -> None:
        self.scanning = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def emit(self, advert: dict[str, Any]) -> None:
        """Push one RawAdvert (tests)."""
        if self.on_advert is not None:
            self.on_advert(advert)

    def emit_canned(self) -> None:
        now = int(time.time() * 1000)
        for device_id, name, manufacturer, services, base, _model in CANNED_DEVICES:
            current = self._rssi[device_id]
            current += self._random.uniform(-2.0, 2.0) + (base - current) * 0.1
            self._rssi[device_id] = current
            self.emit(
                {
                    "id": device_id,
                    "address": device_id,
                    "rssi": int(round(current)),
                    "name": name,
                    "txPower": None,
                    "manufacturerData": dict(manufacturer),
                    "serviceData": {},
                    "serviceUuids": list(services),
                    "t": now,
                }
            )

    async def _run(self) -> None:
        while True:
            self.emit_canned()
            await asyncio.sleep(self.interval)

    async def identify(self, device_id: str) -> dict[str, Any]:
        self.identify_calls.append(device_id)
        for known_id, name, _manufacturer, _services, _base, model in CANNED_DEVICES:
            if known_id == device_id:
                if model is None:
                    return identify_error(device_id, "connect_failed")
                return {"ok": True, "id": device_id, "manufacturer": "Apple Inc.", "model": model, "name": name}
        return identify_error(device_id, "not_found")
