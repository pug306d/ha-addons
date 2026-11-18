import logging

import requests
from url_normalize import url_normalize

_LOGGER = logging.getLogger(__name__)

HOST = 'http://{{HOSTNAME}}:3000/'

# Results of a call to the WhatsApp app
OK = 'OK'
FAILED = 'FAILED'            # app answered KO (it fires whatsapp_send_failed itself)
UNREACHABLE = 'UNREACHABLE'  # app not answering, e.g. mid-restart


class Whatsapp:
    def _post(self, path, data):
        try:
            response = requests.post(url_normalize(f'{HOST}/{path}'), json=data, timeout=60)
        except requests.RequestException as err:
            _LOGGER.warning('WhatsApp app unreachable for %s: %s', path, err)
            return UNREACHABLE
        # The app answers with plain text OK / KO. The old code compared bytes
        # to a str, so a failure was never noticed.
        if response.text.strip() == 'OK':
            return OK
        _LOGGER.warning('WhatsApp %s failed - see the WhatsApp app log', path)
        return FAILED

    def send_message(self, data):
        return self._post('sendMessage', data)

    def set_status(self, data):
        return self._post('setStatus', data)

    def presence_subscribe(self, data):
        return self._post('presenceSubscribe', data)

    def send_presence_update(self, data):
        return self._post('sendPresenceUpdate', data)

    def send_infinity_presence_update(self, data):
        return self._post('sendInfinityPresenceUpdate', data)
