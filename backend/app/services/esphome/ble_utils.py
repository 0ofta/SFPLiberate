"""Helpers for talking to BLE devices through the aioesphomeapi client."""

from collections.abc import Callable

import structlog
from aioesphomeapi.client import APIClient
from aioesphomeapi.model import BluetoothGATTCharacteristic

logger = structlog.get_logger()

# GATT characteristic property bits (Bluetooth Core Spec Vol 3, Part G, 3.3.1.1).
# aioesphomeapi exposes BluetoothGATTCharacteristic.properties as this raw bitmask.
GATT_PROP_WRITE_WITHOUT_RESPONSE = 0x04
GATT_PROP_WRITE = 0x08
GATT_PROP_NOTIFY = 0x10


def mac_to_int(mac_address: str) -> int:
    """Convert "AA:BB:CC:DD:EE:FF" (or "-" separated) to the integer aioesphomeapi expects."""
    return int(mac_address.replace(":", "").replace("-", ""), 16)


def int_to_mac(address: int) -> str:
    """Convert an aioesphomeapi integer address to "AA:BB:CC:DD:EE:FF"."""
    hex_str = f"{address:012X}"
    return ":".join(hex_str[i : i + 2] for i in range(0, 12, 2))


def can_notify(characteristic: BluetoothGATTCharacteristic) -> bool:
    """Whether the characteristic supports notifications."""
    return bool(characteristic.properties & GATT_PROP_NOTIFY)


def can_write(characteristic: BluetoothGATTCharacteristic) -> bool:
    """Whether the characteristic supports writes (with or without response)."""
    return bool(characteristic.properties & (GATT_PROP_WRITE | GATT_PROP_WRITE_WITHOUT_RESPONSE))


async def connect_ble_device(
    client: APIClient, mac_address: str, timeout: float
) -> Callable[[], None]:
    """Connect a proxy to a BLE device and wait until the connection is up.

    Uses the proxy's advertised Bluetooth feature flags so aioesphomeapi picks
    the right connection request type.

    Returns:
        Callback that unsubscribes from connection state updates.
    """
    device_info = await client.device_info()
    api_version = client.api_version
    feature_flags = (
        device_info.bluetooth_proxy_feature_flags_compat(api_version)
        if api_version is not None
        else device_info.bluetooth_proxy_feature_flags
    )

    def on_connection_state(connected: bool, mtu: int, error: int) -> None:
        logger.debug(
            "esphome_ble_connection_state",
            mac=mac_address,
            connected=connected,
            mtu=mtu,
            error=error,
        )

    return await client.bluetooth_device_connect(
        mac_to_int(mac_address),
        on_connection_state,
        timeout=timeout,
        feature_flags=feature_flags,
    )
