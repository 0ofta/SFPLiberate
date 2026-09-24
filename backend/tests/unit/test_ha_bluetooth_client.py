"""Tests for HomeAssistantBluetoothClient configuration and WebSocket startup."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.ha_bluetooth.ha_bluetooth_client import HomeAssistantBluetoothClient


def test_ws_url_defaults_to_supervisor_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HA_WS_URL", raising=False)
    assert HomeAssistantBluetoothClient().ha_ws_url == "ws://supervisor/core/websocket"


def test_ws_url_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HA_WS_URL", "ws://example:8123/api/websocket")
    assert HomeAssistantBluetoothClient().ha_ws_url == "ws://example:8123/api/websocket"


def test_ws_url_argument_wins_over_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HA_WS_URL", "ws://from-env/websocket")
    client = HomeAssistantBluetoothClient(ha_ws_url="ws://from-arg/websocket")
    assert client.ha_ws_url == "ws://from-arg/websocket"


async def test_websocket_listener_without_session_returns_cleanly() -> None:
    client = HomeAssistantBluetoothClient()
    assert client._session is None
    await client._websocket_listener()  # must not raise
    assert client._ws is None


async def test_websocket_listener_connects_to_configured_url() -> None:
    client = HomeAssistantBluetoothClient(ha_ws_url="ws://ha/websocket", supervisor_token="tok")
    ws = MagicMock()
    ws.send_json = AsyncMock()
    ws.receive_json = AsyncMock(return_value={"type": "auth_invalid"})
    session = MagicMock()
    session.ws_connect = AsyncMock(return_value=ws)
    client._session = session

    await client._websocket_listener()

    session.ws_connect.assert_awaited_once_with("ws://ha/websocket")
    ws.send_json.assert_any_await({"type": "auth", "access_token": "tok"})
