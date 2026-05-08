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
      'GLO': 'GLO',
      // ✅ Exact NGX tickers — map to themselves so they never fall through to DYNAMIC
      'DANGCEM': 'DANGCEM', 'ZENITHBANK': 'ZENITHBANK', 'MTNN': 'MTNN',
      'GTCO': 'GTCO', 'ACCESSCORP': 'ACCESSCORP', 'FBNH': 'FBNH',
      'AIRTELAFRI': 'AIRTELAFRI', 'FIDELITYBK': 'FIDELITYBK',
      'STERLINGBANK': 'STERLINGBANK', 'TRANSCORP': 'TRANSCORP',
      'BUACEMENT': 'BUACEMENT', 'NESTLE': 'NESTLE', 'FLOURMILL': 'FLOURMILL',
      'GUINNESS': 'GUINNESS', 'CADBURY': 'CADBURY', 'WAPCO': 'WAPCO',
      'CONOIL': 'CONOIL', 'TOTAL': 'TOTAL', 'ETERNA': 'ETERNA',
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

    // 📈 Traditional Futures & Forex Futures
    this.traditionalFutures = {
      // ── Index Futures ──────────────────────────────────────
      'S&P 500': 'ES=F', 'SPX': 'ES=F', 'SP500': 'ES=F', 'ES': 'ES=F',
      'NASDAQ': 'NQ=F', 'NDX': 'NQ=F', 'NQ': 'NQ=F',
      'DOW JONES': 'YM=F', 'DOW': 'YM=F', 'YM': 'YM=F',
      'RUSSELL': 'RTY=F', 'RTY': 'RTY=F',
      'VIX': '^VIX',
      'NIKKEI': 'NKD=F', 'NKD': 'NKD=F',
      'FTSE': 'Z=F',
      'DAX': 'FDAX=F',

      // ── Commodity Futures ──────────────────────────────────
      'GOLD': 'GC=F', 'GC': 'GC=F',
      'SILVER': 'SI=F', 'SI': 'SI=F',
      'OIL': 'CL=F', 'CRUDE OIL': 'CL=F', 'CL': 'CL=F',
      'BRENT': 'BZ=F', 'BZ': 'BZ=F',
      'NATURAL GAS': 'NG=F', 'NG': 'NG=F',
      'COPPER': 'HG=F', 'HG': 'HG=F',
      'WHEAT': 'ZW=F', 'ZW': 'ZW=F',
      'CORN': 'ZC=F', 'ZC': 'ZC=F',
      'SOYBEAN': 'ZS=F', 'ZS': 'ZS=F',
      'COCOA': 'CC=F', 'CC': 'CC=F',

      // ── Forex Futures (CME) ────────────────────────────────
      'EURO': '6E=F', 'EUR': '6E=F', '6E': '6E=F',
      'POUND': '6B=F', 'GBP': '6B=F', '6B': '6B=F',
      'YEN': '6J=F', 'JPY': '6J=F', '6J': '6J=F',
      'AUSSIE': '6A=F', 'AUD': '6A=F', '6A': '6A=F',
      'CAD FUTURE': '6C=F', '6C': '6C=F',
      'SWISS': '6S=F', 'CHF': '6S=F', '6S': '6S=F',

      // ── Crypto CME Futures ────────────────────────────────
      'BITCOIN CME': 'BTC=F', 'BTC CME': 'BTC=F',
      'ETHEREUM CME': 'ETH=F', 'ETH CME': 'ETH=F',

      // ── Rates & Bonds ─────────────────────────────────────
      'TREASURY': 'ZN=F', 'T-NOTE': 'ZN=F',
      'T-BOND': 'ZB=F', 'ZB': 'ZB=F',
    };
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
    // 0️⃣ NORMALIZE SPACED FOREX PAIRS (e.g. "EUR JPY" → "EURJPY")
    // Must run before split so "EUR JPY" isn't truncated to "EUR"
    // ============================================
    const KNOWN_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'HKD', 'SGD', 'ZAR', 'NGN', 'MXN', 'INR', 'TRY']);
    const spacedForex = rawInput.match(/^([A-Z]{3})\s+([A-Z]{3})$/);
    if (spacedForex && KNOWN_CURRENCIES.has(spacedForex[1]) && KNOWN_CURRENCIES.has(spacedForex[2])) {
      rawInput = spacedForex[1] + spacedForex[2]; // e.g. 'EUR JPY' → 'EURJPY'
      symbol = rawInput;
    }

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
    // 2️⃣ CHECK FOR FUTURES/PERP MODIFIERS
    // ============================================
    let isFuture = false;
    const futureKeywords = ['FUTURES', 'FUTURE', 'PERP', 'PERPETUAL'];
    if (futureKeywords.some(kw => rawInput.includes(kw))) {
      isFuture = true;
      // Strip out the keyword so the base symbol can be matched
      futureKeywords.forEach(kw => {
        rawInput = rawInput.replace(new RegExp(`\\b${kw}\\b`, 'g'), '').trim();
      });
      symbol = rawInput.split(" ")[0] || rawInput;
    }

    // ============================================
    // 3️⃣ HIGH-CONFIDENCE EXACT MATCHES
    // ============================================

    // 📈 Traditional Futures (if matched by explicitly mapped alias)
    if (this.traditionalFutures[rawInput] || this.traditionalFutures[symbol]) {
      return { type: 'TRADITIONAL_FUTURE', symbol: this.traditionalFutures[rawInput] || this.traditionalFutures[symbol], chain: null, confidence: 100 };
    }

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
      if (isFuture) return { type: 'CRYPTO_FUTURE', symbol, chain, confidence: 100 };
      return { type: 'CRYPTO', symbol, chain, confidence: 100 };
    }
    if (this.cryptoAliases[symbol]) {
      if (isFuture) return { type: 'CRYPTO_FUTURE', symbol: this.cryptoAliases[symbol], chain, confidence: 95 };
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

    // Catch-all for "Something Futures" if it wasn't a crypto or explicit traditional future
    if (isFuture) {
      // e.g. a user typed "TSLA futures" -> just return TRADITIONAL_FUTURE so Yahoo tries its =F format
      // Or maybe it's an altcoin perp. We'll default to CRYPTO_FUTURE.
      return { type: 'CRYPTO_FUTURE', symbol, chain, confidence: 80 };
    }

    // ============================================
    // 4️⃣ PATTERN-BASED HEURISTICS
    // ============================================

    // 💱 Forex pattern: 6 uppercase letters (EURUSD, GBPJPY)
    if (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol)) {
      // Verify first 3 and last 3 are valid currency codes
      const base = symbol.substring(0, 3);
      const quote = symbol.substring(3, 6);
      if (KNOWN_CURRENCIES.has(base) && KNOWN_CURRENCIES.has(quote)) {
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
    // 5️⃣ DYNAMIC FALLBACK
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
