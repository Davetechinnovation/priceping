const axios = require("axios");
const cheerio = require("cheerio");
const http = require("http");
const https = require("https");
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const AssetClassifier = require('./assetClassifier');

class PriceService {
  constructor(db = null) {
    this.db = db;
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";
    this.diaAssetApi = "https://api.diadata.org/v1/assetQuotation";
    this.diaCommodityApi = "https://api.diadata.org/v1/commodityQuotation";
    this.forexApi = "https://api.fxratesapi.com/latest";
    this.alphaVantageKey = process.env.ALPHA_VANTAGE_KEY || null;
    this.itickKey = process.env.ITICK_API_KEY || null;

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
    // ============================================
    // 🧠 STEP 1: CLASSIFY THE INPUT
    // ============================================
    const classification = this.classifier.classify(input);
    const { type, symbol, chain, confidence } = classification;

    console.log(`🔍 Classified "${input}" as ${type} (${confidence}% confidence) → ${symbol}`);

    // ============================================
    // 🏆 COMMODITIES
    // ============================================
    if (type === 'COMMODITY') {
      const price = await this.getCommodityPrice(symbol);
      if (price) {
        return { symbol, name: symbol, blockchain: "Commodities", price, currency: "USD", others: [] };
      }
    }

    // ============================================
    // 💎 CRYPTO (High confidence OR dynamic fallback)
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
          const priority = ["Bitcoin", "Ethereum", "Solana", "Binance Smart Chain", "Polygon", "The Open Network"];
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
          if (price !== null) {
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

      // If crypto failed and type was CRYPTO, try stocks next
      if (type === 'CRYPTO') {
        // Fall through to stock lookup
      } else if (type === 'DYNAMIC') {
        // Continue to next services
      }
    }

    // ============================================
    // 💱 FOREX
    // ============================================
    if (type === 'FOREX' || type === 'DYNAMIC') {
      const forexPrice = await this.getForexPrice(symbol);
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
    // 📈 US & GLOBAL STOCKS (Yahoo Finance)
    // Yahoo covers NYSE, NASDAQ, LSE, TSX, ASX, etc.
    // ============================================
    if (type === 'US_STOCK' || type === 'STOCK' || type === 'DYNAMIC') {
      const stockInfo = await this.getStockPrice(symbol, input);
      if (stockInfo !== null) return stockInfo;
    }

    // ============================================
    // 🇳🇬 NIGERIAN STOCKS (Last resort OR explicit NGX type)
    // Only fetch Kwayisi if:
    // 1. Classified as NGX_STOCK, OR
    // 2. All other lookups failed (DYNAMIC fallback)
    // ============================================
    if (type === 'NGX_STOCK' || type === 'DYNAMIC') {
      const allNGX = await this.fetchNGXMarket(this.db);

      if (allNGX && Object.keys(allNGX).length > 0) {
        let matchedStock = allNGX[symbol]; // Direct ticker match

        // Fuzzy match for company names
        if (!matchedStock && symbol.length >= 5) {
          matchedStock = Object.values(allNGX).find(s =>
            s.name.toUpperCase() === symbol ||
            s.name.toUpperCase().startsWith(symbol + " ") ||
            s.name.toUpperCase().includes(symbol)
          );
        }

        if (matchedStock) {
          return {
            symbol: matchedStock.ticker,
            name: `${matchedStock.name} (NGX)`,
            blockchain: "Stock Market",
            price: matchedStock.price,
            currency: "NGN",
            change24h: matchedStock.change,
            others: [],
          };
        }
      }

      // Fallback if Kwayisi down but we know it's NGX
      if (type === 'NGX_STOCK') {
        return {
          symbol: symbol,
          name: `${symbol} (NGX)`,
          blockchain: "Stock Market",
          price: null,
          currency: "NGN",
          _unavailable: true,
          others: [],
        };
      }
    }

    // ============================================
    // ❌ NOT FOUND
    // ============================================
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
        // 🛠️ FIX 5: Stale fallback
        // If API is down or rate-limited, serve last known
        // price instead of returning null (which breaks alerts)
        // ============================================
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
    try {
      const cacheKey = `commodity:${sym}`;
      const cached = this.priceCache[cacheKey];
      if (cached && Date.now() - cached.ts < this.interactiveTTL) {
        return cached.price;
      }
      const res = await this.httpClient.get(
        `${this.diaCommodityApi}/${sym}-USD`,
      );
      const price = res.data.Price;
      this.priceCache[cacheKey] = { price, ts: Date.now() };
      return price;
    } catch (e) {
      const cacheKey = `commodity:${sym}`;
      const cached = this.priceCache[cacheKey];
      if (cached && Date.now() - cached.ts < this.staleTTL) return cached.price;
      return null;
    }
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

    const cacheKey = `forex:${pair}`;
    const cached = this.priceCache[cacheKey];

    if (cached && Date.now() - cached.ts < this.interactiveTTL) {
      return cached.price;
    }

    try {
      let base, target;
      if (pair.length === 6) {
        base = pair.substring(0, 3);
        target = pair.substring(3, 6);
      } else {
        base = pair;
        target = "USD";
      }
      const url = `${this.forexApi}?base=${base}&currencies=${target}&resolution=1m&amount=1&places=6&format=json`;
      const res = await this.httpClient.get(url);
      if (res.data && res.data.rates && res.data.rates[target]) {
        const price = parseFloat(res.data.rates[target]);
        this.priceCache[cacheKey] = { price, ts: Date.now() };
        return price;
      }
    } catch (e) {
      const cached2 = this.priceCache[cacheKey];
      if (cached2 && Date.now() - cached2.ts < this.staleTTL) return cached2.price;
    }
    return null;
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

      // ✅ 1. In-memory cache still fresh
      if (
        this.ngxCache.data &&
        Object.keys(this.ngxCache.data).length > 0 &&
        now - this.ngxCache.lastUpdate < this.ngxTTL
      ) {
        return this.ngxCache.data;
      }

      // ✅ 2. MongoDB persistence layer (survives Render restarts)
      if (db) {
        try {
          const col = db.collection('ngx_cache');
          const cached = await col.findOne({ _id: 'ngx_stocks' });
          if (cached && now - cached.updatedAt < this.ngxTTL) {
            console.log(`📦 NGX: MongoDB cache hit — ${Object.keys(cached.stocks).length} stocks`);
            this.ngxCache = { data: cached.stocks, lastUpdate: cached.updatedAt };
            return cached.stocks;
          }
        } catch (e) {
          console.warn('⚠️ MongoDB NGX cache read failed:', e.message);
        }
      }

      // ✅ 3. Full browser headers — defeats WAF fingerprinting
      const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-NG,en;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://afx.kwayisi.org/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Sec-CH-UA': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"Windows"',
      };

      // ✅ 4. Fetch with retry + exponential backoff
      const fetchPageWithRetry = async (page, maxRetries = 3) => {
        const url = page === 1
          ? 'https://afx.kwayisi.org/ngx/'
          : `https://afx.kwayisi.org/ngx/?page=${page}`;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`🌐 [Kwayisi] Page ${page}, attempt ${attempt}/${maxRetries}`);
            const start = Date.now();

            const { data } = await axios.get(url, {
              family: 4,
              timeout: 40000, // 40s — Render needs breathing room
              headers: browserHeaders,
            });

            console.log(`✅ [Kwayisi] Page ${page} in ${Date.now() - start}ms`);
            return data;
          } catch (err) {
            const isLast = attempt === maxRetries;
            console.warn(`⚠️ Kwayisi page ${page} attempt ${attempt} failed: ${err.message}`);
            if (isLast) return null;
            // Exponential backoff: 3s, 6s
            await new Promise(r => setTimeout(r, 3000 * attempt));
          }
        }
        return null;
      };

      try {
        console.log('📥 Fetching fresh NGX data from Kwayisi...');
        const stocks = {};

        // Page 1
        const html1 = await fetchPageWithRetry(1);
        if (html1) this._parseKwayisiPage(html1, stocks);

        // Polite delay between pages
        await new Promise(r => setTimeout(r, 2000));

        // Page 2
        const html2 = await fetchPageWithRetry(2);
        if (html2) this._parseKwayisiPage(html2, stocks);

        if (Object.keys(stocks).length > 0) {
          this.ngxCache = { data: stocks, lastUpdate: now };
          console.log(`✅ Loaded ${Object.keys(stocks).length} NGX stocks from Kwayisi.`);

          // ✅ 6. Persist to MongoDB — next restart reads from here
          if (db) {
            try {
              await db.collection('ngx_cache').updateOne(
                { _id: 'ngx_stocks' },
                { $set: { stocks, updatedAt: now } },
                { upsert: true }
              );
              console.log('💾 NGX data saved to MongoDB');
            } catch (e) {
              console.warn('⚠️ MongoDB NGX cache write failed:', e.message);
            }
          }
        } else {
          // ✅ 7. Kwayisi totally down — serve stale MongoDB data
          console.warn('⚠️ Kwayisi returned no stocks, checking MongoDB stale cache...');
          if (db) {
            try {
              const stale = await db.collection('ngx_cache').findOne({ _id: 'ngx_stocks' });
              if (stale?.stocks) {
                console.log(`📦 Serving stale NGX data (${Object.keys(stale.stocks).length} stocks, age: ${Math.round((now - stale.updatedAt) / 60000)}min)`);
                this.ngxCache = { data: stale.stocks, lastUpdate: stale.updatedAt };
              }
            } catch (e) {}
          }
        }

        return this.ngxCache.data;
      } catch (error) {
        console.error('⚠️ Error fetching NGX prices:', error.message);
        return this.ngxCache.data || {};
      } finally {
        this.ngxInflight = null;
      }
    })();

    return this.ngxInflight;
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
    // Fresh interactive cache hit
    if (cached && Date.now() - cached.ts < this.interactiveTTL) {
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
          others: [],
        };
        this.priceCache[cacheKey] = { data: result, ts: Date.now() };
        return result;
      }
    } catch (e) {
      // Stale fallback for US/global stocks
      if (cached && Date.now() - cached.ts < this.staleTTL) {
        return cached.data;
      }
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

    // ============================================
    // Process in batches of maxConcurrent to avoid
    // overwhelming the API. Previous version fired ALL
    // at once with Promise.all — kills you at 50+ assets
    // ============================================
    const batchSize = this.maxConcurrent;

    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize);
      const batchPromises = batch.map(async (symbol) => {
        try {
          // Resolve to blockchain/address first
          await this.loadAssetList();
          let sym = symbol.toUpperCase().trim();

          // Handle "SOL (Solana)" format from alert names
          const parenMatch = sym.match(/^([A-Z0-9]+)\s*\((.+)\)$/);
          let resolvedSymbol = sym;
          let chain = null;

          if (parenMatch) {
            resolvedSymbol = parenMatch[1];
            chain = parenMatch[2];
          }

          if (this.nameToSymbol && this.nameToSymbol[resolvedSymbol]) {
            resolvedSymbol = this.nameToSymbol[resolvedSymbol];
          }
          if (resolvedSymbol === "BITCOIN") resolvedSymbol = "BTC";
          if (resolvedSymbol === "DOGS") resolvedSymbol = "CAW";

          const options = this.assetsBySymbol[resolvedSymbol];
          if (!options || options.length === 0) {
            // Try forex
            const forexPrice = await this.getForexPrice(resolvedSymbol);
            prices[symbol] = forexPrice;
            return;
          }

          let selected = null;
          if (chain) {
            selected = options.find(
              (o) => o.blockchain.toUpperCase() === chain.toUpperCase(),
            );
            if (!selected) {
              selected = options.find((o) =>
                o.blockchain.toUpperCase().includes(chain.toUpperCase()),
              );
            }
          }

          if (!selected) {
            const priority = [
              "Bitcoin", "Ethereum", "Solana",
              "Binance Smart Chain", "Polygon", "The Open Network",
            ];
            const sorted = [...options].sort((a, b) => {
              let pA = priority.indexOf(a.blockchain);
              let pB = priority.indexOf(b.blockchain);
              if (pA === -1) pA = 99;
              if (pB === -1) pB = 99;
              return pA - pB;
            });
            selected = sorted[0];
          }

          if (selected) {
            // 🔑 Use "alert" mode for longer cache TTL
            prices[symbol] = await this.fetchDiaPrice(selected, "alert");
          } else {
            prices[symbol] = null;
          }
        } catch (e) {
          console.error(`⚠️ Price fetch error for ${symbol}:`, e.message);
          prices[symbol] = null;
        }
      });

      await Promise.all(batchPromises);
    }

    // Map back to original symbols
    const result = {};
    symbols.forEach((symbol) => {
      result[symbol] = prices[symbol] ?? null;
    });
    return result;
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