const axios = require("axios");
const cheerio = require("cheerio");
const http = require("http");
const https = require("https");
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const AssetClassifier = require('./assetClassifier');
const derivService = require('./derivService');

class PriceService {
  constructor(db = null) {
    this.db = db;
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";
    this.diaAssetApi = "https://api.diadata.org/v1/assetQuotation";
    this.diaCommodityApi = "https://api.diadata.org/v1/rwa/Commodities";
    this.forexApi = "https://api.fxratesapi.com/latest";
    this.ngxApi = "https://doclib.ngxgroup.com/REST/api/statistics/equities/?market=&sector=&orderby=&pageSize=500&pageNo=0";
    this.termiiApi = "https://api.ng.termii.com/api/sms/send";
    this.alphaVantageKey = process.env.ALPHA_VANTAGE_KEY || null;
    this.itickKey = process.env.ITICK_API_KEY || null;
    this.omkarKey = process.env.OMKAR_API_KEY || null;
    this.twelveDataKey = process.env.TWELVE_DATA_KEY || null;

    // 🏢 Finnhub — US stocks API (free: 60 req/min, offloads Yahoo ~80%)
    this.finnhubKey = process.env.FINNHUB_KEY || null;
    this.finnhubCache = {};
    this.finnhubTTL = 300000; // 5 min cache
    this.finnhubInflight = new Map();

    // 🇳🇬 NGX Pulse API — reliable NGX data source that works from Render
    this.ngxPulseKey = process.env.NGX_PULSE_KEY || null;
    this.ngxPulseBase = 'https://www.ngxpulse.ng';
    // 🚦 Hard rate limiter for NGX Pulse (Personal: 10 req/min, 100 req/day)
    this.ngxPulseLimiter = {
      daily: { count: 0, max: 95, reset: Date.now() + 86400000 },    // 95/day (5 buffer)
      minute: { count: 0, max: 9, reset: Date.now() + 60000 },       // 9/min (1 buffer)
      windowMs: 1800000, // 30 minute cache when using Pulse
    };

    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    // ============================================
    // 🛠️ Reuse TCP connections (keep-alive)
    // ============================================
    this.httpClient = axios.create({
      headers: this.headers,
      timeout: 8000,
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 15, family: 4 }),
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 15, family: 4 }),
    });

    this.assetsBySymbol = {};
    this.nameToSymbol = {};
    this.lastCacheUpdate = 0;

    // Two-tier cache: interactive 30s, alert 60s, stale 5min
    this.priceCache = {};
    this.interactiveTTL = 30000;
    this.alertTTL = 60000;
    this.staleTTL = 300000;

    // In-flight dedup for non-Yahoo sources
    this.inflightRequests = new Map();

    // ════════════════════════════════════════════════════════
    // UNIFIED YAHOO CACHE — one cache, one dedup, all methods
    // Used by: getStockPrice, _resolveStockPrice, _tryYahooFormats,
    //          getTraditionalFuturesPrice
    // ════════════════════════════════════════════════════════
    this.yahooUnifiedCache = {};           // key → { result, ts }
    this.yahooUnifiedInflight = new Map(); // key → Promise
    this.yahooStockTTL    = 300000;  // 5 min for stocks
    this.yahooFuturesTTL  = 120000;  // 2 min for futures
    this.yahooIndexTTL    = 180000;  // 3 min for indices
    this.yahooCooldown    = 60000;   // 1 min cooldown after 429

    // 🚦 Per-symbol Yahoo 429 cooldown
    // Only the specific symbol that got 429'd is blocked.
    // Other symbols (e.g. CL=F vs GC=F) are NOT affected.
    this.yahooCooldownMap = new Map(); // symbol → timestamp (millis when cooldown expires)

    // Twelve Data cache (US stocks only, offloads Yahoo)
    this.twelveDataCache  = {};           // key → { result, ts }
    this.twelveDataTTL    = 300000;  // 5 min cache

    this.ngxInflight = null;

    // Concurrency limiter
    this.maxConcurrent = 8;
    this.activeRequests = 0;
    this.requestQueue = [];

    this.ngxCache = { data: {}, lastUpdate: 0 };
    this.ngxTTL = 300000;       // Default 5 min (doclib/kwayisi)
    this.ngxPulseTTL = 1800000; // 30 min when using NGX Pulse (preserves budget)

    this.classifier = new AssetClassifier();
    this.classifier.derivService = derivService;

    this._bootstrapDerivSymbols();
  }

  async _bootstrapDerivSymbols() {
    try {
      await derivService.loadActiveSymbols();
    } catch (e) {
      console.warn('⚠️ [PriceService] Deriv bootstrap failed (will retry lazily):', e.message);
    }
  }

  async _ensureDerivSymbols() {
    if (derivService.activeSymbolSet.size > 0) return;
    try {
      console.log('📥 Lazy-loading Deriv active symbols...');
      await derivService.loadActiveSymbols();
      console.log(`✅ Deriv symbols loaded: ${derivService.activeSymbols.length} total, ${derivService.syntheticSymbols.size} synthetics`);
    } catch (e) {
      console.warn('⚠️ [PriceService] Lazy Deriv load failed:', e.message);
    }
  }

  async _throttled(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.activeRequests++;
        try {
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          this.activeRequests--;
          if (this.requestQueue.length > 0) {
            const next = this.requestQueue.shift();
            next();
          }
        }
      };

      if (this.activeRequests < this.maxConcurrent) {
        execute();
      } else {
        this.requestQueue.push(execute);
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // UNIFIED YAHOO FINANCE FETCHER
  // Every Yahoo request goes through here. Features:
  //   1. Single cache (no stock: vs yahoo: collision)
  //   2. In-flight dedup (alert + user share one promise)
  //   3. Per-type TTL (stocks 5min, futures 2min, indices 3min)
  //   4. GLOBAL 60s cooldown after ANY 429 (prevents cascade waste)
  //   5. Per-symbol cooldown as fallback
  //   6. Stale fallback on error
  // ════════════════════════════════════════════════════════════
  async _yahooFetch(symbol) {
    const key = `yahoo:${symbol.toUpperCase()}`;
    const now = Date.now();

    let ttl = this.yahooStockTTL;
    if (symbol.includes('=F'))  ttl = this.yahooFuturesTTL;
    if (symbol.startsWith('^')) ttl = this.yahooIndexTTL;

    // 🚦 0a. Per-symbol Yahoo cooldown check
    // Only the specific symbol that got 429'd is blocked.
    const cooldownUntil = this.yahooCooldownMap.get(symbol.toUpperCase());
    if (cooldownUntil && now < cooldownUntil) {
      const remaining = Math.round((cooldownUntil - now) / 1000);
      console.warn(`⏳ [Yahoo] ${symbol} in per-symbol cooldown (${remaining}s left)`);
      return null;
    }

    // 1. Fresh cache hit
    const cached = this.yahooUnifiedCache[key];
    if (cached) {
      if (now - cached.ts < ttl && cached.result !== 'COOLDOWN') {
        return cached.result;
      }
      if (cached.result === 'COOLDOWN' && now - cached.ts < this.yahooCooldown) {
        console.warn(`⏳ [Yahoo] ${symbol} in per-symbol cooldown (${Math.round((this.yahooCooldown - (now - cached.ts)) / 1000)}s left)`);
        return null;
      }
    }

    // 2. In-flight dedup
    if (this.yahooUnifiedInflight.has(key)) {
      try {
        return await this.yahooUnifiedInflight.get(key);
      } catch {
        return null;
      }
    }

    // 3. Fire request (throttled)
    const requestPromise = this._throttled(async () => {
      try {
        const quote = await yf.quote(symbol);

        if (!quote || (!quote.regularMarketPrice && !quote.preMarketPrice)) {
          this.yahooUnifiedCache[key] = { result: null, ts: now };
          return null;
        }

        const quoteType = quote.quoteType?.toUpperCase();
        const isFutures = ['FUTURE', 'INDEX'].includes(quoteType);

        const result = {
          symbol:     quote.symbol,
          name:       quote.shortName || quote.longName || quote.symbol,
          blockchain: isFutures ? 'Futures Market' : 'Stock Market',
          price:      quote.regularMarketPrice || quote.preMarketPrice,
          currency:   quote.currency || 'USD',
          change24h:  quote.regularMarketChangePercent || 0,
          high52:     quote.fiftyTwoWeekHigh  || null,
          low52:      quote.fiftyTwoWeekLow   || null,
          volume:     quote.regularMarketVolume || null,
          marketCap:  quote.marketCap          || null,
          others:     [],
        };

        this.yahooUnifiedCache[key] = { result, ts: Date.now() };
        return result;

      } catch (e) {
        const is429 = e.message?.includes('429') || e.message?.includes('Too Many Requests');

        if (is429) {
          // 🔥 Per-symbol cooldown — only THIS symbol is blocked for 60s
          this.yahooCooldownMap.set(symbol.toUpperCase(), Date.now() + this.yahooCooldown);
          console.warn(`⚠️ [Yahoo] 429 on ${symbol} — entering per-symbol cooldown (60s)`);

          // Also mark in cache
          this.yahooUnifiedCache[key] = { result: 'COOLDOWN', ts: Date.now() };
          return null;
        }

        const stale = this.yahooUnifiedCache[key];
        if (stale && stale.result && stale.result !== 'COOLDOWN') {
          const ageMin = Math.round((Date.now() - stale.ts) / 60000);
          console.warn(`⚠️ [Yahoo] Error for ${symbol}, serving stale (${ageMin}m old)`);
          return stale.result;
        }

        const oldCacheKey = `stock:${symbol}`;
        const oldCached = this.priceCache[oldCacheKey];
        if (oldCached && Date.now() - oldCached.ts < this.staleTTL) {
          return oldCached.data;
        }

        return null;
      }
    });

    this.yahooUnifiedInflight.set(key, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.yahooUnifiedInflight.delete(key);
    }
  }

  // ════════════════════════════════════════════════════════════
  // YAHOO RATE-LIMIT DETECTION
  // Returns true if any of the common Yahoo formats for the
  // given symbol are currently in 429 cooldown.
  // Also checks GLOBAL cooldown.
  // ════════════════════════════════════════════════════════════
  _isYahooRateLimited(symbol) {
    const now = Date.now();
    // Check if this specific symbol is in per-symbol cooldown
    const cooldownUntil = this.yahooCooldownMap.get(symbol.toUpperCase());
    if (cooldownUntil && now < cooldownUntil) {
      return true;
    }
    const formats = [symbol, `${symbol}=F`, `^${symbol}`];
    for (const fmt of formats) {
      const key = `yahoo:${fmt.toUpperCase()}`;
      const cached = this.yahooUnifiedCache[key];
      if (cached && cached.result === 'COOLDOWN' && now - cached.ts < this.yahooCooldown) {
        return true;
      }
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════
  // TWELVE DATA FETCHER (US stocks only)
  // Free: 8 req/min, 800/day. Offloads Yahoo for US stocks.
  // ════════════════════════════════════════════════════════════
  async _twelveDataFetch(symbol) {
    if (!this.twelveDataKey) return null;

    const key = `twelve:${symbol.toUpperCase()}`;
    const cached = this.twelveDataCache[key];
    if (cached && Date.now() - cached.ts < this.twelveDataTTL) {
      return cached.result;
    }

    try {
      const url = `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${this.twelveDataKey}`;
      const { data } = await this.httpClient.get(url, { timeout: 8000 });

      if (data?.price) {
        const price = parseFloat(data.price);

        let name = symbol;
        let change24h = null;
        try {
          const quoteKey = `twelve_quote:${symbol}`;
          const quoteCached = this.twelveDataCache[quoteKey];
          if (quoteCached && Date.now() - quoteCached.ts < 600000) {
            name      = quoteCached.name;
            change24h = quoteCached.change;
          } else {
            const quoteUrl = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${this.twelveDataKey}`;
            const { data: qData } = await this.httpClient.get(quoteUrl, { timeout: 8000 });
            if (qData) {
              name      = qData.name     || symbol;
              change24h = qData.percent_change ? parseFloat(qData.percent_change) : null;
              this.twelveDataCache[quoteKey] = { name, change: change24h, ts: Date.now() };
            }
          }
        } catch (_) {}

        const result = {
          symbol,
          name,
          blockchain: 'Stock Market',
          price,
          currency:   'USD',
          change24h,
          others:     [],
        };
        this.twelveDataCache[key] = { result, ts: Date.now() };
        return result;
      }

      if (data?.code === 429 || data?.message?.includes('quota')) {
        console.warn(`⚠️ [TwelveData] Quota hit — falling back to Yahoo for ${symbol}`);
      }
      return null;
    } catch (e) {
      console.warn(`⚠️ [TwelveData] Error for ${symbol}: ${e.message}`);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════
  // FINNHUB — US stocks primary (free: 60 req/min, offloads Yahoo ~80%)
  // Free tier covers US stocks only (not futures, indices, or NGX)
  // ════════════════════════════════════════════════════════════
  async _finnhubFetch(symbol) {
    if (!this.finnhubKey) return null;

    const key = `finnhub:${symbol.toUpperCase()}`;
    const now = Date.now();

    // 1️⃣ Cache hit
    const cached = this.finnhubCache[key];
    if (cached && now - cached.ts < this.finnhubTTL) {
      return cached.result;
    }

    // 2️⃣ In-flight dedup
    if (this.finnhubInflight.has(key)) {
      try { return await this.finnhubInflight.get(key); }
      catch { return null; }
    }

    // 3️⃣ Fire request (throttled)
    const requestPromise = this._throttled(async () => {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.finnhubKey}`;
        const { data } = await this.httpClient.get(url, { timeout: 8000 });

        // c === 0 means symbol not found on Finnhub
        if (!data || data.c === 0 || data.c === null || data.c === undefined) {
          this.finnhubCache[key] = { result: null, ts: now };
          return null;
        }

        const result = {
          symbol,
          name:       symbol,
          blockchain: 'Stock Market',
          price:      data.c,       // current price
          currency:   'USD',
          change24h:  data.dp,      // % change from previous close
          high52:     null,         // not in /quote endpoint
          low52:      null,
          volume:     null,
          marketCap:  null,
          others:     [],
        };

        this.finnhubCache[key] = { result, ts: now };
        console.log(`✅ [Finnhub] ${symbol}: $${data.c}`);
        return result;

      } catch (e) {
        if (e.message?.includes('429')) {
          console.warn(`⚠️ [Finnhub] Rate limit hit for ${symbol}`);
        }
        // Serve stale on error
        const stale = this.finnhubCache[key];
        if (stale?.result) return stale.result;
        return null;
      }
    });

    this.finnhubInflight.set(key, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.finnhubInflight.delete(key);
    }
  }

  async loadAssetList() {
    if (
      Date.now() - this.lastCacheUpdate < 3600000 &&
      Object.keys(this.assetsBySymbol).length > 0
    )
      return;
    try {
      console.log("📥 Updating Crypto List...");
      const res = await this.httpClient.get(this.quotedAssetsApi, {
        timeout: 15000,
      });
      const temp = {};
      const nameMap = {};

      if (res.data) {
        res.data.forEach((item) => {
          const s = item.Asset.Symbol.toUpperCase();
          const n = item.Asset.Name.toUpperCase();
          if (!temp[s]) temp[s] = [];

          const alreadyHasChain = temp[s].some(
            (existing) => existing.blockchain === item.Asset.Blockchain,
          );
          if (!alreadyHasChain) {
            temp[s].push({
              blockchain: item.Asset.Blockchain,
              address: item.Asset.Address,
              name: item.Asset.Name,
              symbol: s,
            });
          }

          if (!nameMap[n]) nameMap[n] = s;
        });
        this.assetsBySymbol = temp;
        this.nameToSymbol = nameMap;
        this.lastCacheUpdate = Date.now();
        console.log(
          `✅ Crypto List Updated (${Object.keys(temp).length} assets)`,
        );
      }
    } catch (e) {
      console.error("⚠️ API Error loadAssetList:", e.message);
    }
  }

  async getAssetInfo(input) {
    let classification = this.classifier.classify(input);
    let { type, symbol, chain, confidence } = classification;
    const sym = symbol; // alias used by DYNAMIC path

    // ════════════════════════════════════════════════════════
    // Dynamic futures pre-resolution
    // When STOCK with ≤60% confidence, check Yahoo futures
    // ════════════════════════════════════════════════════════
    if (type === 'STOCK' && confidence <= 60) {
      // 🚦 Check global Yahoo cooldown BEFORE trying futures
      if (this._isYahooRateLimited(symbol)) {
        console.warn(`⏳ [Dynamic] "${input}" SKIPPING Yahoo futures — GLOBAL cooldown active`);
      } else {
        console.log(`🔄 [Dynamic] "${input}" classified as STOCK (${confidence}%) — checking Yahoo futures...`);
        const futuresResult = await this.classifier.resolveFuturesWithYahoo(symbol);
        if (futuresResult) {
          const yahooSymbol = futuresResult.symbol;
          const quote = await this._yahooFetch(yahooSymbol);
          if (quote && quote.price) {
            quote.blockchain = "Futures Market";
            console.log(`✅ [Dynamic] "${input}" resolved as futures → ${yahooSymbol}`);
            return quote;
          }
        }
        const yahooResult = await this._tryYahooFormats(symbol);
        if (yahooResult && yahooResult.price) {
          yahooResult.blockchain = yahooResult.blockchain || "Futures Market";
          console.log(`✅ [Dynamic] "${input}" resolved via Yahoo formats`);
          return yahooResult;
        }
      }
      console.log(`❌ [Dynamic] "${input}" not a futures product, falling back to STOCK`);
    }

    // ════════════════════════════════════════════════════════
    // COMMODITIES
    // ════════════════════════════════════════════════════════
    if (type === "COMMODITY") {
      // 🏆 COMMODITY → Yahoo futures resolution (primary)
      // Map common commodity names and broker shorthands to Yahoo futures symbols.
      // This covers: GOLD→GC=F, SILVER→SI=F, USOIL→CL=F, UKOIL→BZ=F, etc.
      const COMMODITY_YAHOO_MAP = {
        // Precious metals
        'XAU': 'GC=F', 'GOLD': 'GC=F',
        'XAG': 'SI=F', 'SILVER': 'SI=F',
        'PLATINUM': 'PL=F', 'PL': 'PL=F',
        'PALLADIUM': 'PA=F', 'PA': 'PA=F',
        // Base metals
        'COPPER': 'HG=F', 'HG': 'HG=F',
        // Crude oil & products
        'OIL': 'CL=F', 'WTI': 'CL=F', 'USOIL': 'CL=F',
        'BRENT': 'BZ=F', 'UKOIL': 'BZ=F',
        // Natural gas
        'NATURAL GAS': 'NG=F', 'NATGAS': 'NG=F', 'GAS': 'NG=F',
      };

      // Try direct Yahoo futures mapping first
      const yahooFuturesSymbol = COMMODITY_YAHOO_MAP[symbol];
      if (yahooFuturesSymbol) {
        console.log(`🔄 [Commodity] "${symbol}" mapped to Yahoo futures ${yahooFuturesSymbol}`);
        const yahooResult = await this._yahooFetch(yahooFuturesSymbol);
        if (yahooResult && yahooResult.price) {
          yahooResult.blockchain = "Commodity (Yahoo Futures)";
          return yahooResult;
        }
      }

      // Fallback: try =F suffix via _tryYahooFormats (covers any unlisted commodities)
      const yahooResult = await this._tryYahooFormats(symbol);
      if (yahooResult && yahooResult.price) {
        yahooResult.blockchain = "Commodity (Yahoo)";
        return yahooResult;
      }

      // Last resort: DIA Commodities API (may be deprecated/broken)
      const diaPrice = await this._resolveCommodityPrice(symbol);
      if (diaPrice) {
        return {
          symbol,
          name: symbol,
          blockchain: "Commodity Market",
          price: diaPrice,
          currency: "USD",
          change24h: null,
          others: [],
        };
      }
      return null;
    }

    // ════════════════════════════════════════════════════════
    // SYNTHETIC INDICES (Deriv) — e.g. R_100, 1HZ75V, BOOM500
    // ════════════════════════════════════════════════════════
    if (type === "SYNTHETIC_INDEX") {
      // ✅ Validate the symbol against Deriv's active symbol set BEFORE opening a WebSocket
      await this._ensureDerivSymbols();
      if (!derivService.hasSymbol(symbol)) {
        console.warn(`⚠️ [Deriv] Symbol "${symbol}" is invalid — not in active Deriv symbols list`);
        return null;
      }
      const price = await derivService.fetchTick(symbol);
      if (price !== null && price !== undefined) {
        return {
          symbol,
          name: symbol,
          blockchain: "Synthetic Index (Deriv)",
          price,
          currency: "USD",
          change24h: null,
          others: ["pricePing"],
        };
      }
      return null;
    }

    // ════════════════════════════════════════════════════════
    // DERIV ASSETS
    // ════════════════════════════════════════════════════════
    if (type === "DERIV_ASSET") {
      // ✅ Validate symbol before creating WebSocket
      await this._ensureDerivSymbols();
      if (!derivService.hasSymbol(symbol)) {
        console.warn(`⚠️ [Deriv] Symbol "${symbol}" is invalid — not in active Deriv symbols list`);
        return null;
      }
      const price = await derivService.fetchTick(symbol);
      if (price !== null && price !== undefined) {
        return {
          symbol,
          name: symbol,
          blockchain: "Deriv Asset",
          price,
          currency: "USD",
          change24h: null,
          others: ["pricePing"],
        };
      }
      return null;
    }

    // ════════════════════════════════════════════════════════
    // CRYPTO
    // ════════════════════════════════════════════════════════
    if (type === "CRYPTO") {
      return await this.resolveCrypto(symbol, chain, input);
    }

    // ════════════════════════════════════════════════════════
    // FOREX
    // ════════════════════════════════════════════════════════
    if (type === "FOREX") {
      const price = await this.getForexPrice(symbol);
      if (price) {
        if (price._rateLimited) {
          return {
            symbol,
            name: `${symbol.substring(0,3)}/${symbol.substring(3,6)}`,
            blockchain: "Forex Market",
            price: null,
            currency: "USD",
            change24h: null,
            others: [],
            _rateLimited: true,
          };
        }
        return {
          symbol,
          name: `${symbol.substring(0,3)}/${symbol.substring(3,6)}`,
          blockchain: "Forex Market",
          price: price,
          currency: symbol.substring(3, 6),
          change24h: null,
          others: [],
        };
      }
      return null;
    }

    // ════════════════════════════════════════════════════════
    // NGX STOCKS
    // ════════════════════════════════════════════════════════
    if (type === "NGX_STOCK") {
      const ngxResult = await this._lookupNGX(symbol);
      if (ngxResult) return ngxResult;
      return null;
    }

    // ════════════════════════════════════════════════════════
    // TRADITIONAL FUTURES (e.g. US30 → YM=F, UK100 → Z=F)
    // ════════════════════════════════════════════════════════
    if (type === "TRADITIONAL_FUTURE") {
      return await this.getTraditionalFuturesPrice(symbol, input);
    }

    // ════════════════════════════════════════════════════════
    // FUTURES (crypto futures like BTC-FUTURES)
    // ════════════════════════════════════════════════════════
    if (type === "FUTURE") {
      return await this.getTraditionalFuturesPrice(symbol, input);
    }

    // ════════════════════════════════════════════════════════
    // US STOCKS (Finnhub → Twelve Data → Yahoo)
    // ════════════════════════════════════════════════════════
    if (type === "STOCK" || type === "US_STOCK") {
      return await this.getStockPrice(symbol, input);
    }

    // ════════════════════════════════════════════════════════
    // DYNAMIC — try all in order, return first hit
    // ════════════════════════════════════════════════════════
    if (type === "DYNAMIC") {
      const cryptoPrice = await this._resolveCryptoPrice(sym);
      if (cryptoPrice !== null) return cryptoPrice;

      const ngxPrice = await this._resolveNGXPrice(sym);
      if (ngxPrice !== null) return ngxPrice;

      const forexPrice = await this.getForexPrice(sym);
      if (forexPrice !== null) return forexPrice;

      // 🔄 Try Yahoo futures resolution for any unknown asset
      // 🚦 Skip if global cooldown is active
      if (!this._isYahooRateLimited(sym)) {
        const futuresPrice = await this._resolveDynamicFutures(sym, input);
        if (futuresPrice !== null) return futuresPrice;

        const stockPrice = await this._resolveStockPrice(sym);
        if (stockPrice !== null) return stockPrice;
      } else {
        console.warn(`⏳ [Dynamic] "${sym}" SKIPPING Yahoo in DYNAMIC cascade — GLOBAL cooldown active`);
      }

      return null;
    }

    // 🚦 Yahoo rate-limited? Return friendly message instead of "Not Found"
    const inputUpper = typeof input === 'string' ? input.toUpperCase() : '';
    if (inputUpper && this._isYahooRateLimited(inputUpper)) {
      return { _rateLimited: true, symbol: inputUpper };
    }
    return null;
  }

  getCurrencySymbol(currency) {
    const symbols = {
      USD: "$", EUR: "€", GBP: "£", JPY: "¥", NGN: "₦",
      AUD: "A$", CAD: "C$", CHF: "Fr", CNY: "¥",
      BTC: "₿", ETH: "Ξ", SOL: "◎",
    };
    return symbols[currency] || currency + " ";
  }

  getCurrencyForSymbol(symbol) {
    const s = symbol.toUpperCase().replace(/\s+/g, "");
    if (["BTC", "ETH", "SOL", "XRP", "ADA", "DOT", "DOGE", "LINK", "MATIC", "UNI"].includes(s)) return "USD";
    
    const classification = this.classifier.classify(s);
    if (classification.type === 'NGX_STOCK') {
      return "NGN";
    }

    if (["XAU", "GOLD", "XAG", "SILVER", "OIL", "WTI", "BRENT", "USOIL", "UKOIL",
         "PLATINUM", "PL", "PALLADIUM", "PA", "COPPER", "HG",
         "NATURAL GAS", "NATGAS", "GAS"].includes(s)) return "USD";

    if (s.length === 6) {
      return s.substring(3, 6).toUpperCase();
    }

    return "USD";
  }

  formatPrice(price, symbol, currency = null) {
    if (!price) return "N/A";
    const resolvedCurrency = currency || this.getCurrencyForSymbol(symbol);
    const prefix = this.getCurrencySymbol(resolvedCurrency);

    if (["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"].some((s) => symbol.includes(s))) {
      return `${price.toFixed(5)}`;
    }

    if (price < 1.0 && resolvedCurrency === "USD") return `${prefix}${price.toFixed(6)}`;

    return `${prefix}${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  async getPrice(asset) {
    const info = await this.getAssetInfo(asset);
    return info ? info.price : null;
  }

  async getForexPrice(pair) {
    const FOREX_SKIP = new Set([
      "USDT","USDC","DOGE","BTC","ETH","SOL","XRP",
      "ZENITH","ZENITHBANK","DANGOTE","DANGCEM","GTB","GTCO","GTBANK",
      "UBA","ACCESS","ACCESSCORP","ACCESSBANK","FBN","FBNH","FIRSTBANK",
      "AIRTEL","AIRTELAFRI","STANBIC","SEPLAT","OANDO",
      "FIDELITY","FIDELITYBK","STERLING","STERLINGBANK",
      "MTN","MTNN","MTNNG"
    ]);
    if (FOREX_SKIP.has(pair)) return null;

    const now = Date.now();
    const FOREX_TTL = 300000;

    if (!this.globalForexCache || now - this.globalForexCache.ts > FOREX_TTL) {
      if (!this.forexInflight) {
        this.forexInflight = (async () => {
          try {
            const res = await this.httpClient.get(this.forexApi);
            if (res.data && res.data.rates) {
              this.globalForexCache = { rates: res.data.rates, ts: now };
              console.log(`🌍 Global Forex Market Cached: ${Object.keys(res.data.rates).length} pairs loaded.`);
            }
          } catch (e) {
            console.warn(`⚠️ Global Forex Fetch Failed:`, e.message);
          } finally {
            this.forexInflight = null;
          }
        })();
      }
      if (this.forexInflight) {
        await this.forexInflight;
      }
    }

    if (!this.globalForexCache) {
      return { _rateLimited: true };
    }

    const rates = this.globalForexCache.rates;
    let base, target;
    
    if (pair.length === 6) {
      base = pair.substring(0, 3);
      target = pair.substring(3, 6);
    } else {
      base = pair;
      target = "USD";
    }

    const baseRate = base === "USD" ? 1 : rates[base];
    const targetRate = target === "USD" ? 1 : rates[target];

    if (!baseRate || !targetRate) return null;

    return targetRate / baseRate;
  }

  async getForexCurrencies() {
    return [];
  }

  // ════════════════════════════════════════════════════════════
  // NGX MARKET
  // ════════════════════════════════════════════════════════════
  async fetchNGXMarket(db = null) {
    if (this.ngxInflight) return this.ngxInflight;

    this.ngxInflight = (async () => {
      const now = Date.now();
      const stocks = {};

      // 🇳🇬 Use 30min TTL when NGX Pulse is configured (preserves API budget)
      const effectiveTTL = this.ngxPulseKey ? this.ngxPulseTTL : this.ngxTTL;

      if (this.ngxCache.data && Object.keys(this.ngxCache.data).length > 0) {
        const age = now - this.ngxCache.lastUpdate;
        if (age < effectiveTTL) {
          return this.ngxCache.data;
        }
      }

      if (db) {
        try {
          const mongoCache = await db.collection("ngx_cache").findOne({ _id: "ngx_stocks" });
          if (mongoCache?.stocks) {
            const age = now - mongoCache.updatedAt;
            if (age < effectiveTTL) {
              this.ngxCache = { data: mongoCache.stocks, lastUpdate: mongoCache.updatedAt };
              console.log(`📦 Serving NGX from MongoDB cache (age: ${Math.round(age / 60000)}min)`);
              return this.ngxCache.data;
            }
          }
        } catch (e) {}
      }

      // 🥇 PRIMARY: NGX Pulse API (works everywhere, rate-limited to 95 req/day)
      if (this.ngxPulseKey) {
        try {
          await this._fetchNGXPulseIntoStocks(stocks);
        } catch (e) {
          console.warn(`⚠️ NGX Pulse failed: ${e.message}`);
        }
      }

      // 🥈 FALLBACK: NGX doclib API (works locally, empty on Render)
      if (Object.keys(stocks).length === 0) {
        try {
          const { data } = await this.httpClient.get(this.ngxApi, { timeout: 15000, family: 4 });
          if (data?.records) {
            for (const stock of data.records) {
              const ticker = stock.symbol?.trim() || stock.ticker?.trim();
              const price = parseFloat(stock.lastTradedPrice || stock.closingPrice || stock.price);
              const change = parseFloat(stock.change) || null;
              if (ticker && !isNaN(price)) {
                stocks[ticker] = { ticker, name: stock.description || stock.name || ticker, price, change };
              }
            }
            if (Object.keys(stocks).length > 0) {
              console.log(`📊 NGX doclib API returned ${Object.keys(stocks).length} stocks`);
            }
          }
        } catch (e) {
          console.warn(`⚠️ NGX doclib API failed: ${e.message}`);
        }
      }

      // 🥉 FALLBACK: Kwayisi scrape (works locally, blocked on Render)
      if (Object.keys(stocks).length === 0) {
        try {
          await this._scrapeKwayisiIntoStocks(stocks);
        } catch (e) {
          console.warn(`⚠️ Kwayisi scrape failed: ${e.message}`);
        }
      }

      if (Object.keys(stocks).length > 0) {
        this.ngxCache = { data: stocks, lastUpdate: now };
        if (db) {
          try {
            await db.collection("ngx_cache").updateOne(
              { _id: "ngx_stocks" },
              { $set: { stocks, updatedAt: now } },
              { upsert: true },
            );
            console.log("💾 NGX data persisted to MongoDB");
          } catch (e) {}
        }
      } else if (db) {
        try {
          const stale = await db.collection("ngx_cache").findOne({ _id: "ngx_stocks" });
          if (stale?.stocks) {
            const age = Math.round((now - stale.updatedAt) / 60000);
            console.log(`📦 Serving stale NGX data (age: ${age}min)`);
            this.ngxCache = { data: stale.stocks, lastUpdate: stale.updatedAt };
          }
        } catch (e) {}
      }

      return this.ngxCache.data || {};
    })();

    this.ngxInflight.finally(() => { this.ngxInflight = null; });
    return this.ngxInflight;
  }

  async _lookupNGX(symbol) {
    const allNGX = await this.fetchNGXMarket(this.db);
    if (!allNGX || Object.keys(allNGX).length === 0) return null;

    let match = allNGX[symbol];
    if (match) return this._formatNGXResult(match);

    if (symbol.length >= 3) {
      match = Object.values(allNGX).find(s => s.ticker.startsWith(symbol));
      if (match) return this._formatNGXResult(match);
    }

    const sym = symbol.toLowerCase();
    match = Object.values(allNGX).find(s => {
      const name = s.name.toLowerCase();
      return name === sym || name.startsWith(sym) || name.includes(sym) || sym.includes(name.split(' ')[0]);
    });

    if (match) return this._formatNGXResult(match);
    return null;
  }

  _formatNGXResult(stock) {
    return {
      symbol: stock.ticker,
      name: `${stock.name} (NGX)`,
      blockchain: "Stock Market",
      price: stock.price,
      currency: "NGN",
      change24h: stock.change,
      others: [],
    };
  }

  async _scrapeKwayisiIntoStocks(stocks) {
    const browserHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-NG,en;q=0.9",
      Referer: "https://afx.kwayisi.org/",
    };

    for (const page of [1, 2]) {
      try {
        const url = page === 1 ? "https://afx.kwayisi.org/ngx/" : `https://afx.kwayisi.org/ngx/?page=${page}`;
        const { data } = await axios.get(url, { family: 4, timeout: 30000, headers: browserHeaders });
        this._parseKwayisiPage(data, stocks);
        if (page === 1) await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        // Kwayisi is blocked on Render — silently skip, Pulse/doclib handles it
      }
    }
  }

  _parseKwayisiPage(html, stocks) {
    const $ = cheerio.load(html);
    $('table tbody tr').each((i, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 4) {
        const ticker = $(cells[0]).text().trim();
        const name = $(cells[1]).text().trim();
        const price = parseFloat($(cells[3]).text().trim().replace(/,/g, ''));
        const change = parseFloat($(cells[4]).text().trim()) || null;
        if (ticker && !isNaN(price)) {
          stocks[ticker] = { ticker, name, price, change };
        }
      }
    });
  }

  // 🇳🇬 NGX Pulse API — fetches all 150+ NGX stocks via clean JSON endpoint
  // Free Personal tier: 100 req/day, 10 req/min
  // 🚦 HARD rate limiter ensures we NEVER exceed limits
  // Data is cached for 30 minutes to minimize requests
  // Works from ANY network (Render, Cloudflare, etc.)
  async _fetchNGXPulseIntoStocks(stocks) {
    if (!this.ngxPulseKey) return;

    // 🚦 Rate limit check — enforce hard caps
    const limiter = this.ngxPulseLimiter;
    const now = Date.now();

    // Reset counters if windows have expired
    if (now > limiter.daily.reset) {
      limiter.daily.count = 0;
      limiter.daily.reset = now + 86400000;
    }
    if (now > limiter.minute.reset) {
      limiter.minute.count = 0;
      limiter.minute.reset = now + 60000;
    }

    // Check daily cap
    if (limiter.daily.count >= limiter.daily.max) {
      const resetHrs = Math.round((limiter.daily.reset - now) / 3600000);
      console.warn(`⚠️ NGX Pulse daily limit reached (${limiter.daily.max}/day). Resets in ~${resetHrs}h. Serving cached data.`);
      return;
    }

    // Check minute cap
    if (limiter.minute.count >= limiter.minute.max) {
      const resetSec = Math.ceil((limiter.minute.reset - now) / 1000);
      console.warn(`⚠️ NGX Pulse minute limit reached (${limiter.minute.max}/min). Resets in ${resetSec}s.`);
      return;
    }

    // Increment counters BEFORE the request (counts budget, not actual)
    limiter.daily.count++;
    limiter.minute.count++;

    console.log(`📊 NGX Pulse API request #${limiter.daily.count}/${limiter.daily.max} today, #${limiter.minute.count}/${limiter.minute.max} this minute`);

    try {
      const { data } = await axios.get(`${this.ngxPulseBase}/api/ngxdata/stocks`, {
        headers: {
          'X-API-Key': this.ngxPulseKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      // NGX Pulse returns { stocks: [...] } or an array directly
      const list = Array.isArray(data) ? data : (data?.stocks || []);
      if (list.length === 0) {
        console.warn('⚠️ NGX Pulse returned empty stock list');
        // Refund the request — no data received
        limiter.daily.count = Math.max(0, limiter.daily.count - 1);
        limiter.minute.count = Math.max(0, limiter.minute.count - 1);
        return;
      }

      let parsed = 0;
      for (const stock of list) {
        const ticker = (stock.symbol || '').toUpperCase().trim();
        const price = parseFloat(stock.current_price || stock.price || stock.close_price);
        if (ticker && !isNaN(price) && price > 0) {
          stocks[ticker] = {
            ticker,
            name: stock.name || stock.company_name || ticker,
            price,
            change: parseFloat(stock.change_percent) || null,
          };
          parsed++;
        }
      }

      console.log(`📊 NGX Pulse API returned ${parsed} stocks (budget: ${limiter.daily.count}/${limiter.daily.max} daily, ${limiter.minute.count}/${limiter.minute.max} min)`);
    } catch (e) {
      console.warn(`⚠️ NGX Pulse API request failed: ${e.message}`);
      // Refund the request on failure
      limiter.daily.count = Math.max(0, limiter.daily.count - 1);
      limiter.minute.count = Math.max(0, limiter.minute.count - 1);
      throw e; // Let caller handle fallback chain
    }
  }

  // ════════════════════════════════════════════════════════════
  // US STOCKS — Finnhub (primary, 60 req/min) → Twelve Data → Yahoo
  // Futures/Indices — Yahoo only
  // ════════════════════════════════════════════════════════════
  async getStockPrice(symbol, rawInput) {
    const isFuturesOrIndex = symbol.includes('=F') || symbol.startsWith('^');

    if (!isFuturesOrIndex) {
      // 1️⃣ Finnhub — free US stocks, 60 req/min, covers ~80% of traffic
      if (this.finnhubKey) {
        const fhResult = await this._finnhubFetch(symbol);
        if (fhResult) return fhResult;
      }
      // 2️⃣ Twelve Data — US stocks fallback (if configured)
      if (this.twelveDataKey) {
        const tdResult = await this._twelveDataFetch(symbol);
        if (tdResult) return tdResult;
      }
    }

    // 3️⃣ Yahoo — last resort for stocks, primary for futures/indices
    return await this._yahooFetch(symbol);
  }

  // ════════════════════════════════════════════════════════════
  // TRADITIONAL FUTURES — DYNAMIC YAHOO RESOLUTION
  // ════════════════════════════════════════════════════════════
  async getTraditionalFuturesPrice(symbol, rawInput) {
    const cacheKey = `future_dynamic:${symbol}`;
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.ts < this.interactiveTTL) {
      return cached.data;
    }

    // ✅ Try the mapped Yahoo symbol first (e.g., YM=F for US30)
    // This is the DIRECT path — no format guessing needed
    const futuresResult = await this.classifier.resolveFuturesWithYahoo(symbol);
    if (futuresResult) {
      const yahooSymbol = futuresResult.symbol;
      console.log(`🔍 [Futures] Resolved "${symbol}" → Yahoo symbol "${yahooSymbol}"`);
      const quote = await this._yahooFetch(yahooSymbol);
      if (quote) {
        quote.blockchain = "Futures Market";
        this.priceCache[cacheKey] = { data: quote, ts: Date.now() };
        return quote;
      }
      // 🚦 If the mapped symbol failed (e.g., 429 cooldown), check global cooldown
      // before falling through to format guessing. If Yahoo is globally rate-limited,
      // skip the wasteful format cascade.
      if (this._isYahooRateLimited(symbol)) {
        console.warn(`⏳ [Futures] "${symbol}" — Yahoo in cooldown, skipping format cascade`);
        if (cached && Date.now() - cached.ts < this.staleTTL) {
          return cached.data;
        }
        return null;
      }
    }

    // 💥 Format guessing cascade — only reached if no global cooldown
    const yahooResult = await this._tryYahooFormats(symbol);
    if (yahooResult) {
      yahooResult.blockchain = "Futures Market";
      this.priceCache[cacheKey] = { data: yahooResult, ts: Date.now() };
      return yahooResult;
    }

    if (rawInput && rawInput !== symbol) {
      const rawResult = await this._tryYahooFormats(rawInput);
      if (rawResult) {
        rawResult.blockchain = "Futures Market";
        this.priceCache[cacheKey] = { data: rawResult, ts: Date.now() };
        return rawResult;
      }
    }

    if (cached && Date.now() - cached.ts < this.staleTTL) {
      return cached.data;
    }

    return null;
  }

  // ════════════════════════════════════════════════════════════
  // ALERT-OPTIMIZED BATCH FETCHING
  // ════════════════════════════════════════════════════════════
  async getMultiplePrices(symbols) {
    const uniqueSymbols = [...new Set(symbols)];
    const prices = {};
    const batchSize = this.maxConcurrent;

    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (symbol) => {
          try {
            const price = await this._resolveAlertPrice(symbol);
            prices[symbol] = price;
          } catch (e) {
            console.error(`⚠️ Price fetch error for ${symbol}:`, e.message);
            prices[symbol] = null;
          }
        }),
      );

      if (i + batchSize < uniqueSymbols.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return prices;
  }

  async _resolveAlertPrice(symbol) {
    const info = await this.getAssetInfo(symbol);
    return info ? info.price : null;
  }

  // ════════════════════════════════════════════════════════════
  // Private resolvers (for DYNAMIC path)
  // ════════════════════════════════════════════════════════════

  async _resolveCryptoPrice(sym) {
    try {
      await this.loadAssetList();
      const symbolData = this.assetsBySymbol[sym];
      if (!symbolData || symbolData.length === 0) return null;

      let selected = symbolData.find((o) => o.blockchain === "Bitcoin");
      if (!selected) {
        const priority = [
          "Bitcoin", "Ethereum", "Solana", "Binance Smart Chain",
          "Polygon", "The Open Network",
        ];
        const sorted = [...symbolData].sort((a, b) => {
          let pA = priority.indexOf(a.blockchain);
          let pB = priority.indexOf(b.blockchain);
          if (pA === -1) pA = 99;
          if (pB === -1) pB = 99;
          return pA - pB;
        });
        selected = sorted[0];
        if (sym === "BTC") {
          selected = symbolData.find((o) => o.blockchain === "Bitcoin") || selected;
        }
        if (sym === "ETH") {
          selected = symbolData.find((o) => o.blockchain === "Ethereum") || selected;
        }
      }
      if (!selected) return null;
      return await this.fetchDiaPrice(selected, "alert");
    } catch (e) {
      console.error(`⚠️ Crypto price failed for ${sym}:`, e.message);
      return null;
    }
  }

  async _resolveNGXPrice(sym) {
    try {
      const allNGX = await this.fetchNGXMarket(this.db);
      if (!allNGX || Object.keys(allNGX).length === 0) return null;
      if (allNGX[sym]) return allNGX[sym].price;
      const match = Object.values(allNGX).find(
        (s) => s.name?.toUpperCase().includes(sym) || s.ticker?.includes(sym)
      );
      if (match) return match.price;
      return null;
    } catch (e) {
      return null;
    }
  }

  // ✅ FIX: Routes through unified _yahooFetch instead of raw yf.quote()
  // This was Bug #1 — alert monitor bypassed all protections
  async _resolveStockPrice(sym) {
    const result = await this._yahooFetch(sym);
    return result?.price ?? null;
  }

  /**
   * 🔄 Dynamic futures resolution for the DYNAMIC cascade
   * Tries Yahoo search to resolve unknown symbols as futures products.
   * Mirrors the logic from the STOCK ≤60% block (lines 348-367).
   */
  async _resolveDynamicFutures(symbol, rawInput) {
    console.log(`🔄 [Dynamic] "${rawInput}" in DYNAMIC cascade — checking Yahoo futures...`);
    // 🚦 Check global cooldown before making requests
    if (this._isYahooRateLimited(symbol)) {
      console.warn(`⏳ [Dynamic] SKIPPING "${rawInput}" — Yahoo in GLOBAL cooldown`);
      return null;
    }
    const futuresResult = await this.classifier.resolveFuturesWithYahoo(symbol);
    if (futuresResult) {
      const yahooSymbol = futuresResult.symbol;
      const quote = await this._yahooFetch(yahooSymbol);
      if (quote && quote.price) {
        quote.blockchain = "Futures Market";
        console.log(`✅ [Dynamic] "${rawInput}" resolved as futures → ${yahooSymbol}`);
        return quote;
      }
    }
    const yahooResult = await this._tryYahooFormats(symbol);
    if (yahooResult && yahooResult.price) {
      yahooResult.blockchain = yahooResult.blockchain || "Futures Market";
      console.log(`✅ [Dynamic] "${rawInput}" resolved via Yahoo formats`);
      return yahooResult;
    }
    console.log(`❌ [Dynamic] "${rawInput}" not resolved as futures`);
    return null;
  }

  // ✅ FIX: Uses unified _yahooFetch instead of separate yahooQuoteCache
  // This was Bug #2 + #4 — separate cache + no 429 cooldown
  async _tryYahooFormats(rawInput) {
    const symbol = rawInput.toUpperCase().trim()
      .replace(/\s*(FUTURES?|PERP(ETUAL)?)\s*/gi, '').trim();

    if (!symbol) return null;

    const formats = [symbol, `${symbol}=F`, `^${symbol}`];

    for (const fmt of formats) {
      // 🚦 Check if THIS specific format is in cooldown before trying it
      const cooldownUntil = this.yahooCooldownMap.get(fmt.toUpperCase());
      if (cooldownUntil && Date.now() < cooldownUntil) {
        const remaining = Math.round((cooldownUntil - Date.now()) / 1000);
        console.warn(`⏳ [Yahoo] Format "${fmt}" in cooldown (${remaining}s left) — skipping`);
        continue;
      }

      const result = await this._yahooFetch(fmt);
      if (result && result.price) {
        console.log(`✅ [Dynamic] Yahoo matched "${rawInput}" → ${fmt}`);
        return result;
      }
    }
    return null;
  }

  async _resolveCommodityPrice(symbol) {
    try {
      // DIA Commodities API expects symbol as path parameter
      // Available: XAU-USD (Gold), XAGG-USD (Silver), XG-USD (Copper)
      const DIA_SYMBOL_MAP = {
        'XAU': 'XAU-USD',
        'GOLD': 'XAU-USD',
        'XAG': 'XAGG-USD',
        'SILVER': 'XAGG-USD',
        'COPPER': 'XG-USD',
        'HG': 'XG-USD',
      };
      const mappedSymbol = DIA_SYMBOL_MAP[symbol];
      if (!mappedSymbol) {
        console.warn(`⚠️ Commodity symbol "${symbol}" has no DIA mapping`);
        return null;
      }
      const res = await this.httpClient.get(
        `${this.diaCommodityApi}/${mappedSymbol}`,
        { timeout: 8000 },
      );
      if (res.data && res.data.Price > 0) {
        return res.data.Price;
      }
      return null;
    } catch (e) {
      console.warn(`⚠️ Commodity price failed for ${symbol}: ${e.message}`);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════
  // CRYPTO RESOLUTION (via DIA)
  // ════════════════════════════════════════════════════════════
  async fetchDiaPrice(asset, source = "interactive") {
    const cacheKey = `dia:${asset.symbol}:${asset.blockchain}`;
    const now = Date.now();
    const cached = this.priceCache[cacheKey];
    const ttl = source === "alert" ? this.alertTTL : this.interactiveTTL;

    if (cached && now - cached.ts < ttl) return cached.data;

    if (this.inflightRequests.has(cacheKey)) {
      try { return await this.inflightRequests.get(cacheKey); }
      catch { return null; }
    }

    const requestPromise = (async () => {
      try {
        const url = `${this.diaAssetApi}/${asset.blockchain}/${asset.address}`;
        const res = await this.httpClient.get(url, { timeout: 8000 });

        if (res.data && res.data.Price > 0) {
          const result = {
            symbol: asset.symbol,
            name: asset.name,
            blockchain: asset.blockchain,
            price: res.data.Price,
            currency: "USD",
            change24h: res.data.PriceYesterday
              ? ((res.data.Price - res.data.PriceYesterday) / res.data.PriceYesterday) * 100
              : null,
            others: [],
          };
          this.priceCache[cacheKey] = { data: result, ts: now };
          return result;
        }
        return null;
      } catch (e) {
        const cachedData = this.priceCache[cacheKey];
        if (cachedData && now - cachedData.ts < this.staleTTL) {
          console.warn(`⚠️ DIA fetch failed for ${asset.symbol}, serving stale data`);
          return cachedData.data;
        }
        console.error(`⚠️ DIA price failed for ${asset.symbol}:`, e.message);
        return null;
      }
    })();

    this.inflightRequests.set(cacheKey, requestPromise);
    try { return await requestPromise; }
    finally { this.inflightRequests.delete(cacheKey); }
  }

  async resolveCrypto(symbol, chain, input) {
    await this.loadAssetList();
    const sym = symbol.toUpperCase();

    let options = this.assetsBySymbol[sym];
    if (!options || options.length === 0) {
      const byName = this.nameToSymbol[input.toUpperCase()];
      if (byName) options = this.assetsBySymbol[byName];
    }

    if (!options || options.length === 0) return null;

    let selected = null;
    if (chain) {
      const chainLower = chain.toLowerCase();
      selected = options.find((o) => o.blockchain.toLowerCase() === chainLower);
    }

    if (!selected) {
      const priority = [
        "Bitcoin", "Ethereum", "Solana", "Binance Smart Chain",
        "Polygon", "The Open Network",
      ];
      const sorted = [...options].sort((a, b) => {
        let pA = priority.indexOf(a.blockchain);
        let pB = priority.indexOf(b.blockchain);
        if (pA === -1) pA = 99;
        if (pB === -1) pB = 99;
        return pA - pB;
      });
      selected = sorted[0];

      if (sym === "BTC") {
        selected = options.find((o) => o.blockchain === "Bitcoin") || selected;
      }
      if (sym === "ETH") {
        selected = options.find((o) => o.blockchain === "Ethereum") || selected;
      }
    }

    if (!selected) return null;

    const isAlert = input === "alert";
    return await this.fetchDiaPrice(selected, isAlert ? "alert" : "interactive");
  }

  // ════════════════════════════════════════════════════════════
  // CACHE CLEANUP
  // ════════════════════════════════════════════════════════════
  cleanupExpiredCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const key of Object.keys(this.priceCache)) {
      if (now - this.priceCache[key].ts > this.staleTTL) {
        delete this.priceCache[key];
        cleaned++;
      }
    }

    const maxAge = 600000;
    for (const key of Object.keys(this.yahooUnifiedCache)) {
      if (now - this.yahooUnifiedCache[key].ts > maxAge) {
        delete this.yahooUnifiedCache[key];
        cleaned++;
      }
    }

    for (const key of Object.keys(this.twelveDataCache)) {
      if (now - this.twelveDataCache[key].ts > maxAge) {
        delete this.twelveDataCache[key];
        cleaned++;
      }
    }

    // Clean up expired per-symbol cooldowns
    let cooldownsCleaned = 0;
    for (const [sym, expiry] of this.yahooCooldownMap) {
      if (now > expiry) {
        this.yahooCooldownMap.delete(sym);
        cooldownsCleaned++;
      }
    }

    if (cooldownsCleaned > 0) {
      console.log(`🧹 Cleaned ${cooldownsCleaned} expired Yahoo cooldowns`);
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired price cache entries`);
    }
  }
}

module.exports = PriceService;