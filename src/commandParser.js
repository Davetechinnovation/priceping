const { evaluate } = require('mathjs');
const GeminiService = require('./geminiService');
const fearGreedService = require('./fearGreedService');
const newsService = require('./newsService');
class CommandParser {
  constructor(db = null) {
    this.geminiService = new GeminiService(db);
    this.commands = {
      hi: this.handleGreeting.bind(this),
      hello: this.handleGreeting.bind(this),
      halo: this.handleGreeting.bind(this),
      hallo: this.handleGreeting.bind(this),
      hey: this.handleGreeting.bind(this),
      sup: this.handleGreeting.bind(this),
      start: this.handleGreeting.bind(this),
      menu: this.handleGreeting.bind(this),
      help: this.handleHelp.bind(this),

      // Price & AI
      price: this.handleGenericPrice.bind(this),
      p: this.handleGenericPrice.bind(this),
      analyze: this.handleAnalyze.bind(this),
      analysis: this.handleAnalyze.bind(this),
      news: this.handleNews.bind(this),

      // Alerts
      set: this.handleSetAlert.bind(this),
      set_percent: this.handleSetPercentAlert.bind(this),
      set_ask: this.handleSetAsk.bind(this),
      alert: this.handleSetAlert.bind(this),
      alerts: this.handleMyAlerts.bind(this),
      del: this.handleDeleteAlert.bind(this),
      delete: this.handleDeleteAlert.bind(this),

      // Watchlist (👀 NEW)
      watch: this.handleWatch.bind(this),
      watchlist: this.handleWatchlist.bind(this),
      unwatch: this.handleUnwatch.bind(this),

      // Referrals (🎁 NEW)
      invite: this.handleInvite.bind(this),
      redeem: this.handleRedeem.bind(this),

      // Account
      name: this.handleSetName.bind(this),

      // Portfolio (Pro)
      portfolio: this.handlePortfolio.bind(this),
      holdings: this.handlePortfolio.bind(this),
      'clear portfolio': this.handleClearPortfolio.bind(this),

      // Trade Journal (Pro)
      bought: this.handleBought.bind(this),
      buy: this.handleBought.bind(this),
      sold: this.handleSold.bind(this),
      sell: this.handleSold.bind(this),
      trades: this.handleTrades.bind(this),
      journal: this.handleTrades.bind(this),

      // System
      status: this.handleStatus.bind(this),
      subscribe: this.handleSubscribe.bind(this),
      upgrade: this.handleUpgradePro.bind(this),
      features: this.handleFeatures.bind(this),
    };

    this.adminNumber = "2349160766236";
    // Track users who opted to skip SMS setup this session (in-memory only)
    this.smsSkippedThisSession = new Set();
  }

  // ==========================================
  // 🛠️ UTILITIES
  // ==========================================

  extractPhone(jid) {
    if (!jid) return "";
    let number = jid.split("@")[0];
    number = number.split(":")[0];
    return number;
  }

  formatPhone(number) {
    if (!number) return "Unknown";
    if (number.startsWith("+")) return number;
    return `+${number}`;
  }

  getDisplayName(user, pushName) {
    return user?.name || pushName || "Trader";
  }

  getReadMore() {
    return String.fromCharCode(8206).repeat(4001);
  }

  getHeader(title) {
    return `╔══════════════════════════╗
║ 🚀 *${title}*
╚══════════════════════════╝`;
  }

  getUsageBar(used, limit) {
    if (limit >= 999) return "♾️ Unlimited (Pro)";
    const filled = Math.min(used, limit);
    const bar = "█".repeat(filled) + "░".repeat(limit - filled);
    return `${bar} ${used}/${limit}`;
  }

  // ==========================================
  // 🛡️ SMART ADMIN LINK GENERATOR
  // ==========================================
  getAdminLink(phoneNumber, displayName) {
    const displayPhone = this.formatPhone(phoneNumber);

    const msg = encodeURIComponent(
      `Hi, my name is ${displayName}. I would like to upgrade to PricePing Pro.\n\n🆔 My account ID is: ${displayPhone}`,
    );
    return `wa.me/${this.adminNumber}?text=${msg}`;
  }

  parseMessage(message) {
    const text = message.toLowerCase().trim();

    if (text.startsWith("upgrade")) {
      return { command: "upgrade", args: text.split(/\s+/).slice(1) };
    }

    const words = text.split(/\s+/);
    return { command: words[0], args: words.slice(1) };
  }

  isStrictCommand(command, args) {
    if (["hi", "hello", "halo", "hallo", "hey", "sup", "start", "menu", "status", "subscribe", "upgrade", "help"].includes(command)) {
      return args.length === 0;
    }
    if (["price", "p", "analyze", "analysis", "news"].includes(command)) {
      return args.length >= 1 && args.length <= 3; 
    }
    if (["del", "delete"].includes(command)) {
      return args.length === 1 && !isNaN(args[0]);
    }
    if (["alerts"].includes(command)) {
      return args.length === 0;
    }
    if (["set", "alert"].includes(command)) {
      return args.length >= 2 && (args.includes("at") || args.some((a) => !isNaN(parseFloat(a.replace(/,/g, "")))));
    }
    if (["name"].includes(command)) {
      return args.length >= 1 && args.length <= 3;
    }
    if (["portfolio", "holdings", "trades", "journal", "features"].includes(command)) {
      return args.length === 0;
    }
    if (["bought", "buy", "sold", "sell"].includes(command)) {
      return args.length >= 1;
    }
    if (["watch", "unwatch", "redeem"].includes(command)) {
      return args.length >= 1;
    }
    if (["watchlist", "invite"].includes(command)) {
      return args.length === 0;
    }
    return false;
  }

