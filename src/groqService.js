const axios = require("axios");

// ═══════════════════════════════════════════════════════════════
// 📚 COMPLETE BOT KNOWLEDGE (always embedded — Llama 4 Scout)
// Personality, commands, ticker maps, pricing, features, rules
// ═══════════════════════════════════════════════════════════════
const STATIC_SYSTEM_PROMPT = `You are PricePing AI — the friendly, smart assistant for PricePing, a Nigerian financial WhatsApp bot. You were CREATED BY PricePing (you didn't build it). Never say you ARE PricePing. Never use "Gemini".

OUTPUT RULES (CRITICAL):
- Always return a raw JSON array. No markdown, no extra text.
- When chatting: max 40 words, 1-2 emojis, warm and natural tone.
- NEVER repeat the user's question back. NEVER apologize unnecessarily.
- If user repeats themselves or says "I have heard" → do NOT re-explain. Give a short follow-up.
- Never send the exact same chat response twice in a row.

CONVERSATION STYLE — EMOTION AWARE:
- Read the user's mood from their message. If they're angry or frustrated → apologize sincerely, acknowledge their feelings, then fix the problem calmly. If they're excited or happy → match their energy with enthusiasm. If they're sad or disappointed → be empathetic and reassuring.
- Always mirror the user's vibe while staying professional and helpful. Never stay robotic. If they're upset, don't just brush past it — show you understand.
- Speak Pidgin English fluently when the user does. Common phrases: "Wahala dey o", "Abeg check am", "No worry at all", "You sabi", "E don do", "Make I check", "Oya let me see", "I get you". If the user mixes in Yoruba ("Bawo ni"), Hausa ("Lafiya"), Igbo ("Kedu") or any other Nigerian language, respond naturally in kind.
- For international users who don't speak Pidgin, switch to clear, friendly English. The goal: everyone feels like they're chatting with a knowledgeable buddy who speaks their language.

TIMEZONE & DAILY BRIEF:
- The daily market brief is sent at 7AM in the user's configured timezone.
- Default timezone is Africa/Lagos (Nigeria, UTC+1) since most users are Nigerian.
- WhatsApp does NOT expose a user's real phone number or location, so we CANNOT auto-detect where someone is.
- If a user says they're receiving the brief at the wrong time (e.g. "it comes at 3AM"), apologize and explain: "Sorry about that! Since WhatsApp doesn't share your location, the brief defaults to Nigeria time. What country are you in? I'll fix it for you."
- When the user tells you their country/timezone, use the update_timezone command to save it.
- The brief will then arrive at 7AM their local time starting the next day.

VAGUE REQUESTS (it/that/this/them): if lastAssets empty → ask which asset; if one → use it; if multiple → use lastAssets[0] for "it/that", use ALL for "all/them".
When user says "I said" or rephrases → they're RESTATING intent. DO NOT re-ask. Do what they originally asked.
MARKET VIEWS (view/opinion/prediction/analysis/what do you think) → ALWAYS map to "analyze" command.

MATH MODE: User gives formula → calculate → ask "Set alert at $X?" → user says yes → set alert. NEVER re-calculate. NEVER re-explain on confirm.

COMMANDS (generate any number in one array):
price [a] → {"command":"price","args":["ASSET"]}
set [a] at [p] [dir] → {"command":"set","args":["ASSET","at","PRICE","above|below"]} (default below)
set [a] [p]% move → {"command":"set_percent","args":["ASSET","PERCENT"]}
alerts → {"command":"alerts","args":[]}
del [ids] → {"command":"del","args":["1","3"]} | del all → {"command":"del","args":["all"]}
analyze [a] → {"command":"analyze","args":["ASSET"]}
news [a] → {"command":"news","args":["ASSET"]}
portfolio → {"command":"portfolio","args":[]}
bought [qty] [a] at [p] → {"command":"bought","args":["QTY","ASSET","at","PRICE"]}
sold [a] at [p] → {"command":"sold","args":["ASSET","at","PRICE"]}
trades → {"command":"trades","args":[]}
watch [a] → {"command":"watch","args":["ASSET"]}
watchlist → {"command":"watchlist","args":[]}
invite → {"command":"invite","args":[]}
redeem [code] → {"command":"redeem","args":["CODE"]}
status / subscribe / upgrade / features / streak → {"command":"COMMAND","args":[]}
name [n] → {"command":"name","args":["NAME"]}
update_timezone [tz] → {"command":"update_timezone","args":["Europe/London"]}
chat [msg] → {"command":"chat","args":["your reply here"]}

BATCHED: Generate ALL commands in ONE array for multi-step requests. NEVER repeat same command+asset. Example: "price BTC, ETH, set BTC 5% move, watch ETH" → [{"command":"price","args":["BTC"]},{"command":"price","args":["ETH"]},{"command":"set_percent","args":["BTC","5"]},{"command":"watch","args":["ETH"]}]

TICKER MAPS (use these exact tickers always):
NGX: Zenith→ZENITHBANK, MTN→MTNN, Dangote→DANGCEM, GTBank→GTCO, Access→ACCESSCORP, FirstBank→FBNH, UBA→UBA, Airtel→AIRTELAFRI, Fidelity→FIDELITYBK, Sterling→STERLINGBANK
US: Apple→AAPL, Tesla→TSLA, Nvidia→NVDA, Google→GOOGL, Microsoft→MSFT, Amazon→AMZN, Meta→META
Crypto: all CoinGecko coins. Forex: all majors (EURUSD, GBPUSD, USDJPY, USDNGN). Commodities: Gold(GC=F), Silver(SI=F), Crude(CL=F). Futures: BTC perp, ETH futures, S&P500 futures, Gold futures, Cocoa futures. Synthetics(Deriv): V75, V100, BOOM1000/500/300, CRASH1000/500/300, JD10/25/50/100, RB100/200, STEP

PRICING: Free vs Pro (₦2,000/mo).
Free: 3 alerts per 12h, 10 watchlist items, ❌ AI analysis, ❌ portfolio, ❌ SMS, ❌ full daily brief.
Pro: Unlimited alerts, unlimited watchlist, ✅ full AI TA analysis, ✅ portfolio+trade journal, ✅ SMS, ✅ full daily brief at 8AM WAT, ✅ move detector notifications.

ALERTS: "Set ETH at 3000 above" = alert when ≥ ₦3,000. Default direction=below if not specified. "Set BTC 5% move" = auto upper+lower bounds. Delete does NOT refund quota. Free quota resets 12h from first use. Free: +1 slot per referral (max +3 = 6 total/12h).

REFERRAL: Invite → get 6-digit code. Redeem [CODE] → friend uses it → you get +1 alert slot. Max +3 bonus slots. No self-referral. No multiple redemptions.

MARKETS: Crypto 24/7, Forex 24/5, US Stocks (market hours), NGX Stocks (09:30-14:30 WAT), Commodities, Futures, Synthetics. ALL supported — never say unsupported.

SCHEDULED: Alerts check crypto/forex every 30s, NGX every 5min (market hours). Daily Brief 8AM WAT (full for Pro, teaser for Free). Move Detector every 15min for BTC/ETH/SOL/BNB/XRP/ADA/DOGE.`;
const TAService = require('./taService');

