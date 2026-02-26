const axios = require("axios");

class PriceService {
  constructor() {
    this.quotedAssetsApi = "https://api.diadata.org/v1/quotedAssets";
    this.diaAssetApi = "https://api.diadata.org/v1/assetQuotation";
    this.diaCommodityApi = "https://api.diadata.org/v1/commodityQuotation";
    this.forexApi = "https://api.fxratesapi.com/latest";
    
    this.headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    this.assetsBySymbol = {}; 
    this.lastCacheUpdate = 0;
  }

  async loadAssetList() {
    if (Date.now() - this.lastCacheUpdate < 3600000 && Object.keys(this.assetsBySymbol).length > 0) return;
    try {
      console.log("📥 Updating Crypto List...");
      const res = await axios.get(this.quotedAssetsApi, { headers: this.headers, timeout: 15000 });
      const temp = {};
      
      if(res.data) {
          res.data.forEach(item => {
            const s = item.Asset.Symbol.toUpperCase();
            if (!temp[s]) temp[s] = [];
            
            // ============================================
            // 🛠️ FIX: Deduplicate by (symbol + blockchain)
            // Only keep ONE token per symbol per chain.
            // This prevents fake/duplicate tokens on the 
            // same chain from showing up as separate options.
            // ============================================
            const alreadyHasChain = temp[s].some(
              existing => existing.blockchain === item.Asset.Blockchain
            );
            if (!alreadyHasChain) {
              temp[s].push({
                blockchain: item.Asset.Blockchain,
                address: item.Asset.Address,
                name: item.Asset.Name,
                symbol: s
              });
            }
          });
          this.assetsBySymbol = temp;
          this.lastCacheUpdate = Date.now();
          console.log(`✅ Crypto List Updated (${Object.keys(temp).length} assets)`);
      }
    } catch (e) { console.error("⚠️ API Error loadAssetList:", e.message); }
  }

  // Fetch price by specific chain/address
  async getPriceByChainAddress(blockchain, address) {
      try {
          const url = `${this.diaAssetApi}/${blockchain}/${address}`;
          const res = await axios.get(url, { headers: this.headers, timeout: 5000 });
          return res.data.Price;
      } catch(e) { 
          return null; 
      }
  }

  async getAssetInfo(input) {
    let rawInput = input.toUpperCase().trim();
    
    let symbol = rawInput;
    let specificChain = null;

    // Detect "ETH (Base)" format
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
    if (['GOLD','XAU','SILVER','XAG','OIL','WTI','BRENT'].includes(symbol)) {
        if(symbol === 'GOLD') symbol = 'XAU';
        if(symbol === 'SILVER') symbol = 'XAG';
        const price = await this.getCommodityPrice(symbol);
        if (price) return { symbol, name: symbol, blockchain: 'Commodities', price, others: [] };
    }

    // 💎 CRYPTO
    await this.loadAssetList();
    
    if(symbol === 'DOGS') symbol = 'CAW'; 
    if(symbol === 'BITCOIN') symbol = 'BTC';

    let options = this.assetsBySymbol[symbol];

    if (options) {
        let selected = null;

        // 🔍 1. SPECIFIC CHAIN SEARCH
        if (specificChain) {
            selected = options.find(o => o.blockchain.toUpperCase() === specificChain);
            if (!selected) {
                selected = options.find(o => o.blockchain.toUpperCase().includes(specificChain));
            }
            if (!selected) {
                console.log(`⚠️ Chain '${specificChain}' not found for ${symbol}. Skipping fallback.`);
                return null; 
            }
        }

        // 🔍 2. DEFAULT PRIORITY SEARCH
        if (!selected && !specificChain) {
            const priority = ['Bitcoin', 'Ethereum', 'Solana', 'Binance Smart Chain', 'Polygon', 'The Open Network'];
            options.sort((a, b) => {
                let pA = priority.indexOf(a.blockchain);
                let pB = priority.indexOf(b.blockchain);
                if (pA === -1) pA = 99;
                if (pB === -1) pB = 99;
                return pA - pB;
            });
            selected = options[0];

            if (symbol === 'BTC') {
                const realBTC = options.find(o => o.blockchain === 'Bitcoin');
                if (realBTC) selected = realBTC;
            }
            if (symbol === 'ETH') {
                const realETH = options.find(o => o.blockchain === 'Ethereum');
                if (realETH) selected = realETH;
            }
        }

        if (selected) {
            const price = await this.fetchDiaPrice(selected);
            if (price !== null) {
                // ============================================
                // 🛠️ FIX: Deduplicate "others" by blockchain
                // Safety net — even if loadAssetList missed it,
                // never show two options for the same chain.
                // ============================================
                const rawOthers = options.filter(o => 
                  o.blockchain !== selected.blockchain
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
                    others: uniqueOthers
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
                name: symbol.length === 6 ? `${symbol.substring(0,3)}/${symbol.substring(3,6)}` : `${symbol}/USD`,
                blockchain: 'Forex Market',
                price: forexPrice,
                others: []
            };
        }
    }

    return null;
  }

  async fetchDiaPrice(asset) {
    try {
        const url = `${this.diaAssetApi}/${asset.blockchain}/${asset.address}`;
        const res = await axios.get(url, { headers: this.headers, timeout: 5000 });
        return res.data.Price;
    } catch(e) { return null; }
  }

  async getCommodityPrice(sym) {
      try {
          const res = await axios.get(`${this.diaCommodityApi}/${sym}-USD`, { headers: this.headers, timeout: 5000 });
          return res.data.Price;
      } catch(e) { return null; }
  }

  formatPrice(price, symbol) {
      if(!price) return "N/A";
      if (['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'].some(s => symbol.includes(s))) {
          return `${price.toFixed(5)}`;
      }
      if (price < 1.0) return `$${price.toFixed(6)}`;
      if (price > 1000) return `$${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      return `$${price.toFixed(4)}`;
  }

  async getPrice(asset) {
      const info = await this.getAssetInfo(asset);
      return info ? info.price : null;
  }

  async getForexPrice(pair) {
    if (['USDT','USDC','DOGE','BTC','ETH','SOL','XRP'].includes(pair)) return null;
    try {
        let base, target;
        if (pair.length === 6) {
            base = pair.substring(0, 3);
            target = pair.substring(3, 6);
        } else {
            base = pair;
            target = 'USD';
        }
        const url = `${this.forexApi}?base=${base}&currencies=${target}&resolution=1m&amount=1&places=6&format=json`;
        const res = await axios.get(url, { headers: this.headers, timeout: 5000 });
        if (res.data && res.data.rates && res.data.rates[target]) {
            return parseFloat(res.data.rates[target]);
        }
    } catch (e) { }
    return null;
  }

  async getForexCurrencies() { return []; }

  async getMultiplePrices(symbols) {
    const prices = {};
    const promises = symbols.map(async (symbol) => {
      const info = await this.getAssetInfo(symbol);
      prices[symbol] = info ? info.price : null;
    });
    await Promise.all(promises);
    return prices;
  }
}

module.exports = PriceService;