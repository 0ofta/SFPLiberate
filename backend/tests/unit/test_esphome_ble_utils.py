"""Tests for ESPHome BLE helper conversions."""

import pytest
from aioesphomeapi.model import BluetoothGATTCharacteristic

from app.services.esphome.ble_utils import can_notify, can_write, int_to_mac, mac_to_int


@pytest.mark.parametrize(
    ("mac", "value"),
    [
        ("AA:BB:CC:DD:EE:FF", 0xAABBCCDDEEFF),
        ("aa-bb-cc-dd-ee-ff", 0xAABBCCDDEEFF),
        ("00:00:00:00:00:01", 1),
    ],
)
def test_mac_to_int(mac: str, value: int) -> None:
    assert mac_to_int(mac) == value


def test_int_to_mac_round_trip() -> None:
    assert int_to_mac(0xAABBCCDDEEFF) == "AA:BB:CC:DD:EE:FF"
    assert int_to_mac(1) == "00:00:00:00:00:01"
    assert int_to_mac(mac_to_int("12:34:56:78:9A:BC")) == "12:34:56:78:9A:BC"


def _char(properties: int) -> BluetoothGATTCharacteristic:
    # uuid is given in aioesphomeapi's protobuf [high, low] form
    return BluetoothGATTCharacteristic(uuid=[0, 1], handle=1, properties=properties, descriptors=[])


def test_gatt_property_bits() -> None:
    assert can_notify(_char(0x10))
    assert not can_write(_char(0x10))
    assert can_write(_char(0x08))
    assert can_write(_char(0x04))
    assert not can_notify(_char(0x08))
    assert not can_notify(_char(0x02))
    assert not can_write(_char(0x02))
