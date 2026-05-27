const { evaluate } = require('mathjs');
const GroqService = require('./groqService');
const fearGreedService = require('./fearGreedService');
const newsService = require('./newsService');
class CommandParser {
  constructor(db = null) {
    this.geminiService = new GroqService(db);
    this.userState = new Map();
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
      view: this.handleAnalyze.bind(this),
      opinion: this.handleAnalyze.bind(this),
      news: this.handleNews.bind(this),

      // Alerts
      set: this.handleSetAlert.bind(this),
      set_percent: this.handleSetPercentAlert.bind(this),
      set_ask: this.handleSetAsk.bind(this),
      alert: this.handleSetAlert.bind(this),
      alerts: this.handleMyAlerts.bind(this),
      del: this.handleDeleteAlert.bind(this),
      delete: this.handleDeleteAlert.bind(this),

      // Watchlist
      watch: this.handleWatch.bind(this),
      watchlist: this.handleWatchlist.bind(this),
      unwatch: this.handleUnwatch.bind(this),
      add: this.handleWatch.bind(this),

      // Referrals
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
      streak: this.handleStreak.bind(this),
      timezone: this.handleTimezone.bind(this),
      update_timezone: this.handleTimezone.bind(this),
    };

    this.adminNumber = "2349160766236";
    this.smsSkippedThisSession = new Set();
  }

  // ==========================================
  // UTILITIES
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
║ ${title}
╚══════════════════════════╝`;
  }

  getUsageBar(used, limit) {
    if (limit >= 999) return "Unlimited (Pro)";
    const filled = Math.min(used, limit);
    const bar = "█".repeat(filled) + "░".repeat(limit - filled);
    return `${bar} ${used}/${limit}`;
  }

  // ==========================================
  // SMART ADMIN LINK GENERATOR
  // ==========================================
  getAdminLink(phoneNumber, displayName) {
    const displayPhone = this.formatPhone(phoneNumber);

    const msg = encodeURIComponent(
      `Hi, my name is ${displayName}. I would like to upgrade to PricePing Pro.\n\nID: ${displayPhone}`,
    );
    return `wa.me/${this.adminNumber}?text=${msg}`;
  }

  parseMessage(message) {
    const text = message.toLowerCase().trim();

    if (text.startsWith("upgrade")) {
      return { command: "upgrade", args: text.split(/\s+/).slice(1) };
    }

    // Detect "add X to watchlist" pattern
    const addMatch = text.match(/^add\s+(.+?)\s+to\s+watchlist\s*$/i);
    if (addMatch) {
      const assetWords = addMatch[1].trim().split(/\s+/);
      console.log(`[DEBUG parseMessage] "add to watchlist" pattern: "${text}" → extracted asset="${assetWords.join(' ')}"`);
      return { command: "watch", args: assetWords };
    }

    const words = text.split(/\s+/);
    let command = words[0];
    let args = words.slice(1);

    // SMART COMMAND SCANNING
    const knownCommands = new Set(Object.keys(this.commands));
    const QUESTION_WORDS = new Set(['what', 'who', 'whose', 'which', 'how']);
    if (!knownCommands.has(command)) {
      const foundIdx = words.findIndex(w => knownCommands.has(w));
      if (foundIdx > 0 && !(QUESTION_WORDS.has(words[0]) && words[foundIdx] === 'name')) {
        command = words[foundIdx];
        args = words.slice(foundIdx + 1);
        console.log(`[DEBUG parseMessage] Smart scan: "${text}" → extracted command="${command}" at word ${foundIdx}, args=${JSON.stringify(args)}`);
      }
    }

    console.log(`[DEBUG parseMessage] "${text}" → command="${command}", args=${JSON.stringify(args)}`);
    return { command, args };
  }

  isStrictCommand(command, args) {
    // Simple commands — zero args only
    if (["hi", "hello", "halo", "hallo", "hey", "sup", "start", "menu", "status", "subscribe", "upgrade", "help", "alerts", "watchlist", "invite", "features", "portfolio", "holdings", "trades", "journal", "streak", "timezone"].includes(command)) {
      return args.length === 0;
    }

    // update_timezone — requires exactly 1 arg (the timezone string)
    if (["update_timezone"].includes(command)) {
      return args.length >= 1;
    }

    // Price / analyze / news
    if (["price", "p", "analyze", "analysis", "view", "opinion", "news"].includes(command)) {
      if (args.length === 0) return false;
      for (const arg of args) {
        const clean = arg.replace(/[^a-zA-Z0-9]/g, '');
        if (!clean || clean.length === 0) return false;
        if (/^[a-z]{2,}$/i.test(clean) && !/^\d/.test(clean)) {
          const acceptableAssetWords = new Set(['volatility', 'vol', 'boom', 'crash', 'gold', 'silver', 'crude', 'oil', 'natural', 'gas', 'copper', 'corn', 'wheat', 'step', 'index', 'bull', 'bear']);
          const lower = clean.toLowerCase();
          if (!acceptableAssetWords.has(lower)) return false;
        }
      }
      return true;
    }

    // Set / alert
    if (["set", "alert"].includes(command)) {
      if (args.length < 2) return false;
      if (!args.includes("at") && !args.some((a) => !isNaN(parseFloat(a.replace(/,/g, ""))))) return false;
      const stopWords = new Set(['at', 'above', 'below', 'move', 'either', 'both']);
      const conversationalWords = new Set(["it", "that", "this", "these", "those", "the", "them", "one", "all", "both", "each", "some", "any", "me", "my", "i", "am", "is", "are", "was", "were", "its", "his", "her", "our", "your", "their", "to", "for", "of", "in", "on", "with", "by", "an", "a"]);
      for (const arg of args) {
        if (stopWords.has(arg)) break;
        if (conversationalWords.has(arg)) return false;
      }
      return true;
    }

    // Delete
    if (["del", "delete"].includes(command)) {
      if (args.length >= 1 && (args[0].toLowerCase() === 'all' || args[0].toLowerCase() === 'everything')) return true;
      return args.length >= 1 && args.every(a => !isNaN(a));
    }

    // Name
    if (["name"].includes(command)) {
      if (args.length < 1 || args.length > 3) return false;
      const firstArg = args[0].toLowerCase().replace(/[^a-z]/g, '');
      const introspectionWords = new Set(['your', 'my', 'ur', 'what', 'who', 'whose', 'which', 'how', 'the', 'this', 'that', 'is', 'are', 'its', 'his', 'her', 'our', 'their']);
      if (introspectionWords.has(firstArg) || firstArg.length < 2 || firstArg.length > 20) return false;
      return true;
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
  // MAIN HANDLER
  // ==========================================
  async handleCommand(message, jid, db, priceService, pushName, userState = this.userState) {
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

    // Backfill name for existing users
    if (user && !user.name && pushName && pushName !== "User") {
      try {
        await db.updateUserName(cleanPhone, pushName);
        user.name = pushName;
      } catch (e) { }
    }

    // CHECK IF USER IS BLOCKED
    if (user?.is_blocked === true) {
      const name = this.getDisplayName(user, pushName);
      const displayPhone = this.formatPhone(cleanPhone);

      const appealMsg = encodeURIComponent(
        `Hi Admin, I am ${name}. My PricePing account was restricted. Please review. Thank you.\n\nID: ${displayPhone}`,
      );
      const appealLink = `wa.me/${this.adminNumber}?text=${appealMsg}`;

      return `╔══════════════════════════╗
║ *Account Restricted*
╚══════════════════════════╝

Hi *${name}*, your account has been
suspended by the administrator.

While restricted, you cannot:
━━━━━━━━━━━━━━━━━
- Check prices
- Set or manage alerts
- Use any bot features

*Think this is a mistake?*
━━━━━━━━━━━━━━━━━
Tap below to contact the admin
and request a review:

${appealLink}

_We'll review your account as_
_soon as possible._`;
    }

    // CHECK IF BOT IS IN EMERGENCY LOCKDOWN
    if (global.isLockedDown === true) {
      return `*Service Temporarily Paused*
━━━━━━━━━━━━━━━━━
PricePing is currently undergoing maintenance.

All features are temporarily disabled:
- Price checking
- Alert management
- All commands

