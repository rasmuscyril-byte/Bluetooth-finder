from types import SimpleNamespace

from ipad_finder.advert import advert_to_dict, normalize_uuid


def make_adv(**overrides):
    fields = dict(
        local_name=None,
        manufacturer_data={},
        service_data={},
        service_uuids=[],
        tx_power=None,
        rssi=-60,
        platform_data=(),
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def test_normalize_uuid_expands_short_forms():
    base = "-0000-1000-8000-00805f9b34fb"
    assert normalize_uuid("FE2C") == "0000fe2c" + base
    assert normalize_uuid("0xfd6f") == "0000fd6f" + base
    assert normalize_uuid("0000180A") == "0000180a" + base
    assert normalize_uuid(0x180F) == "0000180f" + base
    full = "d0611e78-bbb4-4591-a5f8-487910ae4366"
    assert normalize_uuid(full.upper()) == full


def test_advert_to_dict_hex_encodes_everything():
    device = SimpleNamespace(address="AA:BB:CC:DD:EE:FF", name="Cached name")
    adv = make_adv(
        local_name="Galaxy S23",
        manufacturer_data={0x004C: b"\x10\x05\x03\x1c\x3a\x2b\x1f", 0x0075: bytearray(b"\x42\x04")},
        service_data={"0000fd6f-0000-1000-8000-00805f9b34fb": b"\x01\x02"},
        service_uuids=["0000FE2C-0000-1000-8000-00805F9B34FB", "0000fe2c-0000-1000-8000-00805f9b34fb"],
        tx_power=12,
        rssi=-71,
    )
    raw = advert_to_dict(device, adv, now_ms=1234)
    assert raw == {
        "id": "AA:BB:CC:DD:EE:FF",
        "address": "AA:BB:CC:DD:EE:FF",
        "rssi": -71,
        "name": "Galaxy S23",
        "txPower": 12,
        "manufacturerData": {"76": "1005031c3a2b1f", "117": "4204"},
        "serviceData": {"0000fd6f-0000-1000-8000-00805f9b34fb": "0102"},
        "serviceUuids": ["0000fe2c-0000-1000-8000-00805f9b34fb"],
        "t": 1234,
    }


def test_advert_to_dict_falls_back_to_device_name_and_handles_missing_fields():
    device = SimpleNamespace(address="0E1D6A4C-2B67-4C47-9A0C-9D0B1C1E2F30", name="Rasmus’ iPad")
    raw = advert_to_dict(device, make_adv(rssi=None, manufacturer_data=None, service_uuids=None))
    assert raw["name"] == "Rasmus’ iPad"
    assert raw["rssi"] is None
    assert raw["manufacturerData"] == {}
    assert raw["serviceUuids"] == []
    assert isinstance(raw["t"], int) and raw["t"] > 0
