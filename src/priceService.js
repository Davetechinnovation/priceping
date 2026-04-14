const axios = require("axios");
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

class PriceService {
  constructor() {
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";
    this.diaAssetApi = "https://api.diadata.org/v1/assetQuotation";
    this.diaCommodityApi = "https://api.diadata.org/v1/commodityQuotation";
    this.forexApi = "https://api.fxratesapi.com/latest";

    this.forexApi = "https://api.fxratesapi.com/latest";
    this.itickToken = process.env.ITICK_API_KEY || "4e6f333e9e3d4a8397a5bbe6c131203679c2528cb2cd46d5b7959c5465e4ddd1";

    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    // Common NGX mapper (user alias -> exact NGX ticker)
    this.ngxMapper = {
      "MTN": "MTNN",
      "MTNNG": "MTNN",
      "ZENITH": "ZENITHBANK",
      "DANGOTE": "DANGCEM",
      "GTB": "GTCO",
      "GTBANK": "GTCO",
      "UBA": "UBA",
      "ACCESS": "ACCESSCORP",
      "ACCESSBANK": "ACCESSCORP",
      "FBN": "FBNH",
      "FIRSTBANK": "FBNH",
      "AIRTEL": "AIRTELAFRI",
      "STANBIC": "STANBIC",
      "SEPLAT": "SEPLAT",
      "OANDO": "OANDO",
      "FIDELITY": "FIDELITYBK",
      "STERLING": "STERLINGBANK"
    };

    // Human-readable names for NGX tickers
    this.ngxNames = {
      "MTNN": "MTN Nigeria",
      "ZENITHBANK": "Zenith Bank",
      "DANGCEM": "Dangote Cement",
      "GTCO": "Guaranty Trust Holding",
      "UBA": "United Bank for Africa",
      "ACCESSCORP": "Access Holdings",
      "FBNH": "FBN Holdings",
      "AIRTELAFRI": "Airtel Africa",
      "STANBIC": "Stanbic IBTC",
      "SEPLAT": "Seplat Energy",
      "OANDO": "Oando",
      "FIDELITYBK": "Fidelity Bank",
      "STERLINGBANK": "Sterling Bank"
    };

    // ============================================
    // 🛠️ FIX 1: Reuse TCP connections (keep-alive)
    // Without this, every request opens a new socket.
    // At 100+ requests/30s you exhaust OS connections.
    // ============================================
    this.httpClient = axios.create({
      headers: this.headers,
      timeout: 8000,
      httpAgent: new (require("http").Agent)({ keepAlive: true, maxSockets: 15 }),
      httpsAgent: new (require("https").Agent)({ keepAlive: true, maxSockets: 15 }),
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

    // ============================================
    // 🛠️ FIX 4: Concurrency limiter
    // Max N simultaneous API calls to avoid rate limits
    // ============================================
    this.maxConcurrent = 8;
    this.activeRequests = 0;
    this.requestQueue = [];
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
    let rawInput = input.toUpperCase().trim();
    let symbol = rawInput;
    let specificChain = null;

    const parenMatch = rawInput.match(/^([A-Z0-9]+)\s*\((.+)\)$/);
    if (parenMatch) {
      symbol = parenMatch[1];
      specificChain = parenMatch[2];
    } else {
      const parts = rawInput.split(" ");
      symbol = parts[0];
      if (parts.length > 1) specificChain = parts.slice(1).join(" ");
    }

    // 🏆 COMMODITIES
    if (
      ["GOLD", "XAU", "SILVER", "XAG", "OIL", "WTI", "BRENT"].includes(symbol)
    ) {
      if (symbol === "GOLD") symbol = "XAU";
      if (symbol === "SILVER") symbol = "XAG";
      const price = await this.getCommodityPrice(symbol);
      if (price)
        return {
          symbol,
          name: symbol,
          blockchain: "Commodities",
          price,
          others: [],
        };
    }

    // 💎 CRYPTO
    await this.loadAssetList();

    if (this.nameToSymbol && this.nameToSymbol[symbol]) {
      symbol = this.nameToSymbol[symbol];
    }

    if (symbol === "DOGS") symbol = "CAW";
    if (symbol === "BITCOIN") symbol = "BTC";

    let options = this.assetsBySymbol[symbol];

    if (options) {
      let selected = null;

      if (specificChain) {
        selected = options.find(
          (o) => o.blockchain.toUpperCase() === specificChain,
        );
        if (!selected) {
          selected = options.find((o) =>
            o.blockchain.toUpperCase().includes(specificChain),
          );
        }
        if (!selected) {
          console.log(
            `⚠️ Chain '${specificChain}' not found for ${symbol}. Skipping fallback.`,
          );
          return null;
        }
      }

      if (!selected && !specificChain) {
        const priority = [
          "Bitcoin",
          "Ethereum",
          "Solana",
          "Binance Smart Chain",
          "Polygon",
          "The Open Network",
        ];
        options.sort((a, b) => {
          let pA = priority.indexOf(a.blockchain);
          let pB = priority.indexOf(b.blockchain);
          if (pA === -1) pA = 99;
          if (pB === -1) pB = 99;
          return pA - pB;
        });
        selected = options[0];

        if (symbol === "BTC") {
          const realBTC = options.find((o) => o.blockchain === "Bitcoin");
          if (realBTC) selected = realBTC;
        }
        if (symbol === "ETH") {
          const realETH = options.find((o) => o.blockchain === "Ethereum");
          if (realETH) selected = realETH;
        }
      }

      if (selected) {
        const price = await this.fetchDiaPrice(selected);
        if (price !== null) {
          const rawOthers = options.filter(
            (o) => o.blockchain !== selected.blockchain,
          );
          const uniqueOthers = [];
          const seenChains = new Set();
          for (const o of rawOthers) {
            if (!seenChains.has(o.blockchain)) {
              seenChains.add(o.blockchain);
              uniqueOthers.push(o);
            }
          }

          return {
            symbol: symbol,
            name: selected.name,
            blockchain: selected.blockchain,
            address: selected.address,
            price: price,
            others: uniqueOthers,
          };
        }
      }
    }

    // 💱 FOREX
    if (symbol.length === 3 || symbol.length === 6) {
      const forexPrice = await this.getForexPrice(symbol);
      if (forexPrice !== null) {
        return {
          symbol: symbol,
          name:
            symbol.length === 6
              ? `${symbol.substring(0, 3)}/${symbol.substring(3, 6)}`
              : `${symbol}/USD`,
          blockchain: "Forex Market",
          price: forexPrice,
          others: [],
        };
      }
    }

    // 📈 STOCKS (US & Nigerian)
    const stockInfo = await this.getStockPrice(symbol, rawInput);
    if (stockInfo !== null) {
      return stockInfo;
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

  formatPrice(price, symbol) {
    if (!price) return "N/A";
    if (
      ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"].some((s) => symbol.includes(s))
    ) {
      return `${price.toFixed(5)}`;
    }
    if (price < 1.0) return `$${price.toFixed(6)}`;
    if (price > 1000)
      return `$${price.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    return `$${price.toFixed(4)}`;
  }

  async getPrice(asset) {
    const info = await this.getAssetInfo(asset);
    return info ? info.price : null;
  }

  async getForexPrice(pair) {
    if (["USDT", "USDC", "DOGE", "BTC", "ETH", "SOL", "XRP"].includes(pair))
      return null;

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
  // 📈 STOCK MARKET FETCHING (Foreign + NGX)
  // ============================================
  async getStockPrice(symbol, rawInput) {
    const cacheKey = `stock:${symbol}`;
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.ts < this.interactiveTTL) {
      return cached.data;
    }

    let isNGX = false;
    let mappedSymbol = symbol;

    // Check if it's explicitly labeled or mapped to NGX
    if (this.ngxMapper[symbol] || rawInput.includes("NIGERIA") || rawInput.includes("NGX")) {
      isNGX = true;
      mappedSymbol = this.ngxMapper[symbol] || symbol;
    }

    // Full NGX ticker list
    const NGX_TICKERS = ['DANGCEM', 'ZENITHBANK', 'MTNN', 'GTCO', 'UBA', 'ACCESSCORP', 'FBNH', 'AIRTELAFRI', 'STANBIC', 'SEPLAT', 'OANDO', 'FIDELITYBK', 'STERLINGBANK'];

    try {
      if (isNGX || NGX_TICKERS.includes(symbol)) {
        // Fetch from iTick
        mappedSymbol = this.ngxMapper[symbol] || symbol;
        const res = await this.httpClient.get(`https://api.itick.org/stock/quote?region=NG&code=${mappedSymbol}`, {
          headers: { 'accept': 'application/json', 'token': this.itickToken }
        });
        
        if (res.data && res.data.data && res.data.data.ld) {
          const friendlyName = this.ngxNames[mappedSymbol] || mappedSymbol;
          const result = {
            symbol: mappedSymbol,
            name: `${friendlyName} (NGX)`,
            blockchain: "Stock Market",
            price: res.data.data.ld,
            currency: "NGN",
            change24h: res.data.data.chp,
            others: [],
          };
          this.priceCache[cacheKey] = { data: result, ts: Date.now() };
          return result;
        }
      } else {
        // Fetch from Yahoo Finance (US/Global)
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
      }
    } catch (e) {
      // If Yahoo throws, we try the stale cache fallback
      const cachedStale = this.priceCache[cacheKey];
      if (cachedStale && Date.now() - cachedStale.ts < this.staleTTL) {
         return cachedStale.data;
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