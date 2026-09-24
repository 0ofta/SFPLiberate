"""Tests for the ESPHome proxy BLE plumbing against the real aioesphomeapi API.

APIClient is autospecced, so every call is checked against the installed
aioesphomeapi method signatures (e.g. integer addresses, required callbacks).
"""

from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, create_autospec

import pytest
from aioesphomeapi.client import APIClient
from aioesphomeapi.model import (
    APIVersion,
    BluetoothGATTService,
    BluetoothLEAdvertisement,
    BluetoothProxyFeature,
    DeviceInfo,
    ESPHomeBluetoothGATTServices,
)

from app.services.esphome.connection_manager import ConnectionManager
from app.services.esphome.proxy_service import ESPHomeProxyService

MAC = "AA:BB:CC:DD:EE:FF"
MAC_INT = 0xAABBCCDDEEFF
SERVICE_UUID = "8e60f02e-f699-4865-b83f-f40501752184"
WRITE_UUID = "9280f26c-a56f-43ea-b769-d5d732e1ac67"
NOTIFY_UUID = "dc272a22-43f2-416b-8fa5-63a071542fac"
WRITE_HANDLE = 0x0B
NOTIFY_HANDLE = 0x0E

# GATT property bits: write-without-response | write, and notify
PROPS_WRITE = 0x04 | 0x08
PROPS_NOTIFY = 0x10


def _uuid(value: str) -> list[int]:
    """aioesphomeapi models take UUIDs in protobuf form: [high 64 bits, low 64 bits]."""
    n = int(value.replace("-", ""), 16)
    return [n >> 64, n & 0xFFFFFFFFFFFFFFFF]


def _char(uuid: str, handle: int, properties: int) -> dict[str, Any]:
    return {"uuid": _uuid(uuid), "handle": handle, "properties": properties, "descriptors": []}


def _gatt_services() -> ESPHomeBluetoothGATTServices:
    # Built through from_dict, the same conversion path aioesphomeapi uses for real responses
    return ESPHomeBluetoothGATTServices(
        address=MAC_INT,
        services=[
            BluetoothGATTService.from_dict(
                {
                    "uuid": _uuid("00001800-0000-1000-8000-00805f9b34fb"),
                    "handle": 1,
                    "characteristics": [
                        _char("00002a00-0000-1000-8000-00805f9b34fb", 3, 0x02),  # read only
                    ],
                }
            ),
            BluetoothGATTService.from_dict(
                {
                    "uuid": _uuid(SERVICE_UUID),
                    "handle": 10,
                    "characteristics": [
                        _char(WRITE_UUID, WRITE_HANDLE, PROPS_WRITE),
                        _char(NOTIFY_UUID, NOTIFY_HANDLE, PROPS_NOTIFY),
                    ],
                }
            ),
        ],
    )


def _mock_client() -> Any:
    client: Any = create_autospec(APIClient, instance=True)
    client.api_version = APIVersion(1, 10)
    client.device_info.return_value = DeviceInfo(
        name="proxy",
        bluetooth_proxy_feature_flags=(
            BluetoothProxyFeature.ACTIVE_CONNECTIONS | BluetoothProxyFeature.REMOTE_CACHING
        ),
    )
    client.bluetooth_device_connect.return_value = MagicMock(name="cancel_connection_callback")
    client.bluetooth_gatt_get_services.return_value = _gatt_services()
    client.bluetooth_gatt_start_notify.return_value = (
        AsyncMock(name="stop_notify"),
        MagicMock(name="remove_callback"),
    )
    return client


@pytest.fixture(autouse=True)
def fresh_singletons() -> Iterator[None]:
    ConnectionManager._instance = None
    ESPHomeProxyService._instance = None
    yield
    ConnectionManager._instance = None
    ESPHomeProxyService._instance = None


