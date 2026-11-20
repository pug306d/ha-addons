const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const { WhatsappClient } = require("./whatsapp");

var logger = require("log4js").getLogger();
logger.level = "info";

var qrimage = require("qr-image");

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Every call except GET /status needs the per-install token that run.sh
// creates in /data/api_token and writes into the HA custom component.
// Without it any other app on the Supervisor network could send messages.
const API_TOKEN = (() => {
  try {
    return fs.readFileSync("/data/api_token", "utf8").trim() || null;
  } catch (err) {
    return null;
  }
})();

const tokenMatches = (given) => {
  if (!API_TOKEN || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

app.use((req, res, next) => {
  if (req.method === "GET" && req.path === "/status") return next();
  if (!API_TOKEN) {
    logger.error("No API token found in /data/api_token - refusing request.");
    return res.status(503).send("KO");
  }
  if (tokenMatches(req.get("X-Api-Token"))) return next();
  logger.warn(`Rejected ${req.method} ${req.path} from ${req.ip}: bad or missing API token.`);
  res.status(401).send("KO");
});

const clients = {};
let baileysLogLevel = "error"; // set from the app options at start-up

// ---- Self-heal (Lodge patch) ---------------------------------------------
// The WhatsApp connection can drop while this process keeps running, so the
// Supervisor watchdog never notices and every send fails quietly. When that
// happens we tell Home Assistant (events) and exit, so the watchdog restarts
// the app (~3 s) with a fresh connection.

const DOWN_LIMIT_MS = 5 * 60 * 1000; // restart if down this long
const HEALTH_CHECK_MS = 60 * 1000;
// 401 disconnected/logged out, 408 lost/timed out, 428 closed,
// 440 replaced, 500 bad session, 503 unavailable, 515 restart required
const CONNECTION_CODES = [401, 408, 428, 440, 500, 503, 515];

const fireEvent = async (type, data) => {
  try {
    await axios.post(`http://supervisor/core/api/events/${type}`, data, {
      headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` },
    });
  } catch (err) {
    logger.error(`Could not fire ${type} event: ${err.message}`);
  }
};

let restarting = false;
const exitForRestart = async (reason) => {
  if (restarting) return;
  restarting = true;
  logger.error(`Self-heal: ${reason}. Exiting so the watchdog restarts the app.`);
  await fireEvent("whatsapp_client_restarting", { reason });
  setTimeout(() => process.exit(1), 1500);
};

const isConnectionError = (error) =>
  error?.name === "WhatsappDisconnectedError" ||
  CONNECTION_CODES.includes(Number(error?.code)) ||
  CONNECTION_CODES.includes(Number(error?.output?.statusCode));

setInterval(() => {
  for (const [key, client] of Object.entries(clients)) {
    const h = client.health;
    if (!h.connected && !h.awaitingQr && h.downForMs > DOWN_LIMIT_MS) {
      exitForRestart(
        `${key} has been disconnected for ${Math.round(h.downForMs / 60000)} min`
      );
    }
  }
}, HEALTH_CHECK_MS);
// ---------------------------------------------------------------------------

const onReady = (key) => {
  logger.info(key, "client is ready.");
  axios.post(
    "http://supervisor/core/api/services/persistent_notification/dismiss",
    {
      notification_id: `whatsapp_addon_qrcode_${key}`,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
      },
    }
  );
};

const onQr = (qr, key) => {
  logger.info(
    key,
    "require authentication over QRCode, please see your notifications..."
  );

  var code = qrimage.image(qr, { type: "png" });

  code.on("readable", function () {
    var img_string = code.read().toString("base64");
    axios.post(
      "http://supervisor/core/api/services/persistent_notification/create",
      {
        title: `Whatsapp QRCode (${key})`,
        message: `Please scan the following QRCode for **${key}** client... ![QRCode](data:image/png;base64,${img_string})`,
        notification_id: `whatsapp_addon_qrcode_${key}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
        },
      }
    );
  });
};

const onMsg = (msg, key) => {
  axios.post(
    "http://supervisor/core/api/events/new_whatsapp_message",
    { clientId: key, ...msg },
    {
      headers: {
        Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
      },
    }
  );
  logger.debug(`New message event fired from ${key}.`);
};

const onPresenceUpdate = (presence, key) => {
  axios.post(
    "http://supervisor/core/api/events/whatsapp_presence_update",
    { clientId: key, ...presence },
    {
      headers: {
        Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
      },
    }
  );
  logger.debug(`New presence event fired from ${key}.`);
};

const onLogout = async (key) => {
  logger.info(`Client ${key} was logged out. Clearing the session for a new QR code...`);
  // fs.rm without a callback crashed the app as soon as it finished, so the
  // QR code for re-pairing never appeared. Wait for the delete, then start.
  try {
    await fs.promises.rm(`/data/${key}`, { recursive: true, force: true });
  } catch (err) {
    logger.error(`Could not clear session for ${key}: ${err.message}`);
  }

  init(key);
};

