#!/usr/bin/env node

// 🔧 FIX: Override system DNS with Google's reliable DNS to fix
// querySrv ECONNREFUSED errors on Windows when connecting to MongoDB Atlas
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./src/swaggerConfig');
require("dotenv").config();

const BaileysWhatsAppService = require("./src/baileysWhatsAppService");
const MongoDBManager = require("./src/mongoDBManager");
const CommandParser = require("./src/commandParser");
const AlertMonitor = require("./src/alertMonitor");
const PriceService = require("./src/priceService");
const MemoryMonitor = require("./src/memoryMonitor");
const TermiiService = require("./src/termiiService");
const GeminiService = require("./src/geminiService");
const cron = require("node-cron");
const { createAdminAPI } = require("./src/adminAPI");

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ FIX 1: Initialize global variable explicitly at top
global.botInitialized = false;

const memoryMonitor = new MemoryMonitor({
  interval: 30000,
  warningThreshold: 450,
  criticalThreshold: 500,
  renderLimit: 512,
});

app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  const memory = memoryMonitor.getStats();
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
    memory: memory.current,
  });
});

app.get("/", (req, res) => {
  res.json({ message: "🤖 PricePing WhatsApp Bot", status: "operational" });
});

// Swagger UI Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "PricePing Admin API Documentation"
}));

// Swagger JSON endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

let botInitialized = false;
const userState = new Map();