async def test_connect_device_uses_integer_address_and_required_callback() -> None:
    client = _mock_client()
    received: list[tuple[str, bytes]] = []

    manager = ConnectionManager()
    await manager.connect_device(
        client_id="ws-1",
        mac_address=MAC,
        proxy_name="proxy",
        client=client,
        service_uuid=SERVICE_UUID,
        notify_char_uuid=NOTIFY_UUID,
        write_char_uuid=WRITE_UUID,
        notification_callback=lambda uuid, data: received.append((uuid, data)),
    )

    connect_args = client.bluetooth_device_connect.call_args
    assert connect_args.args[0] == MAC_INT
    assert callable(connect_args.args[1])  # on_bluetooth_connection_state
    assert connect_args.kwargs["feature_flags"] & BluetoothProxyFeature.REMOTE_CACHING
    client.bluetooth_gatt_get_services.assert_awaited_once_with(MAC_INT)

    connection = manager.get_connection("ws-1")
    assert connection is not None
    assert (connection.write_handle, connection.notify_handle) == (WRITE_HANDLE, NOTIFY_HANDLE)

    # Notifications are enabled on the notify handle and forwarded as bytes with the UUID
    notify_args = client.bluetooth_gatt_start_notify.call_args
    assert notify_args.args[:2] == (MAC_INT, NOTIFY_HANDLE)
    on_notify = notify_args.args[2]
    on_notify(NOTIFY_HANDLE, bytearray(b"\x01\x02"))
    assert received == [(NOTIFY_UUID, b"\x01\x02")]


async def test_write_sends_bytes_to_write_handle() -> None:
    client = _mock_client()
    manager = ConnectionManager()
    await manager.connect_device(
        client_id="ws-1",
        mac_address=MAC,
        proxy_name="proxy",
        client=client,
        service_uuid=SERVICE_UUID,
        notify_char_uuid=NOTIFY_UUID,
        write_char_uuid=WRITE_UUID,
    )

    await manager.write_characteristic("ws-1", WRITE_UUID, b"GET /stats\n", with_response=False)

    client.bluetooth_gatt_write.assert_awaited_once_with(
        address=MAC_INT, handle=WRITE_HANDLE, data=b"GET /stats\n", response=False
    )


async def test_disconnect_stops_notify_and_disconnects_by_integer_address() -> None:
    client = _mock_client()
    stop_notify, _remove = client.bluetooth_gatt_start_notify.return_value
    cancel = client.bluetooth_device_connect.return_value

    manager = ConnectionManager()
    await manager.connect_device(
        client_id="ws-1",
        mac_address=MAC,
        proxy_name="proxy",
        client=client,
        service_uuid=SERVICE_UUID,
        notify_char_uuid=NOTIFY_UUID,
        write_char_uuid=WRITE_UUID,
        notification_callback=lambda uuid, data: None,
    )
    await manager.disconnect_device("ws-1")

    stop_notify.assert_awaited_once_with()
    client.bluetooth_device_disconnect.assert_awaited_once_with(MAC_INT)
    cancel.assert_called_once_with()
    assert not manager.is_connected("ws-1")


async def test_proxy_service_discovers_uuids_from_gatt_property_bits() -> None:
    client = _mock_client()
    service = ESPHomeProxyService()
    service.device_manager.update_device(mac=MAC, name="SFP-Wizard", rssi=-60, proxy_name="proxy")
    service.proxy_manager.clients["proxy"] = client

    result = await service.connect_to_device(MAC.lower())

    assert (result.service_uuid, result.notify_char_uuid, result.write_char_uuid) == (
        SERVICE_UUID,
        NOTIFY_UUID,
        WRITE_UUID,
    )
    assert result.proxy_used == "proxy"
    assert client.bluetooth_device_connect.call_args.args[0] == MAC_INT
    # Discovery connections are always torn down afterwards
    client.bluetooth_device_disconnect.assert_awaited_once_with(MAC_INT)


def test_advertisement_with_integer_address_is_tracked_by_mac_string() -> None:
    service = ESPHomeProxyService()
    advertisement = BluetoothLEAdvertisement(
        address=MAC_INT,
        rssi=-55,
        address_type=0,
        name="SFP-Wizard",
        service_uuids=[],
        service_data={},
        manufacturer_data={},
    )

    service._handle_advertisement(advertisement, proxy_name="proxy")

    device = service.device_manager.get_device(MAC)
    assert device is not None
    assert device.name == "SFP-Wizard"
    assert service.device_manager.select_best_proxy(MAC) == "proxy"
