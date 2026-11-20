"""Blocking HTTP client for the WhatsApp app. Run it in the executor."""
import logging

import requests

_LOGGER = logging.getLogger(__name__)

# Both placeholders are filled in by the app's run.sh at start-up.
BASE_URL = "http://{{HOSTNAME}}:3000"
API_TOKEN = "{{API_TOKEN}}"

# Results of a call to the WhatsApp app
OK = "OK"
FAILED = "FAILED"            # app answered KO (it fires whatsapp_send_failed itself)
UNREACHABLE = "UNREACHABLE"  # app not answering, e.g. mid-restart


class Whatsapp:
    def _post(self, path, data):
        try:
            response = requests.post(
                f"{BASE_URL}/{path}",
                json=data,
                headers={"X-Api-Token": API_TOKEN},
                timeout=60,
            )
        except requests.RequestException as err:
            _LOGGER.warning("WhatsApp app unreachable for %s: %s", path, err)
            return UNREACHABLE
        if response.status_code == 401:
            _LOGGER.error(
                "WhatsApp app rejected %s: API token mismatch - restart Home "
                "Assistant after the app has started so it loads the new token",
                path,
            )
            return FAILED
        # The app answers with plain text OK / KO.
        if response.text.strip() == "OK":
            return OK
        _LOGGER.warning("WhatsApp %s failed - see the WhatsApp app log", path)
        return FAILED

    def send_message(self, data):
        return self._post("sendMessage", data)

    def set_status(self, data):
        return self._post("setStatus", data)

    def presence_subscribe(self, data):
        return self._post("presenceSubscribe", data)

    def send_presence_update(self, data):
        return self._post("sendPresenceUpdate", data)

    def send_infinity_presence_update(self, data):
        return self._post("sendInfinityPresenceUpdate", data)