  // ==========================================
  // 🎯 MAIN HANDLER
  // ==========================================
  async handleCommand(message, jid, db, priceService, pushName, userState) {
    const { command, args } = this.parseMessage(message);
    const cleanPhone = this.extractPhone(jid);

    let user = await db.getUserByPhoneNumber(cleanPhone);
    if (!user) {
      user = await db.createUser(cleanPhone, jid, pushName || null);
    } else if (user.whatsapp_number !== jid && jid.includes('@')) {
      try {
        await db.db.collection("users").updateOne(
          { phone_number: cleanPhone }, 
          { $set: { whatsapp_number: jid } }
        );
        user.whatsapp_number = jid;
      } catch (e) {
        console.error("Failed to update user JID", e);
      }
    }

    // ✅ Backfill name for existing users who were created with null
    if (user && !user.name && pushName && pushName !== "User") {
      try {
        await db.updateUserName(cleanPhone, pushName);
        user.name = pushName;
      } catch (e) {}
    }

    // 🚫 CHECK IF USER IS BLOCKED
    if (user?.is_blocked === true) {
      const name = this.getDisplayName(user, pushName);
      const displayPhone = this.formatPhone(cleanPhone);

      const appealMsg = encodeURIComponent(
        `Hi Admin, I am ${name}. My PricePing account was restricted. Please review. Thank you.\n\n🆔 My account ID is: ${displayPhone}`,
      );
      const appealLink = `wa.me/${this.adminNumber}?text=${appealMsg}`;

      return `╔══════════════════════════╗
║ 🚫 *Account Restricted*
╚══════════════════════════╝

Hi *${name}*, your account has been
suspended by the administrator.

While restricted, you cannot:
━━━━━━━━━━━━━━━━━
❌ Check prices
❌ Set or manage alerts
❌ Use any bot features

💬 *Think this is a mistake?*
━━━━━━━━━━━━━━━━━
Tap below to contact the admin
and request a review:

📱 ${appealLink}

_We'll review your account as_
_soon as possible._`;
    }

    // 🔒 CHECK IF BOT IS IN EMERGENCY LOCKDOWN
    if (global.isLockedDown === true) {
      return `🔒 *Service Temporarily Paused*\n━━━━━━━━━━━━━━━━━\nPricePing is currently undergoing maintenance.\n\nAll features are temporarily disabled:\n❌ Price checking\n❌ Alert management\n❌ All commands\n\n⏳ _We'll be back shortly. Thank you for your patience!_`;
    }

    // ✅ NEW: Track every command

    try {
      await db.incrementCommandCount(cleanPhone);
    } catch (e) {
      console.error("Command tracking error:", e.message);
    }

    let handler = this.commands[command];
    
    // FIX: Only use the zero-cost fast-path if the message strictly structurally matches a command.
    // If it's a natural English sentence starting with a command word (e.g. "Price is moving fast"),
    // pass it safely to Gemini for context processing.
    if (handler && !this.isStrictCommand(command, args)) {
      handler = null;
    }

    if (!handler) {
      const greetings = ["bot", "test", "morning", "gm", "evening", "afternoon"];
      if (greetings.includes(command) && args.length === 0) {
        return this.handleGreeting([], cleanPhone, db, priceService, pushName);
      }
        
      if (this.geminiService && this.geminiService.isConfigured()) {
        try {
          const usage = await db.getAlertUsage(cleanPhone);
          const isPro = usage ? usage.isPro : false;
          const displayName = this.getDisplayName(user, pushName);
          let refinedArray = await this.geminiService.refinePrompt(message, isPro, cleanPhone, displayName);
          
          if (refinedArray && !Array.isArray(refinedArray)) {
             refinedArray = [refinedArray];
          }

          if (refinedArray && refinedArray.length > 0) {
            let responses = [];
            for (const refined of refinedArray) {
              if (refined.command === "chat" && refined.args && refined.args[0]) {
                console.log(`🤖 Gemini chat: "${message}" ->`, refined.args[0]);
                responses.push(refined.args[0]);
              } else if (this.commands[refined.command]) {
                console.log(`🤖 Gemini command: "${message}" ->`, refined);
                const res = await this.commands[refined.command](
                  refined.args, cleanPhone, db, priceService, pushName, userState
                );
                if (res) responses.push(res);
              }
            }
            if (responses.length > 0) {
              const finalResp = responses.join('\n\n━━━━━━━━━━━━━━━━━\n\n');
              this.geminiService.injectBotResponse(cleanPhone, finalResp);
              return finalResp;
            }
          }
        } catch (e) {
          console.error("Gemini routing error:", e.message);
        }
      }

      const unknownRes = this.handleUnknownCommand(command, args);
      if (this.geminiService) this.geminiService.injectBotResponse(cleanPhone, unknownRes);
      return unknownRes;
    }

    try {
      const resp = await handler(
        args,
        cleanPhone,
        db,
        priceService,
        pushName,
        userState,
      );

      let finalResp = resp;

      // 📊 ONBOARDING PROGRESSION
      const isNew = await db.isNewUser(cleanPhone);
      if (isNew && (command === 'set' || command === 'alert' || command === 'set_percent')) {
        await db.completeOnboarding(cleanPhone);
        finalResp += `\n\n🎉 *Onboarding Complete!* You've set your first alert. I'll notify you the second it hits!\n\n💡 _Type *Menu* anytime to see all features._`;
      }

      if (this.geminiService) this.geminiService.injectBotResponse(cleanPhone, finalResp);
      return finalResp;
    } catch (error) {
      console.error(error);
      return "⚠️ *System Error*: Something went wrong. Try again!";
    }
  }

  // ==========================================
  // ❌ UNKNOWN COMMAND
  // ==========================================

  handleUnknownCommand(command, args) {
    const suggestions = this.getSuggestions(command);

    if (suggestions.length > 0) {
      return `🤔 *Unknown Command: "${command}"*

💡 *Did you mean:*
${suggestions.map((s) => `• ${s}`).join("\n")}

━━━━━━━━━━━━━━━━━
🎯 *Popular Commands:*
• Price BTC
• Set ETH at 3500  
• My alerts
• Subscribe
• Help`;
    } else {
      return `🤔 *Unknown Command: "${command}"*

🎯 *Try these commands:*
━━━━━━━━━━━━━━━━━
🔎 *Price [asset]* - Check prices
🔔 *Set [asset] at [price]* - Create alerts
📋 *My alerts* - View watchlist
📧 *Subscribe* - View plan & limits
❓ *Help* - All commands`;
    }
  }

  getSuggestions(command) {
    const availableCommands = Object.keys(this.commands);
    const suggestions = [];

    availableCommands.forEach((cmd) => {
      if (cmd.includes(command) || command.includes(cmd)) {
        suggestions.push(cmd);
      }
    });

    const commonTypos = {
      pric: "price",
      prices: "price",
      alert: "alerts",
      alret: "alerts",
      remove: "del",
      stat: "status",
      subscription: "subscribe",
      sub: "subscribe",
      pro: "upgrade",
    };

    if (commonTypos[command]) suggestions.push(commonTypos[command]);

    return [...new Set(suggestions)].slice(0, 3);
  }

  // ==========================================
  // 🟢 GREETING
  // ==========================================
  async handleGreeting(args, phoneNumber, db, priceService, pushName) {
    const isNew = await db.isNewUser(phoneNumber);
    const displayName = this.getDisplayName(null, pushName); // No user object yet usually here

    if (isNew) {
      return `👋 *Welcome to PricePing, ${displayName}!*

I'm your AI crypto & stock alert assistant. I'll message you the second your target price is hit! 🚀

🎯 *Let's get started in 3 steps:*

*Step 1:* Check a price
Try: \`Price BTC\`

(I'll guide you through setting your first alert after that!)`;
    }

    const user = await db.getUserByPhoneNumber(phoneNumber);
    const name = this.getDisplayName(user, pushName);
    const usage = await db.getAlertUsage(phoneNumber);

    const streak = user?.streak?.current > 1 
      ? `🔥 *${user.streak.current} Day Streak!* Keep it going!\n\n` 
      : "";

    return `${this.getHeader("PricePing Terminal")}

👋 *Hi, ${name}!*
I'm ready to track markets for you.

${streak}📊 *Your Alert Quota:*
${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Pro Plan - Unlimited alerts!" : `⏰ Resets in: ${usage.resetIn}`}

🎯 *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━
🔎 *Check Price:* 
   Type \`Price BTC\` or \`Price Gold\` 
   
🔔 *Set Alert:*
   Type \`Set ETH at 3500\` 

📋 *My Dashboard:*
   Type \`My Alerts\` 

${usage.isPro ? "" : "🚀 Want unlimited alerts? Type *Subscribe*\n"}
💡 *Tip:* _I support Crypto, Forex, Stocks (US & Nigerian), and Commodities!_`;
  }