_We'll be back shortly. Thank you for your patience!_`;
    }

    // Track every command
    try {
      await db.incrementCommandCount(cleanPhone);
    } catch (e) {
      console.error("Command tracking error:", e.message);
    }

    // CHECK USER STATE
    const currentState = userState.get(cleanPhone);
    
    // CONFIRM_DELETE_ALL state
    if (currentState?.type === 'CONFIRM_DELETE_ALL') {
      console.log(`[State] CONFIRM_DELETE_ALL for ${cleanPhone} — message: "${message}"`);
      userState.delete(cleanPhone);
      
      const msgLower = message.toLowerCase().trim();
      const isYes = /^(yes|yea|yeah|yep|yup|sure|ok|okay|confirm|go ahead|do it|proceed|delete all|delete everything|clear all|clear everything|trash all)$/i.test(msgLower);
      const isNo = /^(no|nope|nah|never|cancel|stop|dont|don't|forget it|skip|back)$/i.test(msgLower);
      
      if (isYes) {
        const alerts = await db.getUserAlerts(cleanPhone);
        if (alerts.length === 0) return `No active alerts to delete.`;
        
        let deletedCount = 0;
        for (const alert of alerts) {
          try {
            await db.deleteAlert(alert.id);
            deletedCount++;
          } catch (e) { /* ignore */ }
        }
        return `*Deleted ${deletedCount} alert(s)*\n\nAll your alerts have been cleared. Type *Menu* to see what's next!`;
      }
      
      if (isNo) {
        return `Cancelled. No alerts were deleted.\n\nType *My Alerts* to see your current watchlist.`;
      }
      
      const numbersInMsg = message.match(/\d+/g);
      if (numbersInMsg && numbersInMsg.length > 0) {
        console.log(`[State] CONFIRM_DELETE_ALL — extracted numbers: ${numbersInMsg.join(', ')}, routing to delete handler`);
        return await this.handleDeleteAlert(numbersInMsg, cleanPhone, db, priceService, pushName, userState);
      }
    }

    // CONFIRM_SMS_NUMBER state
    if (currentState?.type === 'CONFIRM_SMS_NUMBER') {
      const msgLower = message.toLowerCase().trim();
      if (msgLower === '1' || msgLower.startsWith('yes') || msgLower.startsWith('use')) {
        userState.delete(cleanPhone);
        return `Got it! You'll receive SMS alerts on *+${currentState.smsNumber}*.`;
      }
      if (msgLower === '2' || msgLower.startsWith('no') || msgLower === 'change') {
        userState.set(cleanPhone, { type: 'AWAITING_SMS_NUMBER' });
        return `Reply with your phone number (e.g. *08012345678*)\nor type *SKIP* for WhatsApp only.`;
      }
    }

    // AWAITING_SMS_NUMBER state
    if (currentState?.type === 'AWAITING_SMS_NUMBER') {
      const msgLower = message.toLowerCase().trim();
      if (msgLower === 'skip' || msgLower === 'no' || msgLower === 'nope' || msgLower === 'cancel') {
        userState.delete(cleanPhone);
        this.smsSkippedThisSession.add(cleanPhone);
        return `Okay, WhatsApp alerts only. I'll notify you the moment your target hits!`;
      }
      const phoneMatch = message.match(/(?:\+?234|0)\s*\d{9,10}/g);
      if (phoneMatch) {
        const rawNumber = phoneMatch[0].replace(/[\s\-\(\)]/g, '');
        let normalized = rawNumber.replace(/^0/, '234');
        if (!normalized.startsWith('+')) normalized = `+${normalized}`;
        userState.delete(cleanPhone);
        try {
          await db.db.collection("users").updateOne(
            { phone_number: cleanPhone },
            { $set: { sms_number: normalized } }
          );
          return `SMS alerts set to *${normalized}*. You'll get notified on both WhatsApp and SMS!`;
        } catch (e) {
          return `Could not save your SMS number. Please try again or type *SKIP*.`;
        }
      }
      const digitsOnly = message.replace(/\D/g, '');
      if ((digitsOnly.startsWith('234') && digitsOnly.length >= 12) || (digitsOnly.startsWith('0') && digitsOnly.length >= 10)) {
        let normalized = digitsOnly.startsWith('0') ? `234${digitsOnly.slice(1)}` : digitsOnly;
        if (!normalized.startsWith('+')) normalized = `+${normalized}`;
        userState.delete(cleanPhone);
        try {
          await db.db.collection("users").updateOne(
            { phone_number: cleanPhone },
            { $set: { sms_number: normalized } }
          );
          return `SMS alerts set to *${normalized}*. You'll get notified on both WhatsApp and SMS!`;
        } catch (e) {
          return `Could not save your SMS number. Please try again or type *SKIP*.`;
        }
      }
      return `I need a valid Nigerian phone number (e.g. *08012345678*)\nor type *SKIP* for WhatsApp only.`;
    }

    let handler = this.commands[command];

    if (handler && !this.isStrictCommand(command, args)) {
      handler = null;
    }

    // Check if Gemini just asked a clarifying question
    let pendingClarification = userState.get(cleanPhone)?.type === 'AWAITING_GEMINI_CLARIFICATION';

    // Fallback: Check MongoDB AI context history for last bot question
    if (!pendingClarification && this.geminiService) {
      try {
        this._lastContextCheck = this._lastContextCheck || {};
        const cacheKey = `ctx:${cleanPhone}`;
        const cached = this._lastContextCheck[cacheKey];
        const now = Date.now();
        if (cached && now - cached.ts < 30000) {
          pendingClarification = cached.pending;
        } else {
          const ctx = await this.geminiService.getUserContext(cleanPhone);
          const history = ctx.history || [];
          for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            if (entry.startsWith('A:')) {
              const text = entry.slice(2).toLowerCase();
              const isQuestion = text.includes('?') ||
                /\b(which|what|who|where|how|tell me|sure|which one)\b/.test(text);
              if (isQuestion) {
                pendingClarification = true;
                console.log(`[Context Fallback] Last bot response was a question for ${cleanPhone}: "${text.slice(0, 60)}..."`);
              }
              break;
            }
          }
          const answerText = message.trim().toUpperCase();
          const isDirectAssetAnswer = /^[A-Z][A-Z0-9]{1,9}$/.test(answerText) ||
                                      /^PRICE\s+/.test(answerText) ||
                                      /^SET\s+/.test(answerText);
          if (isDirectAssetAnswer) {
            console.log(`[Context Fallback] User message "${message}" looks like a direct asset answer — NOT treating as pending clarification`);
            pendingClarification = false;
          }
          this._lastContextCheck[cacheKey] = { pending: pendingClarification, ts: now };
        }
      } catch (_) { /* silent fail */ }
    }

    console.log(`[Conversation] ${cleanPhone} | pendingClarification=${pendingClarification} | handler=${handler ? command : 'null'}`);

    // Direct asset ticker → price lookup
    const originalText = message.trim();
    const isSingleAssetName = /^[A-Z][A-Z0-9]{1,9}$/.test(command) &&
                              !["hi","hello","hey","halo","hallo","sup","yo","thanks","thank","ok","okay",
                                "yes","yeah","yep","yup","no","nope","nah","sure","bye","goodbye",
                                "morning","gm","evening","afternoon","night","gn","bot","test",
                                "please","pls","sorry","welcome","menu","help","stop","quit","exit",
                                "i","me","my","we","us","our","you","your","he","him","his",
                                "she","her","it","its","they","them","their","this","that",
                                "a","an","the","of","in","on","at","to","for","with","by",
                                "and","or","but","not","all","both","each","few","more","some",
                                "one","two","three","four","five","six","seven","eight","nine","ten",
                                "what","when","where","why","how","who","which","are","am","is",
                                "was","were","been","have","has","had","do","does","did","can",
                                "could","will","would","shall","should","may","might","must",
                                "get","got","make","made","take","took","give","gave","tell",
                                "told","show","see","know","think","want","need","like","use",
                                "look","find","come","came","go","went","say","said","talk",
                                "ask","work","run","move","live","leave","let","put","call",
                                "try","keep","start","stop","say","said","speak","use","used"].includes(command);

    if (!handler && isSingleAssetName) {
      console.log(`Direct asset detection: "${originalText}" → routing to price command${pendingClarification ? ' (was pending clarification)' : ''}`);
      const resp = await this.handleGenericPrice([originalText.toUpperCase()], cleanPhone, db, priceService, pushName, userState);
      if (this.geminiService) this.geminiService.injectBotResponse(cleanPhone, resp, [originalText.toUpperCase()]);
      if (pendingClarification) userState.delete(cleanPhone);
      return resp;
    }

    if (pendingClarification) {
      console.log(`[Conversation] Pending clarification for ${cleanPhone} — "${message}" (will still try Gemini)`);
      userState.delete(cleanPhone);
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

          try {
            const ctx = await this.geminiService.getUserContext(cleanPhone);
            console.log(`[DEBUG] AI Context for "${message}": lastAssets=${JSON.stringify(ctx.lastAssets)} | history=${JSON.stringify(ctx.history)}`);
          } catch (_) {}

          let refinedArray = await this.geminiService.refinePrompt(message, isPro, cleanPhone, displayName);

          console.log(`[Gemini Debug] Raw refinedArray for "${message}":`, JSON.stringify(refinedArray));

          if (refinedArray && !Array.isArray(refinedArray)) {
            refinedArray = [refinedArray];
          }

          if (refinedArray && refinedArray.length > 0) {
            let responses = [];
            let geminiAskedQuestion = false;
            let contextAssetsFromBatch = [];
            for (const refined of refinedArray) {
              if (refined.command !== "chat" && responses.length > 0) {
                await new Promise(r => setTimeout(r, 500));
              }

              if (refined.command === "chat" && refined.args && refined.args[0]) {
                const chatText = refined.args[0];
                console.log(`Gemini chat: "${message}" ->`, chatText);
                responses.push(chatText);
                const lowerChat = chatText.toLowerCase();
                const hasQuestionMark = lowerChat.includes('?');
                const startsWithQuestionWord = /^(what|which|who|where|when|why|how|are|is|do|does|can|could|would|should|tell me|sure|which one)\b/.test(lowerChat);
                if (hasQuestionMark || (startsWithQuestionWord && lowerChat.length < 80)) {
                  geminiAskedQuestion = true;
                  console.log(`[Chat] Gemini's chat response is a question — will flag for clarification`);
                } else {
                  console.log(`[Chat] Gemini's chat response is a statement — NOT flagging for clarification`);
                }
              } else if (this.commands[refined.command]) {
                console.log(`[Gemini Debug] Routing: ${JSON.stringify(refined)}`);
                const res = await this.commands[refined.command](
                  refined.args, cleanPhone, db, priceService, pushName, userState
                );
                if (res) responses.push(res);
                if (refined.args?.[0]) {
                  const asset = refined.args[0].toUpperCase();
                  if (asset && asset.length >= 1) contextAssetsFromBatch.push(asset);
                }
              }
            }
            if (responses.length > 0) {
              const finalResp = responses.join('\n\n━━━━━━━━━━━━━━━━━\n\n');
              if (geminiAskedQuestion) {
                userState.set(cleanPhone, { type: 'AWAITING_GEMINI_CLARIFICATION' });
                console.log(`[Conversation] State set to AWAITING_GEMINI_CLARIFICATION for ${cleanPhone}`);
              } else {
                if (userState.get(cleanPhone)?.type === 'AWAITING_GEMINI_CLARIFICATION') {
                  userState.delete(cleanPhone);
                  console.log(`[Conversation] Cleared AWAITING_GEMINI_CLARIFICATION for ${cleanPhone} (definitive answer given)`);
                }
              }
              this.geminiService.injectBotResponse(cleanPhone, finalResp, contextAssetsFromBatch);
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

      // ONBOARDING PROGRESSION
      const isNew = await db.isNewUser(cleanPhone);
      if (isNew && (command === 'set' || command === 'alert' || command === 'set_percent')) {
        await db.completeOnboarding(cleanPhone);
        finalResp += `\n\n*Onboarding Complete!* You've set your first alert. I'll notify you the second it hits!\n\n_Try *Menu* anytime to see all features._`;
      }

      // Extract asset for context tracking
      let contextAssets = [];
      if (['price', 'p', 'analyze', 'analysis', 'view', 'opinion', 'news', 'set', 'alert', 'watch', 'bought', 'sold'].includes(command) && args.length > 0) {
        if (['set', 'alert'].includes(command)) {
          const stopWords = new Set(['at', 'above', 'below']);
          const assetParts = [];
          for (const arg of args) {
            if (stopWords.has(arg.toLowerCase())) break;
            assetParts.push(arg);
          }
          if (assetParts.length > 0) {
            const fullAsset = assetParts.join(' ').replace(/[^a-zA-Z0-9\s]/g, '').toUpperCase().trim();
            if (fullAsset && fullAsset.length >= 1 && fullAsset.length <= 20) {
              contextAssets = [fullAsset];
            }
          }
        } else {
          const fullAsset = args.join(' ').replace(/[^a-zA-Z0-9\s]/g, '').toUpperCase().trim();
          if (fullAsset && fullAsset.length >= 1 && fullAsset.length <= 20) {
            contextAssets = [fullAsset];
          }
        }
      }
      contextAssets = contextAssets.filter(a => {
        if (!a || typeof a !== 'string') return false;
        const trimmed = a.trim().toUpperCase();
        if (trimmed.length < 2 || trimmed.length > 30) return false;
        if (trimmed.includes(' ')) {
          const parts = trimmed.split(/\s+/);
          if (parts.length < 2 || parts.length > 3) return false;
          return parts.every(p => /^[A-Z0-9]{1,15}$/.test(p));
        }
        return /^[A-Z][A-Z0-9]{1,14}$/.test(trimmed);
      });
      console.log(`[Context] Direct handler "${command}" → passing assets=${JSON.stringify(contextAssets)} to injectBotResponse`);
      if (this.geminiService) this.geminiService.injectBotResponse(cleanPhone, finalResp, contextAssets);
      return finalResp;
    } catch (error) {
      console.error(error);
      return "*System Error*: Something went wrong. Try again!";
    }
  }

  // ==========================================
  // UNKNOWN COMMAND
  // ==========================================

  handleUnknownCommand(command, args) {
    const suggestions = this.getSuggestions(command);

    if (suggestions.length > 0) {
      return `*Unknown Command: "${command}"*

*Did you mean:*
${suggestions.map((s) => `  \u2022 ${s}`).join("\n")}

━━━━━━━━━━━━━━━━━
*Popular Commands:*
  \u2022 Price BTC
  \u2022 Set ETH at 3500  
  \u2022 My alerts
  \u2022 Subscribe
  \u2022 Help`;
    } else {
      return `*Unknown Command: "${command}"*

*Try these commands:*
━━━━━━━━━━━━━━━━━
  \u2022 *Price [asset]* - Check prices
  \u2022 *Set [asset] at [price]* - Create alerts
  \u2022 *My alerts* - View watchlist
  \u2022 *Subscribe* - View plan & limits
  \u2022 *Help* - All commands`;
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
  // GREETING
  // ==========================================
  async handleGreeting(args, phoneNumber, db, priceService, pushName) {
    const isNew = await db.isNewUser(phoneNumber);
    const displayName = this.getDisplayName(null, pushName);

    if (isNew) {
      return `*Welcome to PricePing, ${displayName}!*

I'm your AI crypto & stock alert assistant. I'll message you the second your target price is hit!

*Let's get started in 3 steps:*

*Step 1:* Check a price — just type the ticker!
Try: \`BTC\` or \`Price BTC\` or \`GOLD\`
(I understand natural language — give it a shot!)

(I'll guide you through setting your first alert after that!)`;
    }

    const user = await db.getUserByPhoneNumber(phoneNumber);
    const name = this.getDisplayName(user, pushName);
    const usage = await db.getAlertUsage(phoneNumber);

    const streak = user?.streak?.current > 1
      ? `*${user.streak.current} Day Streak!* Keep it going!\n`
      : "";

    const bonusSlots = user?.bonus_alert_slots || 0;
    const bonusLine = bonusSlots > 0 ? `\n*+${bonusSlots} bonus slots* from referrals!` : "";

    return `${this.getHeader("PricePing Terminal")}

*Hey ${name}!* Ready to track some markets?

${streak}*Your Power:* ${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "*Pro Plan* -- Unlimited!" : `Resets in: ${usage.resetIn}`}${bonusLine}

━━━━━━━━━━━━━━━━━

*Try This:* Just type a ticker!
\`BTC\` \`SOL\` \`TSLA\` \`GOLD\` \`EURUSD\`
*No "Price" needed* -- I auto-detect it!

━━━━━━━━━━━━━━━━━

*Set Your First Alert:*
\`Set ETH at 3500\` -- I'll DM you the moment it hits

*Passive Tracking:*
\`Watch TSLA\` -- Zero effort, I keep an eye on it

━━━━━━━━━━━━━━━━━
${usage.isPro ? "" : "Type *Subscribe* to unlock unlimited alerts + AI analysis!\n"}
_Try \`Help\` for full guide, \`Invite\` to earn bonus slots!_`;
  }

  // ==========================================
  // PRICE CHECKER
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
    if (!input) return "Please specify a valid asset to check. (e.g., Price SOL)";

    if (global.trackUserInterest) {
      global.trackUserInterest(input.toUpperCase(), phoneNumber);
    }

    console.log(`[Price] Input: "${input}" → assetInfo lookup...`);
    const info = await priceService.getAssetInfo(input);

    if (!info) {
      return `*Not Found*

I searched high and low for *"${input.toUpperCase()}"* but couldn't find it.

*Try:*
  \u2022 Just type it: \`BTC\` -- I auto-detect assets!
  \u2022 \`GOLD\` -- Commodities
  \u2022 \`AAPL\` -- US Stocks
  \u2022 \`GBPUSD\` -- Forex
  \u2022 \`ZENITHBANK\` -- NGX Stocks`;
    }

    if (info._rateLimited) {
      return `*We are receiving too many requests for ${info.symbol} at the moment.*

Please wait a couple of minutes before checking this specific asset again.`;
    }

    if (info._derivDown) {
      return `*${info.symbol} price is temporarily unavailable.*

The Deriv data feed for synthetic indices is currently down. This usually resolves within a few minutes.

*Try:*
  \u2022 Check back in a moment
  \u2022 Check a different asset like \`Price BTC\` or \`Price GOLD\``;
    }

    if (info._notListed) {
      return `*${info.symbol} (NGX)*
━━━━━━━━━━━━━━━━━
*Not listed on NGX*

_${info.symbol} is not publicly traded on the Nigerian Exchange. It may be a private company (e.g. Globacom/GLO) or delisted._

*Tip:* Check listed stocks at ngxgroup.com`;
    }

    if (info._privateCompany) {
      return `*${info.name}*
━━━━━━━━━━━━━━━━━
*${info._privateNote}*

_This company does not have a publicly traded share price on NGX._`;
    }

    if (info._unavailable) {
      return `*${info.name}*
━━━━━━━━━━━━━━━━━
*NGX market data is temporarily unavailable.*

The Nigerian stock data feed is currently offline. This is a known issue -- please check back later.

*Check manually:*
  \u2022 ngxgroup.com
  \u2022 nairametrics.com

_Tip: US stocks, Crypto, Forex & Gold are all working fine!_`;
    }

    let label = "Crypto Asset";
    let changeLine = "";

    if (info.blockchain === "Commodities") {
      label = "Commodity";
    } else if (info.blockchain === "Futures Market") {
      label = "Futures Contract";
      if (info.change24h != null) {
        changeLine = `\n*Daily Change:* ${info.change24h >= 0 ? "+" : ""}${info.change24h.toFixed(2)}%`;
      }
    } else if (info.blockchain === "Forex Market") {
      label = "Foreign Exchange";
    } else if (info.blockchain === "Stock Market") {
      label = info.currency === "NGN" ? "Nigerian Stock (NGX)" : "Global Stock";
      if (info.change24h != null) {
        changeLine = `\n*Today's Change:* ${info.change24h >= 0 ? "+" : ""}${info.change24h.toFixed(2)}%`;
      }
    }

    const fPrice = priceService.formatPrice(info.price, info.symbol, info.currency);

    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    let response = `*${info.name}*
━━━━━━━━━━━━━━━━━
*Price:* ${fPrice}${changeLine}
*Type:* ${label}
*Market:* ${info.blockchain}
*Time:* ${time}`;

    // Only show Fear & Greed for Crypto
    if (info.blockchain !== "Stock Market" && info.blockchain !== "Forex Market" && info.blockchain !== "Commodities" && info.blockchain !== "Futures Market") {
      const mood = await fearGreedService.getScore();
      if (mood) {
        response += `\n${mood.formatted}`;
      }
    }

    // Premium AI Feature: Smart Alert Suggestions
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
*AI Suggestions* -- Set alerts at:
${formatSuggestion(aiSuggestion.support)} (Support level)
${formatSuggestion(aiSuggestion.resistance)} (Resistance level)`;
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
*Step 2: Set an alert!*
Since you checked ${info.symbol}, try setting an alert for it:
Type: \`Set ${info.symbol} at ${Math.round(info.price * 1.05)}\``;
    } else if (!hasAiSuggestions) {
      response += `
━━━━━━━━━━━━━━━━━
*Set an Alert:*
  \u2022 \`Set ${info.symbol} at ${info.price.toFixed(2)}\` -- I'll DM you
  \u2022 Or just say "alert if ${info.symbol} drops below X"`;
    }

    return response;
  }

  // ==========================================
  // AI MARKET ANALYSIS
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
      return "*Usage:* `Analyze [CoinName]` (e.g., Analyze SOL)";

    const input = args.join(" ").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
    if (!input) return "Please specify a valid coin name to analyze. (e.g., Analyze SOL)";

    const usage = await db.getAlertUsage(phoneNumber);
    if (!usage || !usage.isPro) {
      return `*AI Market Analysis is a Pro Feature*
━━━━━━━━━━━━━━━━━
Upgrade to the Pro plan to unlock on-demand
AI market analysis, daily briefs, portfolio
tracking, and SMS alerts.

*Want to try something free right now?*
  \u2022 Just type \`${input.toUpperCase()}\` -- I'll show the live price
  \u2022 Or set a free alert: \`Set ${input.toUpperCase()} at [price]\`

Type *Subscribe* to view plans or *Price ${input.toUpperCase()}* to start free!`;
    }

    const info = await priceService.getAssetInfo(input);
    if (!info) {
      return `*Not Found*

I couldn't find data for *"${input.toUpperCase()}"* to analyze.`;
    }

    const fearGreedService = require('./fearGreedService');
    let fearGreed = null;
    const isCrypto = info.blockchain !== "Stock Market" && info.blockchain !== "Futures Market" && info.blockchain !== "Forex Market" && !info.blockchain?.includes("Commodity");
    if (isCrypto) {
      try { fearGreed = await fearGreedService.getScore(); } catch (_) { }
    }

    const extras = {
      high52: info.high52 || null,
      low52: info.low52 || null,
      volume: info.volume || null,
      marketCap: info.marketCap || null,
      marketLabel: info.blockchain || null,
      fearGreed,
    };

    const currencyStr = info.blockchain === "Stock Market" ? (info.currency || "USD") : "USD";
    const analysis = await this.geminiService.analyzeMarket(info.symbol, info.price, info.change24h, currencyStr, extras);

    if (!analysis) {
      return `*System Error*
The AI is currently resting. Please try again in a moment!`;
    }

    const fPrice = priceService.formatPrice(info.price, info.symbol, info.currency);
    const changeLine = info.change24h != null
      ? `\n*24h Change:* ${info.change24h >= 0 ? '+' : ''}${info.change24h.toFixed(2)}%`
      : '';
    const fgLine = fearGreed ? `\n${fearGreed.formatted}` : '';

    return `*AI Market Intel: ${info.symbol}*
━━━━━━━━━━━━━━━━━
*Current Price:* ${fPrice}${changeLine}${fgLine}

*Analysis:*
${analysis}

_Not financial advice. Always DYOR._`;
  }

  // ==========================================
  // AI NEWS ANALYSIS
  // ==========================================
  async handleNews(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length === 0)
      return "*Usage:* `News [CoinName]` (e.g., News BTC)";

    const input = args.join(" ").replace(/[^a-zA-Z0-9\s-]/g, "").trim().toUpperCase();
    if (!input) return "Please specify a valid asset for news. (e.g., News BTC)";

    const usage = await db.getAlertUsage(phoneNumber);
    if (!usage || !usage.isPro) {
      return `*AI News Summary is a Pro Feature*
━━━━━━━━━━━━━━━━━
Upgrade to the Pro plan to unlock live AI
news analysis and market updates.

*Try this for free instead:*
  \u2022 \`${input}\` -- Get the live price
  \u2022 \`Set ${input} at [price]\` -- Set a free alert

Type *Subscribe* to view plans!`;
    }

    const assetType = priceService.classifier?.classify(input)?.type?.toLowerCase() || 'crypto';
    const headlineMap = {
      'crypto': 'crypto', 'synthetic_index': 'crypto', 'deriv_asset': 'crypto',
      'stock': 'stock', 'us_stock': 'stock', 'ngx_stock': 'stock',
      'forex': 'forex',
      'commodity': 'commodity',
      'traditional_future': 'futures',
    };
    const newsKeyword = headlineMap[assetType] || 'finance';

    const headlines = await newsService.getLatestHeadlines(input, newsKeyword);
    if (!headlines || headlines.length === 0) {
      return `No major news found for ${input} in the last 24 hours.`;
    }

    const analysis = await this.geminiService.analyzeNewsHeadlines(input, headlines, newsKeyword);

    if (!analysis) {
      return `*System Error*
The AI is currently resting. Please try again in a moment!`;
    }

    return `*${input} News Intel*
━━━━━━━━━━━━━━━━━
${analysis}

_Not financial advice. News can be volatile._`;
  }

  // ==========================================
  // SET ALERT
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
      return "*Usage:* `Set [Coin] at [Price]`\nExample: `Set SOL at 150`";

    let targetPrice = null;
    let direction = null;

    if (args.includes("below")) direction = "below";
    if (args.includes("above")) direction = "above";

    const stopWords = new Set(['at', 'above', 'below']);
    let assetTokens = [];
    let priceTokens = [];
    let foundDelimiter = false;

    for (const arg of args) {
      if (stopWords.has(arg.toLowerCase())) {
        foundDelimiter = true;
        continue;
      }
      if (foundDelimiter) {
        priceTokens.push(arg);
      } else {
        assetTokens.push(arg);
      }
    }

    const asset = assetTokens.join(' ').toUpperCase();

    const possiblePriceArg = priceTokens.find(a =>
      (/^\d+(\.\d+)?$/.test(a.replace(/,/g, "")) || /[\+\-\*\/\(\)]/.test(a))
    );

    if (possiblePriceArg) {
      try {
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
      return "I need a valid target price! Example: `Set BTC at 65000` or `Set BTC at (76000+1000)`";

    const usage = await db.getAlertUsage(phoneNumber);

    if (!usage.isPro && usage.remaining <= 0) {
      return `*Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
*Used:* ${this.getUsageBar(usage.used, usage.limit)}
*Resets in:* ${usage.resetIn}

You've used all *${usage.limit} free alerts* for this 12-hour period.

*Want unlimited alerts?*
━━━━━━━━━━━━━━━━━
Type *Subscribe* to see Pro benefits
or *Upgrade* to get started now!

_Your limit resets automatically in ${usage.resetIn}_`;
    }

    const info = await priceService.getAssetInfo(asset);



    if (info && info._rateLimited) {
      return `*We are receiving too many requests for ${info.symbol} at the moment.*

Please wait a couple of minutes before setting an alert for this specific asset.`;
    }

    const currentPrice = info ? info.price : null;
    if (currentPrice === null)
      return `I couldn't find a price for ${asset}.`;

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
      return `*Alert Already Exists*
━━━━━━━━━━━━━━━━━━━━━━
*Asset:* ${asset}
*Existing Target:* ${formattedTarget}
*Current:* ${priceService.formatPrice(currentPrice, asset)}
━━━━━━━━━━━━━━━━━━━━━━
You already have an active alert for ${asset} at this exact same price. Try tracking a different level!`;
    }

    const slotResult = await db.useAlertSlot(phoneNumber);

    if (!slotResult.allowed) {
      return `*Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
*Used:* ${this.getUsageBar(slotResult.usage.used, slotResult.usage.limit)}
*Resets in:* ${slotResult.usage.resetIn}

Type *Subscribe* for unlimited alerts!`;
    }

    await db.createAlert(phoneNumber, asset, targetPrice, direction);

    const u = slotResult.usage;

    let response = `*Alert Activated!*
━━━━━━━━━━━━━━━━━
*Asset:* ${asset}
*Target:* ${priceService.formatPrice(targetPrice, asset)}
*Current:* ${priceService.formatPrice(currentPrice, asset)}
*Condition:* When price goes *${direction.toUpperCase()}*
━━━━━━━━━━━━━━━━━
*Alerts:* ${this.getUsageBar(u.used, u.limit)}
${u.isPro ? "*Pro Plan*" : `Resets in: ${u.resetIn}`}
━━━━━━━━━━━━━━━━━`;

    // Pro-only: append SMS prompt
    if (u.isPro) {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      response += this._buildSmsFooter(user, phoneNumber, userState);
    } else {
      response += `\n_I'll message you the moment it hits!_`;
    }

    return response;
  }

  async handleSetPercentAlert(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length < 2) return "*Usage:* `Set [Asset] [Percentage]%`\nExample: `Set BTC 5%` or `Set BTC 5% move` (for two-way alert)";

    const asset = args[0].toUpperCase();
    const rawPercent = args[1].replace('%', '');
    const percent = parseFloat(rawPercent);

    if (isNaN(percent)) return "Invalid percentage. Example: `Set BTC 5%`";

    const info = await priceService.getAssetInfo(asset);

    if (info && info._rateLimited) {
      return `*We are receiving too many requests for ${info.symbol} at the moment.*

Please wait a couple of minutes before setting an alert for this specific asset.`;
    }

    if (!info || !info.price) return `Couldn't get current price for ${asset}.`;

    const currentPrice = info.price;
    const isTwoWay = args.includes("move") || args.includes("either") || args.includes("both");

    if (isTwoWay) {
      const upperTarget = currentPrice * (1 + Math.abs(percent) / 100);
      const lowerTarget = currentPrice * (1 - Math.abs(percent) / 100);

      const usage = await db.getAlertUsage(phoneNumber);
      if (usage.remaining < 2 && !usage.isPro) {
        return `*Quota Low!* This two-way alert requires 2 slots, but you only have ${usage.remaining} left. Type *Upgrade* for unlimited!`;
      }

      await db.createAlert(phoneNumber, asset, upperTarget, 'above');
      await db.createAlert(phoneNumber, asset, lowerTarget, 'below');

      return `*Two-way Alert Activated!*
━━━━━━━━━━━━━━━━━
*Asset:* ${asset}
*Current:* ${priceService.formatPrice(currentPrice, asset)}
*Upper:* ${priceService.formatPrice(upperTarget, asset)} (+${Math.abs(percent)}%)
*Lower:* ${priceService.formatPrice(lowerTarget, asset)} (-${Math.abs(percent)}%)
━━━━━━━━━━━━━━━━━
_I'll notify you if it moves ${Math.abs(percent)}% in either direction!_`;
    } else {
      const targetPrice = currentPrice * (1 + percent / 100);
      const direction = percent >= 0 ? 'above' : 'below';

      const newArgs = [asset, 'at', targetPrice.toFixed(4), direction];
      return this.handleSetAlert(newArgs, phoneNumber, db, priceService, pushName, userState);
    }
  }

  // ==========================================
  // WATCHLIST HANDLERS
  // ==========================================

  async handleWatch(args, phoneNumber, db, priceService) {
    if (args.length === 0) return "*Usage:* `Watch [Asset]`\nExample: `Watch BTC` or `Watch TSLA`";
    const asset = args[0].toUpperCase();

    const watchlist = await db.getWatchlist(phoneNumber);
    if (watchlist.length >= 10) {
      const usage = await db.getAlertUsage(phoneNumber);
      if (!usage.isPro) return "*Limit Reached!* Free users can watch up to 10 assets. Type *Upgrade* for unlimited slots!";
    }

    await db.addToWatchlist(phoneNumber, asset);
    const info = await priceService.getAssetInfo(asset);

    const isNew = await db.isNewUser(phoneNumber);
    let onboardingHint = "";
    if (isNew) {
      onboardingHint = "\n\n*Step 2:* Now set an alert when it hits a price!\nTry: `Set ${asset} at ${Math.round(info.price * 1.1)}`";
    }

    return `*Now watching ${asset}*
Current price: ${priceService.formatPrice(info.price, asset)}
━━━━━━━━━━━━━━━━━
Type *Watchlist* to see all tracked assets.${onboardingHint}`;
  }

  async handleWatchlist(args, phoneNumber, db, priceService) {
    const watchlist = await db.getWatchlist(phoneNumber);
    if (watchlist.length === 0) return "*Your watchlist is empty.* Try: `Watch BTC` to start tracking!";

    let msg = `*Your Watchlist*\n━━━━━━━━━━━━━━━━━\n`;

    for (const asset of watchlist) {
      try {
        const info = await priceService.getAssetInfo(asset);
        if (info) {
          const change = info.change24h !== undefined ? ` (${info.change24h >= 0 ? '+' : ''}${info.change24h.toFixed(1)}%)` : '';
          msg += `\n  \u2022 *${asset}:* ${priceService.formatPrice(info.price, asset)}${change}`;
        } else {
          msg += `\n  \u2022 *${asset}:* Price unavailable`;
        }
      } catch (e) {
        msg += `\n  \u2022 *${asset}:* Error fetching price`;
      }
    }

    msg += `\n\n━━━━━━━━━━━━━━━━━\nTo remove: \`Unwatch BTC\``;
    return msg;
  }

  async handleUnwatch(args, phoneNumber, db) {
    if (args.length === 0) return "*Usage:* `Unwatch [Asset]`";
    const asset = args[0].toUpperCase();
    await db.removeFromWatchlist(phoneNumber, asset);
    return `Removed *${asset}* from your watchlist.`;
  }

  // ==========================================
  // REFERRAL HANDLERS
  // ==========================================

  async handleInvite(args, phoneNumber, db) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    let code = user.referral_code;

    if (!code) {
      code = await db.generateReferralCode(phoneNumber);
    }

    const referralCount = user.referrals?.length || 0;
    const bonusSlots = user.bonus_alert_slots || 0;

    return `*Invite Friends, Get More Alerts!*
━━━━━━━━━━━━━━━━━
Your unique code: *${code}*

*Your Stats:*
  \u2022 Friends invited: ${referralCount}
  \u2022 Bonus slots earned: +${bonusSlots}
  \u2022 Current total limit: ${3 + bonusSlots} per 12 hours

*How it works:*
1. Share your code with friends
2. They use: \`Redeem ${code}\`
3. You get *+1 alert slot* (max +3 total)

*Share now:*
_wa.me/?text=Get%20real-time%20crypto%20alerts%20with%20PricePing!%20Use%20my%20code%20*${code}*%20for%20bonus%20alert%20slots!_`;
  }

  async handleRedeem(args, phoneNumber, db) {
    if (args.length === 0) return "*Usage:* `Redeem [Code]`";

    const code = args[0].toUpperCase();
    const result = await db.useReferralCode(phoneNumber, code);

    if (!result.success) {
      return `*Error:* ${result.error || "Invalid referral code."} Ask your friend for their 6-digit code!`;
    }

    return `*Referral Applied!*
━━━━━━━━━━━━━━━━━
*${result.referrerName}* just earned +1 bonus alert slot! 

You can earn bonus slots too -- type *Invite* to get your own code.`;
  }

  async handleSetAsk(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length < 1) return "Invalid format.";
    const asset = args[0].toUpperCase();
    return `Sure! What price should I watch for *${asset}*? You can say "above 150" or "below 120".`;
  }


  // ==========================================
  // SMS FOOTER BUILDER (Pro only)
  // ==========================================
  _buildSmsFooter(user, phoneNumber, userState) {
    if (user?.sms_number) {
      userState.set(phoneNumber, { type: 'CONFIRM_SMS_NUMBER', smsNumber: user.sms_number });
      return `\n*SMS Notification:* 
Receive on *+${user.sms_number}*?
━━━━━━━━━━━━━━━━━
*1* -- Yes, use this number
*2* -- No, use different number

_I'll message you on both channels!_`;
    }
    if (this.smsSkippedThisSession.has(phoneNumber)) {
      return `\n\n_Note: SMS alerts are currently disabled._
_I'll notify you on WhatsApp only._`;
    }
    userState.set(phoneNumber, { type: 'AWAITING_SMS_NUMBER' });
    return `\n*Pro Perk: SMS Alerts*
━━━━━━━━━━━━━━━━━
Would you like an SMS alert as well?
*Reply with your phone number*
   (e.g. *08012345678*)
Or type *SKIP* for WhatsApp only.`;
  }

  // ==========================================
  // MY ALERTS
  // ==========================================
  async handleMyAlerts(args, phoneNumber, db, priceService) {
    const alerts = await db.getUserAlerts(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);

    if (alerts.length === 0) {
      return `*You have no alerts set.*

*Alert Quota:* ${this.getUsageBar(usage.used, usage.limit)}/${usage.limit}
${usage.isPro ? "*Pro Plan*" : `Resets in: ${usage.resetIn}`}

Try: \`Set BTC at 70000\` -- I'll notify you the second it hits!
Or just type a ticker like \`BTC\` to check price first.`;
    }

    let msg = `${this.getHeader("Your Alerts")}\n`;

    alerts.forEach((a) => {
      const icon = a.direction === "above" ? "\u2191" : "\u2193";
      msg += `\n*#${a.alert_number}* ${a.asset} ${icon} ${priceService.formatPrice(a.targetPrice, a.asset)}`;
    });

    msg += `\n\n━━━━━━━━━━━━━━━━━`;
    msg += `\n*Quota:* ${this.getUsageBar(usage.used, usage.limit)}`;
    msg += usage.isPro ? "\n*Pro Plan*" : `\nResets in: ${usage.resetIn}`;
    msg += `\n\n*To Delete:*`;
    msg += `\n  \u2022 Single: \`Delete 1\``;
    msg += `\n  \u2022 Multiple: \`Delete 1 3 5\``;
    msg += `\n  \u2022 All: \`Delete all\``;
    return msg;
  }

  // ==========================================
  // HELP
  // ==========================================
  async handleHelp(args, phoneNumber, db) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);
    const streak = user?.streak?.current > 1
      ? `*${user.streak.current} Day Streak!* Keep it going!\n`
      : "";
    const bonusSlots = user?.bonus_alert_slots || 0;

    let msg = `*Meet PricePing AI -- Your Market Wingman*
━━━━━━━━━━━━━━━━━━━━━━━
${streak}*Your Power:* ${this.getUsageBar(usage.used, usage.limit)}`;

    if (bonusSlots > 0) {
      msg += `\n*+${bonusSlots} bonus slots* from referrals! Earn more with \`Invite\``;
    }
    msg += `\n${usage.isPro ? "*Pro Plan* -- Unlimited!" : `Resets in: ${usage.resetIn}`}

━━━━━━━━━━━━━━━━━━━━━━━

*Try This Right Now:*
Just type a ticker. Yes, that's it!
\`BTC\` \`SOL\` \`GOLD\` \`TSLA\` \`EURUSD\`
*No command needed* -- I auto-detect asset names!

━━━━━━━━━━━━━━━━━━━━━━━

*FREE -- Instantly Useful*
  \u2022 \`Price BTC\` -- Live price
  \u2022 \`Set ETH at 3500\` -- I'll DM you the moment it hits
  \u2022 \`Watch TSLA\` -- Passive tracking, zero effort
  \u2022 \`Invite\` -- Share code, earn +1 alert slot per friend
  \u2022 \`Name Sarah\` -- Personalize my responses

*Natural Language Works:*
_"what's the price of ETH"_
_"set an alert if SOL drops below 100"_
-- I understand you! Try it.

━━━━━━━━━━━━━━━━━━━━━━━

*Pro Upgrades (when you're ready)*
  \u2022 \`Analyze SOL\` -- AI technical analysis (RSI, MACD, EMA)
  \u2022 \`News BTC\` -- AI-summarized breaking headlines
  \u2022 \`Portfolio\` -- Track your holdings with live PnL
  \u2022 \`Trades\` -- Auto-track win rate
  \u2022 SMS alerts -- Never miss a move, even offline

━━━━━━━━━━━━━━━━━━━━━━━
Type \`Subscribe\` for full comparison or \`Upgrade\` to unlock Pro!`;
    return msg;
  }

  // ==========================================
  // DELETE ALERT
  // ==========================================
  async handleDeleteAlert(args, phoneNumber, db, priceService, pushName, userState) {
    if (!args || args.length === 0) {
      return "*Usage:*\n  \u2022 `Delete 1` -- remove one alert\n  \u2022 `Delete 1 3 5` -- remove multiple\n  \u2022 `Delete all` -- clear everything";
    }

    // DELETE ALL with confirmation
    if (args[0].toLowerCase() === 'all') {
      userState.set(phoneNumber, { type: 'CONFIRM_DELETE_ALL' });

      const alerts = await db.getUserAlerts(phoneNumber);
      if (alerts.length === 0) {
        return `No active alerts to delete.`;
      }

      return `*Are you sure?*
━━━━━━━━━━━━━━━━━
You are about to delete *all ${alerts.length} alert(s)*:

${alerts.map(a => {
        const icon = a.direction === 'above' ? '\u2191' : '\u2193';
        return `  \u2022 #${a.alert_number} ${a.asset} ${icon} ${a.targetPrice}`;
      }).join('\n')}

