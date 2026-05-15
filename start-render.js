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
const crypto = require("crypto");
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
const GroqService = require("./src/groqService");
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

// ════════════════════════════════════════════════════════════
// 🎉 PAYMENT SUCCESS PAGE — Redirects user back to WhatsApp DM
// ════════════════════════════════════════════════════════════
app.get('/payment/success', (req, res) => {
  const phone = req.query.phone || '';
  const waLink = `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="5; url=${waLink}">
      <title>Payment Successful - PricePing</title>
      <style>
        body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; text-align: center; padding: 20px; }
        .card { background: #1e293b; padding: 40px; border-radius: 16px; max-width: 400px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
        .check { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #22c55e; margin: 0 0 8px; font-size: 24px; }
        p { color: #94a3b8; margin: 0 0 24px; line-height: 1.5; }
        .btn { display: inline-block; background: #22c55e; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background 0.2s; }
        .btn:hover { background: #16a34a; }
        .redirect { color: #64748b; font-size: 14px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="check">✅</div>
        <h1>Payment Successful!</h1>
        <p>You're now a <strong>PricePing Pro</strong> member.<br>Check your WhatsApp for your welcome message.</p>
        <a class="btn" href="${waLink}" target="_blank">Return to WhatsApp 💬</a>
        <p class="redirect">Redirecting to WhatsApp in 5 seconds...</p>
      </div>
    </body>
    </html>
  `);
});

// ════════════════════════════════════════════════════════════
// 💳 PAYSTACK WEBHOOK (MUST be BEFORE express.json() to get raw body)
// ════════════════════════════════════════════════════════════
const PRO_WELCOME_MESSAGE = `🎉 *WELCOME TO PRICEPING PRO!* 🎉

━━━━━━━━━━━━━━━━━
✅ *Payment confirmed!* You're now a VIP member.

Here's everything you unlocked:

🤖 *AI Analysis* — Technical analysis for any asset
📰 *Live News* — AI-summarized breaking headlines
💡 *Smart Alerts* — AI-suggested support & resistance
📈 *Volatility Alerts* — Two-way percentage alerts
💼 *Portfolio Tracker* — Live profit & loss tracking
📓 *Trade Journal* — Auto-track your win rate
☀️ *Daily Briefs* — Full AI morning market intel at 8AM
🔥 *Move Detectors* — Instant pump/dump warnings
📞 *SMS Fallback* — Text alerts when offline
♾️ *Unlimited Alerts* — No limits, no caps

━━━━━━━━━━━━━━━━━
🚀 *Try it now:* Type *Analyze BTC* or *Portfolio*

💬 *Need help?* Just ask — I'm here 24/7!`;