  // ==========================================
  // 🔎 PRICE CHECKER
  // ==========================================
  async handleGenericPrice(
    args,
    phoneNumber,
    db,
    priceService,
    pushName,
    userState,
  ) {
    const input = args.join(" ").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
    if (!input) return "⚠️ Please specify a valid asset to check. (e.g., Price SOL)";
    
    // Track interest for Move Detector
    if (global.trackUserInterest) {
      global.trackUserInterest(input.toUpperCase(), phoneNumber);
    }
    
    const info = await priceService.getAssetInfo(input);

    if (!info) {
      return `❌ *Not Found*\n\nI searched high and low for *"${input.toUpperCase()}"* but couldn't find it.\n\n💡 *Try:*\n• \`Price BTC\` — Crypto\n• \`Price Gold\` — Commodity\n• \`Price AAPL\` — US Stock\n• \`Price GBPUSD\` — Forex`;
    }

    // 🚨 Rate Limited by Yahoo Finance
    if (info._rateLimited) {
      return `⚠️ *We are receiving too many requests for ${info.symbol} at the moment.*\n\nPlease wait a couple of minutes before checking this specific asset again.`;
    }

    // ✅ Not publicly traded on NGX
    if (info._notListed) {
      return `*${info.symbol} (NGX)*
━━━━━━━━━━━━━━━━━
❌ *Not listed on NGX*

_${info.symbol} is not publicly traded on the Nigerian Exchange. It may be a private company (e.g. Globacom/GLO) or delisted._

💡 *Tip:* Check listed stocks at ngxgroup.com`;
    }

    // 🔒 Private Nigerian Company
    if (info._privateCompany) {
      return `*${info.name}*
━━━━━━━━━━━━━━━━━
🔒 *${info._privateNote}*

_This company does not have a publicly traded share price on NGX._`;
    }

    // NGX data temporarily unavailable (API down, no cache)
    if (info._unavailable) {
      return `📊 *${info.name}*
━━━━━━━━━━━━━━━━━
⏳ *NGX market data is temporarily unavailable.*

The Nigerian stock data feed is currently offline. This is a known issue — please check back later.

🌐 *Check manually:*
• ngxgroup.com
• nairametrics.com

💡 _Tip: US stocks, Crypto, Forex & Gold are all working fine!_`;
    }

    let icon = "💎";
    let label = "Crypto Asset";
    let changeLine = "";

    if (info.blockchain === "Commodities") {
      icon = "🏆";
      label = "Commodity";
    } else if (info.blockchain === "Forex Market") {
      icon = "💱";
      label = "Foreign Exchange";
    } else if (info.blockchain === "Stock Market") {
      icon = "📈";
      label = info.currency === "NGN" ? "Nigerian Stock (NGX)" : "Global Stock";
      if (info.change24h != null) {
        const arrow = info.change24h >= 0 ? "🟢" : "🔴";
        changeLine = `\n${arrow} *Today's Change:* ${info.change24h >= 0 ? "+" : ""}${info.change24h.toFixed(2)}%`;
      }
    }

    const fPrice = priceService.formatPrice(info.price, info.symbol, info.currency);

    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    let response = `${icon} *${info.name}*
━━━━━━━━━━━━━━━━━
💰 *Price:* ${fPrice}${changeLine}
🏷️ *Type:* ${label}
⛓️ *Market:* ${info.blockchain}
⏰ *Time:* ${time}`;

    // Only show Fear & Greed for Crypto
    if (info.blockchain !== "Stock Market" && info.blockchain !== "Forex Market" && info.blockchain !== "Commodities") {
      const mood = await fearGreedService.getScore();
      if (mood) {
        response += `\n${mood.formatted}`;
      }
    }

    // 👑 Premium AI Feature: Smart Alert Suggestions
    let hasAiSuggestions = false;
    try {
      const usage = await db.getAlertUsage(phoneNumber);
      if (usage && usage.isPro) {
        const aiSuggestion = await this.geminiService.suggestAlertLevels(info.symbol, info.price);
        if (aiSuggestion) {
          hasAiSuggestions = true;
          
          const formatSuggestion = (val) => priceService.formatPrice(val, info.symbol, info.currency);

          response += `
━━━━━━━━━━━━━━━━━
💡 *AI Suggestions* — Set alerts at:
📉 ${formatSuggestion(aiSuggestion.support)} (Support level)
📈 ${formatSuggestion(aiSuggestion.resistance)} (Resistance level)`;
        }
      }
    } catch (e) {
      console.error("AI Suggestion failed:", e.message);
    }

    // Onboarding step 1 completion hint
    const isNew = await db.isNewUser(phoneNumber);
    if (isNew) {
      response += `
━━━━━━━━━━━━━━━━━
🎯 *Step 2: Set an alert!*
Since you checked ${info.symbol}, try setting an alert for it:
Type: \`Set ${info.symbol} at ${Math.round(info.price * 1.05)}\``;
    } else if (!hasAiSuggestions) {
      response += `
━━━━━━━━━━━━━━━━━
💡 *Quick Alert:* 
Reply "Set ${info.symbol} at ${info.price.toFixed(2)}"`;
    }

    // ✅ Chain selection removed - bot auto-selects best chain
    // The price shown is already from the optimal chain based on priority list

    return response;
  }

  // ==========================================
  // 🧠 AI MARKET ANALYSIS
  // ==========================================
  async handleAnalyze(
    args,
    phoneNumber,
    db,
    priceService,
    pushName,
    userState,
  ) {
    if (args.length === 0)
      return "⚠️ *Usage:* `Analyze [CoinName]` (e.g., Analyze SOL)";

    const input = args.join(" ").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
    if (!input) return "⚠️ Please specify a valid coin name to analyze. (e.g., Analyze SOL)";
    
    // 1. Check if user is Pro
    const usage = await db.getAlertUsage(phoneNumber);
    if (!usage || !usage.isPro) {
      return `🔒 *AI Market Analysis is a Pro Feature*
━━━━━━━━━━━━━━━━━
Upgrade to the Pro plan to unlock on-demand 
AI market analysis, daily briefs, portfolio 
tracking, and SMS alerts.

Type *Subscribe* to view plans!`;
    }

    // 2. Fetch price info
    const info = await priceService.getAssetInfo(input);
    if (!info) {
      return `❌ *Not Found*\n\nI couldn't find data for *"${input.toUpperCase()}"* to analyze.`;
    }

    // 3. Call Groq
    const currencyStr = info.blockchain === "Stock Market" ? (info.currency || "USD") : "USD";
    const analysis = await this.geminiService.analyzeMarket(info.symbol, info.price, info.change24h, currencyStr);
    
    if (!analysis) {
      return `⚠️ *System Error*\nThe AI is currently resting. Please try again in a moment!`;
    }

    // 4. Build response
    const fPrice = priceService.formatPrice(info.price, info.symbol, info.currency);

    return `🧠 *AI Market Intel: ${info.symbol}*
━━━━━━━━━━━━━━━━━
💰 *Current Price:* ${fPrice}

🤖 *Analysis:*
${analysis}

⚠️ _Not financial advice. Always DYOR._`;
  }

  // ==========================================
  // 📰 AI NEWS ANALYSIS
  // ==========================================
  async handleNews(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length === 0)
      return "⚠️ *Usage:* `News [CoinName]` (e.g., News BTC)";

