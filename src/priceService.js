const axios = require("axios");

class PriceService {
  constructor() {
    this.diadataApi = "https://api.diadata.org/v1/assetQuotation";
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";
    this.forexListApi = "https://api.fxratesapi.com/currencies";

    this.assetMap = {}; // Maps Symbol -> Info (e.g. BTC -> Info)
    this.nameToSymbolMap = {}; // Maps Name -> Symbol (e.g. BITCOIN -> BTC)
    
    this.quotedAssetsCache = null;
    this.forexCache = null;

    this.lastCacheUpdate = 0;
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour
  }

  // ==========================================
  // 🧠 SMART INPUT NORMALIZER
  // ==========================================
  normalizeInput(input) {
    if (!input) return "";
    let cleanInput = input.trim().toUpperCase();

    // 1. Manual Overrides (Common nicknames/Forex/Commodities)
    const manualMappings = {
        'ETHER': 'ETH',
        'DOGE COIN': 'DOGE',
        'GOLD': 'XAU',
        'SILVER': 'XAG',
        'EURO': 'EUR',
        'DOLLAR': 'USD',
        'POUND': 'GBP',
        'SHEKEL': 'ILS',
        'YEN': 'JPY'
    };

    if (manualMappings[cleanInput]) return manualMappings[cleanInput];

    // 2. Dynamic Name Lookup (e.g. "CARDANO" -> "ADA")
    // This uses the map built during getQuotedAssets()
    if (this.nameToSymbolMap[cleanInput]) {
        return this.nameToSymbolMap[cleanInput];
    }

    return cleanInput;
  }

  // ==========================================
  // DYNAMIC LIST FETCHING
  // ==========================================

  async getQuotedAssets() {
    const now = Date.now();
    if (this.quotedAssetsCache && now - this.lastCacheUpdate < this.cacheExpiry) {
      return this.quotedAssetsCache;
    }

    try {
      // console.log('🔄 Updating Crypto Asset list...');
      const response = await axios.get(this.quotedAssetsApi, { timeout: 30000 });

      if (response.data && Array.isArray(response.data)) {
        const assetsMap = {};
        const nameMap = {};

        // 🧠 PRIORITY MAP: Force these symbols to use these blockchains
        const priorityChains = {
            'BTC': 'Bitcoin',
            'ETH': 'Ethereum',
            'BNB': 'Binance Smart Chain',
            'SOL': 'Solana',
            'LTC': 'Litecoin',
            'DOGE': 'Dogecoin',
            'XRP': 'Ripple',
            'MATIC': 'Polygon',
            'AVAX': 'Avalanche',
            'ADA': 'Cardano',
            'DOT': 'Polkadot'
        };

        response.data.forEach((item) => {
          if (item.Asset && item.Asset.Symbol) {
            const symbol = item.Asset.Symbol.toUpperCase();
            const name = item.Asset.Name ? item.Asset.Name.toUpperCase() : null;
            const blockchain = item.Asset.Blockchain;

            const newEntry = {
              blockchain: blockchain,
              address: item.Asset.Address,
              decimals: item.Asset.Decimals,
              name: item.Asset.Name,
            };

            // 1. Populate Symbol Map (Handle Priority)
            if (assetsMap[symbol]) {
                if (priorityChains[symbol] && (blockchain === priorityChains[symbol] || blockchain === 'Binance')) {
                    assetsMap[symbol] = newEntry;
                } else if (!priorityChains[symbol] && (blockchain === 'Bitcoin' || blockchain === 'Ethereum')) {
                    assetsMap[symbol] = newEntry;
                }
            } else {
                assetsMap[symbol] = newEntry;
            }

            // 2. Populate Name Map (Dynamic Mapping)
            // e.g. nameMap["CARDANO"] = "ADA"
            if (name) {
                // Only overwrite if it's a priority chain (to avoid weird token names stealing the spot)
                if (!nameMap[name] || (priorityChains[symbol] && blockchain === priorityChains[symbol])) {
                    nameMap[name] = symbol;
                }
            }
          }
        });
        
        this.quotedAssetsCache = assetsMap;
        this.nameToSymbolMap = nameMap; // Save the dynamic name map
        return assetsMap;
      }
    } catch (error) {
      console.error("❌ Error fetching crypto list:", error.message);
    }
    return this.quotedAssetsCache || {};
  }

  async getForexCurrencies() {
    if (this.forexCache && this.forexCache.size > 0) return this.forexCache;

    try {
      // console.log("🔄 Updating Forex Currency list...");
      const response = await axios.get(this.forexListApi, { timeout: 10000 });

      if (response.data) {
        this.forexCache = new Set(Object.keys(response.data).map((k) => k.toUpperCase()));
        
        // Remove Crypto symbols from Forex list
        this.forexCache.delete("BTC"); this.forexCache.delete("ETH"); this.forexCache.delete("SOL"); 
        this.forexCache.delete("XRP"); this.forexCache.delete("BNB"); this.forexCache.delete("LTC");

        console.log(`✅ Loaded ${this.forexCache.size} forex currencies dynamically.`);
        this.forexCache.add("USD"); this.forexCache.add("EUR");
        return this.forexCache;
      }
    } catch (error) {
      if (!this.forexCache) return new Set(["USD", "EUR", "GBP", "ILS", "TJS", "JPY"]);
    }
    return this.forexCache;
  }

  // ==========================================
  // PRICING LOGIC
  // ==========================================

