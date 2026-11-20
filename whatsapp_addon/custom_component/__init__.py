"""WhatsApp integration - talks to the WhatsApp app (add-on) over its local API."""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .whatsapp import Whatsapp, UNREACHABLE

DOMAIN = "whatsapp"
_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

# Extra keys are allowed so new app features don't need a schema change first.
_BASE = {vol.Required("clientId"): cv.string}

SEND_MESSAGE_SCHEMA = vol.Schema(
    {
        **_BASE,
        vol.Required("to"): cv.string,
        vol.Required("body"): dict,
        vol.Optional("options"): dict,
        vol.Optional("retry"): cv.boolean,
    },
    extra=vol.ALLOW_EXTRA,
)
SET_STATUS_SCHEMA = vol.Schema(
    {**_BASE, vol.Required("status"): cv.string}, extra=vol.ALLOW_EXTRA
)
PRESENCE_SUBSCRIBE_SCHEMA = vol.Schema(
    {**_BASE, vol.Required("userId"): cv.string}, extra=vol.ALLOW_EXTRA
)
PRESENCE_UPDATE_SCHEMA = vol.Schema(
    {
        **_BASE,
        vol.Required("type"): vol.In(
            ["unavailable", "available", "composing", "recording", "paused"]
        ),
        vol.Optional("to"): cv.string,
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    whatsapp = Whatsapp()

    async def send_message(call: ServiceCall) -> None:
        data = dict(call.data)
        result = await hass.async_add_executor_job(whatsapp.send_message, data)
        if result == UNREACHABLE:
            # The app could not fire its own failure event, so fire it here
            # so the resend automation still picks the message up.
            hass.bus.async_fire(
                "whatsapp_send_failed",
                {
                    **data,
                    "retry": bool(data.get("retry", False)),
                    "reason": "AppUnreachable",
                    "error": "WhatsApp app did not answer",
                },
            )

    async def set_status(call: ServiceCall) -> None:
        await hass.async_add_executor_job(whatsapp.set_status, dict(call.data))

    async def presence_subscribe(call: ServiceCall) -> None:
        await hass.async_add_executor_job(whatsapp.presence_subscribe, dict(call.data))

    async def send_presence_update(call: ServiceCall) -> None:
        await hass.async_add_executor_job(whatsapp.send_presence_update, dict(call.data))

    async def send_infinity_presence_update(call: ServiceCall) -> None:
        await hass.async_add_executor_job(
            whatsapp.send_infinity_presence_update, dict(call.data)
        )

    hass.services.async_register(DOMAIN, "send_message", send_message, SEND_MESSAGE_SCHEMA)
    hass.services.async_register(DOMAIN, "set_status", set_status, SET_STATUS_SCHEMA)
    hass.services.async_register(
        DOMAIN, "presence_subscribe", presence_subscribe, PRESENCE_SUBSCRIBE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "send_presence_update", send_presence_update, PRESENCE_UPDATE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        "send_infinity_presence_update",
        send_infinity_presence_update,
        PRESENCE_UPDATE_SCHEMA,
    )

    return True
