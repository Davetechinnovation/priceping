const axios = require("axios");

class PriceService {
  constructor() {
    // 1. CRYPTO APIs
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";
    this.diaAssetApi = "https://api.diadata.org/v1/assetQuotation";

    // 2. COMMODITIES API
    this.diaCommodityApi = "https://api.diadata.org/v1/commodityQuotation";

    // 3. FOREX API
    this.forexListApi = "https://api.fxratesapi.com/currencies";

    // Cache
    this.assetsBySymbol = {}; 
    this.lastCacheUpdate = 0;
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour cache
  }

  // ==========================================
  // 🧠 SMART INPUT NORMALIZER
  // ==========================================
  parseInput(input) {
    if (!input) return { symbol: "", chain: null };

    const cleanInput = input.trim().toUpperCase();
    const parts = cleanInput.split(/\s+/);
    let symbol = parts[0];
    let chain = parts.length > 1 ? parts[1] : null;

    // Manual Overrides
    const symbolMap = {
      'ETHER': "ETH", 'BITCOIN': "BTC", 'DOGE COIN': "DOGE",
      'GOLD': "XAU", 'SILVER': "XAG", 'COPPER': "XG",
      'EURO': "EUR", 'DOLLAR': "USD", 'RIPPLE': "XRP", 'MATIC': "POL",
      'LITECOIN': "LTC",
      // 🐕 SPECIAL DOGS HANDLING: Since TON DOGS is not in API, redirect to Ethereum
      'DOGS': "CAW" // Use CAW Dogs on Ethereum as the closest alternative
    };
    if (symbolMap[symbol]) symbol = symbolMap[symbol];

    // Chain Aliases
    const chainMap = {
      'ETH': "Ethereum", 'BSC': "Binance Smart Chain", 'SOL': "Solana",
      'POLY': "Polygon", 'AVAX': "Avalanche", 'ARB': "Arbitrum",
      'TON': "The Open Network", 'BASE': "Base"
    };
    if (chain && chainMap[chain]) chain = chainMap[chain];

    return { symbol, chain };
  }

  // ==========================================
  // INTELLIGENT ROUTER
  // ==========================================
  async getAssetInfo(input) {
    const originalInput = input; // Store original input
    let { symbol, chain } = this.parseInput(input);
    const cleanSymbol = symbol; 

    // 1. COMMODITIES
    const commodityMap = ['XAU', 'XAG', 'XG', 'WTI', 'BRENT'];
    if (commodityMap.includes(cleanSymbol)) {
        const price = await this.getCommodityPrice(cleanSymbol);
        if (price) {
            return {
                symbol: cleanSymbol,
                name: this.getCommodityName(cleanSymbol),
                blockchain: 'Commodities',
                price: price,
                time: 'Live',
                others: []
            };
        }
    }

    // 2. CRYPTO
    await this.loadAssetList(); 
    
    // A. FIND MATCHES (Exact or Fuzzy)
    let cryptoOptions = this.assetsBySymbol[cleanSymbol];

    if (!cryptoOptions) {
        // Fuzzy search
        const allSymbols = Object.keys(this.assetsBySymbol);
        const fuzzy = allSymbols.find(s => s === cleanSymbol || s.startsWith(cleanSymbol));
        if (fuzzy) {
            symbol = fuzzy; 
            cryptoOptions = this.assetsBySymbol[fuzzy];
        }
    }

    if (cryptoOptions && cryptoOptions.length > 0) {
        
        // 🔍 DEBUG: Log available options for DOGS and CAW
        if (cleanSymbol === 'DOGS' || cleanSymbol === 'CAW') {
            console.log(`🐕 ${cleanSymbol} options before sorting:`, cryptoOptions.map(o => `${o.name} (${o.blockchain})`));
        }
        
        // �� FIX 2: PRIORITY SORTING
        // We ensure "The Open Network" or "Ethereum" comes before "Arbitrum" or "Unknown"
        const chainPriority = [
            "The Open Network", // TON (High priority for DOGS, NOT, etc)
            "Bitcoin", 
            "Ethereum", 
            "Solana", 
            "Base", 
            "Binance Smart Chain", 
            "Polygon"
        ];

        // Sort the array in place
        cryptoOptions.sort((a, b) => {
            const indexA = chainPriority.indexOf(a.blockchain);
            const indexB = chainPriority.indexOf(b.blockchain);
            
            // If both are in priority list, pick the higher one (lower index)
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            // If only A is in list, A comes first
            if (indexA !== -1) return -1;
            // If only B is in list, B comes first
            if (indexB !== -1) return 1;
            // Otherwise maintain default order
            return 0;
        });

        // 🔍 DEBUG: Log results after sorting
        if (cleanSymbol === 'DOGS' || cleanSymbol === 'CAW') {
            console.log(`🐕 ${cleanSymbol} options after sorting:`, cryptoOptions.map(o => `${o.name} (${o.blockchain})`));
            console.log(`🐕 Selected ${cleanSymbol}:`, cryptoOptions[0]);
        }

        // --- SELECT THE BEST CHAIN ---
        let selectedAsset = null;

        if (chain) {
            selectedAsset = cryptoOptions.find(o => o.blockchain.toUpperCase().includes(chain));
        } 
        
        // If no specific chain requested (or not found), take the top sorted result
        if (!selectedAsset) selectedAsset = cryptoOptions[0];

        const cryptoPrice = await this.fetchDiaDataByAddress(selectedAsset);
        
        if (cryptoPrice !== null) {
             // Create list of OTHERS (Display Name + Chain)
             const otherChains = cryptoOptions
                .filter(o => o.blockchain !== selectedAsset.blockchain)
                .map(o => `${o.name || symbol} (${o.blockchain})`); // e.g. "Doggensnout (Arbitrum)"

             return {
                 symbol: originalInput.trim().toUpperCase(), // Show original input (DOGS) not mapped (CAW)
                 name: selectedAsset.name || symbol,
                 blockchain: selectedAsset.blockchain,
                 price: cryptoPrice,
                 time: 'Live',
                 others: otherChains 
             };
        }
    }

    // 3. FOREX (Unchanged)
    const cryptoExclusions = ['USDT', 'USDC', 'BTC', 'ETH', 'SOL', 'DOGS']; // Added DOGS to exclusion
    if (!cryptoExclusions.includes(cleanSymbol)) {
        const forexPrice = await this.getForexPrice(cleanSymbol);
        if (forexPrice !== null) {
            return {
                symbol: cleanSymbol,
                name: `${cleanSymbol} Exchange Rate`,
                blockchain: 'Forex/Fiat',
                price: forexPrice,
                time: 'Live',
                others: []
            };
        }
    }

    return null;
  }