    const input = args.join(" ").replace(/[^a-zA-Z0-9\s-]/g, "").trim().toUpperCase();
    if (!input) return "⚠️ Please specify a valid asset for news. (e.g., News BTC)";
    
    // 1. Check if user is Pro
    const usage = await db.getAlertUsage(phoneNumber);
    if (!usage || !usage.isPro) {
      return `🔒 *AI News Summary is a Pro Feature*
━━━━━━━━━━━━━━━━━
Upgrade to the Pro plan to unlock live AI
news analysis and market updates.

Type *Subscribe* to view plans!`;
    }

    // 2. Fetch News
    const headlines = await newsService.getLatestHeadlines(input);
    if (!headlines || headlines.length === 0) {
      return `ℹ️ *No major news found for ${input} in the last 24 hours.*`;
    }

    // 3. Call Groq
    const analysis = await this.geminiService.analyzeNewsHeadlines(input, headlines);
    
    if (!analysis) {
      return `⚠️ *System Error*\nThe AI is currently resting. Please try again in a moment!`;
    }

    return `📰 *${input} News Intel*
━━━━━━━━━━━━━━━━━
${analysis}

⚠️ _Not financial advice. News can be volatile._`;
  }

  // ==========================================
  // 🔔 SET ALERT
  // ==========================================
  async handleSetAlert(
    args,
    phoneNumber,
    db,
    priceService,
    pushName,
    userState,
  ) {
    if (args.length < 2)
      return "⚠️ *Usage:* `Set [Coin] at [Price]`\nExample: `Set SOL at 150`";

    const asset = args[0].toUpperCase();

    let targetPrice = null;
    let direction = null;

    if (args.includes("below")) direction = "below";
    if (args.includes("above")) direction = "above";

    // Try to find a numeric or formula-based price argument
    const possiblePriceArg = args.find(a => 
      !['at', 'above', 'below', asset].includes(a.toLowerCase()) && 
      ( /^\d+(\.\d+)?$/.test(a.replace(/,/g, "")) || /[\+\-\*\/\(\)]/.test(a) )
    );

    if (possiblePriceArg) {
      try {
        // Use mathjs to evaluate (handles raw numbers and complex formulas)
        const cleaned = possiblePriceArg.replace(/,/g, "");
        targetPrice = evaluate(cleaned);
        
        if (typeof targetPrice !== 'number' || isNaN(targetPrice)) {
          targetPrice = null;
        }
      } catch (e) {
        console.warn("Math evaluation failed for:", possiblePriceArg);
        targetPrice = null;
      }
    }

    if (!targetPrice)
      return "⚠️ I need a valid target price! Example: `Set BTC at 65000` or `Set BTC at (76000+1000)`";

    const usage = await db.getAlertUsage(phoneNumber);

    if (!usage.isPro && usage.remaining <= 0) {
      return `🚫 *Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
📊 *Used:* ${this.getUsageBar(usage.used, usage.limit)}
⏰ *Resets in:* ${usage.resetIn}

You've used all *${usage.limit} free alerts* for this 12-hour period.

🚀 *Want unlimited alerts?*
━━━━━━━━━━━━━━━━━
Type *Subscribe* to see Pro benefits
or *Upgrade* to get started now!

💡 _Your limit resets automatically in ${usage.resetIn}_`;
    }

    const info = await priceService.getAssetInfo(asset);

    if (info && info.others && info.others.length > 0 && args.length < 4) {
      const optionsToDisplay = [
        {
          blockchain: info.blockchain,
          price: info.price,
          address: info.address || null,
        },
        ...info.others.slice(0, 5).map((other) => ({
          blockchain: other.blockchain,
          price: other.price || null,
          address: other.address || null,
        })),
      ];

      userState.set(phoneNumber, {
        type: "SELECT_CHAIN_ALERT",
        symbol: info.symbol,
        targetPrice: targetPrice,
        direction: direction,
        options: optionsToDisplay,
      });

      let menu = `⚖️ *Which ${info.symbol} chain?*
━━━━━━━━━━━━━━━━━
You are setting an alert at *${targetPrice}*.
Please select specific chain:
`;
      optionsToDisplay.forEach((opt, i) => {
        menu += `\n*${i + 1}.* ${opt.blockchain}`;
      });

      menu += `\n\n👇 *Reply with number (e.g., 1 or 2)*`;
      return menu;
    }

    if (info && info._rateLimited) {
      return `⚠️ *We are receiving too many requests for ${info.symbol} at the moment.*\n\nPlease wait a couple of minutes before setting an alert for this specific asset.`;
    }

    const currentPrice = info ? info.price : null;
    if (currentPrice === null)
      return `❌ I couldn't find a price for ${asset}.`;

    if (!direction) {
      direction = targetPrice > currentPrice ? "above" : "below";
    }

    const existingAlerts = await db.getUserAlerts(phoneNumber);
    const duplicateAlert = existingAlerts.find(
      (alert) =>
        alert.asset.toUpperCase() === asset && 
        alert.status === "active" &&
        alert.targetPrice === targetPrice
    );

    if (duplicateAlert) {
      const formattedTarget = priceService.formatPrice(
        duplicateAlert.targetPrice,
        asset,
      );
      return `⚠️ *Alert Already Exists*
━━━━━━━━━━━━━━━━━━━━━━
📦 *Asset:* ${asset}
🎯 *Existing Target:* ${formattedTarget}
📊 *Current:* ${priceService.formatPrice(currentPrice, asset)}
━━━━━━━━━━━━━━━━━━━━━━
💡 You already have an active alert for ${asset} at this exact same price. Try tracking a different level!`;
    }

    const slotResult = await db.useAlertSlot(phoneNumber);

    if (!slotResult.allowed) {
      return `🚫 *Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
📊 *Used:* ${this.getUsageBar(slotResult.usage.used, slotResult.usage.limit)}
⏰ *Resets in:* ${slotResult.usage.resetIn}

Type *Subscribe* for unlimited alerts!`;
    }

    await db.createAlert(phoneNumber, asset, targetPrice, direction);

    const u = slotResult.usage;

    let response = `✅ *Alert Activated!*
━━━━━━━━━━━━━━━━━
🔔 *Asset:* ${asset}
📉 *Target:* ${priceService.formatPrice(targetPrice, asset)}
📊 *Current:* ${priceService.formatPrice(currentPrice, asset)}
🎯 *Condition:* When price goes *${direction.toUpperCase()}*
━━━━━━━━━━━━━━━━━
📊 *Alerts:* ${this.getUsageBar(u.used, u.limit)}
${u.isPro ? "👑 Pro Plan" : `⏰ Resets in: ${u.resetIn}`}
━━━━━━━━━━━━━━━━━`;

    // 👑 Pro-only: append SMS prompt
    if (u.isPro) {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      response += this._buildSmsFooter(user, phoneNumber, userState);
    } else {
      response += `\n_I'll message you the moment it hits!_`;
    }

    return response;
  }

  async handleSetPercentAlert(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length < 2) return "⚠️ *Usage:* `Set [Asset] [Percentage]%`\nExample: `Set BTC 5%` or `Set BTC 5% move` (for two-way alert)";

    const asset = args[0].toUpperCase();
    const rawPercent = args[1].replace('%', '');
    const percent = parseFloat(rawPercent);

    if (isNaN(percent)) return "⚠️ Invalid percentage. Example: `Set BTC 5%`";

    const info = await priceService.getAssetInfo(asset);
    
    if (info && info._rateLimited) {
      return `⚠️ *We are receiving too many requests for ${info.symbol} at the moment.*\n\nPlease wait a couple of minutes before setting an alert for this specific asset.`;
    }
    
    if (!info || !info.price) return `❌ Couldn't get current price for ${asset}.`;

    const currentPrice = info.price;
    const isTwoWay = args.includes("move") || args.includes("either") || args.includes("both");

    if (isTwoWay) {
      const upperTarget = currentPrice * (1 + Math.abs(percent) / 100);
      const lowerTarget = currentPrice * (1 - Math.abs(percent) / 100);
      
      // Check quota for 2 slots
      const usage = await db.getAlertUsage(phoneNumber);
      if (usage.remaining < 2 && !usage.isPro) {
        return `🚫 *Quota Low!* This two-way alert requires 2 slots, but you only have ${usage.remaining} left. Type *Upgrade* for unlimited!`;
      }

      await db.createAlert(phoneNumber, asset, upperTarget, 'above');
      await db.createAlert(phoneNumber, asset, lowerTarget, 'below');

      return `✅ *Two-way Alert Activated!*
━━━━━━━━━━━━━━━━━
🔔 *Asset:* ${asset}
📊 *Current:* ${priceService.formatPrice(currentPrice, asset)}
📈 *Upper:* ${priceService.formatPrice(upperTarget, asset)} (+${Math.abs(percent)}%)
📉 *Lower:* ${priceService.formatPrice(lowerTarget, asset)} (-${Math.abs(percent)}%)
━━━━━━━━━━━━━━━━━
_I'll notify you if it moves ${Math.abs(percent)}% in either direction!_`;
    } else {
      // Single direction alert (default to above if positive, below if negative)
      const targetPrice = currentPrice * (1 + percent / 100);
      const direction = percent >= 0 ? 'above' : 'below';
      
      const newArgs = [asset, 'at', targetPrice.toFixed(4), direction];
      return this.handleSetAlert(newArgs, phoneNumber, db, priceService, pushName, userState);
    }
  }

  // ==========================================
  // 👀 WATCHLIST HANDLERS
  // ==========================================

  async handleWatch(args, phoneNumber, db, priceService) {
    if (args.length === 0) return "⚠️ *Usage:* `Watch [Asset]`\nExample: `Watch BTC` or `Watch TSLA`";
    const asset = args[0].toUpperCase();
    
    const watchlist = await db.getWatchlist(phoneNumber);
    if (watchlist.length >= 10) {
      const usage = await db.getAlertUsage(phoneNumber);
      if (!usage.isPro) return "🚫 *Limit Reached!* Free users can watch up to 10 assets. Type *Upgrade* for unlimited slots!";
    }
    
    await db.addToWatchlist(phoneNumber, asset);
    const info = await priceService.getAssetInfo(asset);
    
    // Complete onboarding step 1 if they are in the tour
    const isNew = await db.isNewUser(phoneNumber);
    let onboardingHint = "";
    if (isNew) {
      onboardingHint = "\n\n🎯 *Step 2:* Now set an alert when it hits a price!\nTry: `Set ${asset} at ${Math.round(info.price * 1.1)}`";
    }

    return `👀 *Now watching ${asset}*
Current price: ${priceService.formatPrice(info.price, asset)}
━━━━━━━━━━━━━━━━━
💡 Type *Watchlist* to see all tracked assets.${onboardingHint}`;
  }

  async handleWatchlist(args, phoneNumber, db, priceService) {
    const watchlist = await db.getWatchlist(phoneNumber);
    if (watchlist.length === 0) return "📂 *Your watchlist is empty.* Try: `Watch BTC` to start tracking!";
    
    let msg = `👀 *Your Watchlist*\n━━━━━━━━━━━━━━━━━\n`;
    
    for (const asset of watchlist) {
      try {
        const info = await priceService.getAssetInfo(asset);
        if (info) {
          const change = info.change24h !== undefined ? ` (${info.change24h >= 0 ? '+' : ''}${info.change24h.toFixed(1)}%)` : '';
          msg += `\n• *${asset}:* ${priceService.formatPrice(info.price, asset)}${change}`;
        } else {
          msg += `\n• *${asset}:* Price unavailable`;
        }
      } catch (e) {
        msg += `\n• *${asset}:* Error fetching price`;
      }
    }
    
    msg += `\n\n━━━━━━━━━━━━━━━━━\n💡 To remove: \`Unwatch BTC\``;
    return msg;
  }

  async handleUnwatch(args, phoneNumber, db) {
    if (args.length === 0) return "⚠️ *Usage:* `Unwatch [Asset]`";
    const asset = args[0].toUpperCase();
    await db.removeFromWatchlist(phoneNumber, asset);
    return `✅ Removed *${asset}* from your watchlist.`;
  }

  // ==========================================
  // 🎁 REFERRAL HANDLERS
  // ==========================================

  async handleInvite(args, phoneNumber, db) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    let code = user.referral_code;
    
    if (!code) {
      code = await db.generateReferralCode(phoneNumber);
    }
    
    const referralCount = user.referrals?.length || 0;
    const bonusSlots = user.bonus_alert_slots || 0;
    
    return `🎁 *Invite Friends, Get More Alerts!*
━━━━━━━━━━━━━━━━━
Your unique code: *${code}*

📊 *Your Stats:*
• Friends invited: ${referralCount}
• Bonus slots earned: +${bonusSlots}
• Current total limit: ${3 + bonusSlots} per 12 hours

🎯 *How it works:*
1. Share your code with friends
2. They use: \`Redeem ${code}\`
3. You get *+1 alert slot* (max +3 total)

💡 *Share now:*
_wa.me/?text=Get%20real-time%20crypto%20alerts%20with%20PricePing!%20Use%20my%20code%20*${code}*%20for%20bonus%20alert%20slots!_`;
  }

  async handleRedeem(args, phoneNumber, db) {
    if (args.length === 0) return "⚠️ *Usage:* `Redeem [Code]`";
    
    const code = args[0].toUpperCase();
    const result = await db.useReferralCode(phoneNumber, code);
    
    if (!result.success) {
      return `❌ *Error:* ${result.error || "Invalid referral code."} Ask your friend for their 6-digit code!`;
    }
    
    return `🎉 *Referral Applied!*
━━━━━━━━━━━━━━━━━
*${result.referrerName}* just earned +1 bonus alert slot! 

💡 You can earn bonus slots too — type *Invite* to get your own code.`;
  }

  async handleSetAsk(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length < 1) return "⚠️ Invalid format.";
    const asset = args[0].toUpperCase();
    return `Sure! What price should I watch for *${asset}*? You can say "above 150" or "below 120".`;
  }


  // ==========================================
  // 📱 SMS FOOTER BUILDER (Pro only)
  // ==========================================
  _buildSmsFooter(user, phoneNumber, userState) {
    if (user?.sms_number) {
      // Has a number — ask if they want to keep it or use a different one
      userState.set(phoneNumber, { type: 'CONFIRM_SMS_NUMBER', smsNumber: user.sms_number });
      return `\n📱 *SMS Notification:* 
Receive on *+${user.sms_number}*?
━━━━━━━━━━━━━━━━━
*1* → Yes, use this number ✓
*2* → No, use different number

_I'll message you on both channels!_`;
    }
    if (this.smsSkippedThisSession.has(phoneNumber)) {
      // Skipped this session — tiny one-liner hint only
      return `\n\n📱 _Note: SMS alerts are currently disabled._
_I'll notify you on WhatsApp only._`;
    }
    // First time seeing this — show the full prompt and enter state
    userState.set(phoneNumber, { type: 'AWAITING_SMS_NUMBER' });
    return `\n🚀 *Pro Perk: SMS Alerts*
━━━━━━━━━━━━━━━━━
Would you like an SMS alert as well?
📱 *Reply with your phone number*
   (e.g. *08012345678*)
🚫 Or type *SKIP* for WhatsApp only.`;
  }

  // ==========================================
  // 📋 MY ALERTS
  // ==========================================
  async handleMyAlerts(args, phoneNumber, db, priceService) {
    const alerts = await db.getUserAlerts(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);

    if (alerts.length === 0) {
      return `📂 *Your watchlist is empty.*

📊 *Alert Quota:* ${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Pro Plan" : `⏰ Resets in: ${usage.resetIn}`}

Try: \`Set BTC at 70000\``;
    }

    let msg = `${this.getHeader("Your Watchlist")}\n`;

    alerts.forEach((a) => {
      const icon = a.direction === "above" ? "📈" : "📉";
      // Use persistent alert_number, not array index
      msg += `\n*#${a.alert_number}* ${a.asset} ${icon} ${priceService.formatPrice(a.targetPrice, a.asset)}`;
    });

    msg += `\n\n━━━━━━━━━━━━━━━━━`;
    msg += `\n📊 *Quota:* ${this.getUsageBar(usage.used, usage.limit)}`;
    msg += usage.isPro ? "\n👑 Pro Plan" : `\n⏰ Resets in: ${usage.resetIn}`;
    msg += `\n\n🗑️ *To Delete:*`;
    msg += `\n• Single: \`Delete 1\``;
    msg += `\n• Multiple: \`Delete 1 3 5\``;
    msg += `\n• All: \`Delete all\``;
    return msg;
  }

  // ==========================================
  // ❓ HELP
  // ==========================================
  async handleHelp(args, phoneNumber, db) {
    const usage = await db.getAlertUsage(phoneNumber);

    return `❓ *PricePing Help Guide*
━━━━━━━━━━━━━━━━━

*1️⃣ Basic Commands*
   • \`Price BTC\` - Get live price
   • \`Analyze SOL\` - AI technical analysis
   • \`Menu\` - Main menu & quota

*2️⃣ Setting Alerts*
   • \`Set ETH at 3000\` - Simple price target
   • \`Set BTC 5% move\` - Two-way volatility alert

*3️⃣ Watchlist (Passive Tracking)*
   • \`Watch TSLA\` - Add to watchlist
   • \`Watchlist\` - View all watched assets

*4️⃣ Managing Your Account*
   • \`My alerts\` - View your alert dashboard
   • \`Delete 1 3\` - Remove specific alerts
   • \`Delete all\` - Clear everything

*5️⃣ Growth & Pro Features*
   • \`Invite\` - Get your referral code to earn bonuses
   • \`Subscribe\` - View Pro benefits & pricing

━━━━━━━━━━━━━━━━━
📊 *Your Quota:* ${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 *Pro Tier:* Unlimited alerts!" : `⏰ Resets every 12 hours (${usage.resetIn} left)`}

💡 _Tip: Type *Features* to see everything I can do!_`;
  }

  // ==========================================
  // 🗑️ DELETE ALERT
  // ==========================================
  async handleDeleteAlert(args, phoneNumber, db, priceService, pushName, userState) {
    if (!args || args.length === 0) {
      return "⚠️ *Usage:*\n• `Delete 1` — remove one alert\n• `Delete 1 3 5` — remove multiple\n• `Delete all` — clear everything";
    }

    // ── DELETE ALL with confirmation ──────────────────────────────────────
    if (args[0].toLowerCase() === 'all') {
      // Set pending confirmation state
      userState.set(phoneNumber, { type: 'CONFIRM_DELETE_ALL' });
      
      const alerts = await db.getUserAlerts(phoneNumber);
      if (alerts.length === 0) {
        return `📂 You have no active alerts to delete.`;
      }

      return `⚠️ *Are you sure?*
━━━━━━━━━━━━━━━━━
You are about to delete *all ${alerts.length} alert(s)*:

${alerts.map(a => {
  const icon = a.direction === 'above' ? '📈' : '📉';
  return `• #${a.alert_number} ${a.asset} ${icon} ${a.targetPrice}`;
}).join('\n')}