━━━━━━━━━━━━━━━━━
Reply *YES* to confirm deletion
Reply *NO* to cancel`;
    }

    // DELETE BY ALERT NUMBER(S)
    const numbersToDelete = args
      .join(' ')
      .split(/[\s,]+/)
      .map(n => parseInt(n.replace(/\D/g, '')))
      .filter(n => !isNaN(n) && n > 0);

    if (numbersToDelete.length === 0) {
      return "Please provide valid alert number(s). Example: `Delete 1` or `Delete 1 3 5`";
    }

    const alerts = await db.getUserAlerts(phoneNumber);

    if (alerts.length === 0) {
      return `No active alerts to delete.`;
    }

    const toDelete = alerts.filter(a => numbersToDelete.includes(a.alert_number));
    const notFound = numbersToDelete.filter(n => !alerts.find(a => a.alert_number === n));

    if (toDelete.length === 0) {
      return `Alert number(s) *${numbersToDelete.join(', ')}* not found.\n\nType *My Alerts* to see your current alert numbers.`;
    }

    for (const alert of toDelete) {
      await db.deleteAlert(alert.id);
    }

    let response = '';
    if (toDelete.length === 1) {
      response = `*Deleted:* Alert #${toDelete[0].alert_number} -- ${toDelete[0].asset}`;
    } else {
      response = `*Deleted ${toDelete.length} alerts:*\n${toDelete.map(a => `  \u2022 #${a.alert_number} ${a.asset}`).join('\n')}`;
    }

    if (notFound.length > 0) {
      response += `\n\nNot found: #${notFound.join(', #')}`;
    }

    response += `\n\n_Deleting an alert does not refund your quota._\nSet a new one: \`Set ${toDelete[0]?.asset || 'BTC'} at [price]\``;
    return response;
  }

  // ==========================================
  // SET NAME
  // ==========================================
  async handleSetName(args, phoneNumber, db) {
    const name = args.join(" ").trim();

    if (!name || name.toLowerCase() === "newname" || name.length < 2) {
      return "Please provide a valid name. Example: `Name Sarah`";
    }

    await db.updateUserName(phoneNumber, name);
    return `Awesome! I'll call you *${name}* from now on, ${name}!\n\n_Try \`Help\` to see everything I can do for you._`;
  }

  // ==========================================
  // STATUS
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

