const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

class BaileysWhatsAppService {
  constructor() {
    this.sock = null;
    this.qrCode = null;
    this.isConnected = false;
    this.messageHandlers = new Map();
    this.app = null; // Express app reference
    this.logger = pino({ level: "info" });
  }

  async initialize() {
    try {
      // ============================================================
      // ⚙️ SETUP: PUT YOUR PHONE NUMBER HERE FOR PAIRING CODE
      // Format: CountryCode + Number (No '+' sign, no spaces)
      // Example for Nigeria: "2349168071385"
      const myPhoneNumber = "2348103393608";
      // ============================================================

      const startTime = Math.floor(Date.now() / 1000);
      const { state, saveCreds } = await this.useMultiFileAuthState();

      // Create WhatsApp socket
      this.sock = makeWASocket({
        printQRInTerminal: false, // Turn off QR because we want the code
        auth: state,
        logger: this.logger,
        browser: ["Ubuntu", "Chrome", "20.0.04"], // "Ubuntu" often helps pairing codes work better
        markOnlineOnConnect: true,
        syncFullHistory: false,
      });

      // 🟢 PAIRING CODE LOGIC
      if (!this.sock.authState.creds.registered) {
        console.log("⏳ Waiting for connection to generate pairing code...");

        // Wait 4 seconds to ensure connection is ready, then request code
        setTimeout(async () => {
          try {
            const code = await this.sock.requestPairingCode(myPhoneNumber);
            console.log("\n================================================");
            console.log("📱 PAIRING CODE REQUIRED");
            console.log("1. Open WhatsApp on your phone");
            console.log("2. Go to Settings > Linked Devices > Link a Device");
            console.log('3. Tap "Link with phone number" instead of scanning');
            console.log("4. Enter this code:");
            console.log(
              `\x1b[32m\x1b[1m   ${code?.match(/.{1,4}/g)?.join("-") || code}   \x1b[0m`,
            );
            console.log("================================================\n");
          } catch (err) {
            console.error("❌ Failed to request pairing code:", err);
          }
        }, 4000);
      }

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log("🔌 Connection closed, reconnecting:", shouldReconnect);
          if (shouldReconnect) this.initialize();
        } else if (connection === "open") {
          console.log("✅ WhatsApp connection established");
          this.isConnected = true;
        }
      });

      this.sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Speed fix: Ignore old history messages
        const messageTimestamp =
          typeof msg.messageTimestamp === "number"
            ? msg.messageTimestamp
            : msg.messageTimestamp.low;
        if (messageTimestamp < startTime) return;

        if (msg.key.remoteJid === "status@broadcast") return;
        await this.handleMessage(msg);
      });

      console.log("🔄 Initializing WhatsApp connection...");
    } catch (error) {
      console.error("❌ Error initializing WhatsApp:", error);
      throw error;
    }
  }

  async useMultiFileAuthState() {
    const authFolder = path.join(__dirname, "..", "data", "auth");

    // Create auth folder if it doesn't exist
    if (!fs.existsSync(authFolder)) {
      fs.mkdirSync(authFolder, { recursive: true });
    }

    return useMultiFileAuthState(authFolder);
  }

  async generateQRCodeFile(qr) {
    try {
      console.log("🔍 Starting QR code generation...");

      // Generate QR code for console display (terminal-friendly)
      console.log("\n" + "=".repeat(50));
      console.log("📱 WHATSAPP QR CODE - SCAN WITH YOUR PHONE");
      console.log("=".repeat(50));

      // Display QR code in terminal
      await qrcode.toString(qr, { type: "terminal", small: true });

      console.log("\n" + "=".repeat(50));
      console.log("💡 Instructions:");
      console.log("1. Open WhatsApp on your phone");
      console.log("2. Go to Settings > Linked Devices");
      console.log('3. Tap "Link a device"');
      console.log("4. Point your camera at QR code above");
      console.log("=".repeat(50) + "\n");

      // Also save to file for backup
      const qrCodeData = await qrcode.toString(qr, { type: "svg", margin: 1 });
      const qrFilePath = path.join(process.cwd(), "data", "qr-code.svg");

      console.log("💾 Saving QR code backup to file:", qrFilePath);
      fs.writeFileSync(qrFilePath, qrCodeData);
      console.log(`📱 QR Code also saved to: ${qrFilePath}`);
      console.log("🌐 File backup available if terminal QR is unclear");
      console.log("🌐 Web QR available at: /qr");

      // QR code endpoint
      if (this.app) {
        this.app.get("/qr", (req, res) => {
          res.set("Content-Disposition", `attachment;filename="qr-code.svg"`);
          res.set("Content-Type", "image/svg+xml");
          res.sendFile(qrFilePath);
        });
      } else {
        console.log("⚠️ Express app not available for QR endpoint");
      }

      return qrFilePath;
    } catch (error) {
      console.error("❌ Error generating QR code:", error);
      console.error("❌ Full error details:", error.stack);
    }
  }

  async handleMessage(message) {
    try {
      const remoteJid = message.key.remoteJid;
      
      // 🟢 1. EXTRACT PROFILE NAME
      const pushName = message.pushName || null;

      // Extract text from different message types
      let messageText = "";

      if (message.message.conversation) {
        messageText = message.message.conversation;
      } else if (message.message.extendedTextMessage) {
        messageText = message.message.extendedTextMessage.text;
      } else if (message.message.imageMessage) {
        messageText = message.message.imageMessage.caption || "";
      } else if (message.message.videoMessage) {
        messageText = message.message.videoMessage.caption || "";
      } else if (message.message.documentMessage) {
        messageText = message.message.documentMessage.caption || "";
      }

      if (!messageText || !messageText.trim()) {
        console.log("📨 Empty or non-text message, ignoring");
        return;
      }

      console.log(`📨 From ${pushName} (${remoteJid}): "${messageText}"`);
      console.log(`🔍 WhatsApp Debug: pushName extracted="${pushName}", type=${typeof pushName}`);

      // Process message through all registered handlers
      for (const [handlerName, handler] of this.messageHandlers) {
        try {
          // ============================================================
          // 🔥 NEW: START TYPING ANIMATION
          // This tells WhatsApp to show "Typing..." in the status bar
          // ============================================================
          await this.sock.sendPresenceUpdate("composing", remoteJid);

          // Wait for the bot logic (PriceService/CommandParser) to finish
          // 🟢 2. PASS PUSHNAME TO HANDLER
          // We pass: (text, jid, pushName)
          console.log(`🔍 Handler Debug: messageText="${messageText}", remoteJid="${remoteJid}", pushName="${pushName}"`);
          console.log(`🔍 About to call handler: ${handlerName}`);
          const response = await handler(messageText, remoteJid, pushName);
          console.log(`🔍 Handler ${handlerName} returned:`, response);

          if (response && response.trim()) {
            await this.sendMessage(remoteJid, response);

            // ============================================================
            // 🔥 NEW: STOP TYPING ANIMATIONn
            // Usually sending a message stops it, but this is good practice
            // ============================================================
            await this.sock.sendPresenceUpdate("paused", remoteJid);

            return; // Stop after first handler responds
          } else {
            // If logic finished but no response was generated, stop typing
            await this.sock.sendPresenceUpdate("paused", remoteJid);
          }
        } catch (error) {
          console.error(`❌ Error in handler ${handlerName}:`, error);
          // Stop typing if there was an error
          await this.sock.sendPresenceUpdate("paused", remoteJid);
        }
      }
    } catch (error) {
      console.error("❌ Error handling message:", error);
    }
  }

  async sendMessage(to, message) {
    try {
      if (!this.isConnected) {
        throw new Error("WhatsApp not connected - message cannot be sent");
      }

      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;

      await this.sock.sendMessage(jid, {
        text: message,
      });

      console.log(`📤 Message sent to ${to}: ${message.substring(0, 50)}...`);
      return true;
    } catch (error) {
      console.error("❌ Error sending message:", error);
      throw error; // Propagate error so AlertMonitor knows it failed
    }
  }

  async sendAlert(to, alert, currentPrice, priceService) {
    const asset = alert.asset.toUpperCase();
    const targetPrice = alert.target_price;
    const direction = alert.direction;

    const formattedCurrentPrice = priceService.formatPrice(currentPrice, asset);
    const formattedTargetPrice = priceService.formatPrice(targetPrice, asset);

    const directionEmoji = direction === "above" ? "📈" : "📉";
    const hitEmoji =
      direction === "above"
        ? currentPrice >= targetPrice
          ? "🎯"
          : "⏳"
        : currentPrice <= targetPrice
          ? "🎯"
          : "⏳";

    const message = `🚨 *PRICE ALERT TRIGGERED!* 🚨

${directionEmoji} *${asset}* Alert Hit!

🎯 *Target*: ${formattedTargetPrice}
📊 *Current*: ${formattedCurrentPrice}
📈 *Direction*: ${direction === "above" ? "Above" : "Below"} target
⏰ *Time*: ${new Date().toLocaleString()}

📈 *Quick Actions*:
• Set new alert: "Set ${asset} at [new_price]"
• View all alerts: "My alerts"
• Delete this alert: "Delete ${alert.id}"

💡 *Tip*: Price alerts help you catch important market movements!

---
*PricePing - Your Trading Alert Companion* 🤖`;

    return await this.sendMessage(to, message);
  }

  async sendPriceUpdate(to, asset, price, priceService) {
    const formattedPrice = priceService.formatPrice(price, asset);

    const message = `📊 *Price Update*

💰 ${asset}: ${formattedPrice}
⏰ ${new Date().toLocaleString()}

🎯 *Set Alert*: "Set ${asset} at [your_price]"

---
*PricePing - Your Trading Alert Companion* 🤖`;

    return await this.sendMessage(to, message);
  }

  // Register message handler (for command parser)
  registerMessageHandler(name, handler) {
    this.messageHandlers.set(name, handler);
    console.log(`📝 Registered message handler: ${name}`);
  }

  // Set Express app reference for QR endpoint
  setExpressApp(app) {
    this.app = app;
    console.log("🌐 Express app reference set for QR endpoint");
  }

  // Get connection status
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      hasQRCode: !!this.qrCode,
      qrCodePath: this.qrCode
        ? path.join(__dirname, "..", "data", "qr-code.svg")
        : null,
    };
  }

  // Disconnect from WhatsApp
  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout();
        console.log("🔌 Disconnected from WhatsApp");
      }
    } catch (error) {
      console.error("❌ Error disconnecting:", error);
    }
  }

  // Get phone number from JID
  extractPhoneNumber(jid) {
    return jid.replace("@s.whatsapp.net", "").replace("@whatsapp.net", "");
  }
}

module.exports = BaileysWhatsAppService;
