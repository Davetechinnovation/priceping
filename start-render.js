#!/usr/bin/env node

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BaileysWhatsAppService = require("./src/baileysWhatsAppService");
const MongoDBManager = require("./src/mongoDBManager");
const CommandParser = require("./src/commandParser");
const AlertMonitor = require("./src/alertMonitor");
const PriceService = require("./src/priceService");
const MemoryMonitor = require("./src/memoryMonitor");

const app = express();
const PORT = process.env.PORT || 10000;

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
  res
    .status(200)
    .json({
      status: "healthy",
      uptime: process.uptime(),
      memory: memory.current,
    });
});

app.get("/", (req, res) => {
  res.json({ message: "🤖 PricePing WhatsApp Bot", status: "operational" });
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
  if (botInitialized) {
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
          // 🛠️ FIX: Properly extract phone from JID
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
                const cmd = `Set ${state.symbol} ${selectedOption.blockchain} at ${state.targetPrice} ${state.direction || "at"}`;
                return await commandParser.handleCommand(
                  cmd,
                  phoneNumber,
                  database,
                  priceService,
                  pushName,
                  userState,
                );
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
    );
    alertMonitor.start();

    botInitialized = true;
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

app.listen(PORT, () => {
  console.log(`🌐 Server on port ${PORT}`);
  setTimeout(initializeBot, 2000);
});

module.exports = app;
