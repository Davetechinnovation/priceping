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
    const priceService = new PriceService();
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
    const commandParser = new CommandParser();

    whatsappService.setExpressApp(app);

    whatsappService.registerMessageHandler(
      "commandParser",
      async (messageText, phoneNumber, pushName) => {
        try {
          const cleanPhone = phoneNumber.split("@")[0].split(":")[0];

          // 1️⃣ CHECK MENU STATE
          if (userState.has(cleanPhone)) {
            const state = userState.get(cleanPhone);
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

                const response = `✅ *Alert Activated!*
━━━━━━━━━━━━━━━━━
🔔 *Asset:* ${assetName}
📉 *Target:* ${priceService.formatPrice(state.targetPrice, state.symbol)}
📊 *Current:* ${priceService.formatPrice(currentPrice, state.symbol)}
🎯 *Condition:* When price goes *${direction.toUpperCase()}*
━━━━━━━━━━━━━━━━━
📊 *Alerts:* ${u.used}/${u.limit}
${u.isPro ? "👑 Pro Plan" : `⏰ Resets in: ${u.resetIn}`}
━━━━━━━━━━━━━━━━━
_I'll message you the moment it hits!_`;

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
    );
    alertMonitor.start();

    // ✅ FIX 2: Set global to true immediately on success
    global.database = database;
    global.whatsappService = whatsappService;
    global.alertMonitor = alertMonitor;
    global.priceService = priceService;
    global.termiiService = termiiService;
    global.botInitialized = true;
    console.log("🎉 PricePing Bot is fully operational!");
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
