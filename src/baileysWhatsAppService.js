const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  proto,
  Browsers,
  jidNormalizedUser // 👈 IMPORTED THIS HELPER
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
    this.retryCount = 0;
    this.pairingRetries = 0;
  }

  async initialize() {
    try {
      // ============================================================
      // ⚙️ SETUP: YOUR PHONE NUMBER
      const myPhoneNumber = "2348103393608";
      // ============================================================

      const { state, saveCreds } = await this.useMongoAuthState();
      const { version } = await fetchLatestBaileysVersion();

      if (!state.creds.registered) {
          console.log("⚠️ No active session found in MongoDB.");
          console.log("🔄 Automatically entering Pairing Mode...");
      }

      this.sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        logger: this.logger,
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 250,
        keepAliveIntervalMs: 10000, 
        syncFullHistory: false,
      });

      // PAIRING LOGIC
      if (!this.sock.authState.creds.registered) {
        setTimeout(async () => {
          try {
            if (this.sock && !this.sock.authState.creds.registered) {
              if (this.pairingRetries >= 5) {
                console.log("\n❌ MAX PAIRING ATTEMPTS REACHED (5/5). Shutting down.");
                process.exit(0);
              }

              this.pairingRetries++; 
              console.log(`🔄 Requesting Pairing Code... (Attempt ${this.pairingRetries}/5)`);
              
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

          const isCorruptSession = statusCode === undefined;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          
          if (isCorruptSession || isLoggedOut) {
            console.log("⚠️ Corrupt session or Logged out.");
            console.log("🗑️ Clearing MongoDB session...");
            await this.database.clearWhatsAppSession();
            this.retryCount = 0;
            this.pairingRetries = 0;
            console.log("🔄 Restarting in 3 seconds...");
            setTimeout(() => this.initialize(), 3000);
            return;
          }

          if (this.retryCount < 5) {
              console.log(`🔄 Reconnecting... (Attempt ${this.retryCount + 1})`);
              this.retryCount++;
              setTimeout(() => this.initialize(), 3000);
          } else {
              console.log("❌ Too many reconnection attempts.");
              process.exit(1); 
          }
        } else if (connection === "open") {
          console.log("✅ WhatsApp connection established");
          this.isConnected = true;
          this.retryCount = 0;
          this.pairingRetries = 0;
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

  // DATABASE AUTH
  async useMongoAuthState() {
    if (!this.database) throw new Error("Database required");
    const dbData = await this.database.getWhatsAppSession();
    let creds, keys = {};

    if (dbData) {
      try {
        const parsedData = JSON.parse(JSON.stringify(dbData), BufferJSON.reviver);
        creds = parsedData.creds || initAuthCreds();
        keys = parsedData.keys || {};
        console.log("📥 Loaded session from MongoDB");
      } catch (e) { creds = initAuthCreds(); }
    } else {
      console.log("🆕 Database empty: Creating fresh session");
      creds = initAuthCreds();
    }

    let isSaving = false;
    let saveTimeout = null;

    const flushToDB = async () => {
      if (isSaving) return;
      isSaving = true;
      try {
        const jsonString = JSON.stringify({ creds, keys }, BufferJSON.replacer);
        const saveableData = JSON.parse(jsonString);
        await this.database.saveWhatsAppSession(saveableData);
      } catch (error) { console.error("❌ Failed to save session:", error.message); } 
      finally { isSaving = false; saveTimeout = null; }
    };

    const saveCreds = () => {
      if (saveTimeout) return;
      saveTimeout = setTimeout(flushToDB, 10000);
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
                if (value) { keys[key] = value; } else { delete keys[key]; }
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
      const rawJid = message.key.remoteJid;
      
      // ============================================
      // 🛠️ CRITICAL FIX: JID NORMALIZATION
      // ============================================
      // 1. Use Baileys helper to standardize (handles :42 suffixes)
      // 2. Split @ to get the number part
      const normalizedJid = jidNormalizedUser(rawJid); 
      const cleanPhone = normalizedJid.split('@')[0];

      // Handle LIDs (if WhatsApp sends 15+ digit ID instead of phone)
      if (cleanPhone.length > 14 && !cleanPhone.startsWith('234')) {
         console.warn(`⚠️ Warning: Detected LID instead of Phone Number: ${cleanPhone}`);
      }

      const pushName = message.pushName || "User";
      let messageText = message.message?.conversation || message.message?.extendedTextMessage?.text || "";

      if (!messageText) return;

      console.log(`📨 ${pushName} (${cleanPhone}): "${messageText}"`);

      // PASS THE NORMALIZED JID to command parser
      for (const [_, handler] of this.messageHandlers) {
        try { await this.sock.sendPresenceUpdate("composing", rawJid); } catch(e){}
        
        // We pass 'normalizedJid' so the parser sees "234..." not "234...:42"
        const response = await handler(messageText, normalizedJid, pushName);
        
        if (response) {
          try {
            await this.sendMessage(rawJid, response);
          } catch (sendErr) {
            console.error("❌ Failed to send reply:", sendErr.message);
          }
          try { await this.sock.sendPresenceUpdate("paused", rawJid); } catch(e){}
          return;
        }
      }
    } catch (error) {
      console.error("Error handling message:", error.message);
    }
  }

  async sendMessage(to, message) {
    if (!this.isConnected) throw new Error("WhatsApp not connected");
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
  
  getConnectionStatus() {
    return { isConnected: this.isConnected, hasQRCode: false, qrCodePath: null };
  }

  async disconnect() {
      if (this.sock) { await this.sock.end(undefined); this.isConnected = false; }
  }
}

module.exports = BaileysWhatsAppService;