━━━━━━━━━━━━━━━━━
Reply *YES* to confirm deletion
Reply *NO* to cancel`;
    }

    // ── DELETE BY ALERT NUMBER(S) ─────────────────────────────────────────
    // Parse all numeric args — supports "del 1 3 5" or "del 1, 3, 5"
    const numbersToDelete = args
      .join(' ')
      .split(/[\s,]+/)
      .map(n => parseInt(n.replace(/\D/g, '')))
      .filter(n => !isNaN(n) && n > 0);

    if (numbersToDelete.length === 0) {
      return "⚠️ Please provide valid alert number(s). Example: `Delete 1` or `Delete 1 3 5`";
    }

    const alerts = await db.getUserAlerts(phoneNumber);
    
    if (alerts.length === 0) {
      return `📂 You have no active alerts to delete.`;
    }

    // Match by persistent alert_number field (not array index)
    const toDelete = alerts.filter(a => numbersToDelete.includes(a.alert_number));
    const notFound = numbersToDelete.filter(n => !alerts.find(a => a.alert_number === n));

    if (toDelete.length === 0) {
      return `❌ Alert number(s) *${numbersToDelete.join(', ')}* not found.\n\nType *My Alerts* to see your current alert numbers.`;
    }

    // Delete them all
    for (const alert of toDelete) {
      await db.deleteAlert(alert.id);
    }

    let response = '';
    if (toDelete.length === 1) {
      response = `🗑️ *Deleted:* Alert #${toDelete[0].alert_number} — ${toDelete[0].asset}`;
    } else {
      response = `🗑️ *Deleted ${toDelete.length} alerts:*\n${toDelete.map(a => `• #${a.alert_number} ${a.asset}`).join('\n')}`;
    }

    if (notFound.length > 0) {
      response += `\n\n⚠️ Not found: #${notFound.join(', #')}`;
    }

    response += `\n\n💡 _Deleting an alert does not refund your quota._`;
    return response;
  }

  // ==========================================
  // ✏️ SET NAME
  // ==========================================
  async handleSetName(args, phoneNumber, db) {
    const name = args.join(" ").trim();
    
    // Block generic placeholders or invalid names
    if (!name || name.toLowerCase() === "newname" || name.length < 2) {
      return "⚠️ Please provide a valid name. Example: `Name Sarah`";
    }

    await db.updateUserName(phoneNumber, name);
    return `✅ Got it! I'll call you *${name}* from now on.\n\n💡 _This name will be used everywhere including admin messages._`;
  }

  // ==========================================
  // 📊 STATUS
  // ==========================================
  async handleStatus(args, phoneNumber, db, priceService, pushName) {
    try {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      const alerts = await db.getUserAlerts(phoneNumber);
      const usage = await db.getAlertUsage(phoneNumber);
      const activeAlerts = alerts.filter((a) => a.status === "active");
      const name = this.getDisplayName(user, pushName);

      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      return `${this.getHeader("System Status")}

👤 *User:* ${name}
📱 *Phone:* ${this.formatPhone(phoneNumber)}
🤖 *Bot Status:* Online ✅
⏰ *Uptime:* ${hours}h ${minutes}m
📊 *Your Alerts:* ${activeAlerts.length} active
💾 *Database:* Connected
🌐 *Markets:* Crypto, Forex, Commodities

━━━━━━━━━━━━━━━━━
📊 *Alert Quota:*
${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Pro Plan - Unlimited!" : `🆓 Free Plan - ${usage.remaining} remaining\n⏰ Resets in: ${usage.resetIn}`}

━━━━━━━━━━━━━━━━━
${usage.isPro ? "" : "🚀 Type *Subscribe* for unlimited alerts!"}`;
    } catch (error) {
      console.error("Status command error:", error);
      return "⚠️ *System Error*: Couldn't fetch status right now.";
    }
  }

  // ==========================================
  // 📧 SUBSCRIBE
  // ==========================================
  async handleSubscribe(args, phoneNumber, db, priceService, pushName) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);
    const alerts = await db.getUserAlerts(phoneNumber);
    const name = this.getDisplayName(user, pushName);

    if (usage.isPro) {
      return `${this.getHeader("Your Subscription")}

👑 *You're on the Pro Plan!*

📊 *Current Usage:*
• Active Alerts: ${alerts.length}
• Alerts Used: ${usage.used} (Unlimited)
• Plan: ⭐ Pro

_Thank you for being a Pro member, ${name}!_
📱 Need help? Message admin:
wa.me/${this.adminNumber}`;
    }

    return `${this.getHeader("Your Plan")}

👋 *Hi ${name}!*

📊 *Current Usage:*
━━━━━━━━━━━━━━━━━
• Active Alerts: ${alerts.length}
• Alerts Used: ${this.getUsageBar(usage.used, usage.limit)}
• Plan: 🆓 Free Tier
• Resets in: ${usage.resetIn}

🆓 *Free Plan Includes:*
━━━━━━━━━━━━━━━━━
✅ 3 alerts every 12 hours
✅ Price checking (unlimited)
✅ Crypto, Forex, Commodities
❌ No priority notifications
❌ Limited alert slots

👑 *Want MORE?*
━━━━━━━━━━━━━━━━━
Type *Upgrade* to see Pro benefits
and unlock unlimited alerts! 🚀`;
  }

  // ==========================================
  // 🚀 UPGRADE PRO
  // ==========================================
  async handleUpgradePro(args, phoneNumber, db, priceService, pushName) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);

    if (usage.isPro) {
      return `👑 *You're already on Pro!*\nEnjoy your unlimited alerts! 🎉`;
    }

    // ✅ Track that they clicked "Upgrade"
    try {
      await db.db.collection('conversion_events').insertOne({
        phone_number: phoneNumber,
        event: 'upgrade_command_clicked',
        timestamp: new Date()
      });
    } catch (e) {
      console.warn(`⚠️ [Upgrade] Click log failed for ${phoneNumber}`);
    }

    const name = this.getDisplayName(user, pushName);
    const link = this.getAdminLink(phoneNumber, name);

    return `${this.getHeader("🚀 Upgrade to Pro")}

👋 *Hi ${name}!*
Here's what you unlock with Pro:

🆓 *Free (Current):*
━━━━━━━━━━━━━━━━━
• 3 alerts per 12 hours
• Basic price checking
• Standard notifications

👑 *Pro Plan:*
━━━━━━━━━━━━━━━━━
✅ *Unlimited* alert slots
✅ *Unlimited* alert creation
✅ Priority notifications (faster!)
✅ Advanced market analytics
✅ Portfolio tracking
✅ Multi-asset alerts
✅ Priority support
✅ No cooldown period

💰 *Pricing:*
━━━━━━━━━━━━━━━━━
🥉 *Monthly:* ₦2,500/month
🥈 *Quarterly:* ₦6,000 (save 20%)
🥇 *Yearly:* ₦20,000 (save 33%)

🚀 *Ready? Tap to message Admin:*
━━━━━━━━━━━━━━━━━
📱 ${link}
━━━━━━━━━━━━━━━━━
🎁 Mention *PRICEPING50* for 10% off
your first month! 🔥`;
  }

  // ==========================================
  // 🌟 FEATURES LIST
  // ==========================================
  async handleFeatures(args, phoneNumber, db, priceService, pushName) {
    return `${this.getHeader("Features & Capabilities")}

I am *PricePing AI* — your elite, AI-driven personal market analyst. Here is everything I can do for you:

🆓 *FREE TIER FEATURES:*
━━━━━━━━━━━━━━━━━
🔎 *Live Prices:* Crypto, Forex, Commodities & Stocks
🌡️ *Market Mood:* Global Fear & Greed Index
🔔 *Basic Alerts:* Up to 3 target alerts per 12 hours
👀 *Watchlist:* Passive price tracking (\`Watch BTC\`)
🎁 *Referral Bonuses:* Earn up to +3 bonus alert slots (\`Invite\`)
🎮 *Usage Streaks:* Gamified daily interaction streaks

👑 *PRO VIP FEATURES:*
━━━━━━━━━━━━━━━━━
🤖 *AI Analysis:* On-demand deep technical analysis
📰 *Live News:* Instant AI-summarized breaking headlines
💡 *Smart Alerts:* AI-suggested Support & Resistance levels
📈 *Volatility Alerts:* Two-way percentage alerts (\`Set BTC 5% move\`)
💼 *Live Portfolio:* Track holdings with live PnL (\`Portfolio\`)
📓 *Trade Journal:* Auto-track your win rate (\`Bought 2 BTC at 65000\`)
☀️ *Daily Briefs:* Personalized morning market intel at 8AM
🔥 *Move Detectors:* Instant warnings on pumps/dumps
📞 *SMS Fallback:* Text-message alerts (offline support)
♾️ *Unlimited Alerts:* Absolutely zero usage limits

📈 *SUPPORTED MARKETS:*
━━━━━━━━━━━━━━━━━
💎 *Crypto:* Bitcoin, Ethereum, Solana, and thousands more
📈 *US Stocks:* Apple, Tesla, Nvidia, Google, and all NYSE/NASDAQ
🇳🇬 *NGX Stocks:* MTN, Zenith, Dangote, GTCO, UBA and more
💱 *Forex:* EUR/USD, GBP/USD, USD/NGN, and major pairs
🏆 *Commodities:* Gold, Silver, Crude Oil

Type *Upgrade* to view Pro pricing, or just type any ticker to get started!`;
  }
}

