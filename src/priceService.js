const axios = require("axios");

class PriceService {
  constructor() {
    // Crypto APIs
    this.diadataApi = "https://api.diadata.org/v1/assetQuotation";
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";

    // Forex API
    this.forexListApi = "https://api.fxratesapi.com/currencies";

    // Caches
    this.assetMap = this.initializeAssetMap();
    this.quotedAssetsCache = null;
    this.forexCache = null;

    this.lastCacheUpdate = 0;
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour
  }

  initializeAssetMap() {
    return {
      BTC: {
        blockchain: "Bitcoin",
        address: "0x0000000000000000000000000000000000000000",
      },
      BITCOIN: {
        blockchain: "Bitcoin",
        address: "0x0000000000000000000000000000000000000000",
      },
      ETH: {
        blockchain: "Ethereum",
        address: "0x0000000000000000000000000000000000000000",
      },
      ETHEREUM: {
        blockchain: "Ethereum",
        address: "0x0000000000000000000000000000000000000000",
      },
      BNB: {
        blockchain: "Binance",
        address: "0x0000000000000000000000000000000000000000",
      },
      SOL: {
        blockchain: "Solana",
        address: "0x0000000000000000000000000000000000000000",
      },
      LTC: {
        blockchain: "Litecoin",
        address: "0x0000000000000000000000000000000000000000",
      },
      XRP: {
        blockchain: "Ripple",
        address: "0x0000000000000000000000000000000000000000",
      },
      DOGE: {
        blockchain: "Dogecoin",
        address: "0x0000000000000000000000000000000000000000",
      },
    };
  }

  // ==========================================
  // DYNAMIC LIST FETCHING
  // ==========================================

