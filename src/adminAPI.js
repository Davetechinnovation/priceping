// src/adminAPI.js
// ================================================
// PricePing Admin API — ALL REAL DATA, ZERO MOCKS
// ================================================

// ──────────────────────────────────────────
// CPU TRACKING (process.cpuUsage delta)
// ──────────────────────────────────────────
let _prevCpu = process.cpuUsage();
let _prevCpuTime = Date.now();

function getRealCpuPercent() {
  const now = Date.now();
  const elapsedUs = (now - _prevCpuTime) * 1000; // wall-clock ms → µs
  if (elapsedUs <= 0) return 0;

  const cur = process.cpuUsage();
  const userDelta = cur.user - _prevCpu.user; // µs spent in user mode
  const sysDelta = cur.system - _prevCpu.system; // µs spent in system mode

  _prevCpu = cur;
  _prevCpuTime = now;

  // (cpu µs / wall µs) × 100 = percent of one core
  const pct = ((userDelta + sysDelta) / elapsedUs) * 100;
  return Math.min(100, Math.round(pct * 10) / 10);
}

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────
function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

async function measureDbLatency(db) {
  if (!db?.db) return -1;
  const start = Date.now();
  try {
    await db.db.collection("users").findOne({}, { projection: { _id: 1 } });
    return Date.now() - start;
  } catch {
    return -1;
  }
}

function extractPhone(rawId) {
  if (!rawId) return null;
  return "+" + rawId.split("@")[0].split(":")[0];
}