// ==========================================
// 💼 PORTFOLIO TRACKER (Pro Only)
// ==========================================
CommandParser.prototype.handlePortfolio = async function(args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `🔒 *Portfolio Tracker is Pro Only*\nType *Upgrade* to unlock!`;

  const holdings = await db.getPortfolio(phoneNumber);
  if (!holdings || holdings.length === 0) {
    return `💼 *Your Portfolio is Empty!*
━━━━━━━━━━━━━━━━━
Tell me what you hold:
_"I have 0.5 BTC and 10 ETH"_

I’ll track your P&L live!`;
  }

  let totalValue = 0;
  let totalCost = 0;
  let lines = [];
  let holdingsSummary = [];

  for (const h of holdings) {
    const info = await priceService.getAssetInfo(h.asset);
    if (!info) continue;
    const value = info.price * h.quantity;
    const cost = h.avg_buy_price ? h.avg_buy_price * h.quantity : value;
    const pnl = cost > 0 ? ((value - cost) / cost) * 100 : 0;
    const emoji = pnl >= 0 ? '📈' : '📉';
    lines.push(`${emoji} *${h.asset}* ${h.quantity} → ${priceService.formatPrice(value, h.asset)} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%)`);
    holdingsSummary.push(`${h.asset}: ${h.quantity} units @ $${info.price.toLocaleString()} = $${value.toLocaleString()}`);
    totalValue += value;
    totalCost += cost;
  }

  const dayPnlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  const aiComment = await this.geminiService.analyzePortfolio(holdingsSummary.join(', '), totalValue, dayPnlPct);

  let msg = `💼 *Your Portfolio*
━━━━━━━━━━━━━━━━━
${lines.join('\n')}
─────────────────
💰 *Total:* ${priceService.formatPrice(totalValue, 'USD')}`;
  if (aiComment) msg += `\n\n🤖 *AI:* ${aiComment}`;
  return msg;
};

