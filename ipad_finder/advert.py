"""Convert bleak advertisement objects into the RawAdvert dict sent to the browser."""

from __future__ import annotations

import time
from typing import Any, Iterable, Mapping, Optional

BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb"


def normalize_uuid(uuid: Any) -> str:
    """Return a full 128-bit lowercase UUID string.

    16- and 32-bit short forms (``"fe2c"``, ``"0000fe2c"`` or an int) are
    expanded with the Bluetooth base UUID.
    """
    if isinstance(uuid, int):
        return f"{uuid:08x}{BASE_UUID_SUFFIX}"
    text = str(uuid).strip().lower()
    if text.startswith("0x"):
        text = text[2:]
    if len(text) == 4:
        return f"0000{text}{BASE_UUID_SUFFIX}"
    if len(text) == 8:
        return f"{text}{BASE_UUID_SUFFIX}"
    return text


def _to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _hex_map(data: Optional[Mapping[Any, Any]], key_fn) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in (data or {}).items():
        try:
            result[key_fn(key)] = bytes(value).hex()
        except (TypeError, ValueError):
            continue
    return result


def _uuid_list(uuids: Optional[Iterable[Any]]) -> list[str]:
    return sorted({normalize_uuid(u) for u in (uuids or [])})


def advert_to_dict(device: Any, adv: Any, now_ms: Optional[int] = None) -> dict[str, Any]:
    """Build a RawAdvert from a bleak ``BLEDevice`` and ``AdvertisementData``.

    On macOS the address is a CoreBluetooth UUID instead of a MAC address; it
    is still stable for as long as the remote device keeps its (random) address.
    """
    address = str(device.address)
    name = getattr(adv, "local_name", None) or getattr(device, "name", None) or None
    return {
        "id": address,
        "address": address,
        "rssi": _to_int(getattr(adv, "rssi", None)),
        "name": name,
        "txPower": _to_int(getattr(adv, "tx_power", None)),
        "manufacturerData": _hex_map(getattr(adv, "manufacturer_data", None), lambda k: str(int(k))),
        "serviceData": _hex_map(getattr(adv, "service_data", None), normalize_uuid),
        "serviceUuids": _uuid_list(getattr(adv, "service_uuids", None)),
        "t": int(time.time() * 1000) if now_ms is None else int(now_ms),
    }
