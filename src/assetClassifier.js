class AssetClassifier {
  constructor() {
    /** @type {import('./derivService') | null} Will be injected after construction */
    this.derivService = null;
    /** @type {Set<string>} Live synthetic index symbols from Deriv API */
    this.derivSyntheticSymbols = new Set();

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
      'TRX', 'BCH', 'CAKE', 'SAND', 'MANA', 'AXS', 'FTM', 'GALA', 'ENJ', 'INJ', 'SEI',
      'STETH', 'WSTETH', 'RETH', 'CBETH', 'LDO', 'PENDLE', 'ENA', 'ETHFI'
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
    // Note: PLATINUM and PALLADIUM are included here so they get classified as
    // COMMODITY rather than matching Deriv synthetic indices (frxXPTUSD, frxXPDUSD).
    // The actual price is resolved via Yahoo futures at runtime (PL=F, PA=F).
    // 🏆 Commodities — hardcoded names and aliases
    // Note: The actual price for most of these is resolved via Yahoo futures at runtime
    // (e.g. GOLD→GC=F, SILVER→SI=F, OIL→CL=F, NATURAL GAS→NG=F, COPPER→HG=F).
    // We also include common broker/CFD shorthands like "USOIL" (=CL=F), "UKOIL" (=BZ=F).
    this.commodities = new Set([
      'GOLD', 'XAU', 'SILVER', 'XAG',
      'OIL', 'WTI', 'BRENT', 'XTI', 'XBR', 'USOIL', 'UKOIL',
      'NATURAL GAS', 'NATGAS', 'GAS',
      'PLATINUM', 'PALLADIUM', 'COPPER',
    ]);
    this.commodityAliases = {
      'GOLD': 'XAU', 'SILVER': 'XAG',
      'OIL': 'WTI', 'XTI': 'WTI', 'XBR': 'BRENT',
      'USOIL': 'USOIL', 'UKOIL': 'UKOIL',
      'NATGAS': 'NATURAL GAS', 'GAS': 'NATURAL GAS',
    };

    // 📈 Traditional Futures & Forex Futures
    // Only index/forex/crypto CME futures are pre-mapped since their Yahoo tickers
    // are non-obvious (e.g. FDAX=F for DAX, 6E=F for Euro). Commodity futures
    // like SUGAR→SB=F, PLATINUM→PL=F are resolved dynamically via Yahoo search
    // at runtime — no hardcoding needed.
    this.traditionalFutures = {
      // ── Index Futures ──────────────────────────────────────
      'S&P 500': 'ES=F', 'SPX': 'ES=F', 'SP500': 'ES=F', 'ES': 'ES=F', 'SPX500': 'ES=F', 'US500': 'ES=F',
      'NASDAQ': 'NQ=F', 'NDX': 'NQ=F', 'NQ': 'NQ=F', 'NAS100': 'NQ=F', 'US100': 'NQ=F',
      'DOW JONES': 'YM=F', 'DOW': 'YM=F', 'YM': 'YM=F', 'US30': 'YM=F',
      'RUSSELL': 'RTY=F', 'RTY': 'RTY=F', 'US2000': 'RTY=F',
      'VIX': '^VIX',
      'NIKKEI': 'NKD=F', 'NKD': 'NKD=F', 'JP225': 'NKD=F', 'JPN225': 'NKD=F', 'JPN': 'NKD=F', 'NIKKEI225': 'NKD=F',
      'FTSE': '^FTSE', 'UK100': '^FTSE',
      'DAX': 'FDAX=F', 'GER40': 'FDAX=F',
      'SPX': 'ES=F', 'USTEC': 'NQ=F',
      'AUS200': '^AXJO',

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

      // ── Precious Metal Futures ───────────────────────────
      // These are major CME/NYMEX futures. Even though PLATINUM and PALLADIUM
      // are caught by the commodities set, we also add them here so that when
      // users say "platinum futures" or if the Yahoo search fails, the direct
      // Yahoo =F lookup works (PL=F, PA=F).
      'PLATINUM': 'PL=F', 'PLATINUM FUTURES': 'PL=F', 'PL': 'PL=F',
      'PALLADIUM': 'PA=F', 'PALLADIUM FUTURES': 'PA=F', 'PA': 'PA=F',
      'COPPER': 'HG=F', 'COPPER FUTURES': 'HG=F', 'HG': 'HG=F',

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
    // 2️⃣ CHECK FOR FOREX QUALIFIER — must run BEFORE futures check
    // e.g. "gold forex" → XAUUSD, "silver forex" → XAGUSD
    // ============================================
    const forexKeywords = ['FOREX', 'FX', 'SPOT'];
    const hasForexQualifier = forexKeywords.some(kw => rawInput.includes(kw));
    if (hasForexQualifier) {
      // Strip the qualifier so we get the base asset
      let baseForForex = rawInput;
      forexKeywords.forEach(kw => {
        baseForForex = baseForForex.replace(new RegExp(`\\b${kw}\\b`, 'g'), '').trim();
      });
      const baseToken = baseForForex.split(' ')[0];

      // Map commodity names → their forex spot pairs
      const COMMODITY_FOREX_MAP = {
        'GOLD': 'XAUUSD', 'XAU': 'XAUUSD', 'XAUUSD': 'XAUUSD',
        'SILVER': 'XAGUSD', 'XAG': 'XAGUSD', 'XAGUSD': 'XAGUSD',
        'OIL': 'USOUSD', 'BRENT': 'UKOUSD',
      };
      if (COMMODITY_FOREX_MAP[baseToken]) {
        return { type: 'FOREX', symbol: COMMODITY_FOREX_MAP[baseToken], chain: null, confidence: 100 };
      }
    }

    // ============================================
    // 3️⃣ CHECK FOR FUTURES/PERP MODIFIERS
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

    // ============================================
    // 3️⃣.5️⃣ CATCH-ALL FOR "Something Futures"
    // If user explicitly said "futures" and it wasn't a crypto or hardcoded
    // traditional future, route it to TRADITIONAL_FUTURE so the dynamic
    // Yahoo resolver can try =F suffix, Yahoo search, etc.
    // ============================================
    if (isFuture) {
      // User explicitly asked for futures — route as TRADITIONAL_FUTURE
      // with a flag indicating it needs Yahoo resolution.
      // PriceService.getTraditionalFuturesPrice() will handle the dynamic lookup.
      return { type: 'TRADITIONAL_FUTURE', symbol, chain: null, confidence: 70, needsYahooResolve: true };
    }

    // ============================================
    // 3.5️⃣ LIVE DERIV SYMBOL CHECK (supplementary)
    // If derivService is seeded, check if the raw symbol (or symbol) exists
    // as an active Deriv instrument. This catches ANY synthetic index, including
    // new ones that get added to Deriv's platform.
    // ============================================
    if (this.derivService && this.derivService.activeSymbolSet.size > 0) {
      // Direct exact match on raw input
      if (this.derivService.isSynthetic(symbol) || this.derivService.hasSymbol(symbol)) {
        return { type: 'SYNTHETIC_INDEX', symbol, chain: null, confidence: 98 };
      }
      // Check display name match (e.g. "volatility 75" → "Volatility 75 Index" → "R_75")
      const searchResults = this.derivService.searchSymbols(symbol);
      if (searchResults.length > 0) {
        return { type: 'SYNTHETIC_INDEX', symbol: searchResults[0].symbol, chain: null, confidence: 90 };
      }
    }

    // ============================================
    // 4️⃣ PATTERN-BASED HEURISTICS
    // ============================================

    // 🎲 SYNTHETIC INDICES (Deriv) — Hardcoded aliases for common known patterns
    const boomCrashMatch = rawInput.match(/^(BOOM|CRASH)\s*(\d+)$/i);
    if (boomCrashMatch) {
      return { type: 'SYNTHETIC_INDEX', symbol: `${boomCrashMatch[1].toUpperCase()}${boomCrashMatch[2]}`, chain: null, confidence: 100 };
    }
    const volMatch = rawInput.match(/^(VOLATILITY|V|VOL)\s*(\d+)\s*(1S)?$/i);
    if (volMatch) {
      if (volMatch[3]) {
        return { type: 'SYNTHETIC_INDEX', symbol: `1HZ${volMatch[2]}V`, chain: null, confidence: 100 };
      }
      return { type: 'SYNTHETIC_INDEX', symbol: `R_${volMatch[2]}`, chain: null, confidence: 100 };
    }
    const stepMatch = rawInput.match(/^STEP\s*(INDEX)?$/i);
    if (stepMatch) {
      return { type: 'SYNTHETIC_INDEX', symbol: 'stpRNG', chain: null, confidence: 100 };
    }
    const jumpMatch = rawInput.match(/^(JUMP|JD)\s*(\d+)$/i);
    if (jumpMatch) {
      return { type: 'SYNTHETIC_INDEX', symbol: `JD${jumpMatch[2]}`, chain: null, confidence: 100 };
    }
    const rangeMatch = rawInput.match(/^(RANGE\s*BREAK|RB)\s*(\d+)$/i);
    if (rangeMatch) {
      return { type: 'SYNTHETIC_INDEX', symbol: `RB${rangeMatch[2]}`, chain: null, confidence: 100 };
    }

    // 💱 Forex pattern: 6 uppercase letters (EURUSD, GBPJPY)
    if (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol)) {
      const base = symbol.substring(0, 3);
      const quote = symbol.substring(3, 6);
      if (KNOWN_CURRENCIES.has(base) && KNOWN_CURRENCIES.has(quote)) {
        return { type: 'FOREX', symbol, chain: null, confidence: 85 };
      }
    }

    // 📊 CFD-style index pattern: e.g. US30, NAS100, UK100, GER40, JP225, AU200
    // Pattern: 2-3 letter country/market code + 2-3 digit number
    const cfdIndexMatch = symbol.match(/^(US|UK|GER|JP|JPN|NAS|AU|EU|FR|HK|CN|SG|IN|SPA|ITA|SUI)(\d{2,5})$/);
    if (cfdIndexMatch) {
      const CFD_INDEX_MAP = {
        'US30': 'YM=F', 'US100': 'NQ=F', 'US500': 'ES=F',
        'UK100': '^FTSE',
        'GER40': 'FDAX=F', 'GER30': 'FDAX=F',
        'JPN225': 'NKD=F', 'JP225': 'NKD=F',
        'NAS100': 'NQ=F', 'NAS': 'NQ=F',
        'AU200':  '^AXJO',
        'AUS200': '^AXJO',
        'CN50':   '000016.SS',
        'SING30': '^STI',
        'HK50': '^HSI', 'HK33': '^HSI',
        'EU50': '^STOXX50E',
        'FR40': '^FCHI',
        'SUI20': '^SSMI',
        'SPA35': '^IBEX',
      };
      const mapped = CFD_INDEX_MAP[symbol];
      if (mapped) {
        return { type: 'TRADITIONAL_FUTURE', symbol: mapped, chain: null, confidence: 95 };
      }
      // Unknown CFD index — still treat as traditional future, Yahoo will figure it out
      return { type: 'TRADITIONAL_FUTURE', symbol: `${symbol}=F`, chain: null, confidence: 70 };
    }

    // 🇳🇬 Nigerian stock patterns
    const ngxKeywords = ['NIGERIA', 'PLC', 'BANK', 'HOLDINGS', 'GROUP'];
    if (ngxKeywords.some(kw => symbol.includes(kw))) {
      return { type: 'NGX_STOCK', symbol, chain: null, confidence: 70 };
    }

    // 💎 Crypto-like patterns
    if (symbol.length >= 2 && symbol.length <= 8) {
      // If it has lowercase (stETH) or common crypto markers (digits, COIN/TOKEN)
      if (/[a-z]/.test(rawInput) || /\d/.test(symbol) || symbol.endsWith('COIN') || symbol.endsWith('TOKEN')) {
        return { type: 'CRYPTO', symbol, chain, confidence: 65 };
      }
    }

    // 📈 Stock-like patterns
    if (symbol.length >= 1 && symbol.length <= 5 && /^[A-Z]+$/.test(symbol)) {
      return { type: 'STOCK', symbol, chain: null, confidence: 50 };
    }

    // ============================================
    // 5️⃣ DYNAMIC FALLBACK
    // Let PriceService try multiple APIs in order:
    // 1. Check if it's in crypto list (DIA API has 10,000+ assets)
    // 2. Try Yahoo Finance (covers global stocks)
    // 3. Try NGX dynamic lookup (Kwayisi scraper)
    // 4. Try Yahoo as futures (={sym}=F, ^{sym})
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
   * 🔍 Dynamic Yahoo Finance symbol resolution
   * Called when classify() returns low confidence (<= 60).
   * Queries Yahoo's free search API to identify the asset type.
   * Results are cached in-memory to avoid repeated API calls.
   *
   * @param {string} symbol - Raw user input symbol
   * @returns {Promise<{type, symbol, confidence}|null>}
   */
  async resolveWithYahoo(symbol) {
    const key = symbol.toUpperCase().trim();

    // Check in-memory cache first (avoid hammering Yahoo)
    if (this._yahooCache && this._yahooCache[key]) {
      return this._yahooCache[key];
    }
    if (!this._yahooCache) this._yahooCache = {};

    try {
      const axios = require('axios');
      const { data } = await axios.get('https://query2.finance.yahoo.com/v1/finance/search', {
        params: { q: key, quotesCount: 3, newsCount: 0, listsCount: 0 },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });

      const hits = data?.quotes || [];
      if (hits.length === 0) return null;

      const best = hits[0];
      const quoteType = best.quoteType?.toUpperCase();
      const resolvedSymbol = best.symbol;

      // Map Yahoo quoteType → our asset types
      const YAHOO_TYPE_MAP = {
        'EQUITY':         { type: 'US_STOCK',          confidence: 88 },
        'INDEX':          { type: 'TRADITIONAL_FUTURE', confidence: 88 },
        'FUTURE':         { type: 'TRADITIONAL_FUTURE', confidence: 92 },
        'ETF':            { type: 'US_STOCK',           confidence: 85 },
        'MUTUALFUND':     { type: 'US_STOCK',           confidence: 80 },
        'CRYPTOCURRENCY': { type: 'CRYPTO',             confidence: 90 },
        'CURRENCY':       { type: 'FOREX',              confidence: 90 },
      };

      const mapped = YAHOO_TYPE_MAP[quoteType];
      if (!mapped) return null;

      const result = { type: mapped.type, symbol: resolvedSymbol, chain: null, confidence: mapped.confidence };
      this._yahooCache[key] = result; // Cache for this session
      console.log(`🔍 [Classifier] Yahoo resolved "${key}" → ${quoteType} → ${resolvedSymbol} (${mapped.confidence}%)`);
      return result;
    } catch (e) {
      // Silent fail — Yahoo search is best-effort
      return null;
    }
  }

  /**
   * 🔍 Targeted Yahoo futures symbol resolution
   * Queries Yahoo search specifically looking for futures-type results.
   * If Yahoo returns a FUTURE or INDEX quoteType, returns the resolved symbol.
   * This is called when user types e.g. "SUGAR", "COFFEE", "PLATINUM", etc.
   * and we need to find the corresponding Yahoo futures symbol.
   *
   * @param {string} symbol - Raw user input (e.g. "SUGAR", "PLATINUM", "FEEDER CATTLE")
   * @returns {Promise<{type: string, symbol: string, confidence: number}|null>}
   */
  async resolveFuturesWithYahoo(symbol) {
    const key = symbol.toUpperCase().trim();
    if (!key) return null;

    // Cache check using futures-specific prefix
    const cacheKey = `futures_${key}`;
    if (this._yahooCache && this._yahooCache[cacheKey]) {
      return this._yahooCache[cacheKey];
    }
    if (!this._yahooCache) this._yahooCache = {};

    try {
      const axios = require('axios');

      // Strategy 1: Search Yahoo with "futures" appended to bias results
      const searchQuery = `${key} futures`;
      const { data } = await axios.get('https://query2.finance.yahoo.com/v1/finance/search', {
        params: { q: searchQuery, quotesCount: 5, newsCount: 0, listsCount: 0 },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });

      const hits = data?.quotes || [];
      if (hits.length > 0) {
        // Find the first FUTURE or INDEX quote type
        const futureHit = hits.find(h => {
          const qt = h.quoteType?.toUpperCase();
          return qt === 'FUTURE' || qt === 'INDEX';
        });

        if (futureHit) {
          const resolvedSymbol = futureHit.symbol;
          const result = { type: 'TRADITIONAL_FUTURE', symbol: resolvedSymbol, chain: null, confidence: 92 };
          this._yahooCache[cacheKey] = result;
          console.log(`🔍 [Classifier] Yahoo resolved futures "${key}" → ${resolvedSymbol}`);
          return result;
        }

        // If no FUTURE/INDEX found but we got a hit, check if it's a commodity
        // Yahoo sometimes returns COMMODITY type for things like gold, silver
        const firstHit = hits[0];
        if (firstHit.quoteType?.toUpperCase() === 'COMMODITY') {
          // Try appending =F to the search symbol — many commodities work with =F suffix
          const result = { type: 'TRADITIONAL_FUTURE', symbol: `${key}=F`, chain: null, confidence: 75 };
          this._yahooCache[cacheKey] = result;
          return result;
        }
      }

      // Strategy 2: Try the =F suffix directly (works for many: SUGAR→SB=F, COFFEE→KC=F, etc.)
      // But we don't know the prefix, so this is a last resort.
      return null;
    } catch (e) {
      return null;
    }
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