CommandParser.prototype.handleClearPortfolio = async function(args, phoneNumber, db) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `🔒 *Pro Only!* Type *Upgrade* to unlock Portfolio Tracker.`;
  await db.clearPortfolio(phoneNumber);
  return `🗑️ Portfolio cleared! Send me your holdings anytime to start fresh.`;
};

// ==========================================
// 📝 TRADE JOURNAL (Pro Only)
// ==========================================
CommandParser.prototype.handleBought = async function(args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `🔒 *Trade Journal is Pro Only*\nType *Upgrade* to unlock!`;

  // Expect: "bought 2 ETH at 2600" or "bought ETH 2 2600"
  // Groq will normalise args to [asset, quantity, price] or similar
  const text = args.join(' ');
  const m = text.match(/(\d+\.?\d*)\s+([A-Z]+)\s+(?:at\s+)?(\d+\.?\d*)/i) ||
             text.match(/([A-Z]+)\s+(\d+\.?\d*)\s+(?:at\s+)?(\d+\.?\d*)/i);
  if (!m) return `⚠️ *Format:* "Bought 2 ETH at 2600"`;

  const isNumFirst = /^\d/.test(text.trim());
  const qty   = isNumFirst ? parseFloat(m[1]) : parseFloat(m[2]);
  const asset = isNumFirst ? m[2].toUpperCase() : m[1].toUpperCase();
  const price = parseFloat(m[3]);

  await db.logTrade(phoneNumber, asset, qty, price);
  const info = await priceService.getAssetInfo(asset);
  const currentPrice = info?.price || price;
  const unrealised = ((currentPrice - price) / price * 100);
  const ue = unrealised >= 0 ? '🟢' : '🔴';

  return `📝 *Trade Logged!*
━━━━━━━━━━━━━━━━━
${qty} ${asset} bought at ${priceService.formatPrice(price, asset)}
Current: ${priceService.formatPrice(currentPrice, asset)} ${ue} (${unrealised >= 0 ? '+' : ''}${unrealised.toFixed(1)}% unrealised)

_Reply "Sold ${asset}" to close this trade._`;
};

