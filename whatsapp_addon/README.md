# Home Assistant App: WhatsApp (Lodge)

_Send and receive WhatsApp messages from Home Assistant._

[![Add this repository to your Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fpug306d%2Fha-addons)

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]
![Supports armhf Architecture][armhf-shield]
![Supports armv7 Architecture][armv7-shield]
![Supports i386 Architecture][i386-shield]

A maintained fork of [giuseppecastaldo/ha-addons](https://github.com/giuseppecastaldo/ha-addons) (Apache 2.0), which is no longer actively developed. It connects through WhatsApp Web using the [Baileys](https://github.com/WhiskeySockets/Baileys) library.

**What this fork adds** (see the changelog for details):

- Self-healing: the app restarts itself when WhatsApp disconnects and does not come back
- Failed messages are handed back to Home Assistant (`whatsapp_send_failed` event) so they can be resent
- A connection sensor per client: `binary_sensor.whatsapp_<client>_connected`
- A per-install API token, so other apps cannot send messages as you
- Fixes for stuck "Waiting for this message", logout crashes and presence updates

**NOTE:** WhatsApp does not allow unofficial clients. This has worked well in practice, but there is no guarantee your number will not be restricted.

## Installation

1. Add this repository: **Settings → Apps → App Store → ⋮ → Repositories** and paste `https://github.com/pug306d/ha-addons` (or use the button above).
2. Install **Whatsapp (Lodge)** and start it.
3. A notification with a QR code appears. In WhatsApp on your phone: **Settings → Linked devices → Link a device**, then scan it.
4. Add this line to `configuration.yaml` (first install only) and restart Home Assistant:

```yaml
whatsapp:
```

You will then have the `whatsapp.send_message` action and the connection sensor. See the **Documentation** tab for examples.

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg
