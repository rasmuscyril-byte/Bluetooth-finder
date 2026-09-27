"""Bluetooth scanning and GATT "identify" on top of bleak.

Works with bleak 1.x, 2.x and 3.x on Windows, macOS and Linux.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from collections import OrderedDict
from typing import Any, Callable, Optional

from .advert import advert_to_dict

log = logging.getLogger(__name__)

MANUFACTURER_NAME_CHAR = "00002a29-0000-1000-8000-00805f9b34fb"
MODEL_NUMBER_CHAR = "00002a24-0000-1000-8000-00805f9b34fb"
DEVICE_NAME_CHAR = "00002a00-0000-1000-8000-00805f9b34fb"

MAX_REMEMBERED_DEVICES = 4000

# BlueZ only reports a new RSSI when it moved by >= 8 dB, unless a discovery
# filter with an RSSI threshold is set. We need every reading for the meter.
BLUEZ_ARGS = {"filters": {"DuplicateData": True, "RSSI": -127}}

# macOS fallback when duplicates cannot be enabled: restart the scan this often.
MACOS_REFRESH_SECONDS = 1.5

PERMISSION_MESSAGE = (
    "Programmet har ikke tilladelse til at bruge Bluetooth. "
    "(Mac: Systemindstillinger → Anonymitet og sikkerhed → Bluetooth → giv Terminal adgang.)"
)

# Danish messages for bleak's BleakBluetoothNotAvailableReason (bleak >= 2).
REASON_MESSAGES = {
    "NO_BLUETOOTH": ("no_bluetooth", "Der blev ikke fundet nogen Bluetooth-adapter på denne computer."),
    "NO_BLE_CENTRAL_ROLE": ("no_ble", "Bluetooth-adapteren understøtter ikke Bluetooth Low Energy."),
    "POWERED_OFF": ("powered_off", "Bluetooth er slået fra. Slå Bluetooth til og prøv igen."),
    "DENIED_BY_USER": ("denied", PERMISSION_MESSAGE),
    "DENIED_BY_SYSTEM": ("denied", PERMISSION_MESSAGE),
    "DENIED_BY_UNKNOWN": ("denied", PERMISSION_MESSAGE),
}

IDENTIFY_MESSAGES = {
    "not_found": "Enheden er ikke set for nylig. Vent til den dukker op igen, og prøv så igen.",
    "busy": "Jeg er allerede ved at identificere en anden enhed. Vent et øjeblik.",
    "timeout": "Enheden svarede ikke i tide. Gå tættere på og prøv igen.",
    "connect_failed": "Enheden tillod ikke forbindelse. Det er helt normalt for mange enheder.",
    "no_info": "Der var forbindelse, men enheden oplyste ikke sin model.",
    "unavailable": "Identifikation er ikke mulig lige nu, fordi Bluetooth ikke kører.",
}


class BluetoothUnavailable(Exception):
    """Raised when scanning cannot start; carries a code and a Danish message."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def describe_error(exc: BaseException) -> tuple[str, str]:
    """Map a bleak/OS exception to ``(code, danish_message)``."""
    reason = getattr(exc, "reason", None)
    reason_name = getattr(reason, "name", None)
    if reason_name in REASON_MESSAGES:
        return REASON_MESSAGES[reason_name]

    text = str(exc)
    lowered = text.lower()
    if "turned off" in lowered or "powered bluetooth" in lowered or "is bluetooth turned on" in lowered:
        return REASON_MESSAGES["POWERED_OFF"]
    if "not authorized" in lowered or "unauthorized" in lowered or "permission" in lowered:
        return REASON_MESSAGES["DENIED_BY_USER"]
    if "no bluetooth adapters" in lowered or "unsupported" in lowered:
        return REASON_MESSAGES["NO_BLUETOOTH"]
    if isinstance(exc, (FileNotFoundError, ConnectionRefusedError)) or "dbus" in lowered or "bluez" in lowered:
        return (
            "bluez",
            "Bluetooth-tjenesten svarer ikke. (Linux: kør 'sudo systemctl start bluetooth' og prøv igen.)",
        )
    detail = text or exc.__class__.__name__
    return ("unknown", f"Bluetooth kunne ikke startes: {detail}")


def identify_error(device_id: str, code: str) -> dict[str, Any]:
    return {"ok": False, "id": device_id, "error": {"code": code, "message": IDENTIFY_MESSAGES[code]}}


def _decode_text(raw: Any) -> Optional[str]:
    text = bytes(raw).split(b"\x00", 1)[0].decode("utf-8", "replace").strip()
    return text or None