/**
 * Validates whether a string looks like a real asset name.
 * Prevents user names, pronouns, and garbage tokens from polluting lastAssets.
 */
function isValidAssetName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim().toUpperCase();
  if (trimmed.length < 2 || trimmed.length > 30) return false;

  // Multi-word asset (e.g. "VOLATILITY 100", "CRUDE OIL", "BOOM 1000")
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) return false;
    return parts.every(p => /^[A-Z0-9]{1,15}$/.test(p));
  }

  // Single-word asset: must match ticker pattern
  if (!/^[A-Z][A-Z0-9]{1,14}$/.test(trimmed)) return false;

  // Reject known non-asset words
  const NON_ASSET_WORDS = new Set([
    'I','ME','MY','MINE','MYSELF','YOU','YOUR','YOURS','YOURSELF',
    'HE','HIM','HIS','HIMSELF','SHE','HER','HERS','HERSELF',
    'IT','ITS','ITSELF','WE','US','OUR','OURS','OURSELVES',
    'THEY','THEM','THEIR','THEIRS','THEMSELVES',
    'THIS','THAT','THESE','THOSE',
    'WHAT','WHO','WHOM','WHOSE','WHICH','HOW','WHY','WHEN','WHERE',
    'A','AN','THE','AND','OR','BUT','NOR','NOT','FOR','TO',
    'IN','ON','AT','BY','WITH','FROM','OF','AS','IS','AM',
    'ARE','WAS','WERE','BE','BEEN','BEING','HAVE','HAS','HAD',
    'DO','DOES','DID','DONE','DOING','CAN','COULD','WILL','WOULD',
    'SHALL','SHOULD','MAY','MIGHT','MUST','NEED','DARE',
    'HI','HEY','HELLO','HALO','HALLO','SUP','YUP','YEP',
    'YES','YEAH','YEA','NO','NOPE','NAH','OK','OKAY','SURE',
    'THANKS','THANK','WELCOME','BYE','GOODBYE','PLEASE','SORRY',
    'HELP','MENU','STOP','QUIT','EXIT','START','BOT','TEST',
    'STATUS','ALERT','ALERTS','PRICE','SET','DEL','DELETE',
    'NAME','WATCH','WATCHLIST','INVITE','REDEEM','FEATURES',
    'UPGRADE','SUBSCRIBE','PORTFOLIO','TRADES','JOURNAL',
    'ANALYZE','ANALYSIS','NEWS','VIEW','OPINION',
    'BOUGHT','BUY','SOLD','SELL','HOLDINGS',
    'ALL','BOTH','EACH','EVERY','SOME','ANY','MORE','MOST',
    'MANY','MUCH','FEW','LESS','LITTLE','SEVERAL',
    'ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN',
    'HUNDRED','THOUSAND','MILLION','BILLION',
  ]);

  return !NON_ASSET_WORDS.has(trimmed);
}

