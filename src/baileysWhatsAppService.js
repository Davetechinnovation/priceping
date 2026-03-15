const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  proto,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const pino = require("pino");

let QRCode;
try {
  QRCode = require("qrcode");
} catch (e) {
  console.log("⚠️ 'qrcode' package not installed — QR images disabled.");
}

class BaileysWhatsAppService {
  constructor(database = null) {
    this.sock = null;
    this.isConnected = false;
    this.messageHandlers = new Map();
    this.app = null;
    this.logger = pino({ level: "silent" });
    this.database = database;
    this.retryCount = 0;

    this.isInitializing = false;
    this.intentionalDisconnect = false;
    this.lastConnectionAttempt = 0;
    this.lastDisconnectTime = 0;

    this._reconnectTimer = null;
    this._pairingCodeTimeout = null;
    this._socketId = 0;

    // Pairing code mode
    this._wantsPairingCode = false;
    this._pairingCodeCallback = null;
    this._pairingCodeRequested = false;

    this.connectionState = "disconnected";
    this.pairingCode = null;
    this.qrCodeDataUrl = null;
    this.pairingAttemptInProgress = false;
    this.qrCount = 0;
    this.maxQRRetries = 5;

    // Dynamic bot phone number
    this.botPhoneNumber = (process.env.WHATSAPP_PHONE_NUMBER || "").replace(
      /[^0-9]/g,
      "",
    );

    // Enhanced debug tracking
    this.debugLog = [];
    this.lastQRGenerated = null;
    this.lastPairingCodeGenerated = null;
    this.connectionHistory = [];

    this._hadSuccessfulConnection = false;
  }

