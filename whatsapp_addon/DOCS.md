# Home Assistant Add-on: Whatsapp add-on

## How to use

### **How to add other Whatsapp sessions**

Go to configuration page in clients input box digit the desired clientId. This one represents an identifier for the session.

### **How to get a User ID**

The user id is made from three parts:

- Country code (Example 39 (Italy))
- User's number
- And a static part: @s.whatsapp.net (for users) @g.us (for groups)

For example for Italian number _3456789010_ the user id is the following _393456789010@s.whatsapp.net_

### **Send a simple text message**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net # User ID
  body:
    text: Hi it's a simple text message
```

### **How to send an image**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net
  body:
    image:
      url: "https://dummyimage.com/600x400/000/fff.png"
    caption: Simple text
```

### **How to send audio message**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net
  body:
    audio:
      url: "https://github.com/pug306d/ha-addons/blob/main/whatsapp_addon/examples/hello_world.mp3?raw=true"
    ptt: true # Send audio as a voice
```

### **How to send a location**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net
  body:
    location:
      degreesLatitude: 24.121231
      degreesLongitude: 55.1121221
```

### **How to subscribe to presence update**

```yaml
service: whatsapp.presence_subscribe
data:
  clientId: default
  userId: 391234567890@s.whatsapp.net
```

---

## Events

| Event type               | Description                           |
| ------------------------ | ------------------------------------- |
| new_whatsapp_message     | The message that was received         |
| whatsapp_presence_update | Presence of contact in a chat updated |

---

## **Sample automations**

## Ping Pong

```yaml
- alias: Ping Pong
  description: ""
  trigger:
    - platform: event
      event_type: new_whatsapp_message
  condition:
    - condition: template
      value_template: "{{ trigger.event.data.message.conversation == '!ping' }}"
  action:
    - service: whatsapp.send_message
      data:
        clientId: default
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          text: pong
  mode: single
```

## Arrive at home

```yaml
- alias: Arrive at home
  description: ""
  trigger:
    - platform: device
      domain: device_tracker
      entity_id: device_tracker.iphone_13_pro
      type: enter
      zone: zone.home
  condition: []
  action:
    - service: whatsapp.send_message
      data:
        clientId: default
        to: 391234567890@s.whatsapp.net
        body:
          text: Hi, I'm at home
  mode: single
```

## Driving mode

```yaml
- alias: Driving mode
  description: ""
  trigger:
    - platform: event
      event_type: new_whatsapp_message
  condition: []
  action:
    - service: whatsapp.send_message
      data:
        clientId: "{{ trigger.event.data.clientId }}" # Which instance of whatsapp should the message come from
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          text: Sorry, I'm driving, I will contact you soon
        options:
          quoted: "{{ trigger.event.data }}" # Quote message
  mode: single
```

## Message reaction

```yaml
- alias: React to message
  description: ""
  trigger:
    - platform: event
      event_type: new_whatsapp_message
  condition: []
  action:
    - service: whatsapp.send_message
      data:
        clientId: "{{ trigger.event.data.clientId }}"
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          react:
            text: "👍🏻" # Use an empty string to remove the reaction
            key: "{{ trigger.event.data.key }}"
  mode: single
```

## Presence notify (SUBSCRIBE FIRST!)

```yaml
- alias: Nuova automazione
  description: ""
  trigger:
    - platform: event
      event_type: whatsapp_presence_update
      event_data: {}
  condition:
    - condition: template
      value_template:
        "{{ trigger.event.data.presences['391234567890@s.whatsapp.net'].lastKnownPresence
        == 'available' }}"
  action:
    - service: persistent_notification.create
      data:
        message: Contact is online!
  mode: single
```

## Reliability features (Lodge fork)

### Connection sensor

Each client gets `binary_sensor.whatsapp_<client>_connected` (on = connected). Attributes: `app_reachable`, `awaiting_qr`, `logged_out`, `down_for_seconds`. It reads off (not unavailable) when the app itself is down, so a simple state trigger catches every outage.

### Events

| Event | When | Data |
|---|---|---|
| `whatsapp_send_failed` | A send failed, or the app was unreachable | `clientId`, `to`, `body`, `options`, `retry`, `reason`, `error` |
| `whatsapp_client_ready` | A client (re)connected | `clientId` |
| `whatsapp_client_restarting` | The app is restarting itself to recover | `reason` |

### Resending failed messages

The app restarts itself after a disconnected send. This automation waits for it and resends once (`retry: true` stops a loop), or tells you if WhatsApp stays down:

```yaml
alias: WhatsApp - Resend failed messages
triggers:
  - trigger: event
    event_type: whatsapp_send_failed
conditions:
  - "{{ not trigger.event.data.retry and trigger.event.data.reason != 'WhatsappNumberNotFoundError' }}"
actions:
  - wait_for_trigger:
      - trigger: event
        event_type: whatsapp_client_ready
    timeout: "00:05:00"
  - if: "{{ wait.trigger is none }}"
    then:
      - action: persistent_notification.create
        data:
          title: WhatsApp down - message not delivered
          message: "To {{ trigger.event.data.to }}: {{ trigger.event.data.body.text | default('(non-text message)') }}"
    else:
      - delay: "00:00:05"
      - action: whatsapp.send_message
        continue_on_error: true
        data:
          clientId: "{{ trigger.event.data.clientId }}"
          to: "{{ trigger.event.data.to }}"
          body: "{{ trigger.event.data.body }}"
          retry: true
mode: parallel
max: 20
```

### Security

The app's API needs a token that the app creates on first start (`/data/api_token`) and writes into the integration for you. After a fresh install, restart Home Assistant once the app is running so the integration picks it up. `GET /status` is the only call that works without it.

### Troubleshooting

Set **WhatsApp library log level** to `warn` or `debug` in the app's Configuration tab to see what the WhatsApp library is doing.

