const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  proto,
  Browsers // Import Browsers helper
} = require("@whiskeysockets/baileys");
const pino = require("pino");

class BaileysWhatsAppService {
  constructor(database = null) {
    this.sock = null;
    this.isConnected = false;
    this.messageHandlers = new Map();
    this.app = null;
    this.logger = pino({ level: "silent" });
    this.database = database;
    this.retryCount = 0; // Track retries to prevent infinite loops
  }

  async initialize() {
    try {
      // ============================================================
      // ⚙️ SETUP: YOUR PHONE NUMBER
      const myPhoneNumber = "2348103393608";
      // ============================================================

      const { state, saveCreds } = await this.useMongoAuthState();
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        logger: this.logger,
        // FIX 1: Use a standard browser string to avoid immediate rejection
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        // FIX 2: Retry configuration for fetching messages
        retryRequestDelayMs: 250,
      });

      // 🟢 PAIRING CODE LOGIC
      if (!this.sock.authState.creds.registered) {
        // Wait longer (6s) to ensure connection is actually stable before requesting
        setTimeout(async () => {
          try {
            // Check if socket exists and isn't closed
            if (this.sock && !this.sock.authState.creds.registered) {
              console.log("🔄 Requesting Pairing Code...");
              const code = await this.sock.requestPairingCode(myPhoneNumber);
              console.log("\n================================================");
              console.log("📱 PAIRING CODE REQUIRED");
              console.log(`\x1b[32m\x1b[1m   ${code?.match(/.{1,4}/g)?.join("-") || code}   \x1b[0m`);
              console.log("================================================\n");
            }
          } catch (err) {
            console.error("❌ Failed to request pairing code:", err.message);
          }
        }, 6000);
      }

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
          const error = lastDisconnect?.error;
          const statusCode = error?.output?.statusCode;
          
          console.log(`🔌 Connection closed. Status: ${statusCode}`);

          // FIX 3: Detect Corrupt Session (undefined status or 401/403 loop)
          // If status is undefined, it means the socket died instantly (bad session data)
          const isCorruptSession = statusCode === undefined;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isCorruptSession;

          if (isCorruptSession) {
            console.log("⚠️ Corrupt session detected (Status: undefined).");
            console.log("🗑️ Clearing MongoDB session to fix the loop...");
            await this.database.clearWhatsAppSession();
            this.retryCount = 0;
            console.log("🔄 Restarting fresh in 3 seconds...");
            setTimeout(() => this.initialize(), 3000);
            return;
          }

          if (shouldReconnect) {
            if (this.retryCount < 5) {
                console.log(`🔄 Reconnecting... (Attempt ${this.retryCount + 1})`);
                this.retryCount++;
                setTimeout(() => this.initialize(), 3000);
            } else {
                console.log("❌ Too many reconnection attempts. Clearing session.");
                await this.database.clearWhatsAppSession();
                this.retryCount = 0;
                process.exit(1); // Restart the process entirely
            }
          } else {
            console.log("❌ Logged out or Session Expired.");
            await this.database.clearWhatsAppSession();
            setTimeout(() => this.initialize(), 3000);
          }
        } else if (connection === "open") {
          console.log("✅ WhatsApp connection established");
          this.isConnected = true;
          this.retryCount = 0; // Reset retries on success
        }
      });

      this.sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === "status@broadcast") return;
        await this.handleMessage(msg);
      });

      console.log("🔄 Initializing WhatsApp connection...");
    } catch (error) {
      console.error("❌ Error initializing WhatsApp:", error);
      setTimeout(() => this.initialize(), 5000);
    }
  }

  async useMongoAuthState() {
    if (!this.database) throw new Error("Database required");

    const dbData = await this.database.getWhatsAppSession();

    let creds;
    let keys = {};

    if (dbData) {
      try {
        const parsedData = JSON.parse(JSON.stringify(dbData), BufferJSON.reviver);
        creds = parsedData.creds || initAuthCreds();
        keys = parsedData.keys || {};
        console.log("📥 Loaded session from MongoDB");
      } catch (e) {
        console.error("❌ Failed to parse session data, starting fresh:", e);
        creds = initAuthCreds();
      }
    } else {
      console.log("🆕 Creating fresh session");
      creds = initAuthCreds();
    }

    const saveCreds = async () => {
      try {
        // Only save if we actually have credentials to save
        if (!this.sock || !this.sock.authState) return;
        
        const jsonString = JSON.stringify({
            creds: this.sock.authState.creds,
            keys: this.sock.authState.keys
        }, BufferJSON.replacer);
        
        const saveableData = JSON.parse(jsonString);
        await this.database.saveWhatsAppSession(saveableData);
      } catch (error) {
        console.error("❌ Failed to save session:", error);
      }
    };

    return {
      state: {
        creds,
        keys: {
          get: (type, ids) => {
            const data = {};
            for (const id of ids) {
              let value = keys[`${type}-${id}`];
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }
            return data;
          },
          set: (data) => {
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                const key = `${category}-${id}`;
                if (value) {
                  keys[key] = value;
                } else {
                  delete keys[key];
                }
              }
            }
            saveCreds();
          }
        }
      },
      saveCreds
    };
  }

  async handleMessage(message) {
    try {
      const remoteJid = message.key.remoteJid;
      const pushName = message.pushName || "User";
      let messageText = message.message?.conversation || message.message?.extendedTextMessage?.text || "";

      if (!messageText) return;

      console.log(`📨 ${pushName}: "${messageText}"`);

      for (const [_, handler] of this.messageHandlers) {
        await this.sock.sendPresenceUpdate("composing", remoteJid);
        const response = await handler(messageText, remoteJid, pushName);
        if (response) {
          await this.sendMessage(remoteJid, response);
          await this.sock.sendPresenceUpdate("paused", remoteJid);
          return;
        }
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  }

  async sendMessage(to, message) {
    if (!this.isConnected) return;
    const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text: message });
  }

  async sendAlert(to, alert, currentPrice, priceService) {
      const asset = alert.asset.toUpperCase();
      const message = `🚨 *PRICE ALERT* 🚨\n${asset} hit target: ${alert.target_price}\nCurrent: ${currentPrice}`;
      return await this.sendMessage(to, message);
  }

  registerMessageHandler(name, handler) { this.messageHandlers.set(name, handler); }
  setExpressApp(app) { this.app = app; }
}

module.exports = BaileysWhatsAppService;