// ============================================================
// 🛠️ FIX: MongoDB connection with retry that WAITS properly
// ============================================================
async function connectMongoDB(maxRetries = 5) {
  const database = new MongoDBManager();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔌 MongoDB connection attempt ${attempt}/${maxRetries}...`);
      await database.connect();
      console.log("✅ MongoDB connected successfully");
      return database; // SUCCESS - return the connected database
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const waitTime = attempt * 5000; // 5s, 10s, 15s, 20s, 25s
        console.log(`⏳ Retrying in ${waitTime / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  // All retries failed
  return null;
}

async function initializeBot() {
  if (global.botInitialized) { // ✅ Check global
    console.log("🔄 Bot already initialized, skipping...");
    return;
  }

  try {
    console.log("🚀 Initializing PricePing WhatsApp Bot for Render...");
    memoryMonitor.start();

    // 1. CONNECT TO MONGODB (WITH PROPER RETRY)
    const database = await connectMongoDB(5);

    if (!database) {
      console.error("❌ Could not connect to MongoDB after 5 attempts.");
      console.log("🔄 Will retry full initialization in 30 seconds...");
      setTimeout(initializeBot, 30000);
      return;
    }

    // 2. CHECK CLEAR_AUTH AND DELETE FROM MONGODB
    if (process.env.CLEAR_AUTH === "true") {
      console.log("🗑️ CLEAR_AUTH detected: Wiping sessions...");
      await database.clearWhatsAppSession();
      console.log("✅ Wiped session from MongoDB");

      const authFiles = [
        "./data/auth/creds.json",
        "./data/auth_info_baileys.json",
      ];
      authFiles.forEach((file) => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
      console.log("✅ Wiped local auth files");
    } else {
      console.log("🔐 Keeping existing auth session");
    }

    // 3. START SERVICES
    const priceService = new PriceService(database.db);
    const termiiService = new TermiiService();
    console.log("🔥 Warming up caches...");
    try {
      await Promise.all([
        priceService.loadAssetList(),
        priceService.getForexCurrencies(),
      ]);
    } catch (e) {
      console.log("⚠️ Cache warning:", e.message);
    }

    const whatsappService = new BaileysWhatsAppService(database);
    const commandParser = new CommandParser(database.db);

    whatsappService.setExpressApp(app);

    whatsappService.registerMessageHandler(
      "commandParser",
      async (messageText, phoneNumber, pushName) => {
        try {
          const cleanPhone = phoneNumber.split("@")[0].split(":")[0];

          // 1️⃣ CHECK MENU STATE
          if (userState.has(cleanPhone)) {
            const state = userState.get(cleanPhone);

            // ── Pro SMS number collection ──────────────────
            if (state.type === 'AWAITING_SMS_NUMBER') {
              const input = messageText.trim();
              const lower = input.toLowerCase();

              if (lower === 'skip') {
                commandParser.smsSkippedThisSession.add(cleanPhone);
                userState.delete(cleanPhone);
                return `👍 No problem! You'll still get alerts via WhatsApp.\n\n📱 _Tip: Send your number anytime to enable SMS alerts._`;
              }

              // Accept: 0801... or 234801... (strip spaces/dashes/+)
              const digits = input.replace(/[\s\-+()]/g, '');
              if (/^(0\d{10}|234\d{10})$/.test(digits)) {
                let smsNum = digits;
                if (smsNum.startsWith('0')) smsNum = '234' + smsNum.substring(1);
                await database.updateUserSmsNumber(cleanPhone, smsNum);
                userState.delete(cleanPhone);
                return `✅ *SMS Alerts Enabled!*\n📱 Alerts will also be sent to *+${smsNum}*\n\n_Send a new number anytime to update it._`;
              }

              // Invalid input — re-prompt
              return `📱 *Please respond to the SMS setup above:* 
Send your phone number (e.g. *08012345678*) or type *SKIP* to continue with WhatsApp only.`;
            }

            // ── Pro SMS number confirmation (already has one) ──
            if (state.type === 'CONFIRM_SMS_NUMBER') {
              const input = messageText.trim();

              if (input === '1') {
                // Keep same number — nothing to update
                userState.delete(cleanPhone);
                return `✅ Got it! SMS alert will be sent to *+${state.smsNumber}* 📱`;
              }

              if (input === '2') {
                // Switch state to collect a new number
                userState.set(cleanPhone, { type: 'AWAITING_SMS_NUMBER' });
                return `📱 Send your new number (e.g. *08012345678*)\nor type *SKIP* to cancel.`;
              }

              // They sent a raw phone number directly — accept it too
              const digits = input.replace(/[\s\-+()]/g, '');
              if (/^(0\d{10}|234\d{10})$/.test(digits)) {
                let smsNum = digits;
                if (smsNum.startsWith('0')) smsNum = '234' + smsNum.substring(1);
                await database.updateUserSmsNumber(cleanPhone, smsNum);
                userState.delete(cleanPhone);
                return `✅ *SMS number updated!*\n📱 Alerts will now be sent to *+${smsNum}*`;
              }

              return `📱 *Action Required:* 
Please respond to the SMS prompt above. 
Reply *1* to keep *+${state.smsNumber}* or *2* to enter a new number.`;
            }

            // ── Delete All Confirmation ────────────────────
            if (state.type === 'CONFIRM_DELETE_ALL') {
              const reply = messageText.trim().toUpperCase();
              
              if (reply === 'YES' || reply === 'Y') {
                userState.delete(cleanPhone);
                const count = await database.deleteAllAlerts(cleanPhone);
                return `✅ *Done!* Deleted all *${count}* alert(s).\n\n💡 _Your quota does not reset when you delete alerts._`;
              } else if (reply === 'NO' || reply === 'N' || reply === 'CANCEL') {
                userState.delete(cleanPhone);
                return `↩️ *Cancelled.* Your alerts are safe!`;
              } else {
                // Anything else — re-prompt
                return `❓ Please reply *YES* to confirm deletion or *NO* to cancel.`;
              }
            }

            const selection = parseInt(messageText.trim());

            if (
              !isNaN(selection) &&
              selection > 0 &&
              selection <= state.options.length
            ) {
              const selectedOption = state.options[selection - 1];
              userState.delete(cleanPhone);

              if (state.type === "SELECT_CHAIN_PRICE") {
                const cmd = `Price ${state.symbol} ${selectedOption.blockchain}`;
                return await commandParser.handleCommand(
                  cmd,
                  phoneNumber,
                  database,
                  priceService,
                  pushName,
                  userState,
                );
              } else if (state.type === "SELECT_CHAIN_ALERT") {
                // ============================================
                // 🛠️ FIX 1: Use cleanPhone for ALL database calls
                // Previously used raw `phoneNumber` (JID with @s.whatsapp.net)
                // which didn't match queries using cleanPhone
                // ============================================

                let currentPrice = selectedOption.price;

                if (
                  !currentPrice &&
                  selectedOption.blockchain &&
                  selectedOption.address
                ) {
                  console.log(
                    `🔄 Fetching specific price for ${state.symbol} on ${selectedOption.blockchain}...`,
                  );
                  currentPrice = await priceService.getPriceByChainAddress(
                    selectedOption.blockchain,
                    selectedOption.address,
                  );
                }

                if (!currentPrice) {
                  console.log(
                    `⚠️ Using default price for ${state.symbol} on ${selectedOption.blockchain}`,
                  );
                  const defaultInfo = await priceService.getAssetInfo(
                    state.symbol,
                  );
                  currentPrice = defaultInfo ? defaultInfo.price : null;
                }

                if (!currentPrice) {
                  return `❌ Couldn't fetch price for ${state.symbol} on ${selectedOption.blockchain}. Please try again.`;
                }

                // ============================================
                // 🛠️ FIX 2: Check alert quota (was completely bypassed!)
                // Multi-chain alerts were never calling useAlertSlot
                // ============================================
                const slotResult = await database.useAlertSlot(cleanPhone);

                if (!slotResult.allowed) {
                  const u = slotResult.usage;
                  return `🚫 *Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
📊 *Used:* ${u.used}/${u.limit}
⏰ *Resets in:* ${u.resetIn}

Type *Subscribe* for unlimited alerts!`;
                }

                const assetName = `${state.symbol} (${selectedOption.blockchain})`;
                const direction =
                  state.targetPrice > currentPrice ? "above" : "below";

                // 🛠️ FIX 1: cleanPhone instead of phoneNumber
                await database.createAlert(
                  cleanPhone,
                  assetName,
                  state.targetPrice,
                  direction,
                );

                const u = slotResult.usage;

                let response = `✅ *Alert Activated!*
━━━━━━━━━━━━━━━━━
🔔 *Asset:* ${assetName}
📉 *Target:* ${priceService.formatPrice(state.targetPrice, state.symbol)}
📊 *Current:* ${priceService.formatPrice(currentPrice, state.symbol)}
🎯 *Condition:* When price goes *${direction.toUpperCase()}*
━━━━━━━━━━━━━━━━━
📊 *Alerts:* ${u.used}/${u.limit}
${u.isPro ? "👑 Pro Plan" : `⏰ Resets in: ${u.resetIn}`}
━━━━━━━━━━━━━━━━━`;

                // 👑 Pro-only SMS footer for multi-chain alerts too
                if (u.isPro) {
                  const user = await database.getUserByPhoneNumber(cleanPhone);
                  response += commandParser._buildSmsFooter(user, cleanPhone, userState);
                } else {
                  response += `\n_I'll message you the moment it hits!_`;
                }

                return response;
              }
            } else {
              userState.delete(cleanPhone);
            }
          }


          // 2️⃣ NORMAL COMMAND
          return await commandParser.handleCommand(
            messageText,
            phoneNumber,
            database,
            priceService,
            pushName,
            userState,
          );
        } catch (error) {
          console.error("❌ Message handling error:", error);
          return null;
        }
      },
    );

    await whatsappService.initialize();
    console.log("✅ WhatsApp service initialized");

    const alertMonitor = new AlertMonitor(
      database,
      priceService,
      whatsappService,
      termiiService,
      userState
    );
    alertMonitor.start();

    // ==========================================
    // ☀️ DAILY MORNING BRIEF (8:00 AM WAT = 7:00 AM UTC)
    // ==========================================
    const geminiService = new GeminiService(database.db);
    const TOP_COINS = ['BTC', 'ETH', 'SOL', 'AAPL', 'ZENITHBANK', 'DANGCEM', 'MTNN', 'GTCO'];

    cron.schedule('0 7 * * *', async () => {
      console.log('☀️ [Daily Brief] Sending morning brief to Pro users...');
      try {
        // 1. Fetch top coin prices
        const marketData = [];
        for (const sym of TOP_COINS) {
          try {
            const info = await priceService.getAssetInfo(sym);
            if (info) marketData.push({ symbol: sym, price: info.price, currency: info.currency, change24h: info.change24h });
          } catch (_) {}
        }

        if (marketData.length === 0) return;

        // 2. Get all Pro users
        const proUsers = await database.getProUsers();
        if (proUsers.length === 0) {
          console.log('☀️ [Daily Brief] No Pro users found, skipping.');
          return;
        }

        // 3. Generate ONE AI brief (cached — all users share it)
        const baseBrief = await geminiService.generateDailyBrief(marketData, '{{NAME}}');

        // 4. Send personalised message to each Pro user
        for (const user of proUsers) {
          try {
            const name = user.name || 'Trader';
            const jid = user.whatsapp_number;
            const userAlerts = await database.getUserAlerts(user.phone_number);
            const activeAlerts = userAlerts.filter(a => a.status === 'active');

            const priceLines = marketData
              .map(m => {
                const arrow = (m.change24h !== null && m.change24h >= 0) ? '🟢' : '🔴';
                return `${arrow} *${m.symbol}:* ${priceService.formatPrice(m.price, m.symbol, m.currency)}`;
              })
              .join('\n');

            let alertLine = '';
            if (activeAlerts.length > 0) {
              alertLine = `\n\n📋 *Your Alerts:* ${activeAlerts.length} active\n` +
                activeAlerts.slice(0, 3).map(a =>
                  `   └ ${a.asset} ${a.direction} ${priceService.formatPrice(a.target_price, a.asset)}`
                ).join('\n');
            }

            const aiInsight = baseBrief ? baseBrief.replace('{{NAME}}', name) : '';
            const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

            const msg = `☀️ *Good Morning, ${name}!*

📊 *Daily Market Brief — ${today}*
━━━━━━━━━━━━━━━━━
${priceLines}${alertLine}
━━━━━━━━━━━━━━━━━
🤖 *AI Insight:*
${aiInsight || 'Markets are moving — check your alerts!'}

_Reply with any coin name for full analysis._`;

            await whatsappService.sendMessage(jid, msg);
            // Small delay to avoid flooding
            await new Promise(r => setTimeout(r, 1200));
          } catch (e) {
            console.error(`☀️ [Daily Brief] Failed for ${user.phone_number}:`, e.message);
          }
        }
        console.log(`☀️ [Daily Brief] Sent to ${proUsers.length} Pro users.`);
      } catch (e) {
        console.error('☀️ [Daily Brief] Error:', e.message);
      }
    }, { timezone: 'Africa/Lagos' });

    console.log('☀️ Daily brief scheduled at 8:00 AM WAT (Africa/Lagos)');

    // ==========================================
    // 🔥 SIGNIFICANT MOVE DETECTOR (every 15 min)
    // ==========================================
    const priceSnapshots = new Map(); // symbol -> { price, ts }
    const userLastChecked = new Map(); // symbol -> Set of phone numbers

    // Expose a function commandParser can call to track user interest
    global.trackUserInterest = (symbol, phoneNumber) => {
      if (!userLastChecked.has(symbol)) userLastChecked.set(symbol, new Map());
      userLastChecked.get(symbol).set(phoneNumber, Date.now());
    };

    const MOVE_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE'];
    const MOVE_THRESHOLD = 5; // 5% move in 60 mins

    cron.schedule('*/15 * * * *', async () => {
      try {
        const now = Date.now();
        
        // 🧹 Garbage Collection: Clean up old tracking data for ALL symbols
        // Prevents memory leak since users check thousands of different non-crypto tickers
        for (const [sym, users] of userLastChecked.entries()) {
          for (const [phone, lastTs] of users.entries()) {
            if (now - lastTs > 86400000) users.delete(phone);
          }
          if (users.size === 0) userLastChecked.delete(sym);
        }

        for (const sym of MOVE_COINS) {
          const info = await priceService.getAssetInfo(sym);
          if (!info) continue;
          const currentPrice = info.price;
          const now = Date.now();
          const snapshot = priceSnapshots.get(sym);

          if (snapshot && (now - snapshot.ts) >= 60 * 60 * 1000) {
            const changePct = ((currentPrice - snapshot.price) / snapshot.price) * 100;
            if (Math.abs(changePct) >= MOVE_THRESHOLD) {
              const direction = changePct > 0 ? '📈 pumped' : '📉 dumped';
              const arrow = changePct > 0 ? '🟢' : '🔴';

              // AI commentary (cached by move event)
              const aiText = await geminiService.analyzeMarket(sym, currentPrice);

              // Find Pro users who checked this coin in last 24h
              const interestedUsers = userLastChecked.get(sym);
              if (interestedUsers && interestedUsers.size > 0) {
                const alertMsg = `🔥 *Sudden Move Detected!*
━━━━━━━━━━━━━━━━━
${arrow} *${sym}* just ${direction} *${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%* in ~60 min!
Current: $${currentPrice.toLocaleString()}
${aiText ? `\n🤖 *AI:* ${aiText}` : ''}
━━━━━━━━━━━━━━━━━
_You checked ${sym} recently_`;

                for (const [phone, lastTs] of interestedUsers.entries()) {
                  if (now - lastTs > 86400000) { interestedUsers.delete(phone); continue; }
                  try {
                    const user = await database.getUserByPhoneNumber(phone);
                    if (!user || user.subscription_type !== 'pro') continue;
                    await whatsappService.sendMessage(user.whatsapp_number, alertMsg);
                    await new Promise(r => setTimeout(r, 800));
                  } catch (_) {}
                }
              }
            }
          }

          // Always update snapshot to current price every 15 min
          // But only use for comparison after 60 min has elapsed
          if (!snapshot || (now - snapshot.ts) >= 60 * 60 * 1000) {
            priceSnapshots.set(sym, { price: currentPrice, ts: now });
          }
        }
      } catch (e) {
        console.error('🔥 [MoveDetector] Error:', e.message);
      }
    });

    console.log('🔥 Significant Move Detector running (every 15 min, threshold: 5%)');

    // ✅ FIX 2: Set global to true immediately on success
    global.database = database;
    global.whatsappService = whatsappService;
    global.alertMonitor = alertMonitor;
    global.priceService = priceService;
    global.termiiService = termiiService;
    global.geminiService = geminiService;
    global.botInitialized = true;
    console.log('🎉 PricePing Bot is fully operational!');
  } catch (error) {
    console.error("❌ Failed to initialize bot:", error);
    console.log("🔄 Retrying full initialization in 30 seconds...");
    setTimeout(initializeBot, 30000);
  }
}

function gracefulShutdown(signal) {
  console.log(`🛑 ${signal} received...`);
  memoryMonitor.stop();
  botInitialized = false;
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

// Register admin API routes IMMEDIATELY (before bot init)
createAdminAPI(app, memoryMonitor);

app.listen(PORT, () => {
  console.log(`🌐 Server on port ${PORT}`);
  setTimeout(initializeBot, 2000);
});

module.exports = app;