  async getQuotedAssets() {
    const now = Date.now();
    if (
      this.quotedAssetsCache &&
      now - this.lastCacheUpdate < this.cacheExpiry
    ) {
      return this.quotedAssetsCache;
    }

    try {
      // console.log('🔄 Updating Crypto Asset list...');
      const response = await axios.get(this.quotedAssetsApi, {
        timeout: 30000,
      });

      if (response.data && Array.isArray(response.data)) {
        const assetsMap = {};
        response.data.forEach((item) => {
          if (item.Asset && item.Asset.Symbol) {
            assetsMap[item.Asset.Symbol.toUpperCase()] = {
              blockchain: item.Asset.Blockchain,
              address: item.Asset.Address,
              decimals: item.Asset.Decimals,
              name: item.Asset.Name,
            };
          }
        });
        this.quotedAssetsCache = assetsMap;
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
      console.log("🔄 Updating Forex Currency list...");
      const response = await axios.get(this.forexListApi, { timeout: 10000 });

      if (response.data) {
        this.forexCache = new Set(
          Object.keys(response.data).map((k) => k.toUpperCase()),
        );

        // Remove Crypto symbols if they appear in Forex API to ensure strictness
        this.forexCache.delete("BTC");
        this.forexCache.delete("ETH");
        this.forexCache.delete("SOL");
        this.forexCache.delete("XRP");

        console.log(
          `✅ Loaded ${this.forexCache.size} forex currencies dynamically.`,
        );

        this.forexCache.add("USD");
        this.forexCache.add("EUR");
        return this.forexCache;
      }
    } catch (error) {
      console.error("❌ Error fetching forex list:", error.message);
      if (!this.forexCache)
        return new Set(["USD", "EUR", "GBP", "ILS", "TJS", "JPY"]);
    }
    return this.forexCache;
  }

  // ==========================================
  // STRICT SEPARATION LOGIC
  // ==========================================

  /**
   * STRICTLY checks ONLY Crypto APIs.
   * Returns NULL if not found in Crypto (even if it exists in Forex).
   */
  async getCryptoPrice(asset) {
    const upperAsset = asset.toUpperCase();

    // 1. Check Hardcoded Crypto Map
    if (this.assetMap[upperAsset]) {
      return await this.fetchDiaData(this.assetMap[upperAsset]);
    }

    // 2. Check Dynamic Crypto List
    const cryptoList = await this.getQuotedAssets();
    if (cryptoList[upperAsset]) {
      return await this.fetchDiaData(cryptoList[upperAsset]);
    }

    // ❌ STOP HERE. Do not check Forex.
    console.log(`ℹ️ ${upperAsset} is not a valid Cryptocurrency.`);
    return null;
  }

  /**
   * STRICTLY checks ONLY Forex APIs.
   * Returns NULL if not found in Forex (even if it exists in Crypto).
   */
  async getForexPrice(pair) {
    const upperPair = pair.toUpperCase();

    // 1. Validate against Forex List
    const isForex = await this.isForexPair(upperPair);
    if (!isForex) {
      console.log(`ℹ️ ${upperPair} is not a valid Forex pair.`);
      return null;
    }

    try {
      // CASE 1: 3-Letter Code (TJS -> USD)
      if (upperPair.length === 3) {
        console.log(`🔍 Getting forex rate for ${upperPair}/USD`);
        try {
          const url = `https://api.fxratesapi.com/latest?base=${upperPair}&currencies=USD&resolution=1m&amount=1&places=6&format=json`;
          const response = await axios.get(url, { timeout: 8000 });
          if (response.data?.rates?.USD)
            return parseFloat(response.data.rates.USD);
        } catch (e) {}

        try {
          const res = await axios.get(
            `https://api.frankfurter.app/latest?from=${upperPair}&to=USD`,
          );
          if (res.data?.rates?.USD) return res.data.rates.USD;
        } catch (e) {}
      }

      // CASE 2: 6-Letter Pair (USDILS)
      if (upperPair.length === 6) {
        const base = upperPair.substring(0, 3);
        const target = upperPair.substring(3, 6);

        try {
          const url = `https://api.fxratesapi.com/latest?base=${base}&currencies=${target}&resolution=1m&amount=1&places=6&format=json`;
          const response = await axios.get(url, { timeout: 8000 });
          if (response.data?.rates?.[target])
            return parseFloat(response.data.rates[target]);
        } catch (e) {}
      }
    } catch (error) {
      console.error(`❌ Forex Error: ${error.message}`);
    }

    return null;
  }

  /**
   * Smart wrapper for generic requests (like Alerts).
   * Checks Crypto first, then Forex.
   */
  async getPrice(asset) {
    // 1. Try Crypto
    const cryptoPrice = await this.getCryptoPrice(asset);
    if (cryptoPrice !== null) return cryptoPrice;

    // 2. Try Forex
    const forexPrice = await this.getForexPrice(asset);
    if (forexPrice !== null) return forexPrice;

    return null;
  }

  // ==========================================
  // HELPERS
  // ==========================================

  async isForexPair(asset) {
    const upperAsset = asset.toUpperCase();
    const validCurrencies = await this.getForexCurrencies();

    if (upperAsset.length === 3) return validCurrencies.has(upperAsset);
    if (upperAsset.length === 6) {
      return (
        validCurrencies.has(upperAsset.substring(0, 3)) &&
        validCurrencies.has(upperAsset.substring(3, 6))
      );
    }
    return false;
  }

  async getMultiplePrices(assets) {
    const prices = {};
    for (const asset of assets) {
      prices[asset.toUpperCase()] = await this.getPrice(asset);
      await new Promise((r) => setTimeout(r, 200));
    }
    return prices;
  }

  // ==========================================
  // DETAILED INFO (Used for "Crypto [Asset]" command)
  // ==========================================
  async getAssetInfo(asset) {
    const upperAsset = asset.toUpperCase();

    // 1. Find the asset info (Blockchain & Address)
    let info = this.assetMap[upperAsset];
    if (!info) {
      const list = await this.getQuotedAssets();
      info = list[upperAsset];
    }

    // 2. Fetch and Calculate
    if (info) {
      const url = `${this.diadataApi}/${info.blockchain}/${info.address}`;
      try {
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        if (data && data.Price) {
          const currentPrice = parseFloat(data.Price);
          let changePercent = null;
          let priceYesterday = null;

          // Calculate 24h Change
          if (data.PriceYesterday) {
            priceYesterday = parseFloat(data.PriceYesterday);
            // Formula: ((Current - Previous) / Previous) * 100
            changePercent =
              ((currentPrice - priceYesterday) / priceYesterday) * 100;
          }

          // Format Time: Remove 'T', 'Z' and milliseconds
          // Input: "2026-02-07T21:19:59Z" -> Output: "2026-02-07 21:19:59"
          let readableTime = data.Time;
          try {
            if (data.Time) {
              readableTime = new Date(data.Time)
                .toISOString()
                .replace("T", " ") // Replace T with space
                .split(".")[0]; // Remove .000Z
            }
          } catch (e) {
            // Keep original if parsing fails
          }

          // Return a "Rich" object
          return {
            symbol: data.Symbol,
            name: data.Name,
            price: currentPrice,
            priceYesterday: priceYesterday,
            change: changePercent,
            volume: data.VolumeYesterdayUSD,
            time: readableTime, // <--- Now readable!
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
      crypto: Object.keys(this.assetMap),
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

    if (asset.length === 6 || ["JPY", "ILS", "TJS"].includes(asset)) {
      return price.toFixed(4);
    }

    if (price >= 1000) return `$${price.toFixed(2)}`;
    if (price >= 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
  }
}

module.exports = PriceService;