class BleScanner:
    """Scans continuously and forwards every advert as a RawAdvert dict."""

    supports_identify = True

    def __init__(
        self,
        on_advert: Optional[Callable[[dict[str, Any]], None]] = None,
        *,
        connect_timeout: float = 10.0,
        identify_timeout: float = 20.0,
    ) -> None:
        self.on_advert = on_advert
        self.connect_timeout = connect_timeout
        self.identify_timeout = identify_timeout
        self.scanning = False
        self.identifying = False
        self.error: Optional[dict[str, str]] = None
        self._scanner: Any = None
        self._devices: OrderedDict[str, Any] = OrderedDict()
        self._lock: Optional[asyncio.Lock] = None
        self._refresh_task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        """Start scanning. Raises BluetoothUnavailable with a Danish message."""
        if self.scanning:
            return
        try:
            from bleak import BleakScanner

            if self._scanner is None:
                self._scanner = BleakScanner(detection_callback=self._detected, bluez=BLUEZ_ARGS)
            await self._scanner.start()
        except Exception as exc:  # bleak raises many different types per platform
            self._scanner = None
            code, message = describe_error(exc)
            self.error = {"code": code, "message": message}
            log.debug("Scanner start failed", exc_info=True)
            raise BluetoothUnavailable(code, message) from exc
        self.scanning = True
        self.error = None
        if sys.platform == "darwin" and not self._allow_duplicates_macos() and self._refresh_task is None:
            self._refresh_task = asyncio.ensure_future(self._refresh_loop())

    async def stop(self) -> None:
        if self._refresh_task is not None:
            self._refresh_task.cancel()
            self._refresh_task = None
        if self._scanner is not None and self.scanning:
            try:
                await self._scanner.stop()
            except Exception:
                log.debug("Scanner stop failed", exc_info=True)
        self.scanning = False

    def _allow_duplicates_macos(self) -> bool:
        """Ask CoreBluetooth to report every advert, not just the first one.

        bleak starts the scan without CBCentralManagerScanOptionAllowDuplicatesKey,
        so macOS would coalesce repeated adverts and the signal strength would
        hardly ever update. Scanning again with new options replaces the old ones.
        """
        try:
            from CoreBluetooth import CBCentralManagerScanOptionAllowDuplicatesKey  # type: ignore

            manager = self._scanner._backend._manager.central_manager
            manager.scanForPeripheralsWithServices_options_(None, {CBCentralManagerScanOptionAllowDuplicatesKey: True})
            return True
        except Exception:
            log.debug("Could not enable duplicate adverts on macOS; restarting scans instead", exc_info=True)
            return False

    async def _refresh_loop(self) -> None:
        """Fallback for macOS: a restarted scan reports every device again."""
        while True:
            await asyncio.sleep(MACOS_REFRESH_SECONDS)
            if self._scanner is None or not self.scanning or self.identifying:
                continue
            try:
                await self._scanner.stop()
                await self._scanner.start()
            except Exception:
                log.debug("Scan refresh failed", exc_info=True)

    def _detected(self, device: Any, adv: Any) -> None:
        self._remember(device)
        callback = self.on_advert
        if callback is None:
            return
        try:
            callback(advert_to_dict(device, adv))
        except Exception:
            log.exception("Could not forward advert")

    def _remember(self, device: Any) -> None:
        address = str(device.address)
        self._devices[address] = device
        self._devices.move_to_end(address)
        while len(self._devices) > MAX_REMEMBERED_DEVICES:
            self._devices.popitem(last=False)

    async def identify(self, device_id: str) -> dict[str, Any]:
        """Connect to a device and read its Device Information (model number).

        Scanning is paused while connecting (several platforms refuse to
        connect while a scan is running) and always resumed afterwards.
        """
        if self._lock is None:
            self._lock = asyncio.Lock()
        if self._lock.locked():
            return identify_error(device_id, "busy")
        async with self._lock:
            device = self._devices.get(device_id)
            if device is None:
                return identify_error(device_id, "not_found")
            was_scanning = self.scanning
            self.identifying = True
            try:
                await self.stop()
                info = await asyncio.wait_for(self._read_info(device), self.identify_timeout)
            except asyncio.TimeoutError:
                return identify_error(device_id, "timeout")
            except Exception:
                log.debug("Identify failed", exc_info=True)
                return identify_error(device_id, "connect_failed")
            finally:
                self.identifying = False
                if was_scanning:
                    try:
                        await self.start()
                    except BluetoothUnavailable:
                        log.warning("Could not resume scanning after identify")
            if not any(info.values()):
                return identify_error(device_id, "no_info")
            return {"ok": True, "id": device_id, **info}

    async def _read_info(self, device: Any) -> dict[str, Optional[str]]:
        from bleak import BleakClient

        client = BleakClient(device, timeout=self.connect_timeout)
        info: dict[str, Optional[str]] = {"manufacturer": None, "model": None, "name": None}
        await client.connect()
        try:
            for key, uuid in (
                ("manufacturer", MANUFACTURER_NAME_CHAR),
                ("model", MODEL_NUMBER_CHAR),
                ("name", DEVICE_NAME_CHAR),  # not readable on macOS; ignored then
            ):
                try:
                    info[key] = _decode_text(await client.read_gatt_char(uuid))
                except Exception:
                    log.debug("Could not read %s", key, exc_info=True)
        finally:
            try:
                await client.disconnect()
            except Exception:
                log.debug("Disconnect failed", exc_info=True)
        return info