app.post('/webhook/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Use global.database (set after MongoDB connects in initializeBot)
    const db = global.database || null;
    if (!db) {
      console.warn('⚠️ [Paystack] Database not ready yet');
      return res.status(503).send('Database not ready');
    }

    const PaystackService = require('./src/paystackService');
    const paystack = new PaystackService(db);

    // 1. Verify signature
    const signature = req.headers['x-paystack-signature'];
    if (!signature || !paystack.verifyWebhookSignature(req.body.toString(), signature)) {
      console.warn('⚠️ [Paystack] Invalid webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body);
    console.log(`🏦 [Paystack] Webhook: ${event.event}`, event.data?.reference || '');

    // 2. Log event to MongoDB
    try {
      await db.db.collection('webhook_events').insertOne({
        event: event.event,
        reference: event.data?.reference,
        data: event.data,
        received_at: new Date()
      });
    } catch (_) {}

    // 3. Process charge.success
    if (event.event === 'charge.success') {
      const { reference, metadata, customer } = event.data;
      const phone = metadata?.phone || customer?.phone?.replace(/[^0-9]/g, '') || null;

      if (!phone) {
        console.warn(`⚠️ [Paystack] No phone in metadata for ${reference}`);
        return res.status(200).send('OK');
      }

      // Check if already processed
      const existing = await db.getPaymentByReference(reference);
      if (existing && existing.status === 'completed') {
        console.log(`⏭️ [Paystack] ${reference} already processed`);
        return res.status(200).send('OK');
      }

      // Verify with Paystack API
      const verification = await paystack.verifyTransaction(reference);
      if (verification.status !== 'success') {
        console.warn(`⚠️ [Paystack] Verification failed for ${reference}: ${verification.status}`);
        return res.status(200).send('OK');
      }

      // Upgrade user to Pro
      await db.setUserPro(phone, reference);
      console.log(`✅ [Paystack] User ${phone} upgraded to Pro (ref: ${reference})`);

      // Send WhatsApp welcome message
      if (global.whatsappService && global.whatsappService.isConnected) {
        try {
          const user = await db.getUserByPhoneNumber(phone);
          if (user?.whatsapp_number) {
            await global.whatsappService.sendMessage(user.whatsapp_number, PRO_WELCOME_MESSAGE);
            console.log(`📨 [Paystack] Welcome message sent to ${phone}`);
          }
        } catch (e) {
          console.warn(`⚠️ [Paystack] Failed to send welcome: ${e.message}`);
        }
      }
    }

    res.status(200).send('OK');
  } catch (e) {
    console.error('❌ [Paystack] Webhook error:', e.message);
    res.status(500).send('Error');
  }
});

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

// ✅ Test Futures Route (Cloud Testing)
app.get('/test-futures', async (req, res) => {
  if (!global.priceService) {
    return res.status(503).json({ error: "Price service not initialized yet" });
  }
  
  const tests = [
    'BTC perp', 
    'ETH futures', 
    'SOL perp',
    'S&P 500 futures',
    'Cocoa futures',
    'Euro futures'
  ];
  const results = {};
  
  for (const t of tests) {
    try {
      const info = await global.priceService.getAssetInfo(t);
      results[t] = info?.price ?? 'failed';
    } catch (e) {
      results[t] = `error: ${e.message}`;
    }
  }
  
  res.json(results);
});

// ✅ Test AI Analysis Route (Cloud Testing)
// Hit: https://your-app.onrender.com/test-analysis
app.get('/test-analysis', async (req, res) => {
  if (!global.geminiService || !global.priceService) {
    return res.status(503).json({ error: "Services not initialized yet. Wait ~30s and retry." });
  }

  const results = {};
  const GeminiService = global.geminiService;
  const TAService = require('./src/taService');
  const ta = new TAService();

  const tests = [
    { symbol: 'BTC',  currency: 'USD' },
    { symbol: 'AAPL', currency: 'USD' },
  ];

  for (const { symbol, currency } of tests) {
    try {
      // 1. Get live price
      const info = await global.priceService.getAssetInfo(symbol);
      const price = info?.price ?? null;

      // 2. Get TA indicators
      const indicators = await ta.getIndicators(symbol);

      // 3. Get AI analysis
      const analysis = await GeminiService.analyzeMarket(symbol, price ?? 100, info?.change24h ?? null, currency);

      results[symbol] = {
        price,
        change24h: info?.change24h ?? null,
        indicators: indicators ? {
          rsi: indicators.rsi,
          macdHist: indicators.macdHist,
          ema50: indicators.ema50,
          ema200: indicators.ema200,
          bbUpper: indicators.bbUpper,
          bbLower: indicators.bbLower,
          candleCount: indicators.candleCount,
        } : 'failed (ISP block or no data)',
        analysis: analysis ?? 'failed (check GROQ_API_KEY)',
      };
    } catch (e) {
      results[symbol] = { error: e.message };
    }
  }

  res.json(results);
});

