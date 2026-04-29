const axios = require("axios");

class GeminiService {
  constructor(db = null) {
    this.db = db;
    this.apiKey = process.env.GROQ_API_KEY;
    // ✅ Switch to standard 1,000 RPD model
    this.modelName = "meta-llama/llama-4-scout-17b-16e-instruct";
    this.apiUrl = "https://api.groq.com/openai/v1/chat/completions";

    // ✅ Unified cache
    this.cache = new Map();
  }

  isConfigured() {
    return !!this.apiKey;
  }

  // ==========================================
  // 🛡️ REGEX GATING
  // Zero-token local parsing for direct commands
  // ==========================================
  tryDirectParse(text) {
    const t = text.trim();

    const DIRECT_PATTERNS = [
      { re: /^price\s+(\S+)$/i, cmd: 'price', args: m => [m[1].toUpperCase()] },
      { re: /^alerts?$/i, cmd: 'alerts', args: () => [] },
      { re: /^status$/i, cmd: 'status', args: () => [] },
      { re: /^subscribe$/i, cmd: 'subscribe', args: () => [] },
      { re: /^upgrade$/i, cmd: 'upgrade', args: () => [] },
      { re: /^features?$/i, cmd: 'features', args: () => [] },
      { re: /^trades?$/i, cmd: 'trades', args: () => [] },
      { re: /^portfolio$/i, cmd: 'portfolio', args: () => [] },
      { re: /^del(?:ete)?\s+all$/i, cmd: 'del', args: () => ['all'] },
      { re: /^del(?:ete)?\s+([\d\s,and]+)$/i, cmd: 'del', args: m => m[1].match(/\d+/g) || [] },
      { re: /^news\s+(\S+)$/i, cmd: 'news', args: m => [m[1].toUpperCase()] },
      { re: /^analyze\s+(\S+)$/i, cmd: 'analyze', args: m => [m[1].toUpperCase()] },

      // ✅ NEW: Structured set commands (zero AI calls for clean alerts)
      {
        re: /^set\s+([a-z0-9]+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(above|below)?$/i,
        cmd: 'set',
        args: m => {
          const asset = m[1].toUpperCase();
          const price = m[2];
          const direction = m[3]?.toLowerCase() || 'below'; // default to below
          return [asset, 'at', price, direction];
        }
      },
      {
        re: /^set\s+([a-z0-9]+)\s+(\d+(?:\.\d+)?)\s*%\s*(move|either|both)?$/i,
        cmd: 'set_percent',
        args: m => {
          const asset = m[1].toUpperCase();
          const percent = m[2];
          const type = m[3] ? 'move' : '';
          return [asset, percent, type];
        }
      },
    ];

    for (const { re, cmd, args } of DIRECT_PATTERNS) {
      const m = t.match(re);
      if (m) {
        console.log(`⚡ [Regex Gate] Matched "${cmd}" locally (zero tokens)`);
        return [{ command: cmd, args: args(m) }];
      }
    }
    return null; // Needs AI
  }

  // ==========================================
  // 📂 PERSISTENT CONTEXT (now with multi-asset memory)
  // ==========================================
  async getUserContext(phone) {
    if (!this.db) return { history: [], lastAssets: [] }; // ← lastAssets is now an array
    try {
      const col = this.db.collection('ai_context');
      const doc = await col.findOne({ _id: phone });
      // Ensure lastAssets is always an array
      if (doc && !Array.isArray(doc.lastAssets)) {
        doc.lastAssets = doc.lastAsset ? [doc.lastAsset] : [];
      }
      return doc || { history: [], lastAssets: [] };
    } catch (e) {
      console.warn('⚠️ Context Load Failed:', e.message);
      return { history: [], lastAssets: [] };
    }
  }

  async saveUserContext(phone, history, lastAssets) {
    if (!this.db) return;
    try {
      const col = this.db.collection('ai_context');
      await col.updateOne(
        { _id: phone },
        { $set: { history, lastAssets, updatedAt: Date.now() } }, // ← save the array
        { upsert: true }
      );
    } catch (e) {
      console.warn('⚠️ Context Save Failed:', e.message);
    }
  }

  async refinePrompt(messageText, isPro = false, phone = "default", userName = "VIP") {
    if (!this.apiKey) return null;

    // ── 🛡️ STEP 1: Regex Gating (Zero AI Calls) ──────────────────────
    const direct = this.tryDirectParse(messageText);
    if (direct) return direct;

    // ── 📂 STEP 2: Load Persistent Context ────────────────────────────
    const context = await this.getUserContext(phone);
    let { history: userHist, lastAssets } = context; // ← lastAssets array

    userHist.push(`U:${messageText}`);
    if (userHist.length > 5) userHist.shift();

    // ── ✂️ STEP 3: Slim System Prompt (now with multi-asset awareness) ──
    const tier = isPro ? "PRO" : "FREE";
    const lastAssetsString = lastAssets.length > 0 ? lastAssets.join(', ') : 'none'; // ← Create a string for the prompt

    // ─────────────────────────────────────────────────────────────
    // 🧠 BOT SUPPORT INTENT DETECTOR — TIGHT ALLOWLIST
    // Only injects KB for unmistakable bot/service questions.
    // Flipping the logic: DON'T try to block market queries —
    // ONLY trigger for clearly bot-related support intent.
    // ─────────────────────────────────────────────────────────────
    const msgLower = messageText.toLowerCase().trim();

    // --- Tier 1: Exact/near-exact bot-service phrases (highest confidence) ---
    const botPhrases = [
      // Identity
      'who are you', 'what are you', 'what is priceping', 'about priceping', 'about this bot',
      'what is this bot', 'what can you do', 'how do you work', 'how does this work', 'how does the bot',
      // Pricing / plans
      'how much', 'how to upgrade', 'how to pay', 'upgrade to pro', 'go pro', 'pro plan',
      'free plan', 'free vs pro', 'subscription fee', 'cancel subscription', 'subscription plan',
      'pricing', 'price plan', 'cost of', 'what does pro', 'what is pro',
      // Referral system
      'referral', 'how does invite', 'how does redeem', 'referral code', 'invite code',
      'how to invite', 'how to get bonus', 'bonus slot', 'extra slot',
      // Alerts / limits
      'alert limit', 'how many alerts', 'why can\'t i set', 'quota reset', 'quota refill',
      'when does my quota', 'alert quota', 'delete refund', 'does deleting', 'alert slot',
      // Features
      'watchlist', 'portfolio feature', 'trade journal', 'what is sms', 'sms notification',
      'how to watch', 'how does watchlist', 'how does portfolio', 'set percent',
      // Support
      'help me', 'i need help', 'customer support', 'contact support', 'refund',
    ];

    // --- Tier 2: Fallback pattern — explicit "about the bot" framing ---
    // e.g. "tell me about the bot", "explain how this works", "what features do you have"
    const tier2Patterns = [
      /\b(tell me|explain|describe)\b.{0,20}\b(bot|priceping|this app|this service)\b/i,
      /\b(what|which)\b.{0,20}\b(features?|commands?|plans?|tiers?)\b.{0,10}\b(you have|available|offered|exist)\b/i,
    ];

    const isBotQuestion =
      botPhrases.some(phrase => msgLower.includes(phrase)) ||
      tier2Patterns.some(re => re.test(msgLower));

    const isQuestion = isBotQuestion;


    // ─────────────────────────────────────────────────────────────
    // 📚 KNOWLEDGE BASE (only injected if user asks a question)
    // ─────────────────────────────────────────────────────────────
    const knowledgeBase = isQuestion ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 BOT KNOWLEDGE (Use this to answer the user's question. Max 40 words per answer)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎁 REFERRAL PROGRAM:
- Get code: "Invite" command → 6-digit code
- How it works: Friend redeems → You get +1 alert slot (max +3)
- Free limit increases: 3 → 6 alerts per 12 hours
- Cannot refer yourself or redeem multiple codes

💰 PRICING:
- Free: 3 alerts/12h, watchlist (10 max), basic features
- Pro: ₦2,500/month (Unlimited alerts, AI, SMS, portfolio)
- Promo: PRICEPING50 = 10% off first month

🔔 ALERT SYSTEM:
- Free: 3 per 12 hours (auto-resets)
- Pro: Unlimited
- Delete does NOT refund quota
- Alert numbers never reused (permanent IDs)
- Volatility: "Set BTC 5% move" creates upper/lower bounds

💡 KEY COMMANDS:
- Invite = Get referral code
- Redeem [CODE] = Use friend's code
- Upgrade = Contact admin for Pro
- Subscribe = View plan comparison
- Watch [ASSET] = Add to watchlist
- Watchlist = View watched assets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : '';

    const systemPrompt = `PricePing WhatsApp bot. Output ONLY raw JSON array. No markdown, no text.
User: ${userName} | Plan: ${tier} | Last assets: ${lastAssetsString}
${knowledgeBase}

CRITICAL RULES:
1. MULTI-ASSET: If user mentions "all of them", "the three", "both", refer to "Last assets" and create a command for EACH one.
2. NEVER use these as asset names: me, my, an, a, the, it, that, this, one, them, those, alert, price, stock, crypto, coin, share
3. No price in "set" command → ask via chat
4. Asset unclear + lastAssets exists → use most recent
5. MATH: Calculate formulas first, then ask for confirmation via chat. Do NOT output formulas.
6. SUPPORT QUESTIONS: If Knowledge Base is present above, use it to answer accurately and keep the answer under 40 words via "chat" command.

NGX TICKERS: Zenith/ZenithBank→ZENITHBANK, MTN/MTNNigeria→MTNN, Dangote→DANGCEM, GTB/GtBank→GTCO, Access/AccessBank→ACCESSCORP, FirstBank/FBNH→FBNH, UBA→UBA, Airtel→AIRTELAFRI, Fidelity→FIDELITYBK, Sterling→STERLINGBANK
US TICKERS: Apple→AAPL, Tesla→TSLA, Nvidia→NVDA, Google→GOOGL, Microsoft→MSFT, Amazon→AMZN, Meta→META

COMMANDS:
price [a]              → [{"command":"price","args":["BTC"]}]
set [a] at [p] [dir]   → [{"command":"set","args":["ETH","at","3000","above"]}]
alerts                 → [{"command":"alerts","args":[]}]
del [numbers...]       → [{"command":"del","args":["1","3"]}]
del all                → [{"command":"del","args":["all"]}]
analyze [a]            → [{"command":"analyze","args":["TSLA"]}]
news [a]               → [{"command":"news","args":["AAPL"]}]
portfolio              → [{"command":"portfolio","args":[]}]
bought [qty][a] at [p] → [{"command":"bought","args":["5","TSLA","at","200"]}]
sold [a] at [p]        → [{"command":"sold","args":["BTC","at","70000"]}]
trades                 → [{"command":"trades","args":[]}]
status                 → [{"command":"status","args":[]}]
subscribe              → [{"command":"subscribe","args":[]}]
upgrade                → [{"command":"upgrade","args":[]}]
features               → [{"command":"features","args":[]}]
chat                   → [{"command":"chat","args":["reply under 40 words"]}]

EXAMPLES:
"I would like to know their prices" (Last assets: ZENITHBANK, MTNN)
→ [{"command":"price","args":["ZENITHBANK"]},{"command":"price","args":["MTNN"]}]

"set an alert for the three of them when they hit an increase of 10% each" (Last assets: ZENITHBANK, MTNN, DANGCEM)
→ [{"command":"set_percent","args":["ZENITHBANK","10"]},{"command":"set_percent","args":["MTNN","10"]},{"command":"set_percent","args":["DANGCEM","10"]}]

"how does the referral program work?"
→ [{"command":"chat","args":["Get your code with the Invite command! When a friend redeems it, you get +1 free alert slot (up to 3 total bonus slots)."]}]`;

    try {
      const recentCtx = userHist.slice(0, -1).join(" | ");
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: recentCtx
                ? `Context: ${recentCtx}\nRequest: ${messageText}`
                : `Request: ${messageText}`
            }
          ],
          temperature: 0.1,
          max_tokens: 280
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          timeout: 10000
        }
      );

