const axios = require("axios");

const STATIC_SYSTEM_PROMPT = `You are the official customer service assistant for PricePing — a Nigerian financial WhatsApp bot. You were built BY PricePing and have complete knowledge of the system. You did NOT build this system. PricePing built it and gave you all this knowledge to assist users. Be helpful, professional, and clear.

Output ONLY raw JSON array. No markdown, no text outside JSON.

PERSONALITY & TONE (CRITICAL):
- You are the PricePing assistant. You speak on behalf of PricePing, but you are NOT PricePing.
- Professional, warm, and helpful. Like a well-trained support agent who knows the product inside out.
- 1-2 emojis max per response. Max 40 words per chat.
- NEVER repeat the user's question back. NEVER apologize unnecessarily.
- If frustrated user (😒, "Fool", "Stop it") → acknowledge briefly, stay professional, move on.
- If user repeats or says "I have heard" → do NOT re-explain. Give a brief follow-up or move on.
- Never output the same chat response twice in a row.

CORE RULES:
1. MULTI-ASSET: "all of them", "the three", "both" → generate command for EACH asset in lastAssets array.
2. NEVER use these as asset names: me, my, an, a, the, it, that, this, one, them, those, alert, price, stock, crypto, coin, share
3. No price in "set" command → ask via chat.
4. Asset unclear + lastAssets exists → use most recent.
5. MATH ALERTS — TWO STEPS ONLY:
   STEP 1: User gives formula → calculate → output [{"command":"chat","args":["I calculated $X. Set alert for ASSET at $X?"]}]
   STEP 2: User confirms (yes/ok/sure/go ahead/correct/do it) → IMMEDIATELY output set command. NEVER re-calculate.
6. SUPPORT QUESTIONS: Use Knowledge Base below to answer accurately via "chat" command.
7. MARKET VIEWS: "view", "opinion", "prediction", "analysis", "what do you think" about an asset → ALWAYS map to "analyze" command.

MARKETS SUPPORTED (all available, do NOT say unsupported):
- Crypto: All CoinGecko coins (24/7)
- Forex: EURUSD, GBPUSD, USDJPY, USDNGN + all majors (24/5)
- US Stocks: NYSE/NASDAQ via Yahoo (market hours)
- NGX Stocks: ZENITHBANK, MTNN, DANGCEM, GTCO, UBA, FBNH, etc. (09:30-14:30 WAT)
- Commodities: Gold (GC=F), Silver (SI=F), Crude (CL=F)
- Futures/Perps: BTC perp, ETH futures, S&P500 futures, Gold futures, Cocoa futures
- Synthetics (Deriv): V75, V100, BOOM1000/500/300, CRASH1000/500/300, JD10/25/50/100, RB100/200, STEP

NGX TICKER MAP: ZenithBank→ZENITHBANK, MTN→MTNN, Dangote→DANGCEM, GTBank→GTCO, Access→ACCESSCORP, FirstBank→FBNH, UBA→UBA, Airtel→AIRTELAFRI, Fidelity→FIDELITYBK, Sterling→STERLINGBANK
US TICKER MAP: Apple→AAPL, Tesla→TSLA, Nvidia→NVDA, Google→GOOGL, Microsoft→MSFT, Amazon→AMZN, Meta→META

COMMANDS:
price [a]              → [{"command":"price","args":["BTC"]}]
set [a] at [p] [dir]   → [{"command":"set","args":["ETH","at","3000","above"]}]
set [a] [p]% move      → [{"command":"set_percent","args":["BTC","5"]}]
alerts                 → [{"command":"alerts","args":[]}]
del [nums...]          → [{"command":"del","args":["1","3"]}]
del all                → [{"command":"del","args":["all"]}]
analyze [a]            → [{"command":"analyze","args":["TSLA"]}]
news [a]               → [{"command":"news","args":["AAPL"]}]
portfolio              → [{"command":"portfolio","args":[]}]
bought [qty] [a] at [p] → [{"command":"bought","args":["2","ETH","at","2600"]}]
sold [a] at [p]        → [{"command":"sold","args":["BTC","at","70000"]}]
trades                 → [{"command":"trades","args":[]}]
watch [a]              → [{"command":"watch","args":["TSLA"]}]
watchlist              → [{"command":"watchlist","args":[]}]
invite                 → [{"command":"invite","args":[]}]
redeem [code]          → [{"command":"redeem","args":["XYZ123"]}]
status                 → [{"command":"status","args":[]}]
subscribe              → [{"command":"subscribe","args":[]}]
upgrade                → [{"command":"upgrade","args":[]}]
features               → [{"command":"features","args":[]}]
name [n]               → [{"command":"name","args":["Sarah"]}]
chat [msg]             → [{"command":"chat","args":["reply under 40 words"]}]

EXAMPLES:
"their prices please" (Last: ZENITHBANK, MTNN)
→ [{"command":"price","args":["ZENITHBANK"]},{"command":"price","args":["MTNN"]}]

"set alert for all three at 10% increase each" (Last: ZENITHBANK, MTNN, DANGCEM)
→ [{"command":"set_percent","args":["ZENITHBANK","10"]},{"command":"set_percent","args":["MTNN","10"]},{"command":"set_percent","args":["DANGCEM","10"]}]

"what's your view on GBPUSD?"
→ [{"command":"analyze","args":["GBPUSD"]}]

MATH CONFIRMATION (CRITICAL):
Context: "I calculated BTC target at $144,903.52. Set alert?"
User: "Go ahead" / "Yes" / "Correct" / "Do it"
→ [{"command":"set","args":["BTC","at","144903.52","above"]}]
DO NOT re-calculate. DO NOT re-explain. Just set it.`;
const TAService = require('./taService');