function computeHealth(memPercent, whatsapp, database, alertMonitor, ngx, intelligence) {
  const wa = whatsapp?.isConnected ? 100 : 0;
  const db = database?.isConnected ? 100 : 0;
  const am = alertMonitor?.isRunning ? 100 : 0;
  const nx = ngx ? 100 : 0;
  const ai = intelligence ? 100 : 0;
  const mem =
    memPercent < 70 ? 100 : memPercent < 85 ? 70 : memPercent < 95 ? 30 : 0;
  
  return {
    overall: Math.round((wa + db + am + nx + ai + mem) / 6),
    whatsapp: wa,
    database: db,
    alerts: am,
    ngx: nx,
    intelligence: ai,
    memory: mem,
  };
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function getResetIn(periodStart) {
  if (!periodStart) return "now";
  const elapsed = Date.now() - new Date(periodStart).getTime();
  const remaining = TWELVE_HOURS_MS - elapsed;
  if (remaining <= 0) return "now";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

// ══════════════════════════════════════════
// ADMIN API FACTORY
// ══════════════════════════════════════════
function createAdminAPI(app, memoryMonitor) {
  // ── Response time & heartbeat tracking ──
  const _responseTimes = [];
  let _lastHeartbeat = null;
  let _yesterdaySuccessRate = null;
  let _yesterdayCalculatedAt = null;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/status
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // In adminAPI.js — replace the existing /api/admin/status handler with this:

/**
 * @swagger
 * /api/admin/status:
 *   get:
 *     summary: Get comprehensive system status
 *     description: Returns complete system status including bot, WhatsApp, users, alerts, and system metrics
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: System status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bot:
 *                   $ref: '#/components/schemas/BotStatus'
 *                 whatsapp:
 *                   $ref: '#/components/schemas/WhatsAppStatus'
 *                 users:
 *                   $ref: '#/components/schemas/UserStats'
 *                 alerts:
 *                   $ref: '#/components/schemas/AlertStats'
 *                 system:
 *                   $ref: '#/components/schemas/SystemStats'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/stats
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/stats:
   *   get:
   *     summary: Get overall alert statistics
   *     description: Returns total alerts for today, all time, delivery success percentage, and average latency.
   *     tags: [Admin]
   *     responses:
   *       200:
   *         description: Statistics retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AlertStats'
   *       500:
   *         description: Database not available
   */
  app.get("/api/admin/stats", async (req, res) => {
    try {
      const database = global.database;
      const alertMonitor = global.alertMonitor;
      
      if (!database?.isConnected) {
        return res.status(500).json({ error: "Database not available" });
      }

      const allAlerts = await database.getAllAlerts();
      const now = new Date();
      const todayStart = new Date(now.setHours(0, 0, 0, 0));

      const totalAlertsAllTime = allAlerts.length;
      const totalAlertsToday = allAlerts.filter(a => new Date(a.created_at) >= todayStart).length;
      
      const triggeredAlerts = allAlerts.filter(a => a.status === "triggered");
      const deliverySuccessPercent = totalAlertsAllTime > 0 
        ? Math.round((triggeredAlerts.length / totalAlertsAllTime) * 100) 
        : 0;

      const avgLatency = alertMonitor?.dbLatency ?? 0;

      res.json({
        totalToday: totalAlertsToday,
        totalAllTime: totalAlertsAllTime,
        deliverySuccess: deliverySuccessPercent,
        avgLatency: avgLatency
      });
    } catch (error) {
      console.error("Admin stats error:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/feed
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/feed:
   *   get:
   *     summary: Get live alert feed
   *     description: Returns the 50 most recent alerts with timestamp, symbol, condition, user, and status.
   *     tags: [Admin]
   *     responses:
   *       200:
   *         description: Feed retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/AlertFeedItem'
   */
  app.get("/api/admin/feed", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected) {
        return res.status(500).json({ error: "Database not available" });
      }

      const alerts = await database.db.collection("alerts")
        .find({})
        .sort({ created_at: -1 })
        .limit(50)
        .toArray();

      const userIds = [...new Set(alerts.map(a => a.user_id))];
      const users = await database.db.collection("users")
        .find({ _id: { $in: userIds.map(id => {
          try { return new (require("mongodb").ObjectId)(id); } catch(e) { return null; }
        }).filter(Boolean) } })
        .toArray();
      
      const userMap = {};
      users.forEach(u => {
        userMap[u._id.toString()] = u.name || u.phone_number;
      });

      const feed = alerts.map(a => ({
        timestamp: a.created_at,
        symbol: a.asset,
        condition: `Price ${a.direction === 'above' ? '>' : '<'} ${global.priceService?.formatPrice(a.target_price, a.asset) || a.target_price.toLocaleString()}`,
        user: userMap[a.user_id] || a.user_id,
        status: a.status
      }));

      res.json(feed);
    } catch (error) {
      console.error("Admin feed error:", error);
      res.status(500).json({ error: "Failed to get feed" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/external-status
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/external-status:
   *   get:
   *     summary: Get status of all external APIs
   *     description: Checks the connectivity and latency of DIA Data (Crypto/Commodities) and Forex APIs.
   *     tags: [Admin]
   *     responses:
   *       200:
   *         description: External statuses retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/ExternalApiStatus'
   */
  app.get("/api/admin/external-status", async (req, res) => {
    try {
      const priceService = global.priceService;
      const geminiService = global.geminiService;
      const termiiService = global.termiiService;

      // If services aren't ready, show Initializing state
      if (!priceService || !geminiService || !termiiService) {
        return res.json([
          { name: "Crypto API (DIA)", status: "Initializing...", latency: "N/A" },
          { name: "Forex API", status: "Initializing...", latency: "N/A" },
          { name: "AI API (Groq)", status: "Initializing...", latency: "N/A" },
          { name: "SMS API", status: "Initializing...", latency: "N/A" },
        ]);
      }

      // ✅ Smarter health check function
      const checkApiHealth = async (name, url, options = {}) => {
        if (!url) return { name, status: "Misconfigured", latency: "N/A" };
        const start = Date.now();
        try {
          // Use a fresh axios instance for health checks to avoid header pollution
          const axios = require('axios');
          await axios.get(url, { timeout: 8000, ...options });
          return { name, status: "Connected", latency: `${Date.now() - start}ms` };
        } catch (e) {
          return { name, status: "Disconnected", latency: "N/A" };
        }
      };

      const checks = [
        // 1. 🇺🇸 Finnhub (US Stocks primary)
        priceService.finnhubKey
          ? checkApiHealth("Finnhub (US Stocks)", `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${priceService.finnhubKey}`)
          : Promise.resolve({ name: "Finnhub (US Stocks)", status: "Misconfigured (no key)", latency: "N/A" }),

        // 2. 💎 DIA Data (Crypto)
        checkApiHealth("DIA Data (Crypto)", priceService.quotedAssetsApi),

        // 3. 💱 FX Rates API (Forex)
        checkApiHealth("FX Rates (Forex)", `${priceService.forexApi}?base=USD`),

        // 4. 🇳🇬 NGX Pulse (Nigerian Stocks primary — multi-key rotation)
        priceService.ngxPulseKeys.length > 0
          ? checkApiHealth("NGX Pulse (NGX Stocks)", `https://www.ngxpulse.ng/api/ngxdata/stocks`, { headers: { 'X-API-Key': priceService.ngxPulseKeys[0], 'Content-Type': 'application/json' } })
          : Promise.resolve({ name: "NGX Pulse (NGX Stocks)", status: "Misconfigured (no keys)", latency: "N/A" }),

        // 5. 📈 Yahoo Finance (Futures & Indices)
        checkApiHealth("Yahoo Finance (Futures)", "https://query1.finance.yahoo.com/v1/finance/search?q=ES%3DF"),

        // 6. 🔬 Kraken (Crypto candles for TA)
        checkApiHealth("Kraken (TA Candles)", "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60"),

        // 7. 🤖 Groq AI (Market Analysis)
        checkApiHealth("AI (Groq)", "https://api.groq.com/openai/v1/models", {
          headers: { 'Authorization': `Bearer ${geminiService.apiKey}` }
        }),

        // 8. 📰 Google News (Headlines)
        checkApiHealth("Google News", "https://news.google.com/rss"),

        // 9. 🌡️ Fear & Greed Index
        checkApiHealth("Fear & Greed Index", "https://api.alternative.me/fng/"),

        // 10. 📱 Termii (SMS Alerts)
        termiiService.apiKey
          ? checkApiHealth("SMS (Termii)", `https://api.ng.termii.com/api/get-balance?api_key=${termiiService.apiKey}`, {})
          : Promise.resolve({ name: "SMS (Termii)", status: "Misconfigured (no key)", latency: "N/A" }),
      ];

      const results = await Promise.all(checks);
      res.json(results);

    } catch (error) {
      console.error("External status error:", error);
      res.status(500).json({ error: "Failed to get external status" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/price-check?coin=BTC
  //  Price-only lookup — does NOT send any WhatsApp message
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/api/admin/price-check", async (req, res) => {
    try {
      const { coin } = req.query;
      if (!coin) return res.status(400).json({ error: "coin query param required" });

      const priceService = global.priceService;
      if (!priceService) {
        return res.status(503).json({ error: "Price service is initializing" });
      }
      const priceInfo = await priceService.getAssetInfo(coin.toUpperCase());
      if (!priceInfo) {
        return res.status(404).json({ error: "Coin not found" });
      }

      res.json({ 
        price: priceInfo.price, 
        symbol: priceInfo.symbol, 
        name: priceInfo.name,
        currency: priceInfo.currency,
        formattedPrice: priceService.formatPrice(priceInfo.price, priceInfo.symbol, priceInfo.currency)
      });
    } catch (error) {
      console.error("Price check error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  POST /api/admin/trigger-manual
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/trigger-manual:
   *   post:
   *     summary: Manually trigger a test alert
   *     description: Fetches real-time price for a coin and sends it to the admin or a specified phone number.
   *     tags: [Admin]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               coin:
   *                 type: string
   *                 example: "BTC"
   *               recipientType:
   *                 type: string
   *                 enum: [self, other, custom]
   *               phoneNumber:
   *                 type: string
   *                 description: Required if recipientType is 'other' or 'custom'
   *     responses:
   *       200:
   *         description: Manual alert triggered successfully
   *       404:
   *         description: Coin not found
   *       400:
   *         description: Invalid parameters
   */
  app.post("/api/admin/trigger-manual", async (req, res) => {
    try {
      const { coin, recipientType, phoneNumber, channel = "whatsapp" } = req.body;
      const priceService = global.priceService;
      const whatsappService = global.whatsappService;
      const termiiService = global.termiiService;

      const priceInfo = await priceService.getAssetInfo(coin);
      if (!priceInfo) {
        return res.status(404).json({ error: "Coin not found" });
      }

      let targetPhone = "";
      if (recipientType === "self") {
        const myJid = whatsappService?.myJid;
        targetPhone = myJid ? myJid.split(":")[0].split("@")[0] : null;
      } else {
        if (!phoneNumber) {
          return res.status(400).json({ error: "phoneNumber is required when recipientType is 'other' or 'custom'" });
        }
        const { countryCode } = req.body;
        const cc = (countryCode || "234").replace(/[^0-9]/g, "");
        let cleaned = phoneNumber.replace(/[^0-9+]/g, "");

        if (cleaned.startsWith("+")) {
          targetPhone = cleaned.substring(1);
        } else if (cleaned.startsWith("0")) {
          targetPhone = cc + cleaned.substring(1);
        } else if (cleaned.startsWith(cc) && (cleaned.length === cc.length + 10 || cleaned.length === cc.length + 9)) {
          targetPhone = cleaned;
        } else {
          targetPhone = cc + cleaned;
        }
      }

      if (!targetPhone) {
        return res.status(400).json({ error: "Recipient phone number not found" });
      }

      const results = { whatsapp: null, sms: null };

      // ── WhatsApp via Baileys ──
      if (channel === "whatsapp" || channel === "both") {
        try {
          const waMessage = `🛠️ *MANUAL TEST ALERT*
      
💰 Asset: *${priceInfo.name} (${priceInfo.symbol})*
💵 Current Price: *${priceService.formatPrice(priceInfo.price, priceInfo.symbol)}*
🏦 Exchange: ${priceInfo.blockchain}

_This is a manual trigger for testing purposes._`;
          const jid = `${targetPhone}@s.whatsapp.net`;
          await whatsappService.sock.sendMessage(jid, { text: waMessage });
          results.whatsapp = "sent";
        } catch (e) {
          console.error("Manual trigger WhatsApp error:", e.message);
          results.whatsapp = "failed";
        }
      }

      // ── SMS via Termii ──
      if (channel === "sms" || channel === "both") {
        if (!termiiService?.isAvailable) {
          results.sms = "unavailable (no Termii API key)";
        } else {
          try {
            const smsMessage = `[PricePing Test Alert]
Asset: ${priceInfo.name} (${priceInfo.symbol})
Price: ${priceService.formatPrice(priceInfo.price, priceInfo.symbol)}
Exchange: ${priceInfo.blockchain}
(Manual test trigger)`;
            await termiiService.sendSMS(targetPhone, smsMessage, "generic");
            results.sms = "sent";
          } catch (e) {
            console.error("Manual trigger SMS error:", e.message);
            results.sms = `failed: ${e.message}`;
          }
        }
      }

      const anySuccess = Object.values(results).some(v => v === "sent");
      const summary = Object.entries(results)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");

      res.json({
        success: anySuccess,
        message: `Alert sent to +${targetPhone} (${summary})`,
        price: priceInfo.price,
        results,
      });
    } catch (error) {
      console.error("Manual trigger error:", error);
      res.status(500).json({ error: error.message });
    }
  });


  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  POST /api/admin/lockdown
  //  Body: { active: true | false }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.post("/api/admin/lockdown", (req, res) => {
    try {
      const { active } = req.body;
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "Body must include { active: true | false }" });
      }

      global.isLockedDown = active;

      // Pause / resume the alert monitor so no alerts fire during lockdown
      const alertMonitor = global.alertMonitor;
      if (alertMonitor) {
        if (active) {
          alertMonitor.isLockedDown = true;
          console.log("[LOCKDOWN] 🔒 Emergency lockdown ACTIVATED — alerts paused");
        } else {
          alertMonitor.isLockedDown = false;
          console.log("[LOCKDOWN] 🔓 Emergency lockdown LIFTED — alerts resumed");
        }
      }

      res.json({
        success: true,
        isLockedDown: active,
        message: active ? "🔒 Bot is now in emergency lockdown." : "🔓 Lockdown lifted. Bot resumed.",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Lockdown error:", error);
      res.status(500).json({ error: "Failed to toggle lockdown" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/lockdown/status
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/api/admin/lockdown/status", (req, res) => {
    res.json({ isLockedDown: !!global.isLockedDown });
  });

  app.get("/api/admin/status", async (req, res) => {
    try {
      const mem = memoryMonitor.getStats();
      const database = global.database;
      const whatsappService = global.whatsappService;
      const alertMonitor = global.alertMonitor;

      let totalUsers = 0,
        newUsers24h = 0,
        proUsers = 0,
        activeAlerts = 0;
      let activeUsers = 0,
        weeklyGrowth = 0,
        dailyNew = [];

      if (database?.isConnected) {
        try {
          const allUsers = await database.getAllUsers();
          totalUsers = allUsers.length;
          proUsers = allUsers.filter(
            (u) => u.subscription_type === "pro",
          ).length;

          const yesterday = new Date(Date.now() - DAY_MS);
          const lastWeek = new Date(Date.now() - WEEK_MS);
          const twoWeeksAgo = new Date(Date.now() - 2 * WEEK_MS);

          newUsers24h = allUsers.filter(
            (u) => new Date(u.created_at) > yesterday,
          ).length;

          // Weekly growth: this week vs last week registrations
          const newThisWeek = allUsers.filter(
            (u) => new Date(u.created_at) > lastWeek,
          ).length;
          const newPrevWeek = allUsers.filter((u) => {
            const c = new Date(u.created_at);
            return c > twoWeeksAgo && c <= lastWeek;
          }).length;
          if (newPrevWeek > 0)
            weeklyGrowth = Math.round(
              ((newThisWeek - newPrevWeek) / newPrevWeek) * 100,
            );
          else if (newThisWeek > 0) weeklyGrowth = 100;

          // Daily new users for last 7 days (for mini chart)
          for (let i = 6; i >= 0; i--) {
            const dayStart = new Date(Date.now() - (i + 1) * DAY_MS);
            const dayEnd = new Date(Date.now() - i * DAY_MS);
            dailyNew.push(
              allUsers.filter((u) => {
                const c = new Date(u.created_at);
                return c >= dayStart && c < dayEnd;
              }).length,
            );
          }

          // Active users = unique users who created alerts in last 24h
          const recentAlerts = await database.db
            .collection("alerts")
            .find({ created_at: { $gte: yesterday } })
            .project({ user_id: 1 })
            .toArray();
          activeUsers = new Set(recentAlerts.map((a) => a.user_id)).size;

          const alerts = await database.getActiveAlerts();
          activeAlerts = alerts.length;
        } catch (e) {
          console.error("Status DB error:", e.message);
        }
      }

      const rss = mem.current?.rss || 0;
      const renderLim = mem.limits?.render || 512;
      const memPercent = Math.round((rss / renderLim) * 100);
      const cpuPercent = getRealCpuPercent();
      const ngxStatus = Object.keys(priceService?.ngxCache?.data || {}).length > 0;
      const aiStatus = !!global.geminiService?.apiKey;

      const health = computeHealth(
        memPercent,
        whatsappService,
        database,
        alertMonitor,
        ngxStatus,
        aiStatus
      );

      res.json({
        bot: {
          status: global.botInitialized ? "online" : "offline",
          uptime: process.uptime(),
          version: "1.0.0",
        },
        whatsapp: {
          connected: whatsappService?.isConnected || false,
          hasSession: !!whatsappService?.sock?.authState?.creds?.registered,
        },
        users: {
          total: totalUsers,
          new24h: newUsers24h,
          activeUsers: activeUsers,
          pro: proUsers,
          weeklyGrowth: weeklyGrowth,
          dailyNew: dailyNew,
        },
        alerts: { active: activeAlerts },
        system: {
          memory: {
            rss,
            heapUsed: mem.current?.heapUsed || 0,
            limit: renderLim,
            percentage: memPercent,
          },
          cpu: { percentage: cpuPercent },
          health: health,
        },
      });
    } catch (error) {
      console.error("Admin status error:", error);
      res.status(500).json({ error: "Failed to get admin status" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/performance
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/api/admin/performance", async (req, res) => {
    try {
      const reqStart = Date.now();
      const mem = memoryMonitor.getStats();
      const database = global.database;
      const alertMonitor = global.alertMonitor;
      const whatsappService = global.whatsappService;
      const priceService = global.priceService;

      const cpuPercent = getRealCpuPercent();
      const rss = mem.current?.rss || 0;
      const renderLim = mem.limits?.render || 512;
      const ramPct = Math.round((rss / renderLim) * 100);

      // 1. Measure Database Latency via simple query
      const dbLatency = database?.isConnected
        ? await measureDbLatency(database)
        : -1;

      // 2. Get the Alert Monitor Latency (PURE DB TIME)
      // We use 'dbLatency' (internal speed) not 'lastCheckDuration' (internet speed)
      const alertLatency = alertMonitor?.dbLatency ?? -1;

      // 3. Measure API Response Latency
      const apiLatency = Date.now() - reqStart;

      const ngxStatus = Object.keys(priceService?.ngxCache?.data || {}).length > 0;
      const aiStatus = !!global.geminiService?.apiKey;

      // Calculate Health Score
      const health = computeHealth(
        ramPct,
        whatsappService,
        database,
        alertMonitor,
        ngxStatus,
        aiStatus
      );

      res.json({
        latency: { 
            alerts: alertLatency, // This will now be fast (e.g., 5ms)
            database: dbLatency, 
            api: apiLatency 
        },
        system: {
          cpu: cpuPercent,
          ram: ramPct,
          memory: {
            rss,
            limit: renderLim,
            percentage: ramPct,
          },
        },
        health,
        priceService: priceService ? {
          cacheSize: Object.keys(priceService.priceCache || {}).length,
          ngxCacheSize: Object.keys(priceService.ngxCache?.data || {}).length,
        } : {},
        alertMonitor: {
          running: !!alertMonitor?.isRunning,
          checking: !!alertMonitor?.isChecking,
          lastCheckTime: alertMonitor?.lastCheckTime || null,
          alertsChecked: alertMonitor?.lastCheckAlertCount || 0,
          lastTriggered: alertMonitor?.lastCheckTriggered || 0,
          totalDuration: alertMonitor?.lastCheckDuration || 0, // We still send this for debugging
        },
        uptime: process.uptime(),
      });
    } catch (error) {
      console.error("Admin performance error:", error);
      res.status(500).json({ error: "Failed to get performance data" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ✅ NEW: User Summary (Total, Active, Blocked)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/users/summary:
   *   get:
   *     summary: Get user summary statistics
   *     description: Returns total, blocked, and active user counts
   *     tags: [Admin]
   *     responses:
   *       200:
   *         description: User summary retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 total:
   *                   type: integer
   *                   description: Total number of users
   *                 blocked:
   *                   type: integer
   *                   description: Number of blocked users
   *                 active:
   *                   type: integer
   *                   description: Number of active users
   *       500:
   *         description: Database not available or internal error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get("/api/admin/users/summary", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const allUsers = await database.getAllUsers();
      
      const total = allUsers.length;
      const blocked = allUsers.filter(u => u.is_blocked === true).length;

      // Active = users who interacted with the bot in last 24h
      const yesterday = new Date(Date.now() - DAY_MS);
      
      // Check users collection: updated_at within 24h means they sent a message
      const activeIn24h = allUsers.filter(u => 
        u.is_blocked !== true && 
        u.updated_at && 
        new Date(u.updated_at) > yesterday
      ).length;

      res.json({
        total,
        blocked,
        active: activeIn24h
      });

    } catch (error) {
      console.error("User summary error:", error);
      res.status(500).json({ error: "Failed to get user summary" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ✅ NEW: Block/Unblock User
  //  Body: { phoneNumber: "23480...", block: true/false }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/users/block:
   *   post:
   *     summary: Block or unblock a user
   *     description: Updates user's blocked status by phone number
   *     tags: [Admin]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               phoneNumber:
   *                 type: string
   *                 description: User's phone number
   *                 example: "2348103393608"
   *               block:
   *                 type: boolean
   *                 description: true to block, false to unblock
   *                 example: true
   *     responses:
   *       200:
   *         description: User status updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   description: Operation success status
   *                 message:
   *                   type: string
   *                   description: Status message
   *                 is_blocked:
   *                   type: boolean
   *                   description: Updated blocked status
   *       400:
   *         description: Phone number required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.post("/api/admin/users/block", async (req, res) => {
    try {
      const { phoneNumber, block } = req.body;
      const database = global.database;

      if (!phoneNumber) return res.status(400).json({ error: "Phone required" });

      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
      
      const result = await database.db.collection("users").updateOne(
        { phone_number: cleanPhone },
        { 
          $set: { 
            is_blocked: block === true,
            updated_at: new Date()
          } 
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ 
        success: true, 
        message: `User ${cleanPhone} ${block ? 'blocked' : 'unblocked'}.`,
        is_blocked: block 
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/admin/users/reset-quota:
   *   post:
   *     summary: Reset a user's free alert quota
   *     description: Resets alerts_used_this_period to 0 and starts a new 12-hour quota window.
   *     tags: [Admin]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               phoneNumber:
   *                 type: string
   *                 description: User phone number
   *                 example: "2348103393608"
   *     responses:
   *       200:
   *         description: Quota reset successfully
   *       400:
   *         description: phoneNumber is required
   *       404:
   *         description: User not found
   *       500:
   *         description: Database not available or internal error
   */
  app.post("/api/admin/users/reset-quota", async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      const database = global.database;

      if (!phoneNumber)
        return res.status(400).json({ error: "phoneNumber is required" });
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");

      const result = await database.db.collection("users").updateOne(
        { phone_number: cleanPhone },
        {
          $set: {
            alerts_used_this_period: 0,
            last_alert_reset: new Date(),
            updated_at: new Date(),
          },
        },
      );

      if (result.matchedCount === 0)
        return res.status(404).json({ error: "User not found" });

      res.json({
        success: true,
        message: `Quota reset for ${cleanPhone}. They now have 3 fresh alerts.`,
        phone: cleanPhone,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/admin/users/change-plan:
   *   post:
   *     summary: Change a user's subscription plan
   *     description: Sets subscription_type to free or pro, and updates related subscription/quota fields.
   *     tags: [Admin]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               phoneNumber:
   *                 type: string
   *                 description: User phone number
   *                 example: "2348103393608"
   *               plan:
   *                 type: string
   *                 enum: [free, pro]
   *                 example: "pro"
   *     responses:
   *       200:
   *         description: Plan changed successfully
   *       400:
   *         description: Validation error
   *       404:
   *         description: User not found
   *       500:
   *         description: Database not available or internal error
   */
  app.post("/api/admin/users/change-plan", async (req, res) => {
    try {
      const { phoneNumber, plan } = req.body;
      const database = global.database;

      if (!phoneNumber)
        return res.status(400).json({ error: "phoneNumber is required" });
      if (!plan || !["free", "pro"].includes(plan))
        return res
          .status(400)
          .json({ error: 'plan must be "free" or "pro"' });
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
      const updateFields = { subscription_type: plan, updated_at: new Date() };

      if (plan === "pro") {
        updateFields.subscription_start_date = new Date();
      } else {
        updateFields.subscription_start_date = null;
        updateFields.alerts_used_this_period = 0;
        updateFields.last_alert_reset = new Date();
      }

      const result = await database.db
        .collection("users")
        .updateOne({ phone_number: cleanPhone }, { $set: updateFields });

      if (result.matchedCount === 0)
        return res.status(404).json({ error: "User not found" });

      res.json({
        success: true,
        message: `${cleanPhone} is now on the ${plan.toUpperCase()} plan.`,
        phone: cleanPhone,
        plan,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ✅ NEW: User List with Search, Filter & Last Interaction
  //  GET /api/admin/users/list?search=john&status=active&plan=pro&page=1&limit=20
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/users/list:
   *   get:
   *     summary: Get paginated user list with search and filters
   *     description: Returns a paginated list of users with search, status, and plan filtering capabilities. Includes last interaction time and alert statistics.
   *     tags: [Admin]
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search by name or phone number
   *         example: john
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [all, active, blocked]
   *           default: all
   *         description: Filter by user status
   *         example: active
   *       - in: query
   *         name: plan
   *         schema:
   *           type: string
   *           enum: [all, free, pro]
   *           default: all
   *         description: Filter by subscription plan
   *         example: pro
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of users per page
   *         example: 20
   *     responses:
   *       200:
   *         description: User list retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 users:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                         description: User ID
   *                       phone:
   *                         type: string
   *                         description: User's phone number
   *                       name:
   *                         type: string
   *                         description: User's name
   *                       plan:
   *                         type: string
   *                         enum: [free, pro]
   *                         description: Subscription plan
   *                       lastInteraction:
   *                         type: string
   *                         format: date-time
   *                         description: Last interaction timestamp
   *                       lastInteractionAgo:
   *                         type: string
   *                         description: Human-readable last interaction time
   *                       status:
   *                         type: string
   *                         enum: [active, blocked]
   *                         description: User status
   *                       activeAlerts:
   *                         type: integer
   *                         description: Number of active alerts
   *                       totalAlerts:
   *                         type: integer
   *                         description: Total alerts ever created
   *                       alertsUsed:
   *                         type: integer
   *                         description: Alerts used in current period
   *                       joined:
   *                         type: string
   *                         format: date-time
   *                         description: When user joined
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     page:
   *                       type: integer
   *                       description: Current page number
   *                     limit:
   *                       type: integer
   *                       description: Users per page
   *                     total:
   *                       type: integer
   *                       description: Total users matching filters
   *                     totalPages:
   *                       type: integer
   *                       description: Total number of pages
   *       500:
   *         description: Database not available or internal error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get("/api/admin/users/list", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const search = (req.query.search || "").trim();
      const status = req.query.status || "all";
      const plan = req.query.plan || "all";
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip = (page - 1) * limit;

      const query = {};
      if (status === "blocked") query.is_blocked = true;
      else if (status === "active") query.is_blocked = { $ne: true };

      if (plan === "pro") query.subscription_type = "pro";
      else if (plan === "free") query.subscription_type = { $ne: "pro" };

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { phone_number: { $regex: search, $options: "i" } },
        ];
      }

      const totalCount = await database.db
        .collection("users")
        .countDocuments(query);

      const users = await database.db
        .collection("users")
        .find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Batch-fetch alert stats
      const userIds = users.map((u) => u._id.toString());
      let alertStatsMap = {};

      if (userIds.length > 0) {
        const alertAgg = await database.db
          .collection("alerts")
          .aggregate([
            { $match: { user_id: { $in: userIds } } },
            {
              $group: {
                _id: "$user_id",
                totalAlerts: { $sum: 1 },
                activeAlerts: {
                  $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
                },
                triggeredAlerts: {
                  $sum: { $cond: [{ $eq: ["$status", "triggered"] }, 1, 0] },
                },
                lastAlertActivity: {
                  $max: { $max: ["$created_at", "$updated_at", "$triggered_at"] },
                },
              },
            },
          ])
          .toArray();

        alertAgg.forEach((a) => {
          alertStatsMap[a._id] = a;
        });
      }

      const FREE_LIMIT = 3;

      const userList = users.map((u) => {
        const id = u._id.toString();
        const alertStats = alertStatsMap[id] || {};
        const isPro = u.subscription_type === "pro";

        // Last Active = most recent of last_active, updated_at, or alert activity
        const candidates = [
          u.last_active ? new Date(u.last_active) : null,
          u.updated_at ? new Date(u.updated_at) : null,
          alertStats.lastAlertActivity ? new Date(alertStats.lastAlertActivity) : null,
        ].filter(Boolean);

        const lastActive =
          candidates.length > 0
            ? new Date(Math.max(...candidates.map((d) => d.getTime())))
            : null;

        // Quota
        const alertsUsedThisPeriod = u.alerts_used_this_period || 0;
        const periodStart = u.last_alert_reset || u.created_at;
        const periodElapsed = Date.now() - new Date(periodStart).getTime();
        const periodExpired = periodElapsed >= TWELVE_HOURS_MS;
        const effectiveUsed = periodExpired ? 0 : alertsUsedThisPeriod;

        return {
          id,
          phone: u.phone_number,
          name: u.name || "Unknown",
          plan: isPro ? "pro" : "free",
          status: u.is_blocked === true ? "blocked" : "active",

          dateJoined: u.created_at,
          dateJoinedAgo: u.created_at ? getTimeAgo(u.created_at) : "Unknown",

          lastActive,
          lastActiveAgo: lastActive ? getTimeAgo(lastActive) : "Never",

          activeAlerts: alertStats.activeAlerts || 0,
          totalAlerts: alertStats.totalAlerts || 0,
          triggeredAlerts: alertStats.triggeredAlerts || 0,

          totalCommands: u.total_commands || 0,

          quota: {
            used: effectiveUsed,
            limit: isPro ? "unlimited" : FREE_LIMIT,
            remaining: isPro
              ? "unlimited"
              : Math.max(0, FREE_LIMIT - effectiveUsed),
            isPro,
            periodExpired,
            resetIn: isPro ? null : getResetIn(periodStart),
          },
        };
      });

      res.json({
        users: userList,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      });
    } catch (error) {
      console.error("User list error:", error);
      res.status(500).json({ error: "Failed to get user list" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/users
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get user statistics and list
 *     description: Returns user statistics including growth metrics and a list of recent users
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: User data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of users
 *                 new24h:
 *                   type: integer
 *                   description: New users in last 24 hours
 *                 new7d:
 *                   type: integer
 *                   description: New users in last 7 days
 *                 pro:
 *                   type: integer
 *                   description: Number of pro users
 *                 free:
 *                   type: integer
 *                   description: Number of free users
 *                 growth:
 *                   type: object
 *                   properties:
 *                     weekly:
 *                       type: integer
 *                       description: Weekly growth percentage
 *                     trend:
 *                       type: string
 *                       enum: [up, down, flat]
 *                       description: Growth trend
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserInfo'
 *       500:
 *         description: Database not available or internal error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
  app.get("/api/admin/users", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const allUsers = await database.getAllUsers();
      const yesterday = new Date(Date.now() - DAY_MS);
      const lastWeek = new Date(Date.now() - WEEK_MS);
      const twoWeeksAgo = new Date(Date.now() - 2 * WEEK_MS);

      const newUsers24h = allUsers.filter(
        (u) => new Date(u.created_at) > yesterday,
      ).length;
      const newUsers7d = allUsers.filter(
        (u) => new Date(u.created_at) > lastWeek,
      ).length;
      const prevWeek = allUsers.filter((u) => {
        const c = new Date(u.created_at);
        return c > twoWeeksAgo && c <= lastWeek;
      }).length;

      let weeklyGrowth = 0,
        trend = "flat";
      if (prevWeek > 0) {
        weeklyGrowth = Math.round(((newUsers7d - prevWeek) / prevWeek) * 100);
        trend = weeklyGrowth > 0 ? "up" : weeklyGrowth < 0 ? "down" : "flat";
      } else if (newUsers7d > 0) {
        weeklyGrowth = 100;
        trend = "up";
      }

      const proUsers = allUsers.filter(
        (u) => u.subscription_type === "pro",
      ).length;
      const freeUsers = allUsers.length - proUsers;

      res.json({
        total: allUsers.length,
        new24h: newUsers24h,
        new7d: newUsers7d,
        pro: proUsers,
        free: freeUsers,
        growth: { weekly: weeklyGrowth, trend },
        users: allUsers
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 50)
          .map((u) => ({
            id: u.id,
            phone: u.phone_number,
            name: u.name || "Unknown",
            subscription: u.subscription_type || "free",
            alertsUsed: u.alerts_used_this_period || 0,
            joined: u.created_at,
            lastActive: u.updated_at,
            is_blocked: u.is_blocked || false,
          })),
      });
    } catch (error) {
      console.error("Admin users error:", error);
      res.status(500).json({ error: "Failed to get users data" });
    }
  });

  app.delete("/api/admin/users/:phoneNumber", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const cleanPhone = req.params.phoneNumber.replace(/[^0-9]/g, "");
      if (!cleanPhone)
        return res.status(400).json({ error: "Invalid phone number" });

      const user = await database.db
        .collection("users")
        .findOne({ phone_number: cleanPhone });
      if (!user) return res.status(404).json({ error: "User not found" });

      const userId = user._id.toString();
      const alertResult = await database.db
        .collection("alerts")
        .deleteMany({ user_id: userId });
      await database.db.collection("users").deleteOne({ phone_number: cleanPhone });

      res.json({
        success: true,
        message: `User ${cleanPhone} permanently deleted.`,
        phone: cleanPhone,
        alertsRemoved: alertResult.deletedCount,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/users/:phoneNumber
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/users/{phoneNumber}:
 *   get:
 *     summary: Get a single user's profile/details
 *     description: Returns user profile, alert stats, quota info, last active, and total command count.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: User phone number
 *         example: "2348103393608"
 *     responses:
 *       200:
 *         description: User details retrieved successfully
 *       400:
 *         description: Invalid phone number
 *       404:
 *         description: User not found
 *       500:
 *         description: Database not available or internal error
 */
  app.get("/api/admin/users/:phoneNumber", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const cleanPhone = req.params.phoneNumber.replace(/[^0-9]/g, "");
      if (!cleanPhone)
        return res.status(400).json({ error: "Invalid phone number" });

      const user = await database.db
        .collection("users")
        .findOne({ phone_number: cleanPhone });

      if (!user) return res.status(404).json({ error: "User not found" });

      const userId = user._id.toString();
      const isPro = user.subscription_type === "pro";
      const FREE_LIMIT = 3;

      // ── Alert stats ──
      const alertAgg = await database.db
        .collection("alerts")
        .aggregate([
          { $match: { user_id: userId } },
          {
            $group: {
              _id: null,
              totalAlerts: { $sum: 1 },
              activeAlerts: {
                $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
              },
              triggeredAlerts: {
                $sum: { $cond: [{ $eq: ["$status", "triggered"] }, 1, 0] },
              },
              deletedAlerts: {
                $sum: { $cond: [{ $eq: ["$status", "deleted"] }, 1, 0] },
              },
            },
          },
        ])
        .toArray();

      const stats = alertAgg[0] || {
        totalAlerts: 0,
        activeAlerts: 0,
        triggeredAlerts: 0,
        deletedAlerts: 0,
      };

      // ── Last active ──
      const candidates = [
        user.last_active ? new Date(user.last_active) : null,
        user.updated_at ? new Date(user.updated_at) : null,
      ].filter(Boolean);

      const lastActive =
        candidates.length > 0
          ? new Date(Math.max(...candidates.map((d) => d.getTime())))
          : null;

      // ── Quota ──
      const periodStart = user.last_alert_reset || user.created_at;
      const periodElapsed = Date.now() - new Date(periodStart).getTime();
      const periodExpired = periodElapsed >= TWELVE_HOURS_MS;
      const effectiveUsed = periodExpired
        ? 0
        : user.alerts_used_this_period || 0;

      res.json({
        id: userId,
        phone: user.phone_number,
        name: user.name || "Unknown",
        plan: isPro ? "pro" : "free",
        status: user.is_blocked === true ? "blocked" : "active",

        dateJoined: user.created_at,
        dateJoinedAgo: user.created_at ? getTimeAgo(user.created_at) : "Unknown",

        lastActive,
        lastActiveAgo: lastActive ? getTimeAgo(lastActive) : "Never",

        totalCommands: user.total_commands || 0,

        alerts: {
          active: stats.activeAlerts,
          triggered: stats.triggeredAlerts,
          deleted: stats.deletedAlerts,
          total: stats.totalAlerts,
        },

        quota: {
          used: effectiveUsed,
          limit: isPro ? "unlimited" : FREE_LIMIT,
          remaining: isPro
            ? "unlimited"
            : Math.max(0, FREE_LIMIT - effectiveUsed),
          isPro,
          periodExpired,
          resetIn: isPro ? null : getResetIn(periodStart),
        },
      });
    } catch (error) {
      console.error("User detail error:", error);
      res.status(500).json({ error: "Failed to get user details" });
    }
  });
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/alerts:
 *   get:
 *     summary: Get alert statistics and list
 *     description: Returns comprehensive alert statistics including active alerts, triggered alerts, and recent activity
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Alert data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total active alerts
 *                 active:
 *                   type: integer
 *                   description: Active alerts (same as total)
 *                 totalEver:
 *                   type: integer
 *                   description: Total alerts ever created
 *                 triggered:
 *                   type: integer
 *                   description: Number of triggered alerts
 *                 triggeredToday:
 *                   type: integer
 *                   description: Alerts triggered today
 *                 byDirection:
 *                   type: object
 *                   properties:
 *                     above:
 *                       type: integer
 *                       description: Alerts targeting price above
 *                     below:
 *                       type: integer
 *                       description: Alerts targeting price below
 *                 byAsset:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       asset:
 *                         type: string
 *                         description: Asset symbol
 *                       count:
 *                         type: integer
 *                         description: Number of alerts for this asset
 *                 recent24h:
 *                   type: integer
 *                   description: Alerts created in last 24 hours
 *                 weeklyChange:
 *                   type: integer
 *                   description: Weekly change percentage
 *                 alerts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AlertInfo'
 *       500:
 *         description: Database not available or internal error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
  app.get("/api/admin/alerts", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected)
        return res.status(500).json({ error: "Database not available" });

      const activeAlerts = await database.getActiveAlerts();
      const allAlerts = await database.getAllAlerts();

      // Direction breakdown
      const aboveCount = activeAlerts.filter(
        (a) => a.direction === "above",
      ).length;
      const belowCount = activeAlerts.filter(
        (a) => a.direction === "below",
      ).length;

      // Asset breakdown
      const assetCounts = {};
      activeAlerts.forEach((a) => {
        const k = a.asset.toUpperCase();
        assetCounts[k] = (assetCounts[k] || 0) + 1;
      });

      const yesterday = new Date(Date.now() - DAY_MS);
      const lastWeek = new Date(Date.now() - WEEK_MS);
      const twoWeeksAgo = new Date(Date.now() - 2 * WEEK_MS);

      // Real weekly change (alerts created this week vs last week)
      const thisWeekCount = allAlerts.filter(
        (a) => new Date(a.created_at) > lastWeek,
      ).length;
      const prevWeekCount = allAlerts.filter((a) => {
        const c = new Date(a.created_at);
        return c > twoWeeksAgo && c <= lastWeek;
      }).length;

      let weeklyChange = 0;
      if (prevWeekCount > 0)
        weeklyChange = Math.round(
          ((thisWeekCount - prevWeekCount) / prevWeekCount) * 100,
        );
      else if (thisWeekCount > 0) weeklyChange = 100;

      // Triggered stats
      const triggered = allAlerts.filter((a) => a.status === "triggered");
      const triggeredToday = triggered.filter(
        (a) => a.triggered_at && new Date(a.triggered_at) > yesterday,
      ).length;
      const recent24h = activeAlerts.filter(
        (a) => new Date(a.created_at) > yesterday,
      ).length;

      res.json({
        total: activeAlerts.length,
        active: activeAlerts.length,
        totalEver: allAlerts.length,
        triggered: triggered.length,
        triggeredToday,
        byDirection: { above: aboveCount, below: belowCount },
        byAsset: Object.entries(assetCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([asset, count]) => ({ asset, count })),
        recent24h,
        weeklyChange,
        alerts: activeAlerts.slice(0, 20).map((a) => ({
          id: a.id,
          asset: a.asset,
          targetPrice: a.target_price,
          direction: a.direction,
          user: a.phone_number,
          created: a.created_at,
          status: a.status,
        })),
      });
    } catch (error) {
      console.error("Admin alerts error:", error);
      res.status(500).json({ error: "Failed to get alerts data" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/whatsapp
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/whatsapp:
 *   get:
 *     summary: Get WhatsApp connection status
 *     description: Returns detailed WhatsApp connection status including session information
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: WhatsApp status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connected:
 *                   type: boolean
 *                   description: WhatsApp connection status
 *                 session:
 *                   type: object
 *                   properties:
 *                     hasSession:
 *                       type: boolean
 *                       description: Whether session exists
 *                     linkedPhone:
 *                       type: string
 *                       nullable: true
 *                       description: Linked phone number
 *                     sessionAge:
 *                       type: string
 *                       nullable: true
 *                       description: Session age description
 *                     lastSynced:
 *                       type: string
 *                       nullable: true
 *                       description: Last sync timestamp
 *                 retryCount:
 *                   type: integer
 *                   description: Number of reconnection attempts
 *                 pairingRetries:
 *                   type: integer
 *                   description: Number of pairing attempts
 *                 canRegenerateQR:
 *                   type: boolean
 *                   description: Whether QR can be regenerated
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
  app.get("/api/admin/whatsapp", async (req, res) => {
    try {
      const whatsappService = global.whatsappService;
      const database = global.database;

      let linkedPhone = null;
      let hasSession = false;
      let sessionAge = null;
      let lastSynced = null;

      // Real session info from Baileys creds
      const creds = whatsappService?.sock?.authState?.creds;
      if (creds?.registered) {
        hasSession = true;
        // creds.me.id = "234XXXXXXXXXX:XX@s.whatsapp.net"
        if (creds.me?.id) {
          linkedPhone = extractPhone(creds.me.id);
        }
      }

      // Real session age from MongoDB
      if (database?.isConnected && database.db) {
        try {
          const session = await database.db
            .collection("whatsapp_sessions")
            .findOne({ session_id: "primary_session" });

          if (session?.updated_at) {
            lastSynced = session.updated_at;
            const ageMs = Date.now() - new Date(session.updated_at).getTime();
            const days = Math.floor(ageMs / DAY_MS);
            const hours = Math.floor((ageMs % DAY_MS) / 3_600_000);
            sessionAge = `${days} days, ${hours} hours`;
          }
        } catch (e) {
          console.error("Session metadata error:", e.message);
        }
      }

      res.json({
        connected: whatsappService?.isConnected || false,
        session: {
          hasSession,
          linkedPhone,
          sessionAge,
          lastSynced,
        },
        retryCount: whatsappService?.retryCount || 0,
        pairingRetries: whatsappService?.pairingRetries || 0,
        canRegenerateQR: !creds?.registered,
      });
    } catch (error) {
      console.error("Admin WhatsApp error:", error);
      res.status(500).json({ error: "Failed to get WhatsApp status" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/whatsapp/pairing
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let lastPairingPoll = 0;
  const POLL_RATE_LIMIT = 1000; // 1 second minimum between polls

/**
 * @swagger
 * /api/admin/whatsapp/pairing:
 *   get:
 *     summary: Get WhatsApp pairing status
 *     description: Returns current pairing status including QR code and pairing information
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: Pairing status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 state:
 *                   type: string
 *                   description: Connection state
 *                 connected:
 *                   type: boolean
 *                   description: Connection status
 *                 qrCode:
 *                   type: string
 *                   nullable: true
 *                   description: QR code data URL
 *                 pairingCode:
 *                   type: string
 *                   nullable: true
 *                   description: Pairing code for phone number linking
 *                 retryCount:
 *                   type: integer
 *                   description: Number of retry attempts
 *                 pairingAttemptInProgress:
 *                   type: boolean
 *                   description: Whether pairing is currently in progress
 *                 qrCount:
 *                   type: integer
 *                   description: Number of QR codes generated
 *                 maxQRRetries:
 *                   type: integer
 *                   description: Maximum QR retry attempts
 *                 rateLimited:
 *                   type: boolean
 *                   description: Whether request was rate limited
 */
  app.get("/api/admin/whatsapp/pairing", (req, res) => {
    const now = Date.now();
    
    // 🔒 Rate limiting to prevent polling spam
    if (now - lastPairingPoll < POLL_RATE_LIMIT) {
      // Return cached response instead of generating new data
      return res.json({
        state: global.whatsappService?.connectionState || "disconnected",
        connected: global.whatsappService?.isConnected || false,
        qrCode: global.whatsappService?.qrCodeDataUrl || null,
        pairingCode: global.whatsappService?.pairingCode || null,
        retryCount: global.whatsappService?.retryCount || 0,
        pairingAttemptInProgress: global.whatsappService?.pairingAttemptInProgress || false,
        qrCount: global.whatsappService?.qrCount || 0,
        maxQRRetries: global.whatsappService?.maxQRRetries || 5,
        rateLimited: true,
      });
    }
    
    lastPairingPoll = now;
    const ws = global.whatsappService;
    res.json({
      state: ws?.connectionState || "disconnected",
      connected: ws?.isConnected || false,
      qrCode: ws?.qrCodeDataUrl || null,
      pairingCode: ws?.pairingCode || null,
      retryCount: ws?.retryCount || 0,
      pairingAttemptInProgress: ws?.pairingAttemptInProgress || false,
      qrCount: ws?.qrCount || 0,
      maxQRRetries: ws?.maxQRRetries || 5,
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  POST /api/admin/whatsapp/relink
  //  Body: { phoneNumber: "2348103393608" }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/whatsapp/relink:
   *   post:
   *     summary: Relink WhatsApp to a different phone number
   *     description: Disconnects current device, deletes the session, updates the bot phone number, and starts a fresh QR pairing flow.
   *     tags: [WhatsApp]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [phoneNumber]
   *             properties:
   *               phoneNumber:
   *                 type: string
   *                 description: New phone number including country code (digits only)
   *                 example: "2348103393608"
   *     responses:
   *       200:
   *         description: Relink initiated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 phoneNumber:
   *                   type: string
   *       400:
   *         description: Invalid phone number
   *       500:
   *         description: Internal server error
   */
  app.post("/api/admin/whatsapp/relink", async (req, res) => {
    try {
      const { phoneNumber } = req.body || {};

      // ── Validate ──
      const clean = (phoneNumber || "").replace(/[^0-9]/g, "");
      if (clean.length < 7) {
        return res.status(400).json({
          success: false,
          error: "A valid phone number with country code is required (min 7 digits).",
        });
      }

      const ws = global.whatsappService;
      const database = global.database;

      // 1. Disconnect current socket
      if (ws) await ws.disconnect();

      // 2. Clear old session — this is an EXPLICIT admin action, so it's allowed
      if (database) await database.clearWhatsAppSession();

      // 3. Set the new phone number on the service
      if (ws) ws.setBotPhoneNumber(clean);

      // 4. Also update process.env so it survives within this process lifetime
      process.env.WHATSAPP_PHONE_NUMBER = clean;

      // 5. Start fresh initialisation (background — don't await)
      if (ws) {
        ws.initialize(true).catch((err) =>
          console.error("Relink re-init error:", err.message),
        );
      }

      console.log(`🔄 Relink initiated for +${clean}`);
      res.json({
        success: true,
        message: "Old session cleared. Generating new QR code…",
        phoneNumber: clean,
      });
    } catch (error) {
      console.error("Relink error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  POST /api/admin/whatsapp/view-qr
  //  Admin came late, QR expired — generate a fresh one
  //  Does NOT delete session if already connected
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.post("/api/admin/whatsapp/view-qr", async (req, res) => {
    try {
      const ws = global.whatsappService;

      if (ws?.isConnected) {
        return res.json({
          success: false,
          message: "Already connected. No QR needed.",
          alreadyConnected: true,
        });
      }

      if (ws?.pairingAttemptInProgress) {
        return res.json({
          success: false,
          message: "Pairing already in progress. Please wait.",
          pairingInProgress: true,
        });
      }

      // If there's already a QR available, just return success
      if (ws?.qrCodeDataUrl) {
        return res.json({
          success: true,
          message: "QR code is already available.",
          hasExistingQR: true,
        });
      }

      // QR expired or not generated — reset QR counter and re-initialize
      // This does NOT clear the session — it just restarts the socket
      // so Baileys generates fresh QR codes
      if (ws) {
        ws.qrCount = 0;
        ws.qrCodeDataUrl = null;
        ws.connectionState = "connecting";
        ws.isInitializing = false;

        // Destroy current socket and create a new one
        await ws._destroySocket(true);
        ws.initialize(true).catch((err) =>
          console.error("View-QR re-init error:", err.message),
        );
      }

      res.json({
        success: true,
        message: "Generating fresh QR code…",
      });
    } catch (error) {
      console.error("View-QR error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  POST /api/admin/whatsapp/request-pairing-code
  //  Switches from QR mode to pairing code
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/whatsapp/request-pairing-code:
 *   post:
 *     summary: Request pairing code for phone linking
 *     description: Switches from QR mode to pairing code mode for phone number linking
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: Pairing code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Request success status
 *                 pairingCode:
 *                   type: string
 *                   description: Generated pairing code
 *       400:
 *         description: Bad request or system not ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   description: Error message
 *       503:
 *         description: Service unavailable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   description: Error message
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   description: Error message
 */
    app.post("/api/admin/whatsapp/request-pairing-code", async (req, res) => {
    try {
      const ws = global.whatsappService;
      if (!ws)
        return res
          .status(503)
          .json({ success: false, error: "WhatsApp service not started yet" });

      const result = await ws.requestPairingCodeForAdmin();

      if (result.success) {
        // ✅ FIX: Forward botPhone so frontend can display it
        res.json({
          success: true,
          pairingCode: result.pairingCode,
          botPhone: result.botPhone,
        });
      } else {
        const isSystemError =
          result.error?.includes("connecting") ||
          result.error?.includes("Waiting") ||
          result.error?.includes("not started");
        res
          .status(isSystemError ? 503 : 400)
          .json({ success: false, error: result.error });
      }
    } catch (error) {
      console.error("Pairing code error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  REPLACE existing regenerate-qr handler
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // src/adminAPI.js inside createAdminAPI

/**
 * @swagger
 * /api/admin/whatsapp/regenerate-qr:
 *   post:
 *     summary: Regenerate QR code for pairing
 *     description: Clears existing session and generates new QR code for WhatsApp pairing
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: QR regeneration initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Operation success status
 *                 message:
 *                   type: string
 *                   description: Status message
 *                 alreadyConnected:
 *                   type: boolean
 *                   description: Whether already connected (no QR needed)
 *                 pairingInProgress:
 *                   type: boolean
 *                   description: Whether pairing is already in progress
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
   app.post("/api/admin/whatsapp/regenerate-qr", async (req, res) => {
    try {
      const ws = global.whatsappService;

      if (ws?.isConnected) {
        return res.json({
          success: false,
          message: "Already connected. No need to regenerate QR.",
          alreadyConnected: true,
        });
      }

      if (ws?.pairingAttemptInProgress) {
        return res.json({
          success: false,
          message: "Pairing already in progress. Please wait.",
          pairingInProgress: true,
        });
      }

      // Reset QR counter and restart socket — does NOT delete session
      // Session might still be valid and auto-reconnect
      if (ws) {
        ws.qrCount = 0;
        ws.qrCodeDataUrl = null;
        ws.connectionState = "connecting";
        ws.isInitializing = false;
        await ws._destroySocket(true);
        ws.initialize(true).catch((err) =>
          console.error("Regenerate QR re-init error:", err.message),
        );
      }

      res.json({ success: true, message: "Generating fresh QR code..." });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  REPLACE existing delete session handler
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/whatsapp/session:
 *   delete:
 *     summary: Delete WhatsApp session
 *     description: Deletes current WhatsApp session and starts fresh pairing process
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: Session deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Operation success status
 *                 message:
 *                   type: string
 *                   description: Status message
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
   app.delete("/api/admin/whatsapp/session", async (req, res) => {
    try {
      const database = global.database;
      const ws = global.whatsappService;

      console.log("🗑️ Admin requested explicit session deletion");

      // 1. Force disconnect — even if connected and working fine
      if (ws) await ws.disconnect();

      // 2. Nuke session from MongoDB — this is the whole point
      if (database) await database.clearWhatsAppSession();

      console.log("✅ Session deleted by admin. Starting fresh pairing...");

      // 3. Start fresh — will generate new QR since session is gone
      if (ws) {
        ws.initialize(true).catch((err) =>
          console.error("Post-delete re-init error:", err.message),
        );
      }

      res.json({
        success: true,
        message: "Session deleted. Generating new QR code...",
      });
    } catch (error) {
      console.error("Delete session error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/activity
  //  ?limit=20&type=all|user|alert|subscription
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * @swagger
 * /api/admin/activity:
 *   get:
 *     summary: Get system activity log
 *     description: Returns recent system activities including user registrations, alert activities, and subscriptions
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of activities to return
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, user, alert, subscription]
 *           default: all
 *         description: Filter activities by type
 *     responses:
 *       200:
 *         description: Activity data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activities:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Activity'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
  app.get("/api/admin/activity", async (req, res) => {
    try {
      const database = global.database;
      const limit = parseInt(req.query.limit) || 20;
      const type = req.query.type || "all";

      if (!database?.isConnected || !database.db) {
        return res.json({ activities: [] });
      }

      const activities = [];
      const cutoff = new Date(Date.now() - WEEK_MS); // last 7 days

      // ── USER REGISTRATIONS ──
      if (type === "all" || type === "user") {
        try {
          const users = await database.db
            .collection("users")
            .find({ created_at: { $gte: cutoff } })
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray();

          users.forEach((u) =>
            activities.push({
              id: `user-${u._id}`,
              type: "user",
              title: `User registered: ${u.name || u.phone_number}`,
              description: `Plan: ${u.subscription_type || "free"}`,
              timestamp: new Date(u.created_at),
              level: "info",
            }),
          );
        } catch (e) {
          console.error("Activity (users) error:", e.message);
        }
      }

      // ── ALERTS: TRIGGERED ──
      if (type === "all" || type === "alert") {
        try {
          const triggered = await database.db
            .collection("alerts")
            .find({ status: "triggered", triggered_at: { $gte: cutoff } })
            .sort({ triggered_at: -1 })
            .limit(limit)
            .toArray();

          triggered.forEach((a) =>
            activities.push({
              id: `triggered-${a._id}`,
              type: "alert",
              title: `Alert triggered: ${a.asset}`,
              description: `Target: ${global.priceService?.formatPrice(a.target_price, a.asset) || a.target_price} • ${a.direction}`,
              timestamp: new Date(a.triggered_at),
              level: "success",
            }),
          );
        } catch (e) {
          console.error("Activity (triggered) error:", e.message);
        }

        // ── ALERTS: CREATED ──
        try {
          const created = await database.db
            .collection("alerts")
            .find({ created_at: { $gte: cutoff } })
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray();

          created.forEach((a) =>
            activities.push({
              id: `created-${a._id}`,
              type: "alert",
              title: `Alert created: ${a.asset}`,
              description: `Target: ${global.priceService?.formatPrice(a.target_price, a.asset) || a.target_price} • ${a.direction} • Status: ${a.status}`,
              timestamp: new Date(a.created_at),
              level: "info",
            }),
          );
        } catch (e) {
          console.error("Activity (created) error:", e.message);
        }

        // ── ALERTS: DELETED ──
        try {
          const deleted = await database.db
            .collection("alerts")
            .find({ status: "deleted", updated_at: { $gte: cutoff } })
            .sort({ updated_at: -1 })
            .limit(Math.ceil(limit / 2))
            .toArray();

          deleted.forEach((a) =>
            activities.push({
              id: `deleted-${a._id}`,
              type: "alert",
              title: `Alert removed: ${a.asset}`,
              description: `Was: ${global.priceService?.formatPrice(a.target_price, a.asset) || a.target_price} • ${a.direction}`,
              timestamp: new Date(a.updated_at),
              level: "warning",
            }),
          );
        } catch (e) {
          console.error("Activity (deleted) error:", e.message);
        }
      }

      // ── PRO UPGRADES ──
      if (type === "all" || type === "subscription") {
        try {
          const proUsers = await database.db
            .collection("users")
            .find({
              subscription_type: "pro",
              subscription_start_date: {
                $exists: true,
                $ne: null,
                $gte: cutoff,
              },
            })
            .sort({ subscription_start_date: -1 })
            .limit(limit)
            .toArray();

          proUsers.forEach((u) =>
            activities.push({
              id: `sub-${u._id}`,
              type: "subscription",
              title: `Pro upgrade: ${u.name || u.phone_number}`,
              description: "Upgraded to Pro plan",
              timestamp: new Date(u.subscription_start_date),
              level: "success",
            }),
          );
        } catch (e) {
          console.error("Activity (subs) error:", e.message);
        }
      }

      // Merge → sort → limit
      activities.sort((a, b) => b.timestamp - a.timestamp);

      res.json({
        activities: activities.slice(0, limit).map((a) => ({
          ...a,
          timeAgo: getTimeAgo(a.timestamp),
        })),
      });
    } catch (error) {
      console.error("Admin activity error:", error);
      res.status(500).json({ error: "Failed to get activity data" });
    }
  });

  /**
   * @swagger
   * /api/admin/whatsapp/debug:
   *   get:
   *     summary: Get WhatsApp debug information
   *     tags: [WhatsApp Debug]
   *     responses:
   *       200:
   *         description: Debug information retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 debugInfo:
   *                   type: object
   *                   properties:
   *                     debugLog:
   *                       type: array
   *                       description: Array of debug log entries
   *                     connectionHistory:
   *                       type: array
   *                       description: Connection state history
   *                     lastQRGenerated:
   *                       type: object
   *                       description: Last QR code generation details
   *                     lastPairingCodeGenerated:
   *                       type: object
   *                       description: Last pairing code generation details
   *                     currentSocketId:
   *                       type: number
   *                       description: Current socket ID
   *                     currentState:
   *                       type: string
   *                       description: Current connection state
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get("/api/admin/whatsapp/debug", (req, res) => {
    try {
      const whatsappService = global.whatsappService;
      if (!whatsappService) {
        return res.status(500).json({ error: "WhatsApp service not available" });
      }

      const debugInfo = whatsappService.getDebugInfo();
      res.json({ debugInfo });
    } catch (error) {
      console.error("WhatsApp debug error:", error);
      res.status(500).json({ error: "Failed to get debug information" });
    }
  });

  /**
   * @swagger
   * /api/admin/whatsapp/debug/clear:
   *   post:
   *     summary: Clear WhatsApp debug logs
   *     tags: [WhatsApp Debug]
   *     responses:
   *       200:
   *         description: Debug logs cleared successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: "Debug logs cleared"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.post("/api/admin/whatsapp/debug/clear", (req, res) => {
    try {
      const whatsappService = global.whatsappService;
      if (!whatsappService) {
        return res.status(500).json({ error: "WhatsApp service not available" });
      }

      whatsappService.clearDebugLog();
      res.json({ success: true, message: "Debug logs cleared" });
    } catch (error) {
      console.error("Clear debug logs error:", error);
      res.status(500).json({ error: "Failed to clear debug logs" });
    }
  });

  /**
   * @swagger
   * /api/admin/whatsapp/status-detailed:
   *   get:
   *     summary: Get detailed WhatsApp connection status with debug info
   *     tags: [WhatsApp Debug]
   *     responses:
   *       200:
   *         description: Detailed status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: object
   *                   description: Enhanced connection status with debug information
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get("/api/admin/whatsapp/status-detailed", (req, res) => {
    try {
      const whatsappService = global.whatsappService;
      if (!whatsappService) {
        return res.status(500).json({ error: "WhatsApp service not available" });
      }

      const status = whatsappService.getConnectionStatus();
      res.json({ status });
    } catch (error) {
      console.error("Detailed status error:", error);
      res.status(500).json({ error: "Failed to get detailed status" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/whatsapp/session-page
  //  All data the Sessions page needs in ONE call
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * @swagger
   * /api/admin/whatsapp/session-page:
   *   get:
   *     summary: Get comprehensive session page data
   *     description: Returns all data needed for the Sessions page including device status, server metrics, pairing information, session logs, and connection stability chart
   *     tags: [WhatsApp]
   *     responses:
   *       200:
   *         description: Session page data retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 botStatus:
   *                   type: object
   *                   properties:
   *                     status:
   *                       type: string
   *                       description: Current bot connection status (Online/Connecting/Offline)
   *                     isConnected:
   *                       type: boolean
   *                       description: Whether the bot is currently connected to WhatsApp
   *                     connectionState:
   *                       type: string
   *                       description: Detailed connection state from the WhatsApp service
   *                     lastHeartbeat:
   *                       type: string
   *                       description: Time since last heartbeat (e.g., "5s ago")
   *                 responseTime:
   *                   type: object
   *                   properties:
   *                     current:
   *                       type: integer
   *                       description: Current API response time in milliseconds
   *                     average:
   *                       type: integer
   *                       description: Rolling average response time over last 50 requests
   *                     label:
   *                       type: string
   *                       description: Performance label (Fast/Normal/Slow)
   *                     optimalRange:
   *                       type: string
   *                       description: Target performance range
   *                     samples:
   *                       type: integer
   *                       description: Number of response time samples collected
   *                 sessionLogs:
   *                   type: array
   *                   description: Last 30 session events with human-readable labels
   *                   items:
   *                     type: object
   *                     properties:
   *                       time:
   *                         type: string
   *                         description: Event time in HH:MM:SS format
   *                       timestamp:
   *                         type: integer
   *                         description: Event timestamp in milliseconds
   *                       event:
   *                         type: string
   *                         description: Human-readable event description
   *                       color:
   *                         type: string
   *                         description: UI color for the event (success/warning/destructive)
   *                       raw:
   *                         type: string
   *                         description: Raw event name from debug log
   *                       socketId:
   *                         type: integer
   *                         description: Socket ID when event occurred
   *                 connectionChart:
   *                   type: object
   *                   properties:
   *                     hourly:
   *                       type: array
   *                       description: 24-hour connection stability data
   *                       items:
   *                         type: object
   *                         properties:
   *                           time:
   *                             type: string
   *                             description: Hour in HH:00 format
   *                           v:
   *                             type: integer
   *                             description: Stability score (0-100)
   *                           disconnects:
   *                             type: integer
   *                             description: Number of disconnects in this hour
   *                     successRate:
   *                       type: number
   *                       description: Overall success rate percentage (last 24 hours)
   *                     yesterdayRate:
   *                       type: number
   *                       nullable: true
   *                       description: Yesterday's success rate percentage
   *                     changeVsYesterday:
   *                       type: number
   *                       description: Change in success rate compared to yesterday
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get("/api/admin/whatsapp/session-page", async (req, res) => {
    try {
      const reqStart = Date.now();
      const ws = global.whatsappService;
      const database = global.database;

      // ═══════════════════════════════════════
      // 1. BOT STATUS + HEARTBEAT
      // ═══════════════════════════════════════
      const isConnected = ws?.isConnected || false;
      const connectionState = ws?.connectionState || "disconnected";
      const heartbeatAgo = _lastHeartbeat
        ? Math.round((Date.now() - _lastHeartbeat) / 1000)
        : null;
      _lastHeartbeat = Date.now();

      let status = "Offline";
      if (isConnected) status = "Online";
      else if (connectionState === "connecting" || connectionState === "verifying") status = "Connecting";

      // ═══════════════════════════════════════
      // 2. RESPONSE TIME (rolling avg of last 50 calls)
      // ═══════════════════════════════════════
      // We measure at the end, but estimate DB cost now
      const dbLatency = database?.isConnected
        ? await measureDbLatency(database)
        : -1;

      // ═══════════════════════════════════════
      // 3. SESSION LOGS
      // ═══════════════════════════════════════
      const eventMap = {
        "CONNECTION_OPENED": { label: "Connected", color: "success" },
        "CONNECTION_CLOSED": { label: "Connection Dropped", color: "destructive" },
        "CONNECTION_UPDATE_PAIRING": { label: "Pairing Update", color: "warning" },
        "QR_RECEIVED": { label: "QR Scan Attempt", color: "warning" },
        "QR_GENERATED": { label: "QR Code Generated", color: "success" },
        "QR_BLOCKED_TOO_SOON": { label: "QR Blocked (cooldown)", color: "warning" },
        "QR_LIMIT_REACHED": { label: "QR Limit Reached", color: "destructive" },
        "PAIRING_CODE_GENERATED": { label: "Pairing Code Generated", color: "success" },
        "PAIRING_CODE_EXPIRED": { label: "Pairing Code Expired", color: "warning" },
        "PAIRING_CODE_ERROR": { label: "Pairing Code Failed", color: "destructive" },
        "SESSION_REVOKED_BY_WHATSAPP": { label: "Session Revoked (401)", color: "destructive" },
        "SESSION_STALE_440_CLEARED": { label: "Session Conflict (440)", color: "destructive" },
        "INITIALIZE_START": { label: "Initializing", color: "warning" },
        "INITIALIZE_SKIPPED": { label: "Init Skipped (duplicate)", color: "warning" },
        "AUTH_STATE_RETRIEVED": { label: "Auth Token Refresh", color: "success" },
        "SOCKET_CREATING": { label: "Websocket Ping", color: "success" },
        "DISCONNECT_REQUESTED": { label: "Disconnect Requested", color: "warning" },
        "DISCONNECT_COMPLETED": { label: "Disconnected", color: "destructive" },
      };

      const sessionLogs = (ws?.debugLog || []).slice(-30).reverse().map(entry => {
        const mapped = eventMap[entry.event] || { label: entry.event, color: "warning" };
        const time = new Date(entry.timestamp);
        return {
          time: time.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          timestamp: entry.timestamp,
          event: mapped.label,
          color: mapped.color,
          raw: entry.event,
          socketId: entry.socketId,
        };
      });

      // ═══════════════════════════════════════
      // 4. CONNECTION SUCCESS RATE (24h chart)
      // ═══════════════════════════════════════
      const connectionHistory = ws?.connectionHistory || [];
      const now = Date.now();
      const hourlyData = [];

      for (let i = 23; i >= 0; i--) {
        const hourStart = now - (i + 1) * 3_600_000;
        const hourEnd = now - i * 3_600_000;
        const hour = new Date(hourEnd).getHours();

        const eventsInHour = connectionHistory.filter(e => {
          const t = new Date(e.timestamp).getTime();
          return t >= hourStart && t < hourEnd;
        });

        const disconnects = eventsInHour.filter(e =>
          e.event === "disconnected" || e.event === "disconnect_requested"
        ).length;

        const connects = eventsInHour.filter(e =>
          e.event === "connected"
        ).length;

        // If no events in this hour and bot is connected, assume 100%
        // If disconnects happened, reduce score
        let score;
        if (eventsInHour.length === 0) {
          // No events = stable (if connected) or down (if not)
          // Check if this hour is in the past or current
          const isCurrentHour = i === 0;
          const isPastHour = hourEnd < now;

          if (isCurrentHour) {
            score = isConnected ? 100 : 0;
          } else if (isPastHour) {
            // If bot uptime covers this hour, it was online
            const uptimeStart = now - (process.uptime() * 1000);
            score = uptimeStart < hourEnd ? 100 : 0;
          } else {
            score = 0;
          }
        } else {
          score = Math.max(0, 100 - (disconnects * 20) + (connects * 10));
          score = Math.min(100, score);
        }

        hourlyData.push({
          time: `${String(hour).padStart(2, "0")}:00`,
          v: score,
          disconnects,
        });
      }

      // Today's success rate
      const totalHours = hourlyData.length;
      const totalScore = hourlyData.reduce((sum, h) => sum + h.v, 0);
      const successRate = totalHours > 0
        ? Math.round((totalScore / (totalHours * 100)) * 1000) / 10
        : 100;

      // Yesterday's rate (recalculate once per hour)
      const shouldRecalcYesterday = !_yesterdayCalculatedAt ||
        (Date.now() - _yesterdayCalculatedAt) > 3_600_000;

      if (shouldRecalcYesterday) {
        // Estimate yesterday from connection history
        const yesterdayStart = now - 2 * DAY_MS;
        const yesterdayEnd = now - DAY_MS;
        const yesterdayEvents = connectionHistory.filter(e => {
          const t = new Date(e.timestamp).getTime();
          return t >= yesterdayStart && t < yesterdayEnd;
        });
        const yesterdayDisconnects = yesterdayEvents.filter(e =>
          e.event === "disconnected" || e.event === "disconnect_requested"
        ).length;

        if (yesterdayEvents.length > 0) {
          // Rough: each disconnect = ~1 hour of downtime out of 24
          _yesterdaySuccessRate = Math.max(0, Math.round((1 - (yesterdayDisconnects / 24)) * 1000) / 10);
        } else {
          // No data = assume same as today (bot probably just started)
          _yesterdaySuccessRate = successRate;
        }
        _yesterdayCalculatedAt = Date.now();
      }

      const changeVsYesterday = _yesterdaySuccessRate !== null
        ? Math.round((successRate - _yesterdaySuccessRate) * 10) / 10
        : 0;

      // ═══════════════════════════════════════
      // MEASURE & TRACK RESPONSE TIME
      // ═══════════════════════════════════════
      const responseTime = Date.now() - reqStart;
      _responseTimes.push({ time: Date.now(), ms: responseTime });
      // Keep last 50 measurements
      while (_responseTimes.length > 50) _responseTimes.shift();

      const avgResponseTime = _responseTimes.length > 0
        ? Math.round(_responseTimes.reduce((s, r) => s + r.ms, 0) / _responseTimes.length)
        : 0;

      let responseLabel = "Fast";
      if (avgResponseTime > 500) responseLabel = "Slow";
      else if (avgResponseTime > 200) responseLabel = "Normal";

      // ═══════════════════════════════════════
      // RESPONSE
      // ═══════════════════════════════════════
      res.json({
        botStatus: {
          status,
          isConnected,
          connectionState,
          lastHeartbeat: heartbeatAgo !== null ? `${heartbeatAgo}s ago` : "First request",
        },
        responseTime: {
          current: responseTime,
          average: avgResponseTime,
          label: responseLabel,
          optimalRange: "< 200ms",
          samples: _responseTimes.length,
        },
        sessionLogs,
        connectionChart: {
          hourly: hourlyData,
          successRate,
          yesterdayRate: _yesterdaySuccessRate,
          changeVsYesterday,
        },
      });
    } catch (error) {
      console.error("Session page error:", error);
      res.status(500).json({ error: "Failed to get session page data" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GET /api/admin/conversion-funnel
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/api/admin/conversion-funnel", async (req, res) => {
    try {
      const database = global.database;
      if (!database?.isConnected) {
        return res.status(500).json({ error: "Database not available" });
      }

      const days = parseInt(req.query.days) || 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const teaserEvents = await database.db.collection('conversion_events')
        .find({ event: 'daily_brief_teaser_shown', timestamp: { $gte: cutoff } })
        .sort({ timestamp: -1 })
        .toArray();

      // Group by phone number
      const userStats = {};
      teaserEvents.forEach(event => {
        const phone = event.phone_number;
        if (!userStats[phone]) {
          userStats[phone] = { phone, teaserCount: 0, firstSeen: event.timestamp, lastSeen: event.timestamp, upgraded: false, nudgeSent: false };
        }
        userStats[phone].teaserCount++;
        if (event.timestamp < userStats[phone].firstSeen) userStats[phone].firstSeen = event.timestamp;
        if (event.timestamp > userStats[phone].lastSeen) userStats[phone].lastSeen = event.timestamp;
      });

      // Check nudge events
      const nudgeEvents = await database.db.collection('conversion_events')
        .find({ event: 'conversion_nudge_sent', timestamp: { $gte: cutoff } })
        .toArray();
      nudgeEvents.forEach(e => { if (userStats[e.phone_number]) userStats[e.phone_number].nudgeSent = true; });

      // Check upgrade click events
      const clickEvents = await database.db.collection('conversion_events')
        .find({ event: 'upgrade_command_clicked', timestamp: { $gte: cutoff } })
        .toArray();
      clickEvents.forEach(e => { if (userStats[e.phone_number]) userStats[e.phone_number].clickedUpgrade = true; });

      // Check which users upgraded
      const phoneNumbers = Object.keys(userStats);
      if (phoneNumbers.length > 0) {
        const users = await database.db.collection('users')
          .find({ phone_number: { $in: phoneNumbers } })
          .toArray();
        users.forEach(u => {
          if (userStats[u.phone_number]) {
            userStats[u.phone_number].userName = u.name || 'Unknown';
            if (u.subscription_type === 'pro') {
              userStats[u.phone_number].upgraded = true;
              userStats[u.phone_number].upgradedAt = u.subscription_start_date;
            }
          }
        });
      }

      const funnel = Object.values(userStats).sort((a, b) => b.teaserCount - a.teaserCount);
      const totalShown = funnel.length;
      const totalUpgraded = funnel.filter(u => u.upgraded).length;
      const clickedUpgrade = funnel.filter(u => u.clickedUpgrade).length;
      const conversionRate = totalShown > 0 ? ((totalUpgraded / totalShown) * 100).toFixed(1) : 0;
      const clickRate = totalShown > 0 ? ((clickedUpgrade / totalShown) * 100).toFixed(1) : 0;

      res.json({
        summary: {
          totalUsersShown: totalShown,
          totalClickedUpgrade: clickedUpgrade,
          totalUpgraded,
          conversionRate: `${conversionRate}%`,
          clickRate: `${clickRate}%`,
          periodDays: days
        },
        funnel: funnel.map(u => ({
          phone: u.phone,
          name: u.userName || 'Unknown',
          teasersReceived: u.teaserCount,
          firstSeen: u.firstSeen,
          lastSeen: u.lastSeen,
          daysSinceFirst: Math.floor((Date.now() - new Date(u.firstSeen).getTime()) / (1000 * 60 * 60 * 24)),
          clickedUpgrade: u.clickedUpgrade || false,
          nudgeSent: u.nudgeSent || false,
          status: u.upgraded ? 'upgraded' : 'warm_lead',
          upgradedAt: u.upgradedAt || null
        }))
      });
    } catch (error) {
      console.error("Conversion funnel error:", error);
      res.status(500).json({ error: "Failed to get conversion data" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  POST /api/admin/send-conversion-nudge
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.post("/api/admin/send-conversion-nudge", async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) return res.status(400).json({ error: "phoneNumber required" });

      const database = global.database;
      const whatsappService = global.whatsappService;

      const user = await database.getUserByPhoneNumber(phoneNumber);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.subscription_type === 'pro') return res.status(400).json({ error: "User is already Pro" });

      const teaserCount = await database.db.collection('conversion_events')
        .countDocuments({ phone_number: phoneNumber, event: 'daily_brief_teaser_shown' });

      const name = user.name || 'Trader';
      let nudgeMessage;
      let engagementLevel;

      if (teaserCount >= 7) {
        engagementLevel = 'high';
        nudgeMessage = `Hey ${name}! 👋\n\nI noticed you've been enjoying the daily market briefs for the past week! 🎯\n\n*Special offer just for you:*\nUpgrade to Pro today and get *50% off your first month* — just ₦1,000!\n\n✅ Full AI market analysis every morning\n✅ Unlimited alerts (no more 3-alert limit)\n✅ Portfolio tracking & trade journal\n✅ SMS notifications\n\nType *UPGRADE* now to claim this exclusive deal! 🔥\n\n_Offer expires in 24 hours._`;
      } else if (teaserCount >= 3) {
        engagementLevel = 'medium';
        nudgeMessage = `Hi ${name}! 📊\n\nYou've been checking the daily briefs regularly — love to see it!\n\nFor just ₦2,000/month, you'd get:\n✅ The *full AI analysis* (not just the teaser)\n✅ Unlimited alerts\n✅ SMS notifications\n\nReply *UPGRADE* if you're ready! 💬`;
      } else {
        engagementLevel = 'low';
        nudgeMessage = `Hey ${name}!\n\nJust a reminder — Pro users get the *full daily AI analysis* plus unlimited alerts for just ₦2,000/month.\n\nType *UPGRADE* anytime to unlock the full experience! 🚀`;
      }

      await whatsappService.sendMessage(user.whatsapp_number, nudgeMessage);
      await database.db.collection('conversion_events').insertOne({
        phone_number: phoneNumber,
        event: 'conversion_nudge_sent',
        teaserCount,
        timestamp: new Date()
      });

      res.json({ success: true, message: `Nudge sent to ${name}`, teaserCount, engagementLevel });
    } catch (error) {
      console.error("Nudge send error:", error);
      res.status(500).json({ error: error.message });
    }
  });

}

module.exports = { createAdminAPI };