  _cancelReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _scheduleReconnect(delayMs, force = false) {
    this._cancelReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this.intentionalDisconnect) {
        this.initialize(force);
      }
    }, delayMs);
  }

  async initialize(force = false) {
    const now = Date.now();
    const debugInfo = {
      timestamp: new Date().toISOString(),
      socketId: this._socketId + 1,
      force,
      currentState: this.connectionState,
      isConnected: this.isConnected,
      isInitializing: this.isInitializing,
      intentionalDisconnect: this.intentionalDisconnect,
      pairingAttemptInProgress: this.pairingAttemptInProgress,
      wantsPairingCode: this._wantsPairingCode,
      timeSinceLastAttempt: now - this.lastConnectionAttempt,
    };

    this._addDebugLog("INITIALIZE_START", debugInfo);
    console.log(
      `🔧 [DEBUG] Initialize attempt:`,
      JSON.stringify(debugInfo, null, 2),
    );

    if (this.isInitializing && !force) {
      console.log("⚠️ Already initializing, skipping.");
      this._addDebugLog("INITIALIZE_SKIPPED", {
        reason: "already_initializing",
      });
      return;
    }

    if (!force && now - this.lastConnectionAttempt < 2000) {
      console.log(
        `⚠️ Too soon since last attempt (${now - this.lastConnectionAttempt}ms), skipping.`,
      );
      this._addDebugLog("INITIALIZE_SKIPPED", { reason: "too_soon" });
      return;
    }

    this.isInitializing = true;
    this.lastConnectionAttempt = now;
    this.intentionalDisconnect = false;
    this.connectionState = "connecting";
    this._pairingCodeRequested = false;

    this._cancelReconnectTimer();
    await this._destroySocket(false);

    this._socketId++;
    const mySocketId = this._socketId;

    try {
      console.log(`🔧 [DEBUG] Fetching auth state and Baileys version...`);
      const { state, saveCreds, saveCredsImmediate } =
        await this.useMongoAuthState();
      const { version } = await fetchLatestBaileysVersion();

      const authDebugInfo = {
        hasCreds: !!state.creds,
        registered: state.creds.registered,
        version: version.join("."),
      };
      this._addDebugLog("AUTH_STATE_RETRIEVED", authDebugInfo);
      console.log(
        `🔧 [DEBUG] Auth state:`,
        JSON.stringify(authDebugInfo, null, 2),
      );

      const isPairingMode = this._wantsPairingCode && !state.creds.registered;

      console.log(
        `🔧 Creating socket #${mySocketId} | pairing: ${isPairingMode} | v${version.join(".")}`,
      );
      this._addDebugLog("SOCKET_CREATING", {
        socketId: mySocketId,
        isPairingMode,
      });

      this.sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        logger: this.logger,
        browser: isPairingMode
          ? Browsers.macOS("Chrome")
          : Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 5000,
        keepAliveIntervalMs: 30000,
        syncFullHistory: false,
      });

      // ── CREDS UPDATE ──
      // ── CREDS UPDATE ──
      this.sock.ev.on("creds.update", async () => {
        if (this._socketId !== mySocketId) return;

        // saveCreds is already debounced — just call it
        await saveCreds();

        const registered = state.creds.registered;
        const me = state.creds.me?.id || "none";
        console.log(
          `🔑 [Socket #${mySocketId}] Creds updated | registered: ${registered} | me: ${me}`,
        );

        if (
          registered &&
          !this.isConnected &&
          this.connectionState !== "connected"
        ) {
          console.log(
            `🎉 [Socket #${mySocketId}] Credentials registered! Waiting for connection.open...`,
          );
        }

        if (
          !registered &&
          !this.pairingAttemptInProgress &&
          !this.isConnected &&
          !this._wantsPairingCode &&
          state.creds.me?.id
        ) {
          this._markPairingStarted();
        }
      });

      // ── CONNECTION UPDATE ──
      this.sock.ev.on("connection.update", async (update) => {
        if (this._socketId !== mySocketId) {
          console.log(
            `⚠️ Ignoring connection.update from stale socket #${mySocketId}`,
          );
          return;
        }

        const { connection, lastDisconnect, qr } = update;

        if (
          this.pairingAttemptInProgress ||
          this._wantsPairingCode ||
          this.pairingCode ||
          isPairingMode
        ) {
          console.log(
            `📡 [Socket #${mySocketId}] connection.update:`,
            JSON.stringify({
              connection: connection || undefined,
              hasQR: !!qr,
              statusCode:
                lastDisconnect?.error?.output?.statusCode || undefined,
            }),
          );
          this._addDebugLog("CONNECTION_UPDATE_PAIRING", {
            ...update,
            qr: qr ? `[${qr.length} chars]` : null,
            socketId: mySocketId,
          });
        }

        // ── QR HANDLING ──
        if (qr) {
          const qrDebugInfo = {
            socketId: mySocketId,
            qrLength: qr.length,
            isPairingMode,
            pairingCodeRequested: this._pairingCodeRequested,
            hasPairingCode: !!this.pairingCode,
            wantsPairingCode: this._wantsPairingCode,
            qrCount: this.qrCount,
            timeSinceDisconnect: Date.now() - this.lastDisconnectTime,
          };
          this._addDebugLog("QR_RECEIVED", qrDebugInfo);

          // Pairing mode: request code on FIRST QR
          if (
            isPairingMode &&
            !this._pairingCodeRequested &&
            !this.pairingCode
          ) {
            this._pairingCodeRequested = true;
            const phoneNumber =
              this.botPhoneNumber ||
              (process.env.WHATSAPP_PHONE_NUMBER || "2348103393608").replace(
                /[^0-9]/g,
                "",
              );

            this._addDebugLog("PAIRING_CODE_REQUEST_START", {
              socketId: mySocketId,
              phoneNumber,
            });

            try {
              console.log(
                `📞 [Socket #${mySocketId}] Requesting pairing code for ${phoneNumber}...`,
              );
              const code = await this.sock.requestPairingCode(phoneNumber);

              this.pairingCode = code;
              this.lastPairingCodeGenerated = {
                code,
                timestamp: Date.now(),
                socketId: mySocketId,
                phoneNumber,
              };
              this._addDebugLog("PAIRING_CODE_GENERATED", {
                code,
                socketId: mySocketId,
                phoneNumber,
              });

              this.connectionState = "verifying";
              this.pairingAttemptInProgress = true;
              this.isInitializing = false;
              this._wantsPairingCode = false;
              console.log(`📟 Pairing Code: ${code}`);

              if (this._pairingCodeCallback) {
                this._pairingCodeCallback({
                  success: true,
                  pairingCode: code,
                  botPhone: phoneNumber,
                });
                this._pairingCodeCallback = null;
              }

              if (this._pairingCodeTimeout)
                clearTimeout(this._pairingCodeTimeout);
              this._pairingCodeTimeout = setTimeout(async () => {
                if (
                  !this.isConnected &&
                  this.pairingCode === code &&
                  this._socketId === mySocketId
                ) {
                  console.log(
                    "⏱️ Pairing code expired (180s). Restarting in QR mode...",
                  );
                  this._addDebugLog("PAIRING_CODE_EXPIRED", {
                    code,
                    socketId: mySocketId,
                  });
                  this.pairingCode = null;
                  this.pairingAttemptInProgress = false;
                  this.resetState();
                  this.initialize(true);
                }
              }, 180000);
            } catch (err) {
              this._addDebugLog("PAIRING_CODE_ERROR", {
                error: err.message,
                socketId: mySocketId,
              });
              console.error("❌ Pairing code request failed:", err.message);
              this._wantsPairingCode = false;
              this.pairingAttemptInProgress = false;
              this.connectionState = "awaiting_pairing";
              if (this._pairingCodeCallback) {
                this._pairingCodeCallback({
                  success: false,
                  error: `Failed: ${err.message}. Try QR code instead.`,
                });
                this._pairingCodeCallback = null;
              }
            }
            return;
          }

          // Block QR if pairing code active
          if (
            this.pairingAttemptInProgress ||
            this.pairingCode ||
            this._wantsPairingCode
          ) {
            console.log("🔒 QR blocked — pairing code mode active");
            return;
          }

          // Normal QR mode
          const timeSinceDisconnect = Date.now() - this.lastDisconnectTime;
          if (this.lastDisconnectTime > 0 && timeSinceDisconnect < 4000) {
            console.log(
              `🔒 QR blocked — too soon after disconnection (${timeSinceDisconnect}ms)`,
            );
            this._addDebugLog("QR_BLOCKED_TOO_SOON", { timeSinceDisconnect });
            return;
          }

          this.qrCount++;
          if (this.qrCount > this.maxQRRetries) {
            console.log(`⏹️ QR limit reached (${this.maxQRRetries}).`);
            this._addDebugLog("QR_LIMIT_REACHED", { qrCount: this.qrCount });
            this.qrCodeDataUrl = null;
            this.connectionState = "awaiting_pairing";
            return;
          }

          console.log(`🔄 Generating QR ${this.qrCount}/${this.maxQRRetries}`);
          this.connectionState = "awaiting_pairing";
          this.isInitializing = false;

          if (QRCode) {
            try {
              const qrStartTime = Date.now();
              this.qrCodeDataUrl = await QRCode.toDataURL(qr, {
                margin: 2,
                scale: 6,
              });
              const genTime = Date.now() - qrStartTime;
              this.lastQRGenerated = {
                dataUrl: this.qrCodeDataUrl,
                timestamp: Date.now(),
                socketId: mySocketId,
                qrCount: this.qrCount,
                generationTime: genTime,
                qrLength: qr.length,
              };
              this._addDebugLog("QR_GENERATED", {
                qrCount: this.qrCount,
                socketId: mySocketId,
                genTime,
              });
              console.log(
                `📱 QR Code Generated (${this.qrCount}) in ${genTime}ms`,
              );
            } catch (e) {
              this._addDebugLog("QR_GENERATION_ERROR", { error: e.message });
              console.error("QR generation failed:", e.message);
            }
          }
        }

        // ── DISCONNECT ──
        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          this._addDebugLog("CONNECTION_CLOSED", {
            socketId: mySocketId,
            statusCode,
          });
          this._addToConnectionHistory("disconnected", {
            socketId: mySocketId,
            statusCode,
          });

          this.isConnected = false;
          this.isInitializing = false;
          this.lastDisconnectTime = Date.now();
          console.log(
            `🔌 [Socket #${mySocketId}] Connection closed: ${statusCode}`,
          );

          if (this._pairingCodeCallback && this._wantsPairingCode) {
            this._pairingCodeCallback({
              success: false,
              error: `Connection lost (${statusCode}). Try again.`,
            });
            this._pairingCodeCallback = null;
          }

          if (this.intentionalDisconnect) {
            console.log("⏹️ Intentional disconnect.");
            this.connectionState = "disconnected";
            return;
          }

          // ── loggedOut (401) — session IS revoked/dead, MUST clear ──
          if (statusCode === DisconnectReason.loggedOut) {
            console.log(
              "🔒 Logged out by WhatsApp (401). Session is revoked — clearing and starting fresh...",
            );
            this._addDebugLog("SESSION_REVOKED_BY_WHATSAPP", { statusCode });
            if (this.database) {
              try {
                await this.database.clearWhatsAppSession();
              } catch (e) {
                console.error("Failed to clear revoked session:", e.message);
              }
            }
            this.resetState();
            this._scheduleReconnect(3000, true); // Will generate fresh QR
            return;
          }

          // ── 515 Stream restart ──
          if (statusCode === 515) {
            console.log("🔄 Stream restart (515). Reconnecting...");
            if (this.pairingAttemptInProgress) {
              console.log("📌 Preserving pairing state across 515 restart");
            }
            this._scheduleReconnect(2000, true);
            return;
          }

          // ── 440 Session conflict ──
          if (statusCode === 440) {
            this.retryCount++;
            if (this.retryCount <= 3) {
              const delay = Math.min(this.retryCount * 5000, 15000);
              console.log(
                `⚠️ Session conflict (440). Retrying with existing session in ${delay / 1000}s (attempt ${this.retryCount})`,
              );
              this.connectionState = "connecting";
              this._scheduleReconnect(delay, false);
            } else {
              // After 3 failed attempts, session is likely stale/corrupted — clear it
              console.log(
                "⚠️ Session conflict (440) — 3 retries failed. Session is stale, clearing...",
              );
              this._addDebugLog("SESSION_STALE_440_CLEARED", {
                retryCount: this.retryCount,
              });
              if (this.database) {
                try {
                  await this.database.clearWhatsAppSession();
                } catch (e) {
                  console.error("Failed to clear stale session:", e.message);
                }
              }
              this.resetState();
              this._scheduleReconnect(5000, true);
            }
            return;
          }

          // ── 428 Connection replaced ──
          if (statusCode === 428) {
            console.log(
              "⚠️ Connection replaced (428). Waiting before retry...",
            );
            this.connectionState = "disconnected";
            this.pairingAttemptInProgress = false;
            this._scheduleReconnect(15000, false);
            return;
          }

          // ── Generic reconnect ──
          if (this.retryCount < 5) {
            this.retryCount++;
            const delay = Math.min(this.retryCount * 3000, 15000);
            this.connectionState = "connecting";
            console.log(
              `🔄 Reconnecting in ${delay / 1000}s... (Attempt ${this.retryCount})`,
            );
            this._scheduleReconnect(delay, false);
          } else {
            console.log("❌ Max retries reached.");
            this.connectionState = "disconnected";
            this.pairingAttemptInProgress = false;
          }
        }

        // ── CONNECTED ──
        if (connection === "open") {
          console.log(`✅ WhatsApp Connected! [Socket #${mySocketId}]`);

          if (!state.creds.registered) {
            console.log(
              `⚠️ [Socket #${mySocketId}] registered was false after open — forcing to true`,
            );
            state.creds.registered = true;
          }

          // Save once — and set the debounce timestamp so creds.update doesn't double-save
          await saveCredsImmediate();
          console.log(`💾 Session saved with registered=true`);

          this._addDebugLog("CONNECTION_OPENED", {
            socketId: mySocketId,
            previousState: this.connectionState,
          });
          this._addToConnectionHistory("connected", { socketId: mySocketId });

          this.isConnected = true;
          this._hadSuccessfulConnection = true;
          this.myJid = state.creds.me?.id || null;
          this.connectionState = "connected";
          this.retryCount = 0;
          this.isInitializing = false;
          this.pairingAttemptInProgress = false;
          this.qrCodeDataUrl = null;
          this.pairingCode = null;
          this.qrCount = 0;
          this.lastDisconnectTime = 0;
          this._wantsPairingCode = false;
          this._pairingCodeRequested = false;
          this._cancelReconnectTimer();
          if (this._pairingCodeTimeout) {
            clearTimeout(this._pairingCodeTimeout);
            this._pairingCodeTimeout = null;
          }
        }
      });

      this.sock.ev.on("messages.upsert", async (m) => {
        if (this._socketId !== mySocketId) return;
        if (!m.messages[0]?.message) return;
        const msg = m.messages[0];
        if (msg.key.fromMe || msg.key.remoteJid === "status@broadcast") return;
        await this.handleMessage(msg);
      });
    } catch (error) {
      console.error("❌ Init Error:", error.message);
      this.isInitializing = false;
      this.connectionState = "disconnected";

      if (this._pairingCodeCallback) {
        this._pairingCodeCallback({
          success: false,
          error: `Init failed: ${error.message}`,
        });
        this._pairingCodeCallback = null;
        this._wantsPairingCode = false;
      }

      if (!this.intentionalDisconnect) {
        this._scheduleReconnect(5000, false);
      }
    }
  }

  _markPairingStarted() {
    if (!this.pairingAttemptInProgress) {
      console.log("🔐 Pairing/scanning detected! Locking state...");
      this.pairingAttemptInProgress = true;
      this.connectionState = "verifying";
      this.qrCodeDataUrl = null;
      this.pairingCode = null;
    }
  }

  resetState() {
    this.pairingCode = null;
    this.qrCodeDataUrl = null;
    this.pairingAttemptInProgress = false;
    this.connectionState = "disconnected";
    this.retryCount = 0;
    this.qrCount = 0;
    this._wantsPairingCode = false;
    this._pairingCodeCallback = null;
    this._pairingCodeRequested = false;
    this._cancelReconnectTimer();
    if (this._pairingCodeTimeout) {
      clearTimeout(this._pairingCodeTimeout);
      this._pairingCodeTimeout = null;
    }
    this._hadSuccessfulConnection = false;
    this._lastCredsSave = 0;
  }

  setBotPhoneNumber(phone) {
    this.botPhoneNumber = (phone || "").replace(/[^0-9]/g, "");
    console.log(`📱 Bot phone number updated to: +${this.botPhoneNumber}`);
  }

  async requestPairingCodeForAdmin() {
    return {
      success: false,
      error: "Pairing code is disabled. Please use QR code scanning instead.",
    };
  }

  async disconnect() {
    this._addDebugLog("DISCONNECT_REQUESTED", {
      connectionState: this.connectionState,
      socketId: this._socketId,
    });
    this._addToConnectionHistory("disconnect_requested", {
      socketId: this._socketId,
    });
    console.log("🔌 Intentional disconnect requested");
    this.intentionalDisconnect = true;
    this._cancelReconnectTimer();

    if (this._pairingCodeCallback) {
      this._pairingCodeCallback({ success: false, error: "Disconnected." });
      this._pairingCodeCallback = null;
    }

    await this._destroySocket(true);
    this.resetState();
    this.connectionState = "disconnected";
    this._addDebugLog("DISCONNECT_COMPLETED", {});
  }

  async reconnect() {
    console.log("🔄 Reconnect requested");
    this.intentionalDisconnect = false;
    this._cancelReconnectTimer();
    await this._destroySocket(true);
    this.resetState();
    return this.initialize(true);
  }

  async _destroySocket(resetLock = true) {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        this.sock.end(undefined);
      } catch (e) {}
      this.sock = null;
    }
    this.isConnected = false;
    if (resetLock) this.isInitializing = false;
  }

  async useMongoAuthState() {
    if (!this.database) throw new Error("Database required");
    const dbData = await this.database.getWhatsAppSession();
    let creds,
      keys = {};

    if (dbData) {
      try {
        const parsedData = JSON.parse(
          JSON.stringify(dbData),
          BufferJSON.reviver,
        );
        creds = parsedData.creds || initAuthCreds();
        keys = parsedData.keys || {};
        console.log("📖 Retrieved existing WhatsApp session from MongoDB");
      } catch (e) {
        creds = initAuthCreds();
        console.log("⚠️ Failed to parse session, starting fresh");
      }
    } else {
      creds = initAuthCreds();
      console.log("🆕 No existing session, starting fresh");
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  DEBOUNCED SAVE — prevents rapid writes that cause 440
    //  Waits 2 seconds of "quiet" before actually writing to MongoDB
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let saveTimer = null;
    let saveInProgress = false;
    let needsSave = false;

    const flushSave = async () => {
      if (saveInProgress) {
        needsSave = true;
        return;
      }
      saveInProgress = true;
      try {
        const jsonString = JSON.stringify({ creds, keys }, BufferJSON.replacer);
        await this.database.saveWhatsAppSession(JSON.parse(jsonString));
      } catch (error) {
        console.error("Session Save Error:", error.message);
      } finally {
        saveInProgress = false;
        if (needsSave) {
          needsSave = false;
          await flushSave();
        }
      }
    };

    const saveCreds = async () => {
      // Clear any pending save timer
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
      // Wait 2 seconds of quiet before actually writing
      saveTimer = setTimeout(async () => {
        saveTimer = null;
        await flushSave();
      }, 2000);
    };

    // Force-save: used by connection.open to ensure creds are persisted immediately
    const saveCredsImmediate = async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await flushSave();
    };

    return {
      state: {
        creds,
        keys: {
          get: (type, ids) => {
            const data = {};
            for (const id of ids) {
              let value = keys[`${type}-${id}`];
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }
            return data;
          },
          set: async (data) => {
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                const key = `${category}-${id}`;
                if (value) keys[key] = value;
                else delete keys[key];
              }
            }
            // Debounced — won't actually write until 2s of quiet
            await saveCreds();
          },
        },
      },
      saveCreds,
      saveCredsImmediate,
    };
  }

  async handleMessage(message) {
    try {
      const rawJid = message.key.remoteJid;
      const normalizedJid = jidNormalizedUser(rawJid);
      const pushName = message.pushName || "User";
      let messageText =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        "";
      if (!messageText) return;
      console.log(`📨 ${pushName}: "${messageText}"`);

      // ✅ Show "typing..." indicator immediately
      try {
        await this.sock.presenceSubscribe(rawJid);
        await this.sock.sendPresenceUpdate("composing", rawJid);
      } catch (e) {
        // Non-critical — don't block message handling
      }

      for (const [_, handler] of this.messageHandlers) {
        const response = await handler(messageText, normalizedJid, pushName);
        if (response) {
          // ✅ Stop typing before sending
          try {
            await this.sock.sendPresenceUpdate("paused", rawJid);
          } catch (e) {}
          await this.sendMessage(rawJid, response);
          return;
        }
      }

      // ✅ Stop typing if no handler responded
      try {
        await this.sock.sendPresenceUpdate("paused", rawJid);
      } catch (e) {}
    } catch (error) {
      console.error("Message Error:", error.message);
    }
  }

  async sendMessage(to, message) {
    if (!this.isConnected) throw new Error("WhatsApp not connected");
    const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text: message });
  }

  registerMessageHandler(name, handler) {
    this.messageHandlers.set(name, handler);
  }

  setExpressApp(app) {
    this.app = app;
  }

  getConnectionStatus() {
    const rawPhone =
      this.botPhoneNumber || process.env.WHATSAPP_PHONE_NUMBER || "";
    const status = {
      isConnected: this.isConnected,
      connectionState: this.connectionState,
      hasQRCode: !!this.qrCodeDataUrl,
      hasPairingCode: !!this.pairingCode,
      isInitializing: this.isInitializing,
      pairingAttemptInProgress: this.pairingAttemptInProgress,
      botPhone: rawPhone.replace(/[^0-9]/g, ""),
      socketId: this._socketId,
      qrCount: this.qrCount,
      retryCount: this.retryCount,
      lastQRGenerated: this.lastQRGenerated?.timestamp,
      lastPairingCodeGenerated: this.lastPairingCodeGenerated?.timestamp,
      hadSuccessfulConnection: this._hadSuccessfulConnection,
    };
    if (this.debugLog.length > 0) {
      status.recentDebugLogs = this.debugLog.slice(-10);
    }
    return status;
  }

  _addDebugLog(event, data) {
    this.debugLog.push({
      event,
      data,
      timestamp: new Date().toISOString(),
      socketId: this._socketId,
      connectionState: this.connectionState,
      isConnected: this.isConnected,
    });
    if (this.debugLog.length > 100) {
      this.debugLog = this.debugLog.slice(-100);
    }
  }

  _addToConnectionHistory(event, data) {
    this.connectionHistory.push({
      event,
      data,
      timestamp: new Date().toISOString(),
      socketId: this._socketId,
    });
    if (this.connectionHistory.length > 50) {
      this.connectionHistory = this.connectionHistory.slice(-50);
    }
  }

  getDebugInfo() {
    return {
      debugLog: this.debugLog,
      connectionHistory: this.connectionHistory,
      lastQRGenerated: this.lastQRGenerated,
      lastPairingCodeGenerated: this.lastPairingCodeGenerated,
      currentSocketId: this._socketId,
      currentState: this.connectionState,
      timestamp: new Date().toISOString(),
    };
  }

  clearDebugLog() {
    this.debugLog = [];
    this.connectionHistory = [];
    console.log(`🔧 [DEBUG] Debug logs cleared`);
  }
}

module.exports = BaileysWhatsAppService;