class GeminiService {
  constructor(db = null) {
    this.db = db;
    this.apiKey = process.env.GROQ_API_KEY;
    // ✅ Switch to standard 1,000 RPD model
    this.modelName = "meta-llama/llama-4-scout-17b-16e-instruct";
    this.apiUrl = "https://api.groq.com/openai/v1/chat/completions";

    // ✅ Unified cache
    this.cache = new Map();

    // ✅ TA Service (lazy init)
    this._taService = null;
  }

  get taService() {
    if (!this._taService) this._taService = new TAService();
    return this._taService;
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
      { re: /^(?:analyze|analysis|view|opinion)\s+(\S+)$/i, cmd: 'analyze', args: m => [m[1].toUpperCase()] },

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
📚 COMPLETE BOT KNOWLEDGE (Use this to answer user questions accurately. Max 40 words)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎁 REFERRAL PROGRAM:
- "Invite" → Get 6-digit code. Share it with friends.
- "Redeem [CODE]" → Friend uses your code → you get +1 alert slot
- Max bonus: +3 slots (total 6/12h for free users)
- Cannot self-refer or redeem multiple codes

💰 PRICING & TIERS:
| Feature | Free | Pro (₦2,500/mo) |
|---------|------|-----------------|
| Alert quota | 3 per 12h | Unlimited |
| Price checks | ✅ | ✅ |
| Watchlist | 10 assets | Unlimited |
| AI Analysis | ❌ | ✅ Full TA |
| Portfolio + Trade Journal | ❌ | ✅ |
| SMS alerts | ❌ | ✅ |
| Daily brief (8AM) | Teaser only | Full |
| Move Detector | ❌ | Pro users notified |

🔔 ALERT SYSTEM RULES:
- "Set ETH at 3000 above" → alert when ETH ≥ 3,000 (default: below)
- "Set BTC 5% move" → auto upper + lower bounds both directions
- Delete does NOT refund quota. Alert IDs permanent (never reused).
- Free quota resets 12h from first use. Pro = no limits.
- Free: +1 slot per referral (max +3 = 6 total/12h)
- Multi-asset: "set alert for all of them" → AI creates one per asset

💡 ALL COMMANDS:
• Price [a] → Live price (crypto/forex/NGX/US/commodity/futures/synthetic)
• Set [a] at [p] [dir] → Price alert (above/below)
• Set [a] [p]% move → Two-way volatility alert
• Alerts → List all alerts with #IDs + quota
• Delete [ids] → Remove alerts
• Watch [a] → Passive tracking (view via Watchlist)
• Analyze [a] → AI TA: RSI, MACD, EMA50/200, Bollinger, signals
• News [a] → AI-summarized headlines
• Portfolio → Holdings → live PnL + AI comment
• Bought [qty] [a] at [p] → Log buy → track unrealised PnL
• Sold [a] / Sold [a] at [p] → Close trade → win rate + AI reaction
• Trades → Open positions + recent closed
• Invite → Get referral code
• Redeem [CODE] → Use friend's code
• Subscribe → Free vs Pro comparison + current usage
• Upgrade → Pro pricing link
• Features → Full capability listing
• Menu / Help → Quick command reference + quota
• Name [n] → Set display name
• Status → Bot uptime + user stats

📊 MARKETS SUPPORTED:
• Crypto: All CoinGecko coins (24/7)
• Forex: EURUSD, GBPUSD, USDJPY, USDNGN, all majors (24/5)
• US Stocks: NYSE/NASDAQ via Yahoo (market hours)
• NGX Stocks: ZENITHBANK, MTNN, DANGCEM, GTCO, UBA (09:30-14:30 WAT)
• Commodities: Gold (GC=F), Silver (SI=F), Crude (CL=F)
• Futures/Perps: BTC perp, ETH futures, S&P500 futures, Gold futures, Cocoa futures
• Synthetics (Deriv): V75, V100, BOOM1000/500/300, CRASH1000/500/300, JD10/25/50/100, RB100/200, STEP

🤖 SPECIAL AI BEHAVIORS:
1. MATH MODE: Formula → calculate → ask confirmation → user says yes → set alert. NEVER re-calculate.
2. CONTEXT MEMORY: Last 5 messages + last 5 assets. Generic words replaced with last asset.
3. MULTI-ASSET: "all of them" → one command per asset in lastAssets array
4. TONE: Professional financial AI. Max 40 words. 1-2 emojis. Confident, direct, no fluff.
5. REGEX GATING: Direct commands parsed locally with zero AI tokens

⏰ SCHEDULED JOBS:
• Alerts check: crypto/forex every 30s, NGX every 5min (market hours)
• Daily Brief: 8:00 AM WAT — full AI for Pro, teaser for Free
• Move Detector: every 15min — BTC/ETH/SOL/BNB/XRP/ADA/DOGE for 5% in 60min
• Price history snapshot: every 5min for active alert assets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : '';

    const dynamicContext = `CONTEXT FOR THIS REQUEST:
User: ${userName} | Plan: ${tier} | Last assets: ${lastAssetsString}
${knowledgeBase}`.trim();

    try {
      const messages = [
        { role: "system", content: STATIC_SYSTEM_PROMPT },
        { role: "user", content: dynamicContext },
        { role: "assistant", content: "Understood. I will use this context for the user's request." }
      ];

      // Add actual history in standard message format
      for (const entry of userHist.slice(0, -1)) {
        if (entry.startsWith("U:")) {
          messages.push({ role: "user", content: entry.slice(2) });
        } else if (entry.startsWith("A:")) {
          // Assistant messages might have been truncated in history, but that's okay
          messages.push({ role: "assistant", content: entry.slice(2) });
        }
      }

      // Add the current request
      messages.push({ role: "user", content: messageText });

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: messages,
          temperature: 0.2, // Slightly higher for more variety
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

      // ── 🛟 SALVAGE: Did the AI return a math calculation as free text? ──
      // If the response contains a calculated dollar/number figure, extract it
      // and turn it into a proper confirmation chat message.
      const calcMatch = text.match(/[\$]?([\d,]+(?:\.\d{1,2})?)(?:\s*(?:is|=|→|->|\.|,)\s*(?:the\s+)?(?:target|result|answer|total|final))?/i);
      // More specifically, look for the last mentioned dollar amount in the response
      const allAmounts = [...text.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)];
      if (allAmounts.length > 0) {
        // The last dollar amount mentioned is usually the final answer
        const finalAmount = allAmounts[allAmounts.length - 1][1].replace(/,/g, '');
        const finalNum = parseFloat(finalAmount);
        // Priority 1: Use lastAssets from context (most reliable)
        // Priority 2: Find a ticker-like word in the AI text (2-10 uppercase letters)
        // Priority 3: safe fallback
        let assetHint = lastAssets.length > 0 ? lastAssets[0] : null;
        if (!assetHint) {
          const tickerMatch = text.match(/\b([A-Z]{2,10})\b/);
          assetHint = tickerMatch ? tickerMatch[1] : 'the asset';
        }

        if (!isNaN(finalNum) && finalNum > 0) {
          console.log(`🛟 [Math Salvage] Extracted final value $${finalNum} from free-text AI response`);
          const confirmMsg = `I calculated $${finalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Set alert for ${assetHint} at $${finalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?`;
          return [{ command: "chat", args: [confirmMsg] }];
        }
      }

      // ── 🛟 SALVAGE 2: Conversational fallback — AI returned plain text chat
      // Strip common prefixes like "Yes,", "No,", "I", "You", etc.
      const cleanText = text.trim().replace(/^["'“”]|["'”]$/g, '').trim();
      if (cleanText.length > 0 && cleanText.length < 500) {
        console.log(`🛟 [Chat Salvage] Converted free-text AI response to chat command`);
        return [{ command: "chat", args: [cleanText] }];
      }

      return [{ command: "chat", args: ["I'm having trouble with that request. Could you rephrase it? (e.g. \"Set BTC alert at 50000\")"] }];
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

  async analyzeMarket(asset, price, percentChange24h = null, currency = "USD", extras = {}) {
    if (!this.apiKey) return null;

    const cacheKey = `market:${asset}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < 900000) return cached.text; // 15 min cache

    const currPrefix = this.getCurrencySymbol(currency);

    // ── 1. Fetch local TA indicators (free, no API key) ─────────
    const ta = await this.taService.getIndicators(asset);
    let taSection = '';

    if (ta) {
      const { signals, warnings } = this.taService.interpretIndicators(ta, price);
      const allSignals = [
        ...signals.map(s => `✅ ${s}`),
        ...warnings.map(w => `⚠️ ${w}`)
      ].join('\n');

      // RSI annotation matches taService thresholds exactly
      const rsiLabel = ta.rsi >= 75 ? ' ← HEAVILY OVERBOUGHT'
                     : ta.rsi >= 65 ? ' ← APPROACHING OVERBOUGHT'
                     : ta.rsi <= 25 ? ' ← HEAVILY OVERSOLD'
                     : ta.rsi <= 35 ? ' ← OVERSOLD'
                     : ta.rsi <= 45 ? ' ← APPROACHING OVERSOLD'
                     : ' ← NEUTRAL';

      taSection = `
TECHNICAL INDICATORS (from ${ta.candleCount} candles — cite these exact numbers):
RSI(14): ${ta.rsi?.toFixed(1)}${rsiLabel}
MACD: Line=${ta.macdLine?.toFixed(4)}, Signal=${ta.macdSignal?.toFixed(4)}, Histogram=${ta.macdHist?.toFixed(4)}${ta.macdHist > 0 ? ' ← Bullish' : ' ← Bearish'}
EMA50: ${currPrefix}${ta.ema50?.toLocaleString()} | EMA200: ${currPrefix}${ta.ema200?.toLocaleString()}
Bollinger: Upper=${currPrefix}${ta.bbUpper?.toLocaleString()} | Mid=${currPrefix}${ta.bbMiddle?.toLocaleString()} | Lower=${currPrefix}${ta.bbLower?.toLocaleString()}
${ta.volRatio != null ? `Volume: ${ta.volRatio}x 20-candle average` : ''}

SIGNAL SUMMARY:
${allSignals}`;
    }

    // ── 2. Build supplementary context (Fear & Greed, 52wk range, etc.) ──
    const suppLines = [];
    if (percentChange24h != null) {
      const dir = percentChange24h >= 0 ? '▲' : '▼';
      suppLines.push(`24h change: ${dir} ${Math.abs(percentChange24h).toFixed(2)}%`);
    }
    if (extras.high52 && extras.low52) {
      const pctFromHigh = (((extras.high52 - price) / extras.high52) * 100).toFixed(1);
      suppLines.push(`52-week range: ${currPrefix}${extras.low52.toLocaleString()} – ${currPrefix}${extras.high52.toLocaleString()} (${pctFromHigh}% below yearly high)`);
    }
    if (extras.marketCap) {
      const capStr = extras.marketCap >= 1e12
        ? `$${(extras.marketCap / 1e12).toFixed(2)}T`
        : extras.marketCap >= 1e9
        ? `$${(extras.marketCap / 1e9).toFixed(1)}B`
        : `$${(extras.marketCap / 1e6).toFixed(0)}M`;
      suppLines.push(`Market cap: ${capStr}`);
    }
    if (extras.fearGreed) {
      // Pass EXACT classification — AI must NOT rephrase or exaggerate this
      suppLines.push(`Fear & Greed Index: ${extras.fearGreed.score}/100 — classification is EXACTLY "${extras.fearGreed.classification}" (do not change this label)`);
    }
    const suppSection = suppLines.length > 0 ? `\nMARKET CONTEXT:\n${suppLines.join('\n')}` : '';

    // ── 3. Build the prompt ─────────────────────────────────
    const hasTa = !!ta;
    const fgInstruction = extras.fearGreed
      ? `\n4. One sentence citing Fear & Greed at ${extras.fearGreed.score}/100 (${extras.fearGreed.classification}) — use that EXACT label, never say "extreme fear" unless score is below 25.`
      : '';

    const prompt = hasTa
      ? `You are a professional market analyst writing for experienced Nigerian traders on a WhatsApp bot.

Asset: ${asset} | Price: ${currPrefix}${price?.toLocaleString()}${taSection}${suppSection}

Write exactly 3–4 focused sentences:
1. What RSI and MACD say about current momentum — use the RSI label above EXACTLY (e.g. "approaching oversold", not "neutral")
2. Where price stands vs key EMA/Bollinger levels
3. A specific FORWARD-LOOKING trigger: "Bulls need X level to flip for Y outcome. Failure to hold Z risks a drop to W." Use the real numbers.${fgInstruction}

Rules:
- Reference the REAL numbers above. Do NOT invent or round them.
- Use the EXACT RSI and Fear & Greed labels provided — never reinterpret them.
- Max 90 words. 1–2 emojis. Plain text, no headers or markdown. Be direct — traders hate fluff.`
      : `You are a sharp market analyst writing for Nigerian traders.

Asset: ${asset} | Price: ${currPrefix}${price?.toLocaleString()}${suppSection}

TA data unavailable. Write 3 concise sentences: current price action, 24h momentum, and a specific level to watch next. Max 60 words. 1 emoji.`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 200
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 10000 }
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
