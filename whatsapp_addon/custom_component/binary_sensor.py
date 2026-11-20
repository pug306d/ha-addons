"""Connection sensor per WhatsApp client, fed by the app's GET /status."""
from __future__ import annotations

from datetime import timedelta
import logging

import aiohttp

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.typing import ConfigType, DiscoveryInfoType
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .whatsapp import BASE_URL

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=30)
UNREACHABLE = "_app_unreachable"


async def async_setup_platform(
    hass: HomeAssistant,
    config: ConfigType,
    async_add_entities: AddEntitiesCallback,
    discovery_info: DiscoveryInfoType | None = None,
) -> None:
    session = async_get_clientsession(hass)

    async def _fetch() -> dict:
        # Never raise: an unreachable app should read as "disconnected",
        # not make the sensor unavailable (which is easy to miss in alerts).
        try:
            async with session.get(
                f"{BASE_URL}/status", timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                resp.raise_for_status()
                return await resp.json()
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            _LOGGER.debug("WhatsApp app status unavailable: %s", err)
            return {UNREACHABLE: True}

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name="whatsapp_status",
        update_method=_fetch,
        update_interval=SCAN_INTERVAL,
    )
    await coordinator.async_refresh()

    known: set[str] = set()

    @callback
    def _add_new_clients() -> None:
        new = [
            c for c in (coordinator.data or {}) if c != UNREACHABLE and c not in known
        ]
        if new:
            known.update(new)
            async_add_entities(WhatsappConnected(coordinator, c) for c in new)

    _add_new_clients()
    # Clients that only appear later (app was down at start-up) get added then.
    coordinator.async_add_listener(_add_new_clients)


class WhatsappConnected(CoordinatorEntity, BinarySensorEntity):
    """On while the client is connected to WhatsApp."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_icon = "mdi:whatsapp"

    def __init__(self, coordinator: DataUpdateCoordinator, client: str) -> None:
        super().__init__(coordinator)
        self._client = client
        self._attr_name = f"WhatsApp {client} connected"
        self._attr_unique_id = f"whatsapp_{client}_connected"

    @property
    def _health(self) -> dict | None:
        data = self.coordinator.data or {}
        return None if UNREACHABLE in data else data.get(self._client)

    @property
    def is_on(self) -> bool:
        health = self._health
        return bool(health and health.get("connected"))

    @property
    def extra_state_attributes(self) -> dict:
        health = self._health
        if health is None:
            return {"app_reachable": False}
        return {
            "app_reachable": True,
            "awaiting_qr": health.get("awaitingQr", False),
            "logged_out": health.get("loggedOut", False),
            "down_for_seconds": round(health.get("downForMs", 0) / 1000),
        }