// ✅ Test NGX Source (verify Kwayisi / doclib work from Render)
// Hit: https://your-app.onrender.com/test-ngx
app.get('/test-ngx', async (req, res) => {
  const axios = require('axios');
  const cheerio = require('cheerio');
  const results = {};

  // 1️⃣ Test NGX doclib API
  results.doclib = { status: 'testing' };
  try {
    const { data } = await axios.get(
      'https://doclib.ngxgroup.com/REST/api/statistics/equities/?market=&sector=&orderby=&pageSize=500&pageNo=0',
      { timeout: 30000, family: 4 }
    );
    const recordCount = data?.records?.length || 0;
    results.doclib = {
      status: recordCount > 0 ? '✅ OK' : '⚠️ Empty (no records)',
      records: recordCount,
      sample: recordCount > 0 ? data.records.slice(0, 3).map(r => ({
        symbol: r.symbol || r.ticker,
        price: r.lastTradedPrice || r.closingPrice || r.price,
        name: r.description || r.name,
      })) : null,
    };
  } catch (e) {
    results.doclib = {
      status: '❌ Failed',
      error: e.message,
      code: e.code || null,
    };
  }

  // 2️⃣ Test Kwayisi scrape (same request the bot makes)
  results.kwayisi = { status: 'testing' };
  try {
    const browserHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-NG,en;q=0.9",
      Referer: "https://afx.kwayisi.org/",
    };

    const start = Date.now();
    const { data } = await axios.get('https://afx.kwayisi.org/ngx/', {
      family: 4, timeout: 30000, headers: browserHeaders,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const $ = cheerio.load(data);
    const rows = $('table tbody tr');
    const stocks = [];
    rows.each((i, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 4) {
        const ticker = $(cells[0]).text().trim();
        const name = $(cells[1]).text().trim();
        const price = parseFloat($(cells[3]).text().trim().replace(/,/g, ''));
        if (ticker && !isNaN(price)) {
          stocks.push({ ticker, name, price });
        }
      }
    });

    results.kwayisi = {
      status: stocks.length > 0 ? '✅ OK' : '⚠️ Parsed but no stocks',
      elapsed: `${elapsed}s`,
      totalStocks: stocks.length,
      sample: stocks.slice(0, 5),
    };
  } catch (e) {
    results.kwayisi = {
      status: '❌ Failed',
      error: e.message,
      code: e.code || null,
    };
  }

  res.json({
    timestamp: new Date().toISOString(),
    results,
    verdict: results.doclib.status === '✅ OK' || results.kwayisi.status === '✅ OK'
      ? '✅ At least one NGX source is working'
      : '❌ Both NGX sources failed — may be blocked from Render',
  });
});