CommandParser.prototype.handleSold = async function(args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `🔒 *Trade Journal is Pro Only*\nType *Upgrade* to unlock!`;

  // "sold ETH" or "sold ETH at 3000" or "sold ETH 3000"
  const text = args.join(' ');
  const assetMatch = text.match(/([A-Z]+)/i);
  const priceMatch = text.match(/(\d+\.?\d+)/i);
  if (!assetMatch) return `⚠️ *Format:* "Sold ETH" or "Sold ETH at 3000"`;

  const asset = assetMatch[1].toUpperCase();
  let sellPrice = priceMatch ? parseFloat(priceMatch[1]) : null;

  if (!sellPrice) {
    const info = await priceService.getAssetInfo(asset);
    if (!info) return `❌ Couldn't fetch live price for ${asset}. Try: Sold ${asset} at 3000`;
    sellPrice = info.price;
  }

  const trade = await db.closeTrade(phoneNumber, asset, sellPrice);
  if (!trade) return `❌ No open ${asset} trade found. Log one with: *Bought 2 ${asset} at [price]*`;

  const profitPct = ((sellPrice - trade.buy_price) / trade.buy_price) * 100;
  const profit = (sellPrice - trade.buy_price) * trade.quantity;
  const profitEmoji = profitPct >= 0 ? '✅' : '🔴';

  // Calc win rate
  const closed = await db.getClosedTrades(phoneNumber, 20);
  const wins = closed.filter(t => t.sell_price >= t.buy_price).length;
  const winRate = closed.length > 0 ? `${Math.round(wins / closed.length * 100)}% (${wins}/${closed.length})` : 'First trade!';

  const aiQuip = await this.geminiService.commentOnTrade(asset, trade.quantity, trade.buy_price, sellPrice, profitPct, winRate);

  return `📊 *Trade Closed!*
━━━━━━━━━━━━━━━━━
${trade.quantity} ${asset}: ${priceService.formatPrice(trade.buy_price, asset)} → ${priceService.formatPrice(sellPrice, asset)}
${profitEmoji} *P&L:* ${priceService.formatPrice(Math.abs(profit), 'USD')} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)
🏆 *Win Rate:* ${winRate}
${aiQuip ? `\n🤖 ${aiQuip}` : ''}`;
};

CommandParser.prototype.handleTrades = async function(args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `🔒 *Trade Journal is Pro Only*\nType *Upgrade* to unlock!`;

  const open = await db.getOpenTrades(phoneNumber);
  const closed = await db.getClosedTrades(phoneNumber, 5);

  if (open.length === 0 && closed.length === 0) {
    return `📝 *Your Trade Journal is Empty!*\n\nLog your first trade:\n_"Bought 2 ETH at 2600"_`;
  }

  let msg = `📝 *Your Trade Journal*
━━━━━━━━━━━━━━━━━`;

  if (open.length > 0) {
    msg += `\n
🟡 *Open Positions:*`;
    for (const t of open) {
      const info = await priceService.getAssetInfo(t.asset);
      const cur = info?.price || t.buy_price;
      const pct = ((cur - t.buy_price) / t.buy_price * 100);
      msg += `\n  • ${t.quantity} ${t.asset} @ $${t.buy_price.toLocaleString()} → $${cur.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
    }
  }

  if (closed.length > 0) {
    msg += `\n
✅ *Recent Closed:*`;
    for (const t of closed) {
      const pct = ((t.sell_price - t.buy_price) / t.buy_price * 100);
      const e = pct >= 0 ? '🏆' : '🔴';
      msg += `\n  ${e} ${t.quantity} ${t.asset}: ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }
  }

  return msg;
};

module.exports = CommandParser;
