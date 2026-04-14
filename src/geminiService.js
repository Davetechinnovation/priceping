const axios = require("axios");

class GeminiService {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.modelName = "meta-llama/llama-4-scout-17b-16e-instruct";
    this.apiUrl = "https://api.groq.com/openai/v1/chat/completions";
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async refinePrompt(messageText, isPro = false, phone = "default", userName = "VIP") {
    if (!this.apiKey) return null;

    if (!this.history) this.history = new Map();
    if (!this.lastAsset) this.lastAsset = new Map(); // Track last mentioned asset per user
    let userHist = this.history.get(phone) || [];
    userHist.push(`U:${messageText}`);
    if (userHist.length > 5) userHist.shift();
    this.history.set(phone, userHist);

    const lastAsset = this.lastAsset.get(phone) || null;

    // ── Ultra-compact system prompt (~650 tokens vs previous ~2600) ──────────────
    const tier = isPro ? "PRO" : "FREE";
    const systemPrompt = `PricePing AI: WhatsApp command router. Output ONLY a raw JSON array. No markdown, no text.
User plan: ${tier}. Markets: Crypto, US Stocks (NYSE/NASDAQ), Nigerian Stocks (NGX), Forex, Commodities.
NGX tickers: MTN/MTNNigeria→MTNN, Zenith/ZenithBank→ZENITHBANK, Dangote→DANGCEM, GTB/GtBank/GuarantyTrust→GTCO, AccessBank→ACCESSCORP, FirstBank/FBN→FBNH, UBA→UBA, Airtel→AIRTELAFRI.
US shortcuts: Apple→AAPL, Tesla→TSLA, Nvidia→NVDA, Google/Alphabet→GOOGL, Microsoft→MSFT, Amazon→AMZN, Meta/Facebook→META.

Commands (return as JSON array — ONLY the matching command):
price [asset]: "btc price"→[{"command":"price","args":["BTC"]}] | "apple stock"→[{"command":"price","args":["AAPL"]}] | "mtn price"→[{"command":"price","args":["MTNN"]}]
set [a] at [p] [above|below]: "eth above 3000"→[{"command":"set","args":["ETH","at","3000","above"]}] | "aapl below 180"→[{"command":"set","args":["AAPL","at","180","below"]}]
alerts: "my alerts"→[{"command":"alerts","args":[]}]
del [n]: "remove 2"→[{"command":"del","args":["2"]}]
name [n]: "i'm dan"→[{"command":"name","args":["dan"]}]
status: "bot status"→[{"command":"status","args":[]}]
subscribe: "my plan"→[{"command":"subscribe","args":[]}]
upgrade: "go pro"→[{"command":"upgrade","args":[]}]
features: "what can you do"→[{"command":"features","args":[]}] | "pro features"→[{"command":"features","args":[]}]
analyze [asset] (Pro): "analyze tesla"→[{"command":"analyze","args":["TSLA"]}] | "thoughts on MTNN"→[{"command":"analyze","args":["MTNN"]}]
news [asset] (Pro): "apple news"→[{"command":"news","args":["AAPL"]}] | "btc news"→[{"command":"news","args":["BTC"]}]
portfolio (Pro): "my holdings"→[{"command":"portfolio","args":[]}]
bought [qty] [a] at [p]: "bought 5 TSLA at 200"→[{"command":"bought","args":["5","TSLA","at","200"]}]
sold [a] at [p]: "sold BTC at 70000"→[{"command":"sold","args":["BTC","at","70000"]}]
trades: "my trades"→[{"command":"trades","args":[]}]
chat [answer text]: Generate a helpful, human-like reply (≤30 words) to the user's greeting or question. DO NOT repeat their message. You are an elite financial assistant. Address the user as "${userName}". ${tier==="FREE"?"Tease them about upgrading to Pro (only ₦2,000) for full AI analysis and news.":""} If "what can you do" → use features command instead. If analyze/news/price but NO asset given → ask for the ticker via chat.
CONTEXT RULE: If user says "it", "that", "this one", refer to Context. Last known asset: ${lastAsset || "none"}.`;

    try {
      const recentCtx = userHist.slice(0, -1).join(" | "); // Last 4 messages as compact context
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
          max_tokens: 280  // JSON command arrays are tiny; 280 is plenty
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
      // Extract JSON array or object if the AI hallucinated extra text
      const match = text.match(/\[.*\]/s) || text.match(/\{.*\}/s);
      if (match) {
        jsonStr = match[0];
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse JSON from AI:", text);
        return [{ command: "chat", args: ["I'm having trouble analyzing that request right now. Try keeping it simple!"] }];
      }

      // Groq json_object mode returns an object — unwrap if needed
      if (!Array.isArray(parsed)) {
        parsed = parsed.commands || parsed.result || Object.values(parsed)[0];
      }
      if (!Array.isArray(parsed) && parsed?.command) parsed = [parsed];

      // ── Code-level safety net ────────────────────────────────────────────────
      // If AI resolves asset as a generic word ("stock", "it", "that", "this"),
      // replace it with the last known asset for this user.
      const GENERIC_WORDS = new Set([
        'it','that','this','stock','stocks','asset','assets','coin','crypto',
        'shares','share','one','the','them','those','airtel','this stock','that stock'
      ]);
      if (Array.isArray(parsed) && lastAsset) {
        parsed = parsed.map(cmd => {
          if (['price','analyze','news','set','bought','sold'].includes(cmd.command)) {
            const assetArg = (cmd.args?.[0] || '').toLowerCase().trim();
            if (GENERIC_WORDS.has(assetArg)) {
              console.log(`🔧 Context fix: "${cmd.args[0]}" → "${lastAsset}" (last asset)`);
              cmd.args[0] = lastAsset;
            }
          }
          return cmd;
        });
      }
      // ────────────────────────────────────────────────────────────────────────

      if (Array.isArray(parsed)) {
        const aiChats = parsed.filter(p => p.command === "chat").map(p => p.args[0]);
        userHist.push(aiChats.length > 0 ? `A:${aiChats[0].slice(0,60)}` : `A:[cmd]`);
        if (userHist.length > 5) userHist.shift();
        this.history.set(phone, userHist);

        // Track the last referenced asset for context-aware follow-ups
        const assetCmd = parsed.find(p => ['price','analyze','news','set','bought','sold'].includes(p.command));
        if (assetCmd && assetCmd.args && assetCmd.args[0]) {
          this.lastAsset.set(phone, assetCmd.args[0]);
        }
        return parsed;
      } else if (parsed && parsed.command) {
        userHist.push(parsed.command === "chat" ? `A:${parsed.args[0].slice(0,60)}` : `A:[cmd]`);
        if (userHist.length > 5) userHist.shift();
        this.history.set(phone, userHist);
        if (['price','analyze','news','set','bought','sold'].includes(parsed.command) && parsed.args[0]) {
          this.lastAsset.set(phone, parsed.args[0]);
        }
        return [parsed];
      }

      return null;
    } catch (error) {
      console.error("Groq API Error:", error.response?.data || error.message);
      if (error.response && error.response.status === 429) {
        return [{ command: "chat", args: ["I am receiving too many requests right now! 😅 Please give me a minute and try again."] }];
      }
      return null;
    }
  }