  async getCryptoPrice(asset) {
    // 1. Ensure list is loaded so name mapping works
    if (!this.quotedAssetsCache) await this.getQuotedAssets();

    // 2. Normalize (Handles "Bitcoin" -> "BTC" automatically now)
    const upperAsset = this.normalizeInput(asset); 
    
    // 3. Look up
    if (this.quotedAssetsCache[upperAsset]) {
      return await this.fetchDiaData(this.quotedAssetsCache[upperAsset]);
    }

    console.log(`ℹ️ ${upperAsset} is not a valid Cryptocurrency.`);
    return null;
  }

  async getForexPrice(pair) {
    const upperPair = this.normalizeInput(pair);

    if (!(await this.isForexPair(upperPair))) {
      console.log(`ℹ️ ${upperPair} is not a valid Forex pair.`);
      return null;
    }

    try {
      if (upperPair.length === 3) {
        try {
          const url = `https://api.fxratesapi.com/latest?base=${upperPair}&currencies=USD&resolution=1m&amount=1&places=6&format=json`;
          const response = await axios.get(url, { timeout: 8000 });
          if (response.data?.rates?.USD) return parseFloat(response.data.rates.USD);
        } catch (e) {}
        try {
            const res = await axios.get(`https://api.frankfurter.app/latest?from=${upperPair}&to=USD`);
            if (res.data?.rates?.USD) return res.data.rates.USD;
        } catch (e) {}
      }

      if (upperPair.length === 6) {
        const base = upperPair.substring(0, 3);
        const target = upperPair.substring(3, 6);
        try {
          const url = `https://api.fxratesapi.com/latest?base=${base}&currencies=${target}&resolution=1m&amount=1&places=6&format=json`;
          const response = await axios.get(url, { timeout: 8000 });
          if (response.data?.rates?.[target]) return parseFloat(response.data.rates[target]);
        } catch (e) {}
      }
    } catch (error) { console.error(`❌ Forex Error: ${error.message}`); }
    return null;
  }

  async getPrice(asset) {
    // Ensure lists loaded for normalization
    if (!this.quotedAssetsCache) await this.getQuotedAssets();

    const normalized = this.normalizeInput(asset);
    
    const cryptoPrice = await this.getCryptoPrice(normalized);
    if (cryptoPrice !== null) return cryptoPrice;
    
    const forexPrice = await this.getForexPrice(normalized);
    if (forexPrice !== null) return forexPrice;
    
    return null;
  }

  async isForexPair(asset) {
    const upperAsset = this.normalizeInput(asset);
    const validCurrencies = await this.getForexCurrencies();

    if (upperAsset.length === 3) return validCurrencies.has(upperAsset);
    if (upperAsset.length === 6) {
      return (validCurrencies.has(upperAsset.substring(0, 3)) && validCurrencies.has(upperAsset.substring(3, 6)));
    }
    return false;
  }

  async getMultiplePrices(assets) {
    // Warm up cache first to ensure normalization works for batch requests
    if (!this.quotedAssetsCache) await this.getQuotedAssets();

    const prices = {};
    for (const asset of assets) {
      prices[asset.toUpperCase()] = await this.getPrice(asset);
      await new Promise((r) => setTimeout(r, 200));
    }
    return prices;
  }

  async getAssetInfo(asset) {
    // 1. Ensure list is loaded
    if (!this.quotedAssetsCache) await this.getQuotedAssets();
    
    // 2. Normalize input (Name -> Symbol)
    const upperAsset = this.normalizeInput(asset);
    
    // 3. Fetch Info
    const list = this.quotedAssetsCache;
    const info = list[upperAsset];

    if (info) {
      const url = `${this.diadataApi}/${info.blockchain}/${info.address}`;
      try {
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        if (data && data.Price) {
          const currentPrice = parseFloat(data.Price);
          let changePercent = null;
          let priceYesterday = null;

          if (data.PriceYesterday) {
            priceYesterday = parseFloat(data.PriceYesterday);
            changePercent = ((currentPrice - priceYesterday) / priceYesterday) * 100;
          }

          let readableTime = data.Time;
          try {
            if (data.Time) {
              readableTime = new Date(data.Time).toISOString().replace("T", " ").split(".")[0];
            }
          } catch (e) {}

          return {
            symbol: data.Symbol,
            name: data.Name,
            price: currentPrice,
            priceYesterday: priceYesterday,
            change: changePercent,
            volume: data.VolumeYesterdayUSD,
            time: readableTime,
          };
        }
      } catch (e) {
        console.error(`Error fetching asset info: ${e.message}`);
        return null;
      }
    }
    return null;
  }

  getSupportedAssets() {
    return {
      crypto: "All supported cryptocurrencies (Dynamic from API)",
      forex: "All Major & Exotic pairs (Dynamic)",
    };
  }

  async fetchDiaData(info) {
    try {
      const url = `${this.diadataApi}/${info.blockchain}/${info.address}`;
      const response = await axios.get(url, { timeout: 20000 });
      return response.data?.Price ? parseFloat(response.data.Price) : null;
    } catch (e) {
      return null;
    }
  }

  formatPrice(price, asset) {
    if (price == null) return "Unavailable";
    const cleanAsset = this.normalizeInput(asset);
    
    if (cleanAsset.length === 6 || ["JPY", "ILS", "TJS", "XAU", "XAG"].includes(cleanAsset)) {
      return price.toFixed(4);
    }
    if (price >= 1000) return `$${price.toFixed(2)}`;
    if (price >= 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
  }
}

module.exports = PriceService;