  // Wrapper for simple price fetching
  async getPrice(asset) {
    const info = await this.getAssetInfo(asset);
    return info ? info.price : null;
  }

  // ==========================================
  // BATCH FETCHING
  // ==========================================
  async getMultiplePrices(assets) {
    if (!this.assetsBySymbol || Object.keys(this.assetsBySymbol).length === 0) {
      await this.loadAssetList();
    }
    const prices = {};
    const promises = assets.map(async (asset) => {
        prices[asset.toUpperCase()] = await this.getPrice(asset);
    });
    await Promise.all(promises);
    return prices;
  }

  // ==========================================
  // CRYPTO FETCHING
  // ==========================================
  async getCryptoPrice(input) {
    const info = await this.getAssetInfo(input);
    return info ? info.price : null;
  }

  // ==========================================
  // API HELPERS
  // ==========================================
  async getCommodityPrice(symbol) {
    try {
      const url = `${this.diaCommodityApi}/${symbol}-USD`;
      const response = await axios.get(url, { timeout: 4000 });
      if (response.data && response.data.Price) return parseFloat(response.data.Price);
    } catch (e) { return null; }
    return null;
  }

  getCommodityName(symbol) {
      const names = { 'XAU': 'Gold Ounce', 'XAG': 'Silver Ounce', 'XG': 'Copper', 'WTI': 'Crude Oil' };
      return names[symbol] || symbol;
  }

  async getForexPrice(pair) {
    const cleanPair = pair.trim().toUpperCase();
    if (cleanPair.includes("USD") && (cleanPair.endsWith("T") || cleanPair.endsWith("C"))) return null;

    try {
      if (cleanPair.length === 6) {
        const base = cleanPair.substring(0, 3);
        const target = cleanPair.substring(3, 6);
        const url = `https://api.fxratesapi.com/latest?base=${base}&currencies=${target}&resolution=1m&amount=1&places=6&format=json`;
        const res = await axios.get(url, { timeout: 4000 });
        if (res.data?.rates?.[target]) return parseFloat(res.data.rates[target]);
      } 
      else if (cleanPair.length === 3) {
        const url = `https://api.fxratesapi.com/latest?base=${cleanPair}&currencies=USD&resolution=1m&amount=1&places=6&format=json`;
        const res = await axios.get(url, { timeout: 4000 });
        if (res.data?.rates?.USD) return parseFloat(res.data.rates.USD);
      }
    } catch (e) {}
    return null;
  }

  // ==========================================
  // DATA LOADERS
  // ==========================================
  async loadAssetList() {
    const now = Date.now();
    if (Object.keys(this.assetsBySymbol).length > 0 && now - this.lastCacheUpdate < this.cacheExpiry) return;

    try {
      console.log("📥 Loading Asset List...");
      const response = await axios.get(this.quotedAssetsApi, { timeout: 30000 });
      if (response.data && Array.isArray(response.data)) {
        const tempMap = {};
        response.data.forEach((item) => {
          if (item.Asset && item.Asset.Symbol) {
            const sym = item.Asset.Symbol.toUpperCase();
            if (!tempMap[sym]) tempMap[sym] = [];
            tempMap[sym].push({
              blockchain: item.Asset.Blockchain,
              address: item.Asset.Address,
              name: item.Asset.Name,
            });
          }
        });
        this.assetsBySymbol = tempMap;
        this.lastCacheUpdate = now;
        console.log(`✅ Loaded ${Object.keys(this.assetsBySymbol).length} crypto symbols.`);
      }
    } catch (error) {
      console.error("❌ Error fetching crypto list:", error.message);
    }
  }

  async fetchDiaDataByAddress(info) {
    const url = `${this.diaAssetApi}/${info.blockchain}/${info.address}`;
    try {
      const response = await axios.get(url, { timeout: 10000 });
      return response.data?.Price ? parseFloat(response.data.Price) : null;
    } catch (e) { return null; }
  }

  formatPrice(price, asset) {
    if (price == null) return "Unavailable";
    if (price < 1.0) return `$${price.toFixed(6)}`;
    if (price > 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `$${price.toFixed(4)}`;
  }
} 

module.exports = PriceService;