// ✅ Test Alternative NGX Sources (find one that works from Render)
// Hit: https://your-app.onrender.com/test-ngx-sources
app.get('/test-ngx-sources', async (req, res) => {
  const axios = require('axios');
  const cheerio = require('cheerio');
  const results = {};

  const browserHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-NG,en;q=0.9",
  };

  const sources = [
    { name: 'NGX doclib', url: 'https://doclib.ngxgroup.com/REST/api/statistics/equities/?market=&sector=&orderby=&pageSize=500&pageNo=0', timeout: 15000, parse: 'none' },
    { name: 'Kwayisi', url: 'https://afx.kwayisi.org/ngx/', timeout: 30000, parse: 'kwayisi' },
    { name: 'Google Finance', url: 'https://www.google.com/finance/quote/MTNN:NGX', timeout: 15000, parse: 'none' },
  ];

  for (const source of sources) {
    const start = Date.now();
    try {
      const { data } = await axios.get(source.url, {
        timeout: source.timeout,
        family: 4,
        headers: { ...browserHeaders, Referer: source.url },
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const sizeKB = (Buffer.byteLength(data, 'utf8') / 1024).toFixed(1);

      if (source.parse === 'table') {
        const $ = cheerio.load(data);
        const stocks = [];
        $('table').each((ti, table) => {
          $(table).find('tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 3) {
              const ticker = $(cells[0]).text().trim();
              const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
              if (ticker && !isNaN(price) && ticker.length <= 15) {
                stocks.push({ ticker, price });
              }
            }
          });
        });
        results[source.name] = {
          status: stocks.length > 0 ? '✅ OK' : '⚠️ No stocks parsed',
          elapsed: `${elapsed}s`,
          size: `${sizeKB}KB`,
          stocksFound: stocks.length,
          sample: stocks.slice(0, 3),
        };
      } else if (source.parse === 'kwayisi') {
        const $ = cheerio.load(data);
        const stocks = [];
        $('table tbody tr').each((i, el) => {
          const cells = $(el).find('td');
          if (cells.length >= 4) {
            const ticker = $(cells[0]).text().trim();
            const name = $(cells[1]).text().trim();
            const price = parseFloat($(cells[3]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price)) {
              stocks.push({ ticker, name, price });
            }
          }
        });
        results[source.name] = {
          status: stocks.length > 0 ? '✅ OK' : '⚠️ No stocks parsed',
          elapsed: `${elapsed}s`,
          size: `${sizeKB}KB`,
          stocksFound: stocks.length,
          sample: stocks.slice(0, 3),
        };
      } else {
        results[source.name] = {
          status: '📡 Connected',
          elapsed: `${elapsed}s`,
          size: `${sizeKB}KB`,
          preview: data.substring(0, 200).replace(/\s+/g, ' ').trim(),
        };
      }
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results[source.name] = {
        status: '❌ Failed',
        elapsed: `${elapsed}s`,
        error: e.message.slice(0, 120),
        code: e.code || null,
      };
    }
  }

  // Determine which source worked best
  const working = Object.entries(results).filter(([_, v]) => v.status === '✅ OK');
  const recommendation = working.length > 0
    ? `✅ Best source: "${working[0][0]}" (${working[0][1].stocksFound || 'connected'} stocks)`
    : '❌ No source working yet — may need a paid API or proxy';

  res.json({
    timestamp: new Date().toISOString(),
    results,
    recommendation,
  });
});