  // Inject raw bot responses directly into the AI history so it stays fully context-aware
  injectBotResponse(phone, responseText) {
    if (!this.history) this.history = new Map();
    let userHist = this.history.get(phone) || [];
    // Only capture a short snippet to save tokens
    const snippet = responseText.replace(/\n+/g, " ").slice(0, 150) + (responseText.length > 150 ? "..." : "");
    userHist.push(`A:${snippet}`);
    if (userHist.length > 5) userHist.shift();
    this.history.set(phone, userHist);
  }
  // ==========================================
  // 💎 PREMIUM AI FEATURES
  // ==========================================
  // ==========================================
  // 💎 PREMIUM AI FEATURES
  // ==========================================

  async analyzeMarket(asset, price, percentChange24h = null, currency = "USD") {
    if (!this.apiKey) return null;
    if (!this._marketCache) this._marketCache = new Map();
    
    const now = Date.now();
    const cached = this._marketCache.get(asset);
    if (cached && now - cached.ts < 900000) { // 15 min cache
      return cached.text;
    }

    const currPrefix = currency === "USD" ? "$" : `${currency} `;
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
        this._marketCache.set(asset, { text, ts: now });
        return text;
      }
    } catch(e) {
      console.error('Groq Analysis Error:', e.message);
    }
    return null;
  }

  async suggestAlertLevels(asset, currentPrice, currency = "USD") {
    if (!this.apiKey) return null;
    if (!this._alertCache) this._alertCache = new Map();

    const now = Date.now();
    const cached = this._alertCache.get(asset);
    if (cached && now - cached.ts < 1800000) { // 30 min cache
      return cached.levels; // { support, resistance }
    }

    const currPrefix = currency === "USD" ? "$" : `${currency} `;
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
          this._alertCache.set(asset, { levels: parsed, ts: now });
          return parsed;
        }
      }
    } catch(e) {
      console.error('Groq Alert Suggest Error:', e.message);
    }
    return null;
  }
  async analyzeNewsHeadlines(asset, headlines) {
    if (!this.apiKey || !headlines || headlines.length === 0) return null;
    if (!this._newsCache) this._newsCache = new Map();

    const now = Date.now();
    const cached = this._newsCache.get(asset);
    if (cached && now - cached.ts < 1800000) { // 30 min cache
      return cached.text;
    }

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
        this._newsCache.set(asset, { text, ts: now });
        return text;
      }
    } catch(e) {
      console.error('Groq News Analyst Error:', e.message);
    }
    return null;
  }
  async analyzePortfolio(holdingsSummary, totalValue, dayPnlPct) {
    if (!this.apiKey) return null;
    if (!this._portfolioCache) this._portfolioCache = new Map();

    const cacheKey = holdingsSummary;
    const now = Date.now();
    const cached = this._portfolioCache.get(cacheKey);
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
        this._portfolioCache.set(cacheKey, { text, ts: now });
        return text;
      }
    } catch(e) { console.error('Groq Portfolio Error:', e.message); }
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
    } catch(e) { return null; }
  }

  async generateDailyBrief(marketData, userName = 'Trader') {
    if (!this.apiKey) return null;
    if (!this._briefCache) this._briefCache = { text: null, ts: 0 };

    const now = Date.now();
    if (this._briefCache.text && now - this._briefCache.ts < 3600000) {
      // Return cached brief with personalised name swapped in
      return this._briefCache.text.replace('{{NAME}}', userName);
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
        this._briefCache = { text: text.replace(userName, '{{NAME}}'), ts: now };
        return text;
      }
    } catch(e) { console.error('Groq Daily Brief Error:', e.message); }
    return null;
  }
}

module.exports = GeminiService;