const init = (key) => {
  clients[key] = new WhatsappClient({
    path: `/data/${key}`,
    logLevel: baileysLogLevel,
  });

  clients[key].on("restart", () => logger.debug(`${key} client restarting...`));
  clients[key].on("qr", (qr) => onQr(qr, key));
  clients[key].once("ready", () => onReady(key));
  clients[key].on("ready", () =>
    fireEvent("whatsapp_client_ready", { clientId: key })
  );
  clients[key].on("disconnected", (code) =>
    logger.warn(`${key} disconnected (code ${code}), reconnecting...`)
  );
  clients[key].on("connect_error", (err) =>
    logger.error(`${key} failed to connect: ${err?.message || err}`)
  );
  clients[key].on("msg", (msg) => onMsg(msg, key));
  clients[key].on("logout", () => onLogout(key));
  clients[key].on("presence_update", (presence) =>
    onPresenceUpdate(presence, key)
  );
};

fs.readFile("data/options.json", function (error, content) {
  var options = JSON.parse(content);
  baileysLogLevel = options.baileys_log_level || "error";

  options.clients.forEach((key) => {
    init(key);
  });

  app.listen(port, () => logger.info(`Whatsapp Addon started.`));

  // Connection status per client, e.g. for a RESTful sensor in HA.
  app.get("/status", (req, res) => {
    const status = {};
    for (const [key, client] of Object.entries(clients))
      status[key] = client.health;
    res.json(status);
  });

  app.post("/sendMessage", (req, res) => {
    const message = req.body;
    if (message.hasOwnProperty("clientId")) {
      if (clients.hasOwnProperty(message.clientId)) {
        const wapp = clients[message.clientId];
        wapp
          .sendMessage(message.to, message.body, message.options)
          .then(() => {
            res.send("OK");
            logger.debug("Message successfully sended from addon.");
          })
          .catch(async (error) => {
            res.send("KO");
            logger.error(error.message);
            // Hand the message back to HA so an automation can resend it.
            await fireEvent("whatsapp_send_failed", {
              clientId: message.clientId,
              to: message.to,
              body: message.body,
              options: message.options,
              retry: !!message.retry,
              reason: error?.name || "Error",
              error: error?.message,
            });
            if (isConnectionError(error) && !wapp.health.awaitingQr) {
              exitForRestart(`${message.clientId} send failed: ${error.message}`);
            }
          });
      } else {
        logger.error("Error in sending message. Client ID not found.");
        res.send("KO");
      }
    } else {
      logger.error("Error in sending message. Please specify client ID.");
      res.send("KO");
    }
  });

  app.post("/setStatus", (req, res) => {
    const status = req.body.status;
    if (req.body.hasOwnProperty("clientId")) {
      if (clients.hasOwnProperty(req.body.clientId)) {
        const wapp = clients[req.body.clientId];

        wapp
          .updateProfileStatus(status)
          .then(() => {
            res.send("OK");
          })
          .catch((error) => {
            res.send("KO");
            logger.error(error.message);
          });
      } else {
        logger.error("Error in set status. Client ID not found.");
        res.send("KO");
      }
    } else {
      logger.error("Error in set status. Please specify client ID.");
      res.send("KO");
    }
  });

  app.post("/presenceSubscribe", (req, res) => {
    const request = req.body;

    if (req.body.hasOwnProperty("clientId")) {
      if (clients.hasOwnProperty(req.body.clientId)) {
        const wapp = clients[req.body.clientId];

        wapp
          .presenceSubscribe(request.userId)
          .then(() => {
            res.send("OK");
          })
          .catch((error) => {
            res.send("KO");
            logger.error(error.message);
          });
      } else {
        logger.error("Error in subscribe presence. Client ID not found.");
        res.send("KO");
      }
    } else {
      logger.error("Error in subscribe presence. Please specify client ID.");
      res.send("KO");
    }
  });

  app.post("/sendPresenceUpdate", (req, res) => {
    const request = req.body;

    if (req.body.hasOwnProperty("clientId")) {
      if (clients.hasOwnProperty(req.body.clientId)) {
        const wapp = clients[req.body.clientId];

        wapp
          .sendPresenceUpdate(request.type, request.to)
          .then(() => {
            res.send("OK");
          })
          .catch((error) => {
            res.send("KO");
            logger.error(error.message);
          });
      } else {
        logger.error("Error in presence update. Client ID not found.");
        res.send("KO");
      }
    } else {
      logger.error("Error in presence update. Please specify client ID.");
      res.send("KO");
    }
  });

  app.post("/sendInfinityPresenceUpdate", (req, res) => {
    const request = req.body;

    if (req.body.hasOwnProperty("clientId")) {
      if (clients.hasOwnProperty(req.body.clientId)) {
        const wapp = clients[req.body.clientId];

        // setSendPresenceUpdateInterval is not async; calling .then on its
        // result threw, so this service failed every time.
        try {
          if (!wapp.health.connected) throw new Error("Whatsapp disconnected.");
          wapp.setSendPresenceUpdateInterval(request.type, request.to);
          res.send("OK");
        } catch (error) {
          res.send("KO");
          logger.error(error.message);
        }
      } else {
        logger.error("Error in presence update. Client ID not found.");
        res.send("KO");
      }
    } else {
      logger.error("Error in presence update. Please specify client ID.");
      res.send("KO");
    }
  });
});
