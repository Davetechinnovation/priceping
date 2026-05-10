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

    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    // ============================================
    // 🛠️ FIX 1: Reuse TCP connections (keep-alive)
    // Without this, every request opens a new socket.
    // At 100+ requests/30s you exhaust OS connections.
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

    // ============================================
    // 🛠️ FIX 2: Two-tier cache
    // - Interactive (user asks "price sol"): 30s TTL (fresh)
    // - Alert monitoring (background checks): 60s TTL (efficient)
    // - Stale fallback: if API fails, serve last known price up to 5min old
    // ============================================
    this.priceCache = {};
    this.interactiveTTL = 30000;   // 30s for user queries
    this.alertTTL = 60000;         // 60s for alert monitoring
    this.staleTTL = 300000;        // 5min stale fallback

    // ============================================
    // 🛠️ FIX 3: In-flight request deduplication
    // If 10 users check SOL at the same time,
    // only 1 HTTP request fires. All 10 await the same promise.
    // ============================================
    this.inflightRequests = new Map();
    this.ngxInflight = null; // 🛠️ Lock to prevent duplicate NGX fetches

    // ============================================
    // 🛠️ FIX 4: Concurrency limiter
    // Max N simultaneous API calls to avoid rate limits
    // ============================================
    this.maxConcurrent = 8;
    this.activeRequests = 0;
    this.requestQueue = [];

    // NGX Market Cache (Kwayisi)
    this.ngxCache = { data: {}, lastUpdate: 0 };
    this.ngxTTL = 300000; // 5 mins cache for all NGX

    this.classifier = new AssetClassifier();
    this.classifier.derivService = derivService;

    // 🎲 Bootstrap Deriv active symbols in background
    this._bootstrapDerivSymbols();
  }

  /**
   * Background-load Deriv active symbols so the classifier can match them.
   * Non-blocking — if it fails we retry next time someone asks for a dynamic asset.
   */
  async _bootstrapDerivSymbols() {
    try {
      await derivService.loadActiveSymbols();
    } catch (e) {
      console.warn('⚠️ [PriceService] Deriv bootstrap failed (will retry lazily):', e.message);
    }
  }

  /**
   * Lazily ensures Deriv symbols are loaded. Call this before any Deriv-dependent
   * resolution. If background bootstrap failed or hasn't run, this will trigger a load.
   */
  async _ensureDerivSymbols() {
    if (derivService.activeSymbolSet.size > 0) return; // already loaded
    try {
      console.log('📥 Lazy-loading Deriv active symbols...');
      await derivService.loadActiveSymbols();
      console.log(`✅ Deriv symbols loaded: ${derivService.activeSymbols.length} total, ${derivService.syntheticSymbols.size} synthetics`);
    } catch (e) {
      console.warn('⚠️ [PriceService] Lazy Deriv load failed:', e.message);
    }
  }

  // ============================================
  // Concurrency limiter — queues excess requests
  // instead of firing 100 at once
  // ============================================
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

    // ── Dynamic upgrade for low-confidence results ─────────────────
    // If the classifier isn't sure (≤60%), ask Yahoo Finance to identify it.
    // This catches stuff like SUGAR (classified as STOCK at 50% because it's
    // 5 upper-case letters). Yahoo search knows it's a futures product.
    if (confidence <= 60) {
      const upgraded = await this.classifier.resolveWithYahoo(input);
      if (upgraded && upgraded.confidence > confidence) {
        classification = upgraded;
        ({ type, symbol, chain, confidence } = classification);
      }
    }

    console.log(`🔍 Classified "${input}" as ${type} (${confidence}% confidence) → ${symbol}`);


    // 🇳🇬 Known Nigerian private companies (not on NGX)
    if (type === 'NGX_PRIVATE') {
      const info = this.classifier.privateNigerianAliases[symbol];
      return {
        symbol,
        name: info.name,
        blockchain: "Stock Market",
        price: null,
        currency: "NGN",
        _privateCompany: true,
        _privateNote: info.note,
        others: [],
      };
    }

    // ============================================
    // 🎲 SYNTHETIC INDICES (Deriv)
    // ============================================
    if (type === 'SYNTHETIC_INDEX') {
      // Check cache first (30s)
      const cacheKey = `deriv_${symbol}`;
      if (this.priceCache && this.priceCache[cacheKey] && (Date.now() - this.priceCache[cacheKey].time < 30000)) {
        return { symbol, name: symbol, blockchain: "Synthetic Market", price: this.priceCache[cacheKey].price, currency: "USD", others: [] };
      }

      try {
        const price = await derivService.fetchTick(symbol);
        if (price !== null) {
          if (!this.priceCache) this.priceCache = {};
          this.priceCache[cacheKey] = { price, time: Date.now() };
          return { symbol, name: symbol, blockchain: "Synthetic Market", price, currency: "USD", others: [] };
        }
      } catch (e) {
        console.error(`❌ [PriceService] Deriv Error for ${symbol}:`, e.message);
      }
    }

    // ============================================
    // 🚀 CRYPTO FUTURES (Binance Perpetuals)
    // ============================================
    if (type === 'CRYPTO_FUTURE') {
      const futuresPrice = await this.getBinanceFuturesPrice(symbol);
      if (futuresPrice && futuresPrice._rateLimited) {
        return { symbol: `${symbol}-PERP`, name: `${symbol} Perpetual`, blockchain: "Crypto Futures", price: null, currency: "USD", _rateLimited: true, others: [] };
      }
      if (futuresPrice !== null) {
        return { symbol: `${symbol}-PERP`, name: `${symbol} Perpetual`, blockchain: "Crypto Futures", price: futuresPrice, currency: "USD", others: [] };
      }
    }

    // ============================================
    // 📈 TRADITIONAL FUTURES (Yahoo Finance + Dynamic)
    // ============================================
    if (type === 'TRADITIONAL_FUTURE') {
      // Check if we need dynamic Yahoo resolution (classification was uncertain)
      if (classification.needsYahooResolve) {
        const futureInfo = await this.getTraditionalFuturesPrice(symbol, input);
        if (futureInfo !== null) return futureInfo;
      } else {
        // Fast lane: symbol is already a known Yahoo format (e.g. "ES=F", "GC=F")
        const futureInfo = await this.getStockPrice(symbol, input);
        if (futureInfo !== null) {
          futureInfo.blockchain = "Futures Market";
          return futureInfo;
        }
      }
    }

    // ============================================
    // 🏆 COMMODITIES
    // ============================================
    if (type === 'COMMODITY') {
      const price = await this.getCommodityPrice(symbol);
      if (price && price._rateLimited) {
        return { symbol, name: symbol, blockchain: "Commodities", price: null, currency: "USD", _rateLimited: true, others: [] };
      }
      if (price !== null && price !== undefined) {
        return { symbol, name: symbol, blockchain: "Commodities", price, currency: "USD", others: [] };
      }

      // Fallback: Try Yahoo futures for commodities not covered by DIA
      // (PLATINUM→PL=F, PALLADIUM→PA=F, COPPER→HG=F, etc.)
      const futuresResult = await this.classifier.resolveFuturesWithYahoo(symbol);
      if (futuresResult) {
        const futurePrice = await this.getTraditionalFuturesPrice(futuresResult.symbol, symbol);
        if (futurePrice) return futurePrice;
      }
    }

    // ============================================
    // 💎 CRYPTOCURRENCIES (DIA Data)
    // ============================================
    if (type === 'CRYPTO' || type === 'DYNAMIC') {
      await this.loadAssetList();
      let cryptoSymbol = symbol;
      if (this.nameToSymbol && this.nameToSymbol[cryptoSymbol]) {
        cryptoSymbol = this.nameToSymbol[cryptoSymbol];
      }

      const options = this.assetsBySymbol[cryptoSymbol];

      if (options && options.length > 0) {
        let selected = null;
        if (chain) {
          selected = options.find((o) => o.blockchain.toUpperCase() === chain.toUpperCase());
          if (!selected) {
            selected = options.find((o) => o.blockchain.toUpperCase().includes(chain.toUpperCase()));
          }
        }

        if (!selected) {
          const priority = ["Bitcoin", "Ethereum", "Solana", "Binance Smart Chain", "Tron", "Arbitrum", "Avalanche", "Optimism", "Base", "Polygon", "The Open Network"];
          options.sort((a, b) => {
            let pA = priority.indexOf(a.blockchain);
            let pB = priority.indexOf(b.blockchain);
            if (pA === -1) pA = 99;
            if (pB === -1) pB = 99;
            return pA - pB;
          });
          selected = options[0];

          if (cryptoSymbol === "BTC") {
            const realBTC = options.find((o) => o.blockchain === "Bitcoin");
            if (realBTC) selected = realBTC;
          }
          if (cryptoSymbol === "ETH") {
            const realETH = options.find((o) => o.blockchain === "Ethereum");
            if (realETH) selected = realETH;
          }
        }

        if (selected) {
          const price = await this.fetchDiaPrice(selected);
          
          if (price && price._rateLimited) {
            return {
              symbol: cryptoSymbol,
              name: selected.name,
              blockchain: selected.blockchain,
              address: selected.address,
              price: null,
              currency: "USD",
              _rateLimited: true,
              others: [],
            };
          }

          if (price !== null && price !== undefined) {
            const rawOthers = options.filter((o) => o.blockchain !== selected.blockchain);
            const uniqueOthers = [];
            const seenChains = new Set();
            for (const o of rawOthers) {
              if (!seenChains.has(o.blockchain)) {
                seenChains.add(o.blockchain);
                uniqueOthers.push(o);
              }
            }

            return {
              symbol: cryptoSymbol,
              name: selected.name,
              blockchain: selected.blockchain,
              address: selected.address,
              price: price,
              currency: "USD",
              others: uniqueOthers,
            };
          }
        }
      }
    }

    // ============================================
    // 💱 FOREX
    // ============================================
    if (type === 'FOREX' || type === 'DYNAMIC') {
      const forexPrice = await this.getForexPrice(symbol);
      if (forexPrice && forexPrice._rateLimited) {
        return {
          symbol: symbol,
          name: symbol.length === 6 ? `${symbol.substring(0, 3)}/${symbol.substring(3, 6)}` : `${symbol}/USD`,
          blockchain: "Forex Market",
          price: null,
          currency: symbol.length === 6 ? symbol.substring(3, 6) : "USD",
          _rateLimited: true,
          others: [],
        };
      }
      if (forexPrice !== null) {
        return {
          symbol: symbol,
          name: symbol.length === 6 ? `${symbol.substring(0, 3)}/${symbol.substring(3, 6)}` : `${symbol}/USD`,
          blockchain: "Forex Market",
          price: forexPrice,
          currency: symbol.length === 6 ? symbol.substring(3, 6) : "USD",
          others: [],
        };
      }
    }

    // ============================================
    // 🇳🇬 NGX CHECK — before Yahoo for DYNAMIC
    // For a Nigerian bot, local context beats global
    // ============================================
    if (type === 'NGX_STOCK' || type === 'DYNAMIC') {
      const ngxResult = await this._lookupNGX(symbol);
      if (ngxResult) return ngxResult;

      // If explicitly NGX type but not found, return proper response
      if (type === 'NGX_STOCK') {
        const feedAlive = Object.keys(this.ngxCache.data || {}).length > 0;
        return {
          symbol,
          name: `${symbol} (NGX)`,
          blockchain: "Stock Market",
          price: null,
          currency: "NGN",
          _notListed: feedAlive,    // Feed up = not listed
          _unavailable: !feedAlive, // Feed down = unavailable
          others: [],
        };
      }
    }

    // ============================================
    // 📈 DYNAMIC FUTURES RESOLUTION (before stocks)
    // For low-confidence STOCK matches (e.g. SUGAR, COFFEE, PLATINUM)
    // we try Yahoo's futures search first. If it resolves, use it.
    // This makes the bot support ANY futures product (SUGAR→SB=F,
    // PLATINUM→PL=F, WHEAT→ZW=F, etc.) without hardcoding.
    // ============================================
    if (type === 'STOCK' && confidence <= 60 && symbol.length >= 3) {
      const futuresResult = await this.classifier.resolveFuturesWithYahoo(symbol);
      if (futuresResult) {
        const futurePrice = await this.getTraditionalFuturesPrice(futuresResult.symbol, symbol);
        if (futurePrice) return futurePrice;
      }
    }

    // ============================================
    // 📈 US & GLOBAL STOCKS — last resort for DYNAMIC
    // ============================================
    if (type === 'US_STOCK' || type === 'STOCK' || type === 'DYNAMIC') {
      const stockInfo = await this.getStockPrice(symbol, input);
      if (stockInfo !== null) return stockInfo;
    }

    // ============================================
    // 🌐 FINAL DYNAMIC FALLBACK — tries Yahoo with
    // multiple formats: exact, =F suffix, ^ prefix
    // Catches any futures/index/stock not in our maps
    // ============================================

    // If still unknown and Deriv symbols not loaded, try lazy loading them
    if (derivService.activeSymbolSet.size === 0) {
      await this._ensureDerivSymbols();
      if (derivService.isSynthetic(symbol) || derivService.hasSymbol(symbol)) {
        const price = await derivService.fetchTick(symbol);
        if (price !== null) {
          const cacheKey = `deriv_${symbol}`;
          if (!this.priceCache) this.priceCache = {};
          this.priceCache[cacheKey] = { price, time: Date.now() };
          return { symbol, name: symbol, blockchain: "Synthetic Market", price, currency: "USD", others: [] };
        }
      }
    }

    const dynamicYahoo = await this._tryYahooFormats(input);
    if (dynamicYahoo) return dynamicYahoo;

    return null;
  }

  /**
   * 🔄 Multi-format Yahoo Fallback
   * Tries symbol directly, then with =F suffix, then ^ prefix.
   * This is the "magic" that makes the bot infinite for traditional markets.
   */
  async _tryYahooFormats(rawInput) {
    const symbol = rawInput.toUpperCase().trim()
      .replace(/\s*(FUTURES?|PERP(ETUAL)?)\s*/gi, '').trim();

    if (!symbol) return null;

    const formats = [
      symbol,         // exact: AAPL, ES=F, ^GSPC
      `${symbol}=F`,  // futures: YM=F, NQ=F, GC=F
      `^${symbol}`,   // index: ^DJI, ^GSPC, ^N225
    ];

    for (const fmt of formats) {
      try {
        const quote = await yf.quote(fmt);
        if (!quote || (!quote.regularMarketPrice && !quote.preMarketPrice)) continue;

        const quoteType = quote.quoteType?.toUpperCase();
        const isFutures = ['FUTURE', 'INDEX'].includes(quoteType);

        console.log(`✅ [Dynamic] Yahoo matched "${rawInput}" → ${fmt} (${quoteType})`);

        return {
          symbol:    quote.symbol,
          name:      quote.shortName || quote.longName || quote.symbol,
          blockchain: isFutures ? 'Futures Market' : 'Stock Market',
          price:     quote.regularMarketPrice || quote.preMarketPrice,
          currency:  quote.currency || 'USD',
          change24h: quote.regularMarketChangePercent || 0,
          high52:    quote.fiftyTwoWeekHigh || null,
          low52:     quote.fiftyTwoWeekLow || null,
          others: [],
        };
      } catch (e) {
        continue; // try next format
      }
    }
    return null;
  }

  // ============================================
  // 🛠️ CORE FIX: Deduplicated + throttled + stale-fallback
  // ============================================
  async fetchDiaPrice(asset, mode = "interactive") {
    const cacheKey = `${asset.blockchain}:${asset.address}`;
    const cached = this.priceCache[cacheKey];
    const now = Date.now();
    const ttl = mode === "alert" ? this.alertTTL : this.interactiveTTL;

    // 1. Fresh cache hit
    if (cached && now - cached.ts < ttl) {
      return cached.price;
    }

    // 2. Deduplicate: if same request is already in-flight, await it
    if (this.inflightRequests.has(cacheKey)) {
      try {
        return await this.inflightRequests.get(cacheKey);
      } catch {
        // If the in-flight request failed, fall through to stale
        return cached && now - cached.ts < this.staleTTL ? cached.price : null;
      }
    }

    // 3. Fire new request (throttled)
    const requestPromise = this._throttled(async () => {
      try {
        const url = `${this.diaAssetApi}/${asset.blockchain}/${asset.address}`;
        const res = await this.httpClient.get(url);
        const price = res.data.Price;
        this.priceCache[cacheKey] = { price, ts: Date.now() };
        return price;
      } catch (e) {
        // ============================================
        // 🛠️ FIX 5: Stale fallback & Rate Limit Catching
        // ============================================
        if (e.message && (e.message.includes("429") || e.message.includes("Too Many Requests"))) {
          console.warn(`⚠️ DIA Crypto API Rate Limit (429) hit for ${asset.blockchain}/${asset.address}`);
          return { _rateLimited: true };
        }
        
        if (cached && Date.now() - cached.ts < this.staleTTL) {
          console.log(`⚠️ API failed for ${asset.blockchain}/${asset.symbol || '?'}, using stale price (${Math.round((Date.now() - cached.ts) / 1000)}s old)`);
          return cached.price;
        }
        return null;
      } finally {
        this.inflightRequests.delete(cacheKey);
      }
    });

    this.inflightRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async getPriceByChainAddress(blockchain, address) {
    return await this.fetchDiaPrice({ blockchain, address });
  }

  async getCommodityPrice(sym) {
    const cacheKey = `commodity:${sym}`;
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.ts < this.interactiveTTL) return cached.price;

    const diaSymbols = { 'XAU': 'XAU-USD', 'GOLD': 'XAU-USD', 'XAG': 'XAGG-USD', 'SILVER': 'XAGG-USD', 'COPPER': 'XG-USD', 'XG': 'XG-USD' };

    const s = sym.toUpperCase();
    let price = null;

    try {
      // 1. Metals (Gold/Silver/Copper) → DIA
      if (diaSymbols[s]) {
        const { data } = await axios.get(`https://api.diadata.org/v1/rwa/Commodities/${diaSymbols[s]}`, { timeout: 8000 });
        price = data?.Price;
      }

      if (price) {
        this.priceCache[cacheKey] = { price, ts: Date.now() };
        return price;
      }
    } catch (e) {
      if (e.message && (e.message.includes("429") || e.message.includes("Too Many Requests"))) {
        console.warn(`⚠️ Commodity API Rate Limit (429) hit for ${sym}`);
        return { _rateLimited: true };
      }
      if (cached && Date.now() - cached.ts < this.staleTTL) return cached.price;
    }
    return null;
  }

  // ============================================
  // 🚀 BINANCE FUTURES (Crypto Perpetuals)
  // ============================================
  async getBinanceFuturesPrice(sym) {
    const cacheKey = `binance_future:${sym}`;
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.ts < this.interactiveTTL) return cached.price;

    const baseSymbol = sym.toUpperCase().replace(/USDT$/, '').replace(/USD$/, '');
    const binanceSymbol = `${baseSymbol}USDT`;

    // ── Try Binance first ────────────────────────────────
    try {
      const { data } = await axios.get(
        `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${binanceSymbol}`,
        { timeout: 8000 }
      );
      if (data?.price) {
        const price = parseFloat(data.price);
        this.priceCache[cacheKey] = { price, ts: Date.now() };
        return price;
      }
    } catch (e) {
      const status = e.response?.status;
      const is429 = status === 429 || e.message?.includes('429');
      const isGeoBlocked = status === 451 || status === 403; // 451 = blocked for legal reasons (Render/AWS)
      const isNetworkError = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET'].includes(e.code) || e.message?.includes('timeout');
      
      if (!is429 && !isGeoBlocked && !isNetworkError) {
        // Not blocked in any way — symbol just doesn't exist on Binance futures
        return null;
      }
      console.warn(`⚠️ Binance fetch failed (${status || e.code || 'ERR'}) for ${binanceSymbol}, trying Bybit fallback...`);
    }

    // ── Bybit fallback (only on Binance 429) ────────────
    try {
      const { data } = await axios.get(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${binanceSymbol}`,
        { timeout: 8000 }
      );
      const ticker = data?.result?.list?.[0];
      if (ticker?.lastPrice) {
        const price = parseFloat(ticker.lastPrice);
        this.priceCache[cacheKey] = { price, ts: Date.now() };
        return price;
      }
    } catch (e2) {
      console.warn(`⚠️ Bybit fallback also failed for ${binanceSymbol}:`, e2.message);
    }

    // ── 3. Try OKX (best regional availability) ──────────
    try {
      const okxSymbol = `${baseSymbol}-USDT-SWAP`; // OKX perp format
      const { data } = await axios.get(
        `https://www.okx.com/api/v5/market/ticker?instId=${okxSymbol}`,
        { timeout: 8000 }
      );
      const ticker = data?.data?.[0];
      if (ticker?.last) {
        const price = parseFloat(ticker.last);
        this.priceCache[cacheKey] = { price, ts: Date.now() };
        console.log(`✅ OKX fallback success for ${okxSymbol}`);
        return price;
      }
    } catch (e3) {
      console.warn(`⚠️ OKX fallback failed for ${baseSymbol}:`, e3.message);
    }

    // ── 4. DIA spot proxy (Binance/Bybit/OKX all 451-blocked on Render/AWS) ──
    try {
      await this.loadAssetList();
      const diaSymbol = baseSymbol.toUpperCase();
      const options = this.assetsBySymbol[diaSymbol];
      if (options?.length > 0) {
        const priority = ['Bitcoin', 'Ethereum', 'Solana', 'Binance Smart Chain', 'Tron'];
        const sorted = [...options].sort((a, b) => {
          const pA = priority.indexOf(a.blockchain);
          const pB = priority.indexOf(b.blockchain);
          return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
        });
        const price = await this.fetchDiaPrice(sorted[0]);
        if (price && typeof price === 'number') {
          console.log(`✅ [Futures] DIA spot proxy for ${diaSymbol}: $${price}`);
          this.priceCache[cacheKey] = { price, ts: Date.now() };
          return price;
        }
      }
    } catch (e4) {
      console.warn(`⚠️ DIA spot fallback failed for ${baseSymbol}:`, e4.message);
    }

    // Stale cache (last resort)
    if (cached && Date.now() - cached.ts < this.staleTTL) return cached.price;
    return null;
  }

  getCurrencySymbol(currencyCode) {
    const symbolMap = {
      "NGN": "₦",
      "USD": "$",
      "GBP": "£",
      "EUR": "€",
      "JPY": "¥"
    };
    return symbolMap[currencyCode?.toUpperCase()] || (currencyCode ? `${currencyCode} ` : "$");
  }

  getCurrencyForSymbol(symbol) {
    const s = symbol.toUpperCase().trim();
    
    // 🇳🇬 Nigerian Stocks (NGX)
    const classification = this.classifier.classify(s);
    if (classification.type === 'NGX_STOCK') {
      return "NGN";
    }

    // 🏆 Commodities
    if (["XAU", "GOLD", "XAG", "SILVER", "OIL", "WTI", "BRENT"].includes(s)) return "USD";

    // 💱 Forex
    if (s.length === 6) {
      // For pairs like EURUSD, the target currency is the second 3 chars
      return s.substring(3, 6).toUpperCase();
    }

    // Default to USD for US Stocks & Crypto
    return "USD";
  }

  formatPrice(price, symbol, currency = null) {
    if (!price) return "N/A";
    
    // If currency not provided, try to infer it
    const resolvedCurrency = currency || this.getCurrencyForSymbol(symbol);
    const prefix = this.getCurrencySymbol(resolvedCurrency);

    if (
      ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"].some((s) => symbol.includes(s))
    ) {
      return `${price.toFixed(5)}`;
    }

    // High precision for small prices (Crypto)
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
    // Exclude crypto tickers AND NGX stock aliases from forex lookup
    const FOREX_SKIP = new Set([
      "USDT","USDC","DOGE","BTC","ETH","SOL","XRP",
      // NGX aliases (6-char ones would otherwise hit the forex path)
      "ZENITH","ZENITHBANK","DANGOTE","DANGCEM","GTB","GTCO","GTBANK",
      "UBA","ACCESS","ACCESSCORP","ACCESSBANK","FBN","FBNH","FIRSTBANK",
      "AIRTEL","AIRTELAFRI","STANBIC","SEPLAT","OANDO",
      "FIDELITY","FIDELITYBK","STERLING","STERLINGBANK",
      "MTN","MTNN","MTNNG"
    ]);
    if (FOREX_SKIP.has(pair)) return null;

    const now = Date.now();
    const FOREX_TTL = 300000; // 5 minutes cache

    // Fetch the entire global forex market once every 5 minutes
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

    // The API uses USD as the base for all returned rates.
    const baseRate = base === "USD" ? 1 : rates[base];
    const targetRate = target === "USD" ? 1 : rates[target];

    if (!baseRate || !targetRate) return null;

    // Calculate cross rate locally
    // Example: EUR/JPY -> rates[JPY] / rates[EUR]
    return targetRate / baseRate;
  }

  async getForexCurrencies() {
    return [];
  }

  // ============================================
  // 📈 NGX MARKET FETCHING (Kwayisi)
  // ============================================
  async fetchNGXMarket(db = null) {
    if (this.ngxInflight) return this.ngxInflight;

    this.ngxInflight = (async () => {
      const now = Date.now();

      // 1. In-memory cache
      if (
        this.ngxCache.data &&
        Object.keys(this.ngxCache.data).length > 0 &&
        now - this.ngxCache.lastUpdate < this.ngxTTL
      ) {
        return this.ngxCache.data;
      }

      // 2. MongoDB cache (survives Render restarts)
      if (db) {
        try {
          const col = db.collection("ngx_cache");
          const cached = await col.findOne({ _id: "ngx_stocks" });
          if (cached && now - cached.updatedAt < this.ngxTTL) {
            console.log(
              `📦 NGX MongoDB hit — ${Object.keys(cached.stocks).length} stocks`,
            );
            this.ngxCache = {
              data: cached.stocks,
              lastUpdate: cached.updatedAt,
            };
            // ✅ seed classifier from cached data
            this.classifier.seedNGXTickers(Object.keys(cached.stocks));
            return cached.stocks;
          }
        } catch (e) {
          console.warn("⚠️ MongoDB NGX read failed:", e.message);
        }
      }

      // 3. NGX Official REST API — JSON, no scraping, datacenter friendly
      console.log("📥 Fetching NGX data from doclib API...");
      const stocks = {};

      try {
        // Fetches ALL ~400 stocks in one request (pageSize=500)
        const url = this.ngxApi;

        const { data } = await axios.get(url, {
          timeout: 30000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json, text/plain, */*",
          },
        });

        // Handle both array and { data: [] } response shapes
        const items = Array.isArray(data) ? data : data?.data || [];

        for (const item of items) {
          // Map the JSON fields — confirmed field names from NGX pipeline article
          const ticker = (item.Symbol || item.symbol || "").trim();
          const name =
            item.CompanyName || item.company_name || item.Name || ticker;
          const price = parseFloat(
            item.ClosePrice || item.close_price || item.LastPrice || 0,
          );
          const change =
            parseFloat(item.PerChange || item.per_change || 0) || null;

          if (ticker && price > 0) {
            stocks[ticker] = { ticker, name, price, change };
          }
        }

        console.log(`✅ NGX doclib API: ${Object.keys(stocks).length} stocks loaded`);
        // ✅ seeds classifier with ALL real NGX tickers
        this.classifier.seedNGXTickers(Object.keys(stocks));
      } catch (e) {
        console.warn(`⚠️ NGX doclib API failed: ${e.message}`);
      }

      // 4. Fallback: Kwayisi scraping (only if doclib fails)
      if (Object.keys(stocks).length === 0) {
        console.log("↩️ Falling back to Kwayisi scrape...");
        try {
          await this._scrapeKwayisiIntoStocks(stocks);
        } catch (e) {
          console.warn("⚠️ Kwayisi fallback also failed:", e.message);
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
        // Everything failed — serve stale MongoDB data
        try {
          const stale = await db
            .collection("ngx_cache")
            .findOne({ _id: "ngx_stocks" });
          if (stale?.stocks) {
            const age = Math.round((now - stale.updatedAt) / 60000);
            console.log(`📦 Serving stale NGX data (age: ${age}min)`);
            this.ngxCache = { data: stale.stocks, lastUpdate: stale.updatedAt };
          }
        } catch (e) {}
      }

      return this.ngxCache.data || {};
    })();

    this.ngxInflight.finally(() => {
      this.ngxInflight = null;
    });
    return this.ngxInflight;
  }

  async _lookupNGX(symbol) {
    const allNGX = await this.fetchNGXMarket(this.db);
    if (!allNGX || Object.keys(allNGX).length === 0) return null;

    // 1. Direct ticker match: GLO, MTNN, DANGCEM
    let match = allNGX[symbol];
    if (match) return this._formatNGXResult(match);

    // 2. Ticker starts-with: "ZEN" → ZENITHBANK
    if (symbol.length >= 3) {
      match = Object.values(allNGX).find(s =>
        s.ticker.startsWith(symbol)
      );
      if (match) return this._formatNGXResult(match);
    }

    // 3. Company name fuzzy match against all stocks
    const sym = symbol.toLowerCase();
    match = Object.values(allNGX).find(s => {
      const name = s.name.toLowerCase();
      return (
        name === sym ||
        name.startsWith(sym) ||
        name.includes(sym) ||
        sym.includes(name.split(' ')[0]) // "dangote" matches "Dangote Cement"
      );
    });

    if (match) return this._formatNGXResult(match);

    return null; // Not in NGX data at all
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

  /**
   * 🕸️ Fallback Scraper for Kwayisi (used only if Official API fails)
   */
  async _scrapeKwayisiIntoStocks(stocks) {
    const browserHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-NG,en;q=0.9",
      Referer: "https://afx.kwayisi.org/",
    };

    for (const page of [1, 2]) {
      try {
        const url =
          page === 1
            ? "https://afx.kwayisi.org/ngx/"
            : `https://afx.kwayisi.org/ngx/?page=${page}`;
        const { data } = await axios.get(url, {
          family: 4,
          timeout: 40000,
          headers: browserHeaders,
        });
        this._parseKwayisiPage(data, stocks);
        if (page === 1) await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`⚠️ Kwayisi fallback page ${page} failed: ${err.message}`);
      }
    }
  }

  // ✅ Extracted parser — clean separation
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

  // ============================================
  // 📈 GLOBAL STOCKS PATH (Yahoo Finance)
  // ============================================
  async getStockPrice(symbol, rawInput) {
    const cacheKey = `stock:${symbol}`;
    const cached = this.priceCache[cacheKey];
    
    // 🛠️ FIX: Use a dedicated longer TTL (2 mins) for Yahoo Finance
    // to strictly prevent 429 Rate Limits from aggressive polling.
    const yahooTTL = 120000; 

    // Fresh interactive cache hit
    if (cached && Date.now() - cached.ts < yahooTTL) {
      return cached.data;
    }

    // ── GLOBAL STOCKS PATH (Yahoo Finance) ───────────────────────────────────
    try {
      const quote = await yf.quote(symbol);
      if (quote && quote.regularMarketPrice) {
        const result = {
          symbol: quote.symbol,
          name: quote.shortName || quote.longName || quote.symbol,
          blockchain: "Stock Market",
          price: quote.regularMarketPrice,
          currency: quote.currency || "USD",
          change24h: quote.regularMarketChangePercent,
          high52: quote.fiftyTwoWeekHigh || null,
          low52: quote.fiftyTwoWeekLow || null,
          volume: quote.regularMarketVolume || null,
          marketCap: quote.marketCap || null,
          others: [],
        };
        this.priceCache[cacheKey] = { data: result, ts: Date.now() };
        return result;
      }
    } catch (e) {
      // 🚨 Specific Rate Limit Handling
      if (e.message && (e.message.includes("429") || e.message.includes("Too Many Requests"))) {
        console.warn(`⚠️ Yahoo Finance Rate Limit (429) hit for ${symbol}`);
        return {
          symbol,
          name: symbol,
          blockchain: "Stock Market",
          price: null,
          currency: "USD",
          _rateLimited: true,
          others: [],
        };
      }

      // Stale fallback for US/global stocks
      if (cached && Date.now() - cached.ts < this.staleTTL) {
        return cached.data;
      }
    }

    return null;
  }

  // ============================================
  // 📈 TRADITIONAL FUTURES — DYNAMIC YAHOO RESOLUTION
  // Handles ANY futures product from Yahoo Finance.
  // Tries multiple symbol formats: direct, =F suffix, ^ prefix, Yahoo search
  // ============================================
  async getTraditionalFuturesPrice(symbol, rawInput) {
    const cacheKey = `future_dynamic:${symbol}`;
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.ts < this.interactiveTTL) {
      return cached.data;
    }

    // Step 1: Try Yahoo futures resolution via the classifier
    const futuresResult = await this.classifier.resolveFuturesWithYahoo(symbol);
    if (futuresResult) {
      const yahooSymbol = futuresResult.symbol;
      console.log(`🔍 [Futures] Resolved "${symbol}" → Yahoo symbol "${yahooSymbol}"`);

      // Now fetch the price using that Yahoo symbol
      const quote = await this._tryYahooFormats(yahooSymbol);
      if (quote) {
        quote.blockchain = "Futures Market";
        this.priceCache[cacheKey] = { data: quote, ts: Date.now() };
        return quote;
      }
    }

    // Step 2: Try the =F suffix directly for the raw input symbol
    // This handles cases like "SUGAR" → try "SUGAR=F"
    const yahooResult = await this._tryYahooFormats(symbol);
    if (yahooResult) {
      yahooResult.blockchain = "Futures Market";
      this.priceCache[cacheKey] = { data: yahooResult, ts: Date.now() };
      return yahooResult;
    }

    // Step 3: Try using the input raw text as a search query to Yahoo
    if (rawInput && rawInput !== symbol) {
      const rawResult = await this._tryYahooFormats(rawInput);
      if (rawResult) {
        rawResult.blockchain = "Futures Market";
        this.priceCache[cacheKey] = { data: rawResult, ts: Date.now() };
        return rawResult;
      }
    }

    // Stale fallback
    if (cached && Date.now() - cached.ts < this.staleTTL) {
      return cached.data;
    }

    return null;
  }

  // ============================================
  // 🛠️ FIX 6: Alert-optimized batch fetching
  // Uses longer cache TTL + concurrency control
  // ============================================
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

      // Small delay between batches to avoid hammering APIs
      if (i + batchSize < uniqueSymbols.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Map back to original symbols (preserves duplicates)
    const result = {};
    symbols.forEach((symbol) => {
      result[symbol] = prices[symbol] ?? null;
    });
    return result;
  }

  // NEW: Single unified price resolver for alert monitoring
  // This is the core method that routes each asset to the right API
  async _resolveAlertPrice(symbol) {
    const sym = symbol.toUpperCase().trim();

    // ── Step 1: Classify the asset ──────────────────────────────────────
    const classification = this.classifier.classify(sym);
    const { type } = classification;

    console.log(`🔍 [Alert Monitor] ${sym} → ${type}`);

    // ── Step 2: Route to correct API based on type ──────────────────────

    // 🚀 Crypto Perpetuals (Binance / Bybit)
    if (type === 'CRYPTO_FUTURE') {
      const baseSymbol = classification.symbol;
      return await this.getBinanceFuturesPrice(baseSymbol);
    }

    // 📈 Traditional Futures (Yahoo Finance ES=F, NQ=F, GC=F etc)
    if (type === 'TRADITIONAL_FUTURE') {
      const futureSymbol = classification.symbol; // already mapped e.g. "ES=F"
      const result = await this.getStockPrice(futureSymbol, sym);
      return result?.price ?? null;
    }

    // 💎 CRYPTO — DIA API (existing, fast)
    if (type === "CRYPTO") {
      return await this._resolveCryptoPrice(sym);
    }

    // 💱 FOREX — FX Rates API (existing, fast)
    if (type === "FOREX") {
      return await this.getForexPrice(sym);
    }

    // 🏆 COMMODITY — DIA Commodity API (existing)
    if (type === "COMMODITY") {
      return await this.getCommodityPrice(sym);
    }

    // 🎲 SYNTHETIC INDEX — Deriv Tick API
    if (type === 'SYNTHETIC_INDEX') {
      try {
        const price = await derivService.fetchTick(classification.symbol);
        return price;
      } catch (e) {
        console.warn(`⚠️ [Alert Monitor] Deriv fetch failed for ${classification.symbol}:`, e.message);
        return null;
      }
    }

    // 🇳🇬 NGX STOCK — NGX cache (refreshes every 5min)
    if (type === "NGX_STOCK") {
      return await this._resolveNGXPrice(sym);
    }

    // 📈 US/GLOBAL STOCK — Yahoo Finance
    if (type === "US_STOCK" || type === "STOCK") {
      return await this._resolveStockPrice(sym);
    }

    // 🔀 DYNAMIC — try all in order, return first hit
    if (type === "DYNAMIC") {
      // Try crypto first
      const cryptoPrice = await this._resolveCryptoPrice(sym);
      if (cryptoPrice !== null) return cryptoPrice;

      // Try NGX
      const ngxPrice = await this._resolveNGXPrice(sym);
      if (ngxPrice !== null) return ngxPrice;

      // Try forex
      const forexPrice = await this.getForexPrice(sym);
      if (forexPrice !== null) return forexPrice;

      // Try US stocks last (slowest)
      const stockPrice = await this._resolveStockPrice(sym);
      if (stockPrice !== null) return stockPrice;

      return null;
    }

    return null;
  }

  // ── Private resolvers ────────────────────────────────────────────────────

  async _resolveCryptoPrice(sym) {
    try {
      await this.loadAssetList();

      let resolvedSymbol = sym;

      // Handle "SOL (Solana)" format stored in some alerts
      const parenMatch = sym.match(/^([A-Z0-9]+)\s*\((.+)\)$/);
      let chain = null;
      if (parenMatch) {
        resolvedSymbol = parenMatch[1];
        chain = parenMatch[2];
      }

      if (this.nameToSymbol?.[resolvedSymbol]) {
        resolvedSymbol = this.nameToSymbol[resolvedSymbol];
      }

      const options = this.assetsBySymbol[resolvedSymbol];
      if (!options || options.length === 0) return null;

      let selected = null;

      // Match specific chain if requested
      if (chain) {
        selected = options.find(
          (o) =>
            o.blockchain.toUpperCase() === chain.toUpperCase() ||
            o.blockchain.toUpperCase().includes(chain.toUpperCase()),
        );
      }

      // Priority selection if no chain specified
      if (!selected) {
        const priority = [
          "Bitcoin",
          "Ethereum",
          "Solana",
          "Binance Smart Chain",
          "Polygon",
          "The Open Network",
        ];
        const sorted = [...options].sort((a, b) => {
          let pA = priority.indexOf(a.blockchain);
          let pB = priority.indexOf(b.blockchain);
          if (pA === -1) pA = 99;
          if (pB === -1) pB = 99;
          return pA - pB;
        });
        selected = sorted[0];

        // Force correct chain for majors
        if (resolvedSymbol === "BTC") {
          selected =
            options.find((o) => o.blockchain === "Bitcoin") || selected;
        }
        if (resolvedSymbol === "ETH") {
          selected =
            options.find((o) => o.blockchain === "Ethereum") || selected;
        }
      }

      if (!selected) return null;

      // Use alert TTL (60s cache) — less aggressive than interactive (30s)
      return await this.fetchDiaPrice(selected, "alert");
    } catch (e) {
      console.error(`⚠️ Crypto price failed for ${sym}:`, e.message);
      return null;
    }
  }

  async _resolveNGXPrice(sym) {
    try {
      // NGX data is cached for 5 minutes — no per-stock API call needed
      // The entire market is fetched in one batch, so this is essentially free
      const allNGX = await this.fetchNGXMarket(this.db);
      if (!allNGX || Object.keys(allNGX).length === 0) return null;

      // Direct ticker match first
      if (allNGX[sym]) return allNGX[sym].price;

      // Partial match (e.g. "ZENITH" → "ZENITHBANK")
      const match = Object.values(allNGX).find(
        (s) => s.ticker.startsWith(sym) || sym.startsWith(s.ticker),
      );

      return match ? match.price : null;
    } catch (e) {
      console.error(`⚠️ NGX price failed for ${sym}:`, e.message);
      return null;
    }
  }

  async _resolveStockPrice(sym) {
    try {
      const cacheKey = `stock:${sym}`;
      const cached = this.priceCache[cacheKey];

      // Use longer cache for alert monitoring (60s vs 30s interactive)
      if (cached && Date.now() - cached.ts < this.alertTTL) {
        return cached.data?.price || null;
      }

      const quote = await yf.quote(sym);
      if (quote?.regularMarketPrice) {
        const result = {
          symbol: quote.symbol,
          name: quote.shortName || quote.symbol,
          blockchain: "Stock Market",
          price: quote.regularMarketPrice,
          currency: quote.currency || "USD",
          change24h: quote.regularMarketChangePercent,
          others: [],
        };
        this.priceCache[cacheKey] = { data: result, ts: Date.now() };
        return quote.regularMarketPrice;
      }
      return null;
    } catch (e) {
      // Stale fallback
      const cached = this.priceCache[`stock:${sym}`];
      if (cached && Date.now() - cached.ts < this.staleTTL) {
        return cached.data?.price || null;
      }
      console.error(`⚠️ Stock price failed for ${sym}:`, e.message);
      return null;
    }
  }

  cleanupExpiredCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const key of Object.keys(this.priceCache)) {
      if (now - this.priceCache[key].ts > this.staleTTL) {
        delete this.priceCache[key];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired price cache entries`);
    }
  }

  clearPriceCache() {
    this.priceCache = {};
    this.inflightRequests.clear();
    console.log("🗑️ Price cache cleared manually");
  }

  // ============================================
  // Stats method — useful for monitoring
  // ============================================
  getStats() {
    return {
      cachedPrices: Object.keys(this.priceCache).length,
      inflightRequests: this.inflightRequests.size,
      activeRequests: this.activeRequests,
      queuedRequests: this.requestQueue.length,
      knownAssets: Object.keys(this.assetsBySymbol).length,
    };
  }
}

module.exports = PriceService;