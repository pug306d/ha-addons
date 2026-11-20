## 1.7.0 (pug306d fork)

- Now installable from the App Store: add `https://github.com/pug306d/ha-addons` as a repository
- Renamed to **Whatsapp (Lodge)**, docs and links point at the fork
- New connection sensor per client: `binary_sensor.whatsapp_<client>_connected`
- Docs: events, resend automation, security and troubleshooting
- Dependencies: lock file for the app, `log4js` no longer allowed to jump major versions

## 1.6.0 (pug306d fork)

- Self-heal: the app restarts itself (via the Supervisor watchdog) when WhatsApp disconnects and does not come back, or when a send fails because of it
- New events: `whatsapp_send_failed` (carries the message, so HA can resend it), `whatsapp_client_ready`, `whatsapp_client_restarting`
- New `GET /status` endpoint with per-client connection health
- Security: the API now needs a per-install token (created automatically and passed to the integration); CORS and unused Supervisor API access removed
- Fixed: being logged out by WhatsApp crashed the app instead of showing a new QR code
- Fixed: `send_infinity_presence_update` failed every time
- Fixed: a failed presence keep-alive could crash the app
- Fixed: connect errors and late events from an old connection could leave the client dead
- New option `baileys_log_level` (default `error`) - WhatsApp library logs were silenced completely
- Integration: service schemas, failures logged in HA, `whatsapp_send_failed` fired when the app is unreachable, `url-normalize` dependency removed
- Fixed stuck "Waiting for this message" (message cache for retry requests)

## 1.5.0

- Updated whatsapp library
- Updated docker base image

## 1.4.1

- Bug QR-Code fixed

## 1.4.0

- Updated whatsapp library
- Changed session saving method
- Special functions such as sending buttons, sending lists, etc., are no longer available.

## 1.3.5

- Revert [(Pull request)](https://github.com/giuseppecastaldo/ha-addons/pull/33)

## 1.3.4

- Bug fixed [(Pull request)](https://github.com/giuseppecastaldo/ha-addons/pull/33)
- Bug fixed [(Pull request)](https://github.com/giuseppecastaldo/ha-addons/pull/55)

## 1.3.3

- Added donation button.

## 1.3.2

- Bug fixed.

## 1.3.0

- Bug fixed.

## 1.2.4

- Bug fixed.
- Added patch for receive button on iOS (Attention! iOS receive buttons only if app is open (it seems to be a iOS app bug))

## 1.2.2

- Added the ability to always be online or offline. This could lead to not receiving notifications on other devices. (**Restard required**)
- Bug fixed.

## 1.2.1

- Fixed bug that did not allow the reception of push notifications on other devices.
- Added event presence update.
- Added two more services like subscribe presence and send presence update.

## 1.2.0

- **Changed radically command and events. Please refer to doc and developer tools for change your automations.**
- **Performance boost! (Required re-authentication)**
- Bug fixed on send location.
- Bug fixed on send mulitple buttons.

## 1.1.2

- Bug fixed.
- Performance improvements.

## 1.1.1

- Migration from Home Assistant base image to Debian image

## 1.1.0

- Added the ability to manage multiple whatsapp sessions (re-authentication required)
- Buttons bug fixed (better visibility on android devices)
- Message options bug fixed
- Bug fixed.

**NOTE:** If you have problems with the custom components being updated, please follow this steps:

- Remove Whatsapp configuration in _configuration.yaml_
- Restart Home Assistant
- Add Whatsapp configuration in _configuration.yaml_
- Restart Home Assistant

## 1.0.2

- Addedd message revoke event.
- Added buttons message type (view documentation) (may not work properly on some devices)
- Added set status service (for sets the current user's status message)
- Bug fixed.

## 1.0.1

- Initial release
