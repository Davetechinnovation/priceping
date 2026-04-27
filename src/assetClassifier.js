class AssetClassifier {
  constructor() {
    // ============================================
    // 🔑 KNOWN HIGH-CONFIDENCE MAPPINGS
    // Only the most common 50-100 tickers to speed up classification
    // Everything else gets dynamic lookup
    // ============================================

    // 🇳🇬 Top 20 Nigerian stocks (most traded)
    this.ngxAliases = {
      'MTN': 'MTNN', 'MTNNG': 'MTNN', 'MTN NIGERIA': 'MTNN',
      'ZENITH': 'ZENITHBANK', 'ZENITH BANK': 'ZENITHBANK',
      'DANGOTE': 'DANGCEM', 'DANGOTE CEMENT': 'DANGCEM',
      'GTB': 'GTCO', 'GTBANK': 'GTCO', 'GUARANTY TRUST': 'GTCO',
      'ACCESS': 'ACCESSCORP', 'ACCESSBANK': 'ACCESSCORP', 'ACCESS BANK': 'ACCESSCORP',
      'FBN': 'FBNH', 'FIRSTBANK': 'FBNH', 'FIRST BANK': 'FBNH',
      'AIRTEL': 'AIRTELAFRI', 'AIRTEL AFRICA': 'AIRTELAFRI',
      'STANBIC': 'STANBIC', 'STANBIC IBTC': 'STANBIC',
      'UBA': 'UBA', 'SEPLAT': 'SEPLAT', 'OANDO': 'OANDO',
      'FIDELITY': 'FIDELITYBK', 'FIDELITY BANK': 'FIDELITYBK',
      'STERLING': 'STERLINGBANK', 'STERLING BANK': 'STERLINGBANK',
      'GLO': 'GLO'
    };

    this.ngxLiveTickers = new Set();

    // 💎 Top 50 cryptocurrencies (by market cap)
    this.topCryptos = new Set([
      'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'MATIC', 'DOT', 'AVAX',
      'SHIB', 'LTC', 'LINK', 'UNI', 'ATOM', 'ETC', 'XLM', 'NEAR', 'ALGO', 'VET',
      'ICP', 'FIL', 'APT', 'HBAR', 'QNT', 'ARB', 'OP', 'MKR', 'AAVE', 'GRT',
      'USDT', 'USDC', 'BUSD', 'DAI', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'TON',
      'TRX', 'BCH', 'CAKE', 'SAND', 'MANA', 'AXS', 'FTM', 'GALA', 'ENJ', 'INJ', 'SEI'
    ]);

    this.cryptoAliases = {
      'BITCOIN': 'BTC', 'ETHEREUM': 'ETH', 'SOLANA': 'SOL', 'BINANCE': 'BNB',
      'RIPPLE': 'XRP', 'CARDANO': 'ADA', 'DOGECOIN': 'DOGE', 'POLYGON': 'MATIC',
      'POLKADOT': 'DOT', 'AVALANCHE': 'AVAX', 'SHIBAINU': 'SHIB', 'LITECOIN': 'LTC'
    };

    this.privateNigerianCompanies = new Set([
      'GLO', 'GLOBACOM',
      '9MOBILE', 'ETISALAT',         // same company, rebranded
      'STARLINK',
      'DANGOTE_CEMENT_PRIVATE',      // the unlisted entities
      'NNPC',                        // state owned
      'GTBANK_PRIVATE',
    ]);

    this.privateNigerianAliases = {
      'GLO':       { name: 'Globacom (GLO)', note: 'Private company — not listed on NGX' },
      'GLOBACOM':  { name: 'Globacom (GLO)', note: 'Private company — not listed on NGX' },
      '9MOBILE':   { name: '9mobile (formerly Etisalat)', note: 'Private company — not listed on NGX' },
      'ETISALAT':  { name: '9mobile (formerly Etisalat)', note: 'Private company — not listed on NGX' },
      'NNPC':      { name: 'NNPC Limited', note: 'State-owned — not listed on NGX' },
    };

    // 📈 Top 50 US stocks (most searched)
    this.topUSStocks = new Set([
      'AAPL', 'TSLA', 'GOOGL', 'GOOG', 'MSFT', 'AMZN', 'META', 'NVDA', 'NFLX',
      'AMD', 'INTC', 'PYPL', 'DIS', 'BA', 'UBER', 'BABA', 'NIO', 'PLTR', 'COIN',
      'SHOP', 'SQ', 'SNAP', 'HOOD', 'RIVN', 'LCID', 'F', 'GM', 'T', 'VZ',
      'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'ADBE', 'CRM',
      'ORCL', 'IBM', 'CSCO', 'QCOM', 'SBUX', 'MCD', 'KO', 'PEP', 'WMT', 'COST'
    ]);

    this.stockAliases = {
      'APPLE': 'AAPL', 'TESLA': 'TSLA', 'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL',
      'MICROSOFT': 'MSFT', 'AMAZON': 'AMZN', 'FACEBOOK': 'META', 'META': 'META',
      'NVIDIA': 'NVDA', 'NETFLIX': 'NFLX', 'DISNEY': 'DIS', 'BOEING': 'BA',
      'ALIBABA': 'BABA', 'PALANTIR': 'PLTR', 'COINBASE': 'COIN'
    };

    // 💱 Common Forex pairs
    this.forexPairs = new Set([
      'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
      'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURAUD', 'EURCHF', 'GBPCHF'
    ]);

    this.forexAliases = {
      'EUUSD': 'EURUSD', 'GBUSD': 'GBPUSD', 'GBPUS': 'GBPUSD',
      'JPUSD': 'USDJPY', 'EURUS': 'EURUSD'
    };

    // 🏆 Commodities
    this.commodities = new Set(['GOLD', 'XAU', 'SILVER', 'XAG', 'OIL', 'WTI', 'BRENT']);
    this.commodityAliases = { 'GOLD': 'XAU', 'SILVER': 'XAG', 'OIL': 'WTI' };
  }

  /**
   * 🧠 SMART CLASSIFICATION WITH DYNAMIC FALLBACK
   * @param {string} input - Raw user input
   * @returns {Object} { type, symbol, chain, confidence }
   */
  classify(input) {
    if (!input) return { type: 'UNKNOWN', symbol: null, chain: null, confidence: 0 };

    let rawInput = input.toUpperCase().trim();
    let symbol = rawInput;
    let chain = null;

    // ============================================
    // 1️⃣ PARSE CHAIN SPECIFIER (e.g. "SOL Solana")
    // ============================================
    const parenMatch = rawInput.match(/^([A-Z0-9]+)\s*\((.+)\)$/);
    if (parenMatch) {
      symbol = parenMatch[1];
      chain = parenMatch[2];
    } else {
      const parts = rawInput.split(" ");
      symbol = parts[0];
      if (parts.length > 1) {
        const possibleChain = parts.slice(1).join(" ");
        if (['BITCOIN', 'ETHEREUM', 'SOLANA', 'BINANCE', 'POLYGON', 'TON', 'BSC'].includes(possibleChain)) {
          chain = possibleChain;
        }
      }
    }

    // ============================================
    // 2️⃣ HIGH-CONFIDENCE EXACT MATCHES
    // ============================================

    // 🏆 Commodities (always first — "GOLD" shouldn't match stocks)
    if (this.commodities.has(symbol) || this.commodityAliases[symbol]) {
      return { type: 'COMMODITY', symbol: this.commodityAliases[symbol] || symbol, chain: null, confidence: 100 };
    }

    // 🇳🇬 Known Nigerian private companies (not on NGX)
    if (this.privateNigerianAliases[symbol]) {
      return { type: 'NGX_PRIVATE', symbol, chain: null, confidence: 100 };
    }

    // 💎 Top 50 Cryptos
    if (this.topCryptos.has(symbol)) {
      return { type: 'CRYPTO', symbol, chain, confidence: 100 };
    }
    if (this.cryptoAliases[symbol]) {
      return { type: 'CRYPTO', symbol: this.cryptoAliases[symbol], chain, confidence: 95 };
    }

    // 🇳🇬 Nigerian stock aliases
    if (this.ngxAliases[symbol]) {
      return { type: 'NGX_STOCK', symbol: this.ngxAliases[symbol], chain: null, confidence: 95 };
    }

    // 🇳🇬 Dynamically seeded NGX tickers (from live doclib API)
    if (this.ngxLiveTickers && this.ngxLiveTickers.has(symbol)) {
      return { type: 'NGX_STOCK', symbol, chain: null, confidence: 90 };
    }

    // 📈 Top 50 US stocks
    if (this.topUSStocks.has(symbol)) {
      return { type: 'US_STOCK', symbol, chain: null, confidence: 100 };
    }
    if (this.stockAliases[symbol]) {
      return { type: 'US_STOCK', symbol: this.stockAliases[symbol], chain: null, confidence: 95 };
    }

    // 💱 Forex pairs
    if (this.forexPairs.has(symbol) || this.forexAliases[symbol]) {
      return { type: 'FOREX', symbol: this.forexAliases[symbol] || symbol, chain: null, confidence: 100 };
    }

    // ============================================
    // 3️⃣ PATTERN-BASED HEURISTICS
    // ============================================

    // 💱 Forex pattern: 6 uppercase letters (EURUSD, GBPJPY)
    if (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol)) {
      // Verify first 3 and last 3 are valid currency codes
      const base = symbol.substring(0, 3);
      const quote = symbol.substring(3, 6);
      const currencies = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'HKD', 'SGD']);
      if (currencies.has(base) && currencies.has(quote)) {
        return { type: 'FOREX', symbol, chain: null, confidence: 85 };
      }
    }

    // 🇳🇬 Nigerian stock patterns
    const ngxKeywords = ['NIGERIA', 'PLC', 'BANK', 'HOLDINGS', 'GROUP'];
    if (ngxKeywords.some(kw => symbol.includes(kw))) {
      return { type: 'NGX_STOCK', symbol, chain: null, confidence: 70 };
    }

    // 💎 Crypto-like patterns
    // - Very short (2-5 chars) AND not in stock list
    // - Contains numbers (BTC2, ETH2)
    // - Ends in common crypto suffixes
    if (symbol.length >= 2 && symbol.length <= 5) {
      if (/\d/.test(symbol) || symbol.endsWith('COIN') || symbol.endsWith('TOKEN')) {
        return { type: 'CRYPTO', symbol, chain, confidence: 60 };
      }
    }

    // 📈 Stock-like patterns
    // - 1-5 uppercase letters (most stock tickers)
    // - NOT a known crypto
    if (symbol.length >= 1 && symbol.length <= 5 && /^[A-Z]+$/.test(symbol)) {
      return { type: 'STOCK', symbol, chain: null, confidence: 50 };
    }

    // ============================================
    // 4️⃣ DYNAMIC FALLBACK
    // Let PriceService try multiple APIs in order:
    // 1. Check if it's in crypto list (DIA API has 10,000+ assets)
    // 2. Try Yahoo Finance (covers global stocks)
    // 3. Try NGX dynamic lookup (Kwayisi scraper)
    // ============================================
    return { type: 'DYNAMIC', symbol, chain, confidence: 30 };
  }

  /**
   * 🔍 Batch classify
   */
  classifyBatch(symbols) {
    return symbols.map(s => this.classify(s));
  }

  /**
   * 🇳🇬 Dynamically seed NGX tickers from live API data
   * Called after fetchNGXMarket loads real data.
   * This ensures ANY real NGX ticker gets classified correctly,
   * not just the ~15 we hardcoded.
   */
  seedNGXTickers(tickers) {
    if (!tickers || tickers.length === 0) return;

    for (const ticker of tickers) {
      const t = ticker.toUpperCase().trim();
      // Only add if not already classified as something else
      // (don't override BTC, USDT, etc. if they somehow appear)
      if (
        !this.topCryptos.has(t) &&
        !this.topUSStocks.has(t) &&
        !this.commodities.has(t) &&
        !this.forexPairs.has(t)
      ) {
        this.ngxLiveTickers.add(t);
      }
    }

    if (this.ngxLiveTickers.size > 0) {
      console.log(`🇳🇬 Classifier seeded with ${this.ngxLiveTickers.size} NGX tickers`);
    }
  }
}

module.exports = AssetClassifier;