*User:* ${name}
*Phone:* ${this.formatPhone(phoneNumber)}
*Bot Status:* Online
*Uptime:* ${hours}h ${minutes}m
*Your Alerts:* ${activeAlerts.length} active
*Database:* Connected
*Markets:* Crypto, Forex, US Stocks & NGX, Commodities

━━━━━━━━━━━━━━━━━
*Alert Quota:*
${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "*Pro Plan* - Unlimited!" : `Free Plan - ${usage.remaining} remaining\nResets in: ${usage.resetIn}`}

━━━━━━━━━━━━━━━━━
${usage.isPro ? "" : "Type *Subscribe* for unlimited alerts!"}`;
    } catch (error) {
      console.error("Status command error:", error);
      return "*System Error*: Couldn't fetch status right now.";
    }
  }

  // ==========================================
  // STREAK
  // ==========================================
  async handleStreak(args, phoneNumber, db) {
    try {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      if (!user?.streak?.current || user.streak.current <= 1) {
        return `*No active streak yet.*

Start your streak today! Just check a price or set an alert.
Use me every day to build your streak!`;
      }
      return `*${user.streak.current} Day Streak!* Keep it going!
      
You've been consistent for *${user.streak.current} days in a row*.
Don't break the chain!`;
    } catch (error) {
      console.error("Streak command error:", error);
      return "*System Error*: Couldn't fetch your streak right now.";
    }
  }

  // ==========================================
  // TIMEZONE
  // ==========================================
  async handleTimezone(args, phoneNumber, db) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const currentTz = user?.timezone || 'Africa/Lagos';

    if (args.length === 0) {
      return `*Your Timezone:* ${currentTz}

You receive your daily market brief at 7AM local time.

*To change it, type:*
Timezone [your area]
Examples:
  \u2022 \`Timezone Europe/London\` (UK)
  \u2022 \`Timezone America/New_York\` (US East)
  \u2022 \`Timezone America/Los_Angeles\` (US West)
  \u2022 \`Timezone Asia/Seoul\` (South Korea)
  \u2022 \`Timezone Africa/Lagos\` (Nigeria)

Find yours at: wikipedia.org/wiki/List_of_tz_database_time_zones`;
    }

    const tzInput = args.join('_').toUpperCase();
    // Validate: check if the timezone string looks reasonable
    // Must be in format like Africa/Lagos, America/New_York, Europe/London
    const tzPattern = /^[A-Z][a-zA-Z]+\/[A-Z][a-zA-Z_]+$/;
    if (!tzPattern.test(tzInput)) {
      return `Invalid timezone format. Use format like: Africa/Lagos, Europe/London, America/New_York

Find your timezone at: wikipedia.org/wiki/List_of_tz_database_time_zones`;
    }

    try {
      // Validate by trying to use it
      new Date().toLocaleString('en-US', { timeZone: tzInput });
    } catch (_) {
      return `"${tzInput}" is not a recognized timezone.

Check: wikipedia.org/wiki/List_of_tz_database_time_zones

Example: \`Timezone Europe/London\``;
    }

    await db.updateTimezone(phoneNumber, tzInput);
    return `Timezone set to *${tzInput}*.

You'll now receive the daily market brief at *7AM local time* in *${tzInput}*.`;
  }

  // ==========================================
  // SUBSCRIBE
  // ==========================================
  async handleSubscribe(args, phoneNumber, db, priceService, pushName) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);
    const alerts = await db.getUserAlerts(phoneNumber);
    const name = this.getDisplayName(user, pushName);

    if (usage.isPro) {
      return `${this.getHeader("Your Subscription")}

*You're on the Pro Plan!*

*Current Usage:*
  \u2022 Active Alerts: ${alerts.length}
  \u2022 Alerts Used: ${usage.used} (Unlimited)
  \u2022 Plan: Pro

_Thank you for being a Pro member, ${name}!_
Need help? Message admin:
wa.me/${this.adminNumber}`;
    }

    return `${this.getHeader("Your Plan")}

*Hi ${name}!*

*Current Usage:*
━━━━━━━━━━━━━━━━━
  \u2022 Active Alerts: ${alerts.length}
  \u2022 Alerts Used: ${this.getUsageBar(usage.used, usage.limit)}
  \u2022 Plan: Free Tier
  \u2022 Resets in: ${usage.resetIn}

*Free Plan Includes:*
━━━━━━━━━━━━━━━━━
  \u2022 3 alerts per 12 hours (earn +3 bonus via referrals!)
  \u2022 Unlimited price checks -- Crypto, Forex, Stocks & Commodities
  \u2022 Watchlist (10 assets) -- passive tracking
  \u2022 Global Fear & Greed Index -- market mood at a glance
  \u2022 Daily interaction streaks -- keep it going!
  \u2022 AI analysis, portfolio tracking & SMS (Pro only)

*Upgrade to Pro (N2,000/month):*
━━━━━━━━━━━━━━━━━
  \u2022 Unlimited alerts
  \u2022 AI market analysis
  \u2022 Live news intel
  \u2022 Portfolio tracker & trade journal
  \u2022 SMS alerts
  \u2022 Daily AI briefs

Type *Upgrade* to unlock!`;
  }

  // ==========================================
  // UPGRADE PRO (Paystack)
  // ==========================================
  async handleUpgradePro(args, phoneNumber, db, priceService, pushName) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);

    if (usage.isPro) {
      return `*You're already on Pro!*\nEnjoy your unlimited alerts!`;
    }

    try {
      await db.db.collection('conversion_events').insertOne({
        phone_number: phoneNumber,
        event: 'upgrade_command_clicked',
        timestamp: new Date()
      });
    } catch (e) {
      console.warn(`[Upgrade] Click log failed for ${phoneNumber}`);
    }

    const name = this.getDisplayName(user, pushName);

    try {
      const PaystackService = require('./paystackService');
      const paystack = new PaystackService(db);
      if (!paystack.isConfigured()) {
        throw new Error('PAYSTACK_SECRET_KEY not configured');
      }
      const realPhone = user?.phone_number || phoneNumber;
      const { url } = await paystack.initializeTransaction(realPhone, 2000);

      return `${this.getHeader("Upgrade to Pro")}

*Hi ${name}!*

Unlock *unlimited alerts, AI analysis, portfolio tracking & more!*

*Pro Plan Benefits:*
━━━━━━━━━━━━━━━━━
  \u2022 *Unlimited* alert creation
  \u2022 *AI Market Analysis* -- Technical analysis on any asset
  \u2022 *Live News Intel* -- AI-summarized headlines
  \u2022 *Portfolio Tracker* -- Live profit & loss
  \u2022 *Trade Journal* -- Auto-track your win rate
  \u2022 *Smart Alerts* -- AI-suggested support & resistance
  \u2022 *Volatility Alerts* -- Two-way percentage alerts
  \u2022 *Daily Briefs* -- Personalized morning intel at 8AM
  \u2022 *Move Detectors* -- Instant pump/dump warnings
  \u2022 *SMS Notifications* -- Text alerts when offline

━━━━━━━━━━━━━━━━━
*Price:* *N2,000/month* -- one-time payment

*Pay Now:* ${url}

━━━━━━━━━━━━━━━━━
*Secured by Paystack* -- Your payment is safe
*Auto-activation:* You'll be upgraded instantly
A welcome message will arrive the moment payment succeeds
*One-time use:* Type *Upgrade* anytime for a fresh payment link

_Your existing alerts and data remain safe._`;
    } catch (e) {
      console.error(`[Upgrade] Paystack error: ${e.message}`);
      const link = this.getAdminLink(phoneNumber, name);
      return `${this.getHeader("Upgrade to Pro")}

*Hi ${name}!*

Online payment is temporarily unavailable.

*Price:* *N2,000/month*

*To upgrade, message the admin:*
━━━━━━━━━━━━━━━━━
${link}

We'll activate your Pro access manually!`;
    }
  }

  // ==========================================
  // FEATURES LIST
  // ==========================================
  async handleFeatures(args, phoneNumber, db, priceService, pushName) {
    return `${this.getHeader("Features & Capabilities")}

I am *PricePing AI* -- your elite, AI-driven personal market analyst. Here is everything I can do for you:

*FREE TIER FEATURES:*
━━━━━━━━━━━━━━━━━
  \u2022 *Live Prices:* Crypto, Forex, Commodities & Stocks
  \u2022 *Market Mood:* Global Fear & Greed Index
  \u2022 *Basic Alerts:* Up to 3 target alerts per 12 hours
  \u2022 *Watchlist:* Passive price tracking (\`Watch BTC\`)
  \u2022 *Referral Bonuses:* Earn up to +3 bonus alert slots (\`Invite\`)
  \u2022 *Usage Streaks:* Gamified daily interaction streaks

*PRO VIP FEATURES:*
━━━━━━━━━━━━━━━━━
  \u2022 *AI Analysis:* On-demand deep technical analysis
  \u2022 *Live News:* Instant AI-summarized breaking headlines
  \u2022 *Smart Alerts:* AI-suggested Support & Resistance levels
  \u2022 *Volatility Alerts:* Two-way percentage alerts (\`Set BTC 5% move\`)
  \u2022 *Live Portfolio:* Track holdings with live PnL (\`Portfolio\`)
  \u2022 *Trade Journal:* Auto-track your win rate (\`Bought 2 BTC at 65000\`)
  \u2022 *Daily Briefs:* Personalized morning market intel at 8AM
  \u2022 *Move Detectors:* Instant warnings on pumps/dumps
  \u2022 *SMS Fallback:* Text-message alerts (offline support)
  \u2022 *Unlimited Alerts:* Absolutely zero usage limits

*SUPPORTED MARKETS:*
━━━━━━━━━━━━━━━━━
  \u2022 *Crypto:* Bitcoin, Ethereum, Solana, and thousands more
  \u2022 *US Stocks:* Apple, Tesla, Nvidia, Google, and all NYSE/NASDAQ
  \u2022 *NGX Stocks:* MTN, Zenith, Dangote, GTCO, UBA and more
  \u2022 *Forex:* EUR/USD, GBP/USD, USD/NGN, and major pairs
  \u2022 *Commodities:* Gold, Silver, Crude Oil

Type *Upgrade* to view Pro pricing, or just type any ticker to get started!`;
  }
}

// ==========================================
// PORTFOLIO TRACKER (Pro Only)
// ==========================================
CommandParser.prototype.handlePortfolio = async function (args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `*Portfolio Tracker is Pro Only*\nType *Upgrade* to unlock!`;

  const holdings = await db.getPortfolio(phoneNumber);
  if (!holdings || holdings.length === 0) {
    return `*Your Portfolio is Empty!*
━━━━━━━━━━━━━━━━━
Tell me what you hold:
_"I have 0.5 BTC and 10 ETH"_

I'll track your P&L live!`;
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
    const direction = pnl >= 0 ? '+' : '';
    lines.push(`*${h.asset}* ${h.quantity} --> ${priceService.formatPrice(value, h.asset)} (${direction}${pnl.toFixed(1)}%)`);
    holdingsSummary.push(`${h.asset}: ${h.quantity} units @ $${info.price.toLocaleString()} = $${value.toLocaleString()}`);
    totalValue += value;
    totalCost += cost;
  }

  const dayPnlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  const aiComment = await this.geminiService.analyzePortfolio(holdingsSummary.join(', '), totalValue, dayPnlPct);

  let msg = `*Your Portfolio*
━━━━━━━━━━━━━━━━━
${lines.join('\n')}
─────────────────
*Total:* ${priceService.formatPrice(totalValue, 'USD')}`;
  if (aiComment) msg += `\n\n*AI:* ${aiComment}`;
  return msg;
};