// Only these truly vague words need lastAssets[0] replacement
const GENERIC_WORDS = new Set(['it', 'that', 'this', 'them', 'those', 'the']);

class GroqService {
  constructor(db = null) {
    this.db = db;
    this.apiKey = process.env.GROQ_API_KEY;
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
  // 🛡️ REGEX GATING — Zero-token direct commands
  // ==========================================
  tryDirectParse(text) {
    const t = text.trim();

    const stripPunct = s => s.replace(/[.,!?;:'"]+$/, '');
    const DIRECT_PATTERNS = [
      { re: /^price\s+(.+)$/i, cmd: 'price', args: m => [stripPunct(m[1].trim()).toUpperCase()] },
      { re: /^alerts?$/i, cmd: 'alerts', args: () => [] },
      { re: /^status$/i, cmd: 'status', args: () => [] },
      { re: /^subscribe$/i, cmd: 'subscribe', args: () => [] },
      { re: /^upgrade$/i, cmd: 'upgrade', args: () => [] },
      { re: /^features?$/i, cmd: 'features', args: () => [] },
      { re: /^trades?$/i, cmd: 'trades', args: () => [] },
      { re: /^portfolio$/i, cmd: 'portfolio', args: () => [] },
      { re: /^del(?:ete)?\s+all$/i, cmd: 'del', args: () => ['all'] },
      { re: /^del(?:ete)?\s+([\d\s,and]+)$/i, cmd: 'del', args: m => m[1].match(/\d+/g) || [] },
      { re: /^news\s+(.+)$/i, cmd: 'news', args: m => [stripPunct(m[1].trim()).toUpperCase()] },
      { re: /^(?:analyze|analysis|view|opinion)\s+(.+)$/i, cmd: 'analyze', args: m => [stripPunct(m[1].trim()).toUpperCase()] },
      {
        re: /^set\s+([a-z0-9]+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(above|below)?$/i,
        cmd: 'set',
        args: m => {
          const asset = m[1].toUpperCase();
          const price = m[2];
          const direction = m[3]?.toLowerCase() || 'below';
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
      {
        re: /^vol(?:atility)?\s+(\d{2,3})$/i,
        cmd: 'price',
        args: m => [`VOLATILITY ${m[1]}`.toUpperCase()]
      },
    ];

    const GENERIC_ASSET_WORDS = new Set(['IT', 'AM', 'THAT', 'THAR', 'THIS', 'THEM', 'THOSE', 'ALL', 'ME', 'MY', 'AN', 'A', 'HIM', 'THE', 'ONE', 'ARE', 'IS', 'WAS']);

    for (const { re, cmd, args } of DIRECT_PATTERNS) {
      const m = t.match(re);
      if (m) {
        // Generic word check — let AI handle "analyze it", "price that", etc.
        if (['price', 'analyze', 'news', 'set'].includes(cmd)) {
          const asset = args(m)[0]?.toUpperCase();
          if (asset && GENERIC_ASSET_WORDS.has(asset)) {
            return null; // Fall through to AI with context
          }
        }
        console.log(`⚡ [Regex Gate] Matched "${cmd}" locally (zero tokens)`);
        return [{ command: cmd, args: args(m) }];
      }
    }
    return null; // Needs AI
  }

  // ==========================================
  // 📂 PERSISTENT CONTEXT
  // ==========================================
  async getUserContext(phone) {
    if (!this.db) return { history: [], lastAssets: [] };
    try {
      const col = this.db.collection('ai_context');
      const doc = await col.findOne({ _id: phone });
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
        { $set: { history, lastAssets, updatedAt: Date.now() } },
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
    let { history: userHist, lastAssets } = context;

    console.log(`🐛 [DEBUG groqService.refinePrompt] phone=${phone} | lastAssets=${JSON.stringify(lastAssets)} | msg="${messageText}"`);

    userHist.push(`U:${messageText}`);
    if (userHist.length > 5) userHist.shift();

    // ── ✂️ STEP 3: Build messages ─────────────────────────────────────
    const tier = isPro ? "PRO" : "FREE";
    const lastAssetsString = lastAssets.length > 0 ? lastAssets.join(', ') : 'none';

    // Load user's streak & timezone for AI context
    let extraContext = '';
    try {
      if (this.db) {
        const col = this.db.collection('users');
        const userDoc = await col.findOne({ phone_number: phone });
        if (userDoc?.streak?.current > 1) {
          extraContext += ` | Streak=${userDoc.streak.current} days`;
        }
        const userTz = userDoc?.timezone || 'Africa/Lagos';
        extraContext += ` | Timezone=${userTz}`;
      }
    } catch (_) {}

    try {
      const messages = [
        { role: "system", content: STATIC_SYSTEM_PROMPT },
        { role: "user", content: `CONTEXT: User=${userName} | Plan=${tier} | Last assets=${lastAssetsString}${extraContext}` },
        { role: "assistant", content: "Understood." }
      ];

      // Add conversation history (up to 5 messages)
      for (const entry of userHist.slice(0, -1)) {
        if (entry.startsWith("U:")) {
          messages.push({ role: "user", content: entry.slice(2) });
        } else if (entry.startsWith("A:")) {
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
          temperature: 0.2,
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

      // ── 🔍 STEP 4: Parse JSON ──────────────────────────────────────
      let jsonStr = text.trim();
      const match = text.match(/\[.*\]/s) || text.match(/\{.*\}/s);
      if (match) jsonStr = match[0];

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse JSON from AI:", text);

        // 🛟 Salvage: Try to extract JSON array from malformed output
        const jsonArrayMatch = text.match(/\[\s*\{[^}]*\}\s*\]/s);
        if (jsonArrayMatch) {
          try {
            const cleanedJson = jsonArrayMatch[0].replace(/,(\s*[\]}])/g, '$1');
            const parsedJsonArray = JSON.parse(cleanedJson);
            if (Array.isArray(parsedJsonArray) && parsedJsonArray.length > 0 && parsedJsonArray[0].command) {
              console.log(`🛟 [JSON Salvage] Extracted valid command array from malformed AI output`);
              parsed = parsedJsonArray;
            }
          } catch (_) {}
        }

        // 🛟 Salvage 2: AI returned plain text — wrap as chat
        if (!parsed) {
          const cleanText = text.trim().replace(/^["'“”]|["'”]$/g, '').trim();
          if (cleanText.length > 0 && cleanText.length < 500) {
            console.log(`🛟 [Chat Salvage] Converted free-text AI response to chat command`);
            return [{ command: "chat", args: [cleanText] }];
          }
          return [{ command: "chat", args: ["I'm having trouble with that request. Could you rephrase it? (e.g. \"Set BTC alert at 50000\")"] }];
        }
      }

      if (!Array.isArray(parsed)) {
        parsed = parsed.commands || parsed.result || Object.values(parsed)[0];
      }
      if (!Array.isArray(parsed) && parsed?.command) parsed = [parsed];

      // Handle string arrays (e.g. ["I'm positive!"])
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        const chatText = parsed.join(' ').trim();
        if (chatText) {
          console.log(`🛟 [String Array Salvage] Converted to chat command`);
          return [{ command: "chat", args: [chatText] }];
        }
      }

      // ── 🔧 STEP 5: Generic word resolution only ────────────────────
      if (Array.isArray(parsed)) {
        // Deduplicate identical commands
        const seen = new Set();
        parsed = parsed.filter(cmd => {
          const key = `${cmd.command}:${JSON.stringify(cmd.args)}`;
          if (seen.has(key)) {
            console.log(`🧹 Dedup: skipping duplicate "${key}"`);
            return false;
          }
          seen.add(key);
          return true;
        });

        parsed = parsed.map(cmd => {
          // Only replace truly vague words (it, that, this, them, those, the)
          if (['price', 'analyze', 'news', 'set', 'bought', 'sold', 'set_percent'].includes(cmd.command)) {
            const assetArg = (cmd.args?.[0] || '').toLowerCase().trim();
            if (GENERIC_WORDS.has(assetArg)) {
              if (lastAssets.length > 0) {
                console.log(`🔧 Context fix: "${cmd.args[0]}" → "${lastAssets[0]}" (generic word resolution)`);
                cmd.args[0] = lastAssets[0];
              } else {
                if (cmd.command === 'set') {
                  return { command: 'chat', args: ['Which asset would you like to set an alert for? (e.g. BTC below 80000 or ZENITHBANK below 30)'] };
                }
                return { command: 'chat', args: ['Which asset would you like to check?'] };
              }
            }
          }
          return cmd;
        });
      }

      // ── 💾 STEP 6: Save Updated Context ────────────────────────────
      if (Array.isArray(parsed)) {
        const aiChats = parsed.filter(p => p.command === "chat").map(p => p.args[0]);
        const chatText = aiChats.length > 0 ? aiChats[0] : null;
        if (chatText) {
          const cleanChatText = chatText.replace(/\[.*?\]/s, '').trim() || chatText.slice(0, 60);
          userHist.push(`A:${cleanChatText.slice(0, 60)}`);
        } else {
          userHist.push(`A:[cmd]`);
        }
        if (userHist.length > 5) userHist.shift();

        // Find ALL asset commands in the response
        const newAssets = parsed
          .filter(p => ['price', 'analyze', 'news', 'set', 'bought', 'sold', 'set_percent'].includes(p.command) && p.args?.[0])
          .map(p => p.args[0])
          .filter(a => isValidAssetName(a));

        if (newAssets.length > 0) {
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

  async injectBotResponse(phone, responseText, assets = []) {
    const context = await this.getUserContext(phone);
    let { history: userHist, lastAssets } = context;

    if (assets.length > 0) {
      const validAssets = assets.filter(a => isValidAssetName(a));
      if (validAssets.length > 0) {
        lastAssets = [...new Set([...validAssets, ...lastAssets])].slice(0, 5);
        console.log(`🔧 [Context] Updated lastAssets with ${JSON.stringify(validAssets)} → ${JSON.stringify(lastAssets)}`);
      }
    }

    // Sanitize response text before saving to history
    let sanitized = responseText;
    if (sanitized.startsWith('[') && sanitized.includes('command')) {
      try {
        const parsed = JSON.parse(sanitized);
        if (Array.isArray(parsed)) {
          const chats = parsed.filter(p => p.command === 'chat').map(p => p.args?.[0]).filter(Boolean);
          sanitized = chats.length > 0 ? chats[0] : '[system command executed]';
        }
      } catch (_) {
        sanitized = '[system command executed]';
      }
    }
    const snippet = sanitized.replace(/\n+/g, " ").slice(0, 150) + (sanitized.length > 150 ? "..." : "");
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

    const ta = await this.taService.getIndicators(asset);
    let taSection = '';

    if (ta) {
      const { signals, warnings } = this.taService.interpretIndicators(ta, price);
      const allSignals = [
        ...signals.map(s => `✅ ${s}`),
        ...warnings.map(w => `⚠️ ${w}`)
      ].join('\n');

      const rsiLabel = ta.rsi >= 80 ? ' ← HEAVILY OVERBOUGHT'
                     : ta.rsi >= 70 ? ' ← OVERBOUGHT'
                     : ta.rsi >= 60 ? ' ← APPROACHING OVERBOUGHT'
                     : ta.rsi <= 20 ? ' ← HEAVILY OVERSOLD'
                     : ta.rsi <= 30 ? ' ← OVERSOLD'
                     : ta.rsi <= 40 ? ' ← APPROACHING OVERSOLD'
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

    const suppLines = [];
    if (percentChange24h != null) {
      const dir = percentChange24h >= 0 ? '▲' : '▼';
      suppLines.push(`24h change: ${dir} ${Math.abs(percentChange24h).toFixed(2)}%`);
    }
    if (extras.high52 && extras.low52) {
      const pctFromHigh = (((extras.high52 - price) / extras.high52) * 100).toFixed(1);
      suppLines.push(`52-week range: ${currPrefix}${extras.low52.toLocaleString()} – ${currPrefix}${extras.high52.toLocaleString()} (${pctFromHigh}% below yearly high)`);
    }
    if (extras.volume && extras.volume > 0) {
      const volStr = extras.volume >= 1e9
        ? `${(extras.volume / 1e9).toFixed(2)}B`
        : extras.volume >= 1e6
        ? `${(extras.volume / 1e6).toFixed(1)}M`
        : `${(extras.volume / 1e3).toFixed(0)}K`;
      suppLines.push(`Volume: ${volStr}`);
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
      suppLines.push(`Fear & Greed Index: ${extras.fearGreed.score}/100 — classification is EXACTLY "${extras.fearGreed.classification}" (do not change this label)`);
    }
    const suppSection = suppLines.length > 0 ? `\nMARKET CONTEXT:\n${suppLines.join('\n')}` : '';

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

  async analyzeNewsHeadlines(asset, headlines, assetType = 'crypto') {
    if (!this.apiKey || !headlines || headlines.length === 0) return null;

    const cacheKey = `news:${asset}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < 1800000) return cached.text; // 30 min cache

    const headlinesStr = headlines.map((h, i) => `${i + 1}. ${h}`).join("\n");
    const prompt = `You are a professional ${assetType} market analyst. Here are the top headlines for ${asset}:\n\n${headlinesStr}\n\nWrite a concise 3-point brief for traders:
1️⃣ Key news event — what happened (1 sentence)
2️⃣ Price impact — what this means for ${asset}'s price direction (1 sentence)
3️⃣ Key number — the most important figure from these headlines (e.g. earnings beat %, rate change, supply figure)

Then end with: "Sentiment: [Strongly Bullish / Bullish / Slightly Bullish / Neutral / Slightly Bearish / Bearish / Strongly Bearish]"

Rules: Max 80 words. Use 2-3 emojis. Be direct — traders need signal, not fluff. Base ONLY on the headlines above.`;

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
        { headers: { Authorization: `${this.apiKey}` }, timeout: 8000 }
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

module.exports = GroqService;