// ✅ Test Candle Sources (verify which APIs work from Render's US servers)
// Hit: https://your-app.onrender.com/test-candles
app.get('/test-candles', async (req, res) => {
  const axios = require('axios');
  const results = {};

  // 1. CoinGecko (our new fallback)
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/coins/bitcoin/ohlc', {
      params: { vs_currency: 'usd', days: 90 }, timeout: 8000
    });
    results.coingecko = data?.length > 0
      ? `✅ Works — ${data.length} candles, latest close: $${data[data.length - 1][4]}`
      : '❌ Empty response';
  } catch (e) { results.coingecko = `❌ Failed: ${e.message}`; }

  // 2. Kraken OHLC
  try {
    const { data } = await axios.get('https://api.kraken.com/0/public/OHLC', {
      params: { pair: 'XBTUSD', interval: 60 }, timeout: 8000
    });
    if (data.error?.length > 0) {
      results.kraken = `❌ Error: ${data.error[0]}`;
    } else {
      const candles = data.result?.XXBTZUSD || data.result?.[Object.keys(data.result).find(k => k !== 'last')];
      results.kraken = candles?.length > 0
        ? `✅ Works — ${candles.length} candles, latest close: $${candles[candles.length - 1][4]}`
        : '❌ Empty candles';
    }
  } catch (e) { results.kraken = `❌ Failed: ${e.message}`; }

  // 3. Binance klines (expected to fail — confirming the block)
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: 'BTCUSDT', interval: '1h', limit: 5 }, timeout: 6000
    });
    results.binance = data?.length > 0 ? `✅ Works — ${data.length} candles` : '❌ Empty';
  } catch (e) { results.binance = `❌ Blocked (${e.code || e.response?.status}): ${e.message}`; }

  res.json(results);
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
    const geminiService = new GroqService(database.db);
    const TOP_COINS = ['BTC', 'ETH', 'SOL', 'AAPL', 'ZENITHBANK', 'DANGCEM', 'MTNN', 'GTCO'];

    cron.schedule('0 7 * * *', async () => {
      console.log('☀️ [Daily Brief] Sending morning brief to ALL active users (Pro + Free teaser)...');
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

        // 2. Get ALL active users (used in last 7 days)
        const activeUsers = await database.getActiveUsers(7);
        if (activeUsers.length === 0) {
          console.log('☀️ [Daily Brief] No active users found, skipping.');
          return;
        }

        // 3. Generate ONE AI brief (cached — all users share it)
        const baseBrief = await geminiService.generateDailyBrief(marketData, '{{NAME}}');
        const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

        // 4. Send personalised message to each user
        for (const user of activeUsers) {
          try {
            const name = user.name || 'Trader';
            const jid = user.whatsapp_number;
            const isPro = user.subscription_type === 'pro';
            const userAlerts = await database.getUserAlerts(user.phone_number);
            const activeAlerts = userAlerts.filter(a => a.status === 'active');

            const priceLines = marketData
              .map(m => {
                const arrow = (m.change24h !== null && m.change24h >= 0) ? '🟢' : '🔴';
                return `${arrow} *${m.symbol}:* ${priceService.formatPrice(m.price, m.symbol, m.currency)}`;
              })
              .join('\n');

            let msg = `☀️ *Good Morning, ${name}!*

📊 *Daily Market Brief — ${today}*
━━━━━━━━━━━━━━━━━
${priceLines}`;

            if (isPro) {
              // ✅ PRO: Full AI insight + alerts
              let alertLine = '';
              if (activeAlerts.length > 0) {
                alertLine = `\n\n📋 *Your Alerts:* ${activeAlerts.length} active\n` +
                  activeAlerts.slice(0, 3).map(a =>
                    `   └ ${a.asset} ${a.direction} ${priceService.formatPrice(a.target_price, a.asset)}`
                  ).join('\n');
              }

              const aiInsight = baseBrief ? baseBrief.replace('{{NAME}}', name) : '';

              msg += `${alertLine}
━━━━━━━━━━━━━━━━━
🤖 *AI Insight:*
${aiInsight || 'Markets are moving — check your alerts!'}

_Reply with any coin name for full analysis._`;

            } else {
              // 🔒 FREE: Teaser version with upgrade CTA
              const aiInsight = baseBrief ? baseBrief.replace('{{NAME}}', name) : '';
              
              // Truncate the AI insight to first 120 characters
              const teaserInsight = aiInsight.length > 120 
                ? aiInsight.substring(0, 120) + '...' 
                : aiInsight;

              msg += `
━━━━━━━━━━━━━━━━━
🤖 *AI Insight:*
${teaserInsight}

━━━━━━━━━━━━━━━━━
🔒 *Upgrade to read the full analysis*

For just *₦2,000/month*, unlock:
✅ Full daily AI market briefs
✅ Unlimited alerts (vs 3 per 12h)
✅ Portfolio tracking & trade journal
✅ SMS notifications (never miss an alert)

Type *Upgrade* now! 🚀`;

              // ✅ LOG CONVERSION EVENT
              try {
                await database.db.collection('conversion_events').insertOne({
                  phone_number: user.phone_number,
                  event: 'daily_brief_teaser_shown',
                  timestamp: new Date()
                });
              } catch (e) {
                console.warn(`⚠️ [Daily Brief] Event log failed for ${user.phone_number}`);
              }
            }

            await whatsappService.sendMessage(jid, msg);
            // Small delay to avoid flooding
            await new Promise(r => setTimeout(r, 1200));
          } catch (e) {
            console.error(`☀️ [Daily Brief] Failed for ${user.phone_number}:`, e.message);
          }
        }
        
        const proCount = activeUsers.filter(u => u.subscription_type === 'pro').length;
        console.log(`☀️ [Daily Brief] Sent to ${activeUsers.length} users (${proCount} Pro, ${activeUsers.length - proCount} Free).`);
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