      const text = response.data?.choices?.[0]?.message?.content || "";
      if (!text) return null;

      let jsonStr = text.trim();
      const match = text.match(/\[.*\]/s) || text.match(/\{.*\}/s);
      if (match) jsonStr = match[0];

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse JSON from AI:", text);
        return [{ command: "chat", args: ["I'm having trouble analyzing that. Try keeping it simple!"] }];
      }

      if (!Array.isArray(parsed)) {
        parsed = parsed.commands || parsed.result || Object.values(parsed)[0];
      }
      if (!Array.isArray(parsed) && parsed?.command) parsed = [parsed];

      // ── 🔧 STEP 4: Asset Context Safety Net ──────────────────────────
      const GENERIC_WORDS = new Set([
        'it', 'that', 'this', 'stock', 'stocks', 'asset', 'assets', 'coin', 'crypto',
        'shares', 'share', 'one', 'the', 'them', 'those',
        // THE KEY ADDITIONS - these were causing your "ME" and "AN" bugs:
        'me', 'my', 'an', 'a', 'alert', 'alerts', 'price', 'set'
      ]);

      if (Array.isArray(parsed)) {
        parsed = parsed.map(cmd => {

          // Fix generic asset words using last known context
          if (['price', 'analyze', 'news', 'set', 'bought', 'sold'].includes(cmd.command)) {
            const assetArg = (cmd.args?.[0] || '').toLowerCase().trim();

            if (GENERIC_WORDS.has(assetArg)) {
              if (lastAssets.length > 0) {
                console.log(`🔧 Context fix: "${cmd.args[0]}" → "${lastAssets[0]}"`);
                cmd.args[0] = lastAssets[0];
              } else {
                // No context at all — convert set to a chat question
                if (cmd.command === 'set') {
                  return {
                    command: 'chat',
                    args: ['Which asset would you like to set an alert for? (e.g. BTC below 80000 or ZENITHBANK below 30)']
                  };
                }
                // For price/analyze/news with no context
                return {
                  command: 'chat',
                  args: ['Which asset would you like to check?']
                };
              }
            }
          }

          // Fix "set" command that has a price but no proper asset
          if (cmd.command === 'set') {
            const assetArg = (cmd.args?.[0] || '').toLowerCase().trim();
            if (GENERIC_WORDS.has(assetArg) || assetArg.length <= 1) {
              if (lastAssets.length > 0) {
                console.log(`🔧 Set-alert context fix: "${cmd.args[0]}" → "${lastAssets[0]}"`);
                cmd.args[0] = lastAssets[0];
              } else {
                return {
                  command: 'chat',
                  args: ['Sure! Which asset should I watch? (e.g. BTC below 80000)']
                };
              }
            }
          }

          return cmd;
        });
      }

      // ── 💾 STEP 5: Save Updated Context ──────────────────────────────
      if (Array.isArray(parsed)) {
        const aiChats = parsed.filter(p => p.command === "chat").map(p => p.args[0]);
        userHist.push(aiChats.length > 0 ? `A:${aiChats[0].slice(0, 60)}` : `A:[cmd]`);
        if (userHist.length > 5) userHist.shift();

        // Find ALL asset commands in the response
        const newAssets = parsed
          .filter(p => ['price', 'analyze', 'news', 'set', 'bought', 'sold', 'set_percent'].includes(p.command) && p.args?.[0])
          .map(p => p.args[0]);

        if (newAssets.length > 0) {
          // Add new assets to the front, remove duplicates, and keep the last 5
          lastAssets = [...new Set([...newAssets, ...lastAssets])].slice(0, 5);
        }

        await this.saveUserContext(phone, userHist, lastAssets);
        return parsed;
      }

      return null;
    } catch (error) {
      console.error("Groq API Error:", error.response?.data || error.message);
      if (error.response?.status === 429) {
        return [{ command: "chat", args: ["I'm receiving too many requests right now! 😅 Give me a minute."] }];
      }
      return null;
    }
  }

  async injectBotResponse(phone, responseText) {
    const context = await this.getUserContext(phone);
    let { history: userHist, lastAssets } = context;

    const snippet = responseText.replace(/\n+/g, " ").slice(0, 150) + (responseText.length > 150 ? "..." : "");
    userHist.push(`A:${snippet}`);
    if (userHist.length > 5) userHist.shift();

    await this.saveUserContext(phone, userHist, lastAssets);
  }
  // ==========================================
  // 💎 PREMIUM AI FEATURES
  // ==========================================

  getCurrencySymbol(currencyCode) {
    const symbolMap = { "NGN": "₦", "USD": "$", "GBP": "£", "EUR": "€" };
    return symbolMap[currencyCode?.toUpperCase()] || (currencyCode ? `${currencyCode} ` : "$");
  }

  async analyzeMarket(asset, price, percentChange24h = null, currency = "USD") {
    if (!this.apiKey) return null;

    const cacheKey = `market:${asset}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < 900000) return cached.text; // 15 min cache

    const currPrefix = this.getCurrencySymbol(currency);
    let priceStr = `Current price: ${currPrefix}${price}.`;
    if (percentChange24h) priceStr += ` 24h change: ${percentChange24h}%.`;

    const prompt = `You are a friendly, premium market analyst. 
Write a short 3-sentence market analysis for ${asset}. 
${priceStr} 
Explain it in simple, easy-to-understand terms that a beginner would grasp, while remaining professional. Use 1 or 2 appropriate emojis. Do not use markdown headers, just plain text. Never give financial advice.`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 150
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 8000 }
      );

      const text = response.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        this.cache.set(cacheKey, { text, ts: now });
        return text;
      }
    } catch (e) {
      console.error('Groq Analysis Error:', e.message);
    }
    return null;
  }

  async suggestAlertLevels(asset, currentPrice, currency = "USD") {
    if (!this.apiKey) return null;

    const cacheKey = `levels:${asset}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < 1800000) return cached.levels; // 30 min cache

    const currPrefix = this.getCurrencySymbol(currency);
    const prompt = `Calculate a logical support level and resistance level for ${asset} currently priced at ${currPrefix}${currentPrice}. 
Return exactly in this JSON format strictly, no explanation: {"support": number, "resistance": number}`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 80,
          response_format: { type: "json_object" }
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 8000 }
      );

      const text = response.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.support && parsed.resistance) {
          this.cache.set(cacheKey, { levels: parsed, ts: now });
          return parsed;
        }
      }
    } catch (e) {
      console.error('Groq Alert Suggest Error:', e.message);
    }
    return null;
  }

  async analyzeNewsHeadlines(asset, headlines) {
    if (!this.apiKey || !headlines || headlines.length === 0) return null;

    const cacheKey = `news:${asset}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < 1800000) return cached.text; // 30 min cache

    const headlinesStr = headlines.map((h, i) => `${i + 1}. ${h}`).join("\n");
    const prompt = `You are a crypto news analyst. Here are the top news headlines for ${asset} right now:\n\n${headlinesStr}\n\nWrite a short, engaging 3-point summary (using emojis) of what is happening with ${asset} based ONLY on these headlines. End with a 1-sentence overall sentiment (e.g. Bullish, Bearish, or Neutral).`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 200
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 8000 }
      );

      const text = response.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        this.cache.set(cacheKey, { text, ts: now });
        return text;
      }
    } catch (e) {
      console.error('Groq News Analyst Error:', e.message);
    }
    return null;
  }

  async analyzePortfolio(holdingsSummary, totalValue, dayPnlPct) {
    if (!this.apiKey) return null;

    const cacheKey = `portfolio:${holdingsSummary}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < 900000) return cached.text; // 15 min cache

    const prompt = `You are a personal crypto portfolio analyst. A user's portfolio:
${holdingsSummary}
Total value: $${totalValue.toLocaleString()}
Day change: ${dayPnlPct > 0 ? '+' : ''}${dayPnlPct.toFixed(2)}%

Write 2 short, insightful sentences about their portfolio performance today. Be direct, confident, and use 1-2 emojis. Do not give generic advice. Comment on which asset is strongest/weakest today. Never say "not financial advice" here.`;

    try {
      const response = await axios.post(
        this.apiUrl,
        { model: this.modelName, messages: [{ role: "user", content: prompt }], temperature: 0.35, max_tokens: 120 },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 8000 }
      );
      const text = response.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        this.cache.set(cacheKey, { text, ts: now });
        return text;
      }
    } catch (e) { console.error('Groq Portfolio Error:', e.message); }
    return null;
  }

  async commentOnTrade(asset, quantity, buyPrice, sellPrice, profitPct, winRate) {
    if (!this.apiKey) return null;

    const side = profitPct >= 0 ? 'profit' : 'loss';
    const prompt = `A trader just closed a ${side} trade:
- Asset: ${asset}
- Qty: ${quantity}
- Bought at: $${buyPrice}
- Sold at: $${sellPrice}
- P&L: ${profitPct > 0 ? '+' : ''}${profitPct.toFixed(2)}%
- Their recent win rate: ${winRate}

Write 1 short, punchy, honest sentence (max 20 words) reacting to this trade result. Use 1 emoji. Be real — celebrate wins, commiserate losses. No advice.`;

    try {
      const response = await axios.post(
        this.apiUrl,
        { model: this.modelName, messages: [{ role: "user", content: prompt }], temperature: 0.5, max_tokens: 60 },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 8000 }
      );
      return response.data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) { return null; }
  }

  async generateDailyBrief(marketData, userName = 'Trader') {
    if (!this.apiKey) return null;

    const cacheKey = 'daily_brief';
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && now - cached.ts < 3600000) {
      return cached.text.replace('{{NAME}}', userName);
    }

    const lines = marketData.map(m => `${m.symbol}: $${m.price.toLocaleString()} (${m.change24h >= 0 ? '+' : ''}${m.change24h?.toFixed(1) ?? '?'}%)`).join('\n');
    const prompt = `You are a concise, professional crypto market analyst delivering a morning brief.
Here are current top crypto prices:
${lines}

Write a 3-sentence morning brief in plain text (no markdown headers). Mention the market mood, one bullish and one bearish note. Keep it punchy and relevant. Start with "The market ..."`;

    try {
      const response = await axios.post(
        this.apiUrl,
        { model: this.modelName, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 10000 }
      );
      const text = response.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        this.cache.set(cacheKey, { text: text.replace(userName, '{{NAME}}'), ts: now });
        return text;
      }
    } catch (e) { console.error('Groq Daily Brief Error:', e.message); }
    return null;
  }
}

module.exports = GeminiService;
