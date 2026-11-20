const EventEmitter = require("eventemitter2");

const makeWASocket = require("./Baileys").default;
const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("./Baileys");

const MessageType = {
  text: "conversation",
  location: "locationMessage",
  liveLocation: "liveLocationMessage",
  image: "imageMessage",
  video: "videoMessage",
  document: "documentMessage",
  contact: "contactMessage",
};

class WhatsappClient extends EventEmitter {
  #conn;
  #msgStore = new Map();
  #path;
  #refreshInterval;
  #sendPresenceUpdateInterval;
  #timeout;
  #attempts;
  #offline;
  #refreshMs;
  #logLevel;

  #status = {
    attempt: 0,
    connected: false,
    disconnected: false,
    reconnecting: false,
  };

  // Self-heal: track how long we have been down and whether we are waiting
  // for a QR scan, so index.js can restart the app when a reconnect stalls.
  #disconnectedSince = Date.now();
  #awaitingQr = false;

  get health() {
    return {
      connected: this.#status.connected,
      awaitingQr: this.#awaitingQr,
      loggedOut: this.#status.disconnected,
      downForMs: this.#status.connected
        ? 0
        : Date.now() - this.#disconnectedSince,
    };
  }

  #markDown = () => {
    if (this.#status.connected) this.#disconnectedSince = Date.now();
    this.#status.connected = false;
  };

  #toMilliseconds = (hrs, min, sec) => (hrs * 60 * 60 + min * 60 + sec) * 1000;

  constructor({
    path,
    timeout = 1e3,
    attempts = Infinity,
    offline = true,
    refreshMs,
    logLevel = "error",
  }) {
    super();
    this.#path = path;
    this.#timeout = timeout;
    this.#attempts = attempts;
    this.#offline = offline;
    this.#refreshMs = refreshMs || this.#toMilliseconds(6, 0, 0);
    this.#logLevel = logLevel;
    this.connect();
  }

  connect = async () => {
    if (this.#status.connected) return;

    try {
      await this.#openSocket();
    } catch (err) {
      // Previously an error here left the client disconnected for good.
      this.emit("connect_error", err);
      this.#reconnect();
    }
  };

  #openSocket = async () => {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(this.#path);

    const sock = makeWASocket({
      version,
      auth: state,
      syncFullHistory: false,
      markOnlineOnConnect: !this.#offline,
      logger: require("pino")({ level: this.#logLevel }),
      generateHighQualityLinkPreview: true,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      defaultQueryTimeoutMs: undefined,
      getMessage: async (key) => this.#msgStore.get(key.id),
    });
    this.#conn = sock;

    // Ignore late events from a socket that has already been replaced.
    sock.ev.on("creds.update", (state) => {
      if (sock !== this.#conn) return;
      if (state.me) {
        this.emit("pair", {
          phone: state.me.id.split(":")[0],
          name: state.me.name,
        });
      }

      saveCreds(state);
    });

    sock.ev.on("connection.update", (event) => {
      if (sock !== this.#conn) return;
      this.#onConnectionUpdate(event);
    });
  };

  disconnect = (reconnect) => {
    if (this.#status.disconnected) return;

    this.#markDown();
    this.#status.disconnected = !reconnect;
    this.#status.reconnecting = !!reconnect;

    return this.#conn.end();
  };

  restart = () => {
    this.emit("restart");
    return this.disconnect(true);
  };

  #toId = (phone) => {
    phone = phone.toString();
    if (!phone) throw new Error("Invalid phone");

    return `${phone.replace("+", "")}${
      !phone.endsWith("@s.whatsapp.net") &&
      !phone.endsWith("@g.us") &&
      !phone.endsWith("@broadcast")
        ? "@s.whatsapp.net"
        : ""
    }`;
  };

  #reconnect = () => {
    if (this.#status.attempt++ > this.#attempts || this.#status.disconnected) {
      this.#status.reconnecting = false;
      this.#status.disconnected = true;
      return;
    }

    setTimeout(this.connect, this.#timeout);
  };

  #onConnectionUpdate = (event) => {
    if (event.qr) this.#onQr(event.qr);
    if (event.connection === "open") this.#onConnected(event);
    else if (event.connection === "close") this.#onDisconnected(event);
  };

  #onQr = (qr) => {
    this.#awaitingQr = true;
    this.emit("qr", qr);
  };

  #onConnected = (event) => {
    this.#status.attempt = 0;
    this.#awaitingQr = false;
    this.#status.connected = true;
    this.#status.disconnected = false;
    this.#status.reconnecting = false;

    this.#refreshInterval = setInterval(() => this.restart(), this.#refreshMs);
    if (this.#offline) this.setSendPresenceUpdateInterval("unavailable");

    this.#conn.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];

      if (msg.hasOwnProperty("message") && !msg.key.fromMe) {
        delete msg.message.messageContextInfo;
        const messageType = Object.keys(msg.message)[0];
        this.emit("msg", { type: messageType, ...msg });
      }
    });

    this.#conn.ev.on("presence.update", (presence) => {
      this.emit("presence_update", presence);
    });

    this.emit("ready");
  };

  #onDisconnected = ({ lastDisconnect }) => {
    this.#markDown();

    clearInterval(this.#refreshInterval);
    this.setSendPresenceUpdateInterval();

    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (statusCode === DisconnectReason.loggedOut) {
      this.#status.reconnecting = false;
      this.#status.disconnected = true;

      this.emit("logout");
      return;
    }

    this.emit("disconnected", statusCode);
    this.#reconnect();
  };

  setSendPresenceUpdateInterval = (status, id) => {
    clearInterval(this.#sendPresenceUpdateInterval);

    if (status) {
      // sendPresenceUpdate is async: a try/catch round it never caught its
      // errors, so one failed keep-alive was an unhandled rejection that
      // could take the whole app down. Catch on the promise instead.
      const send = () =>
        this.sendPresenceUpdate(status, id).catch(() =>
          clearInterval(this.#sendPresenceUpdateInterval)
        );

      send();
      this.#sendPresenceUpdateInterval = setInterval(send, 10000);
    }
  };

  sendMessage = async (phone, msg, options) => {
    phone = phone.toString();
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    const id = this.#toId(phone);

    const [result] = await this.#conn.onWhatsApp(id);

    if (
      result ||
      phone.endsWith("@s.whatsapp.net") ||
      phone.endsWith("@g.us") ||
      phone.endsWith("@broadcast")
    ) {
      try {
        const result = await this.#conn.sendMessage(id, msg, options);
        if (result?.key?.id && result.message) {
          this.#msgStore.set(result.key.id, result.message);
          if (this.#msgStore.size > 500)
            this.#msgStore.delete(this.#msgStore.keys().next().value);
        }
        return result;
      } catch (err) {
        throw new WhatsappError(err?.output?.payload?.statusCode ?? 0);
      }
    }

    throw new WhatsappNumberNotFoundError(phone);
  };

  waitForMessage(from, callback) {
    this.once("msg", (msg) => {
      if (msg.key.remoteJid === this.#toId(from)) callback(msg);
    });
  }

  sendPresenceUpdate = async (type, id) => {
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    try {
      await this.#conn.sendPresenceUpdate(type, id);
    } catch (err) {
      throw new WhatsappError(err.output.payload.statusCode);
    }
  };

  presenceSubscribe = async (phone) => {
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    const id = this.#toId(phone);

    const [result] = await this.#conn.onWhatsApp(id);

    if (result) {
      try {
        await this.#conn.presenceSubscribe(id);
      } catch (err) {
        throw new WhatsappError(err.output.payload.statusCode);
      }
    } else {
      throw new WhatsappNumberNotFoundError(phone);
    }
  };

  updateProfileStatus = async (status) => {
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    try {
      await this.#conn.updateProfileStatus(status);
    } catch (err) {
      throw new WhatsappError(err.output.payload.statusCode);
    }
  };
}

class WhatsappNumberNotFoundError extends Error {
  constructor(phone = "", ...args) {
    super(phone, ...args);
    this.name = "WhatsappNumberNotFoundError";
    this.message = `Send message failed. Number ${phone} is not on Whatsapp.`;
    this.code = 404;
  }
}

class WhatsappDisconnectedError extends Error {
  constructor(message = "", ...args) {
    super(message, ...args);
    this.name = "WhatsappDisconnectedError";
    this.code = 401;
    this.message = `Send message failed. Whatsapp disconnected error.`;
  }
}

class WhatsappError extends Error {
  #errors = {
    428: "Connection Closed",
    408: "Connection Lost / Timed Out",
    440: "Connection Replaced",
    401: "Logged Out",
    500: "Bad Session",
    515: "Restart Required",
    411: "Multidevice Mismatch",
  };

  constructor(message = "", ...args) {
    super(message, ...args);
    this.name = "WhatsappError";
    this.code = Number(this.message);
    this.message = `Send message failed. Whatsapp error ${this.message}: ${
      this.#errors[this.code]
    }`;
  }
}

module.exports = { WhatsappClient, MessageType };