CommandParser.prototype.handleClearPortfolio = async function (args, phoneNumber, db) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `*Pro Only!* Type *Upgrade* to unlock Portfolio Tracker.`;
  await db.clearPortfolio(phoneNumber);
  return `Portfolio cleared! Send me your holdings anytime to start fresh.`;
};

// ==========================================
// TRADE JOURNAL (Pro Only)
// ==========================================
CommandParser.prototype.handleBought = async function (args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `*Trade Journal is Pro Only*\nType *Upgrade* to unlock!`;

  const text = args.join(' ');
  const m = text.match(/(\d+\.?\d*)\s+([A-Z]+)\s+(?:at\s+)?(\d+\.?\d*)/i) ||
    text.match(/([A-Z]+)\s+(\d+\.?\d*)\s+(?:at\s+)?(\d+\.?\d*)/i);
  if (!m) return `*Format:* "Bought 2 ETH at 2600"`;

  const isNumFirst = /^\d/.test(text.trim());
  const qty = isNumFirst ? parseFloat(m[1]) : parseFloat(m[2]);
  const asset = isNumFirst ? m[2].toUpperCase() : m[1].toUpperCase();
  const price = parseFloat(m[3]);

  await db.logTrade(phoneNumber, asset, qty, price);
  const info = await priceService.getAssetInfo(asset);
  const currentPrice = info?.price || price;
  const unrealised = ((currentPrice - price) / price * 100);
  const ue = unrealised >= 0 ? '+' : '';

  return `*Trade Logged!*
━━━━━━━━━━━━━━━━━
${qty} ${asset} bought at ${priceService.formatPrice(price, asset)}
Current: ${priceService.formatPrice(currentPrice, asset)} (${ue}${unrealised.toFixed(1)}% unrealised)

_Reply "Sold ${asset}" to close this trade._`;
};

CommandParser.prototype.handleSold = async function (args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `*Trade Journal is Pro Only*\nType *Upgrade* to unlock!`;

  const text = args.join(' ');
  const assetMatch = text.match(/([A-Z]+)/i);
  const priceMatch = text.match(/(\d+\.?\d+)/i);
  if (!assetMatch) return `*Format:* "Sold ETH" or "Sold ETH at 3000"`;

  const asset = assetMatch[1].toUpperCase();
  let sellPrice = priceMatch ? parseFloat(priceMatch[1]) : null;

  if (!sellPrice) {
    const info = await priceService.getAssetInfo(asset);
    if (!info) return `Couldn't fetch live price for ${asset}. Try: Sold ${asset} at 3000`;
    sellPrice = info.price;
  }

  const trade = await db.closeTrade(phoneNumber, asset, sellPrice);
  if (!trade) return `No open ${asset} trade found. Log one with: *Bought 2 ${asset} at [price]*`;

  const profitPct = ((sellPrice - trade.buy_price) / trade.buy_price) * 100;
  const profit = (sellPrice - trade.buy_price) * trade.quantity;
  const profitEmoji = profitPct >= 0 ? '+' : '';

  const closed = await db.getClosedTrades(phoneNumber, 20);
  const wins = closed.filter(t => t.sell_price >= t.buy_price).length;
  const winRate = closed.length > 0 ? `${Math.round(wins / closed.length * 100)}% (${wins}/${closed.length})` : 'First trade!';

  const aiQuip = await this.geminiService.commentOnTrade(asset, trade.quantity, trade.buy_price, sellPrice, profitPct, winRate);

  return `*Trade Closed!*
━━━━━━━━━━━━━━━━━
${trade.quantity} ${asset}: ${priceService.formatPrice(trade.buy_price, asset)} --> ${priceService.formatPrice(sellPrice, asset)}
*P&L:* ${priceService.formatPrice(Math.abs(profit), 'USD')} (${profitEmoji}${profitPct.toFixed(2)}%)
*Win Rate:* ${winRate}
${aiQuip ? `\n${aiQuip}` : ''}`;
};

CommandParser.prototype.handleTrades = async function (args, phoneNumber, db, priceService) {
  const usage = await db.getAlertUsage(phoneNumber);
  if (!usage?.isPro) return `*Trade Journal is Pro Only*\nType *Upgrade* to unlock!`;

  const open = await db.getPortfolio(phoneNumber);
  const closed = await db.getClosedTrades(phoneNumber, 5);

  let msg = `*Trade Journal*\n━━━━━━━━━━━━━━━━━\n`;

  if (!open || open.length === 0) {
    msg += `*No open trades.*\nLog one with: *Bought 2 ETH at 2600*\n\n`;
  } else {
    msg += `*Open Positions:*\n`;
    for (const h of open) {
      const info = await priceService.getAssetInfo(h.asset);
      if (!info) continue;
      const pnl = h.avg_buy_price ? ((info.price - h.avg_buy_price) / h.avg_buy_price) * 100 : 0;
      const dir = pnl >= 0 ? '+' : '';
      msg += `  \u2022 *${h.asset}* ${h.quantity} @ ${priceService.formatPrice(info.price, h.asset)} (${dir}${pnl.toFixed(1)}%)\n`;
    }
    msg += '\n';
  }

  if (closed && closed.length > 0) {
    msg += `*Recent Closed:*\n`;
    for (const t of closed) {
      const pnl = ((t.sell_price - t.buy_price) / t.buy_price) * 100;
      const dir = pnl >= 0 ? '+' : '';
      msg += `  \u2022 *${t.asset}* ${t.quantity} | ${priceService.formatPrice(t.buy_price, t.asset)} --> ${priceService.formatPrice(t.sell_price, t.asset)} (${dir}${pnl.toFixed(1)}%)\n`;
    }
  }

  if (!open?.length && !closed?.length) {
    msg = `*Trade Journal*\n━━━━━━━━━━━━━━━━━\n\nNo trades yet. Start with:\n_Bought 2 ETH at 2600_`;
  }

  return msg.trim();
};

module.exports = CommandParser;
