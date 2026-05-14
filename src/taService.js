// src/taService.js
// 100% FREE — no API keys, no rate limits
// Fetches candles from Binance (crypto) or Yahoo Finance (stocks)
// then calculates RSI, MACD, EMA, Bollinger Bands locally

const axios = require('axios');
const ti = require('technicalindicators');
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

class TAService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 900000; // 15 min
  }

  // ============================================
  // 🕯️ FETCH CANDLES
  // ============================================
  async fetchCandles(asset) {
    if (this._isCrypto(asset)) {
      // Binance is blocked (451) and Kraken is DNS-blocked (ENOTFOUND) on Render.
      // Use CryptoCompare directly — free, no API key, works perfectly.
      return await this._fetchCryptoCompareCandles(asset);
    } else {
      return await this._fetchYahooCandles(asset);
    }
  }

  async _fetchCryptoCompareCandles(asset) {
    try {
      const symbol = asset.toUpperCase().replace(/-PERP$/i, '').replace(/USDT$/, '');
      const { data } = await axios.get('https://min-api.cryptocompare.com/data/v2/histoday', {
        params: { fsym: symbol, tsym: 'USD', limit: 300, aggregate: 1 },
        timeout: 10000,
      });

      if (data.Response === 'Error') throw new Error(data.Message);

      const candles = data.Data?.Data;
      if (!candles || candles.length < 50) {
        console.warn(`⚠️ [TA] CryptoCompare: ${symbol} → ${candles?.length || 0} candles (too few)`);
        return null;
      }

      console.log(`✅ [TA] CryptoCompare: ${symbol} → ${candles.length} daily candles (free)`);
      return candles.map(k => ({
        open:   k.open,
        high:   k.high,
        low:    k.low,
        close:  k.close,
        volume: k.volumeto || 0,
      }));
    } catch (e) {
      console.warn(`⚠️ [TA] CryptoCompare failed for ${asset}: ${e.message}`);
      return null;
    }
  }

  async _fetchYahooCandles(asset) {
    try {
      // 300 days back for EMA200 to have enough candles
      const period1 = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000);
      const period2 = new Date();

      // 📌 Forex pairs on Yahoo use =X suffix (e.g. EURUSD=X, GBPUSD=X)
      // Detect 6-letter uppercase patterns: exactly 6 alpha chars = forex pair
      const isForex = /^[A-Z]{6}$/.test(asset.toUpperCase());
      const symbol = isForex ? `${asset}=X` : asset;
      if (isForex) console.log(`📌 [TA] Forex pair detected: ${asset} → Yahoo symbol ${symbol}`);

      // Use chart() — the current Yahoo Finance API (historical() is deprecated)
      const result = await yf.chart(symbol, { period1, period2, interval: '1d' });
      const quotes = result?.quotes || [];
      if (quotes.length === 0) return null;

      return quotes
        .filter(q => q.close != null)
        .map(q => ({
          open:   q.open,
          high:   q.high,
          low:    q.low,
          close:  q.close,
          volume: q.volume || 0,
        }));
    } catch (e) {
      console.warn(`⚠️ [TA] Yahoo candles failed for ${asset}: ${e.message}`);
      return null;
    }
  }

  // ============================================
  // 📊 CALCULATE INDICATORS LOCALLY — FREE MATH
  // ============================================
  async getIndicators(asset) {
    const cacheKey = `ta:${asset}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < this.cacheTTL) return cached.data;

    const candles = await this.fetchCandles(asset);
    if (!candles || candles.length < 50) {
      console.warn(`⚠️ [TA] Not enough candles for ${asset} (got ${candles?.length || 0})`);
      return null;
    }

    const closes  = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const last    = closes[closes.length - 1];

    try {
      // RSI (14)
      const rsiVals = ti.RSI.calculate({ period: 14, values: closes });
      const rsi = rsiVals[rsiVals.length - 1];

      // MACD (12, 26, 9)
      const macdVals = ti.MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      const macd = macdVals[macdVals.length - 1];

      // EMA 50 & 200
      const ema50Vals  = ti.EMA.calculate({ period: 50,  values: closes });
      const ema200Vals = ti.EMA.calculate({ period: 200, values: closes });
      const ema50  = ema50Vals[ema50Vals.length - 1];
      const ema200 = ema200Vals[ema200Vals.length - 1];

      // Bollinger Bands (20, 2)
      const bbVals = ti.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
      const bb = bbVals[bbVals.length - 1];

      // Volume ratio vs 20-candle average
      const avgVol  = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const lastVol = volumes[volumes.length - 1];
      const volRatio = avgVol > 0 ? lastVol / avgVol : null;

      const result = {
        rsi:          rsi != null ? parseFloat(rsi.toFixed(1)) : null,
        macdLine:     macd?.MACD    != null ? parseFloat(macd.MACD.toFixed(4))    : null,
        macdSignal:   macd?.signal  != null ? parseFloat(macd.signal.toFixed(4))  : null,
        macdHist:     macd?.histogram != null ? parseFloat(macd.histogram.toFixed(4)) : null,
        ema50:        ema50  != null ? parseFloat(ema50.toFixed(2))  : null,
        ema200:       ema200 != null ? parseFloat(ema200.toFixed(2)) : null,
        bbUpper:      bb?.upper  != null ? parseFloat(bb.upper.toFixed(2))  : null,
        bbMiddle:     bb?.middle != null ? parseFloat(bb.middle.toFixed(2)) : null,
        bbLower:      bb?.lower  != null ? parseFloat(bb.lower.toFixed(2))  : null,
        volRatio:     volRatio != null ? parseFloat(volRatio.toFixed(2)) : null,
        currentPrice: last,
        candleCount:  candles.length,
      };

      console.log(`✅ [TA] ${asset}: RSI=${result.rsi}, MACD hist=${result.macdHist}, EMA50=${result.ema50}, EMA200=${result.ema200}`);
      this.cache.set(cacheKey, { data: result, ts: now });
      return result;

    } catch (e) {
      console.error(`⚠️ [TA] Calculation error for ${asset}:`, e.message);
      return null;
    }
  }

  // ============================================
  // 🧠 PRE-COMPUTED SIGNAL INTERPRETATION
  // Saves tokens — Groq gets plain-English signals instead of raw numbers
  // ============================================
  interpretIndicators(ta, price) {
    const signals = [];
    const warnings = [];

    // RSI
    if (ta.rsi != null) {
      if      (ta.rsi >= 75) warnings.push(`RSI ${ta.rsi.toFixed(1)} — heavily overbought, pullback risk`);
      else if (ta.rsi >= 65) warnings.push(`RSI ${ta.rsi.toFixed(1)} — approaching overbought`);
      else if (ta.rsi <= 25) signals.push(`RSI ${ta.rsi.toFixed(1)} — heavily oversold, bounce possible`);
      else if (ta.rsi <= 35) signals.push(`RSI ${ta.rsi.toFixed(1)} — oversold, watch for reversal`);
      else if (ta.rsi <= 45) signals.push(`RSI ${ta.rsi.toFixed(1)} — approaching oversold territory`);
      else                   signals.push(`RSI ${ta.rsi.toFixed(1)} — neutral momentum`);
    }

    // MACD
    if (ta.macdHist != null) {
      if      (ta.macdHist > 0 && ta.macdLine > ta.macdSignal) signals.push('MACD bullish cross — momentum rising');
      else if (ta.macdHist < 0 && ta.macdLine < ta.macdSignal) warnings.push('MACD bearish cross — momentum falling');
      else if (ta.macdHist > 0) signals.push('MACD histogram positive — mild bullish bias');
      else                       warnings.push('MACD histogram negative — mild bearish bias');
    }

    // EMA trend
    if (ta.ema50 != null && ta.ema200 != null) {
      if (price > ta.ema200) signals.push(`Above 200 EMA ($${ta.ema200.toLocaleString()}) — long-term uptrend`);
      else                    warnings.push(`Below 200 EMA ($${ta.ema200.toLocaleString()}) — long-term downtrend`);

      if (price > ta.ema50) signals.push(`Above 50 EMA ($${ta.ema50.toLocaleString()}) — short-term bullish`);
      else                   warnings.push(`Below 50 EMA ($${ta.ema50.toLocaleString()}) — short-term bearish`);
    }

    // Bollinger Bands
    if (ta.bbUpper != null && ta.bbLower != null && ta.bbMiddle != null) {
      if      (price > ta.bbUpper)  warnings.push(`Price above upper BB ($${ta.bbUpper.toLocaleString()}) — extended, mean-reversion risk`);
      else if (price < ta.bbLower)  signals.push(`Price below lower BB ($${ta.bbLower.toLocaleString()}) — potential bounce zone`);
      else                          signals.push(`Price inside Bollinger Bands — mid: $${ta.bbMiddle.toLocaleString()}`);
    }

    // Volume
    if (ta.volRatio != null) {
      if      (ta.volRatio > 1.5) signals.push(`Volume ${ta.volRatio}x above average — strong conviction`);
      else if (ta.volRatio < 0.5) warnings.push(`Volume ${ta.volRatio}x below average — weak, low conviction`);
    }

    return { signals, warnings };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _isCrypto(asset) {
    const KNOWN_NON_CRYPTO = new Set([
      // US Stocks
      'AAPL','TSLA','NVDA','GOOGL','MSFT','AMZN','META','NFLX','AMD','INTC',
      'PYPL','DIS','BA','UBER','BABA','PLTR','COIN','SHOP','SQ','SNAP','HOOD',
      'JPM','BAC','WFC','GS','V','MA',
      // Futures
      'ES=F','NQ=F','GC=F','CL=F','CC=F','BZ=F','SI=F','YM=F','RTY=F',
      '6E=F','6B=F','6J=F','ZN=F','ZB=F',
      // NGX stocks
      'ZENITHBANK','MTNN','DANGCEM','GTCO','ACCESSCORP','FBNH','UBA','AIRTELAFRI',
      'FIDELITYBK','STERLINGBANK','SEPLAT','OANDO','NESTLE',
      // Commodities (non-futures symbol)
      'XAU','XAG',
      // 📌 FOREX PAIRS — route to Yahoo Finance with =X suffix
      'EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD',
      'EURGBP','EURJPY','GBPJPY','EURCHF','GBPCHF',
      'EURAUD','EURCAD','EURNZD','GBPAUD','GBPCAD','GBPNZD',
      'AUDJPY','AUDCHF','AUDCAD','CADJPY','CHFJPY','NZDJPY',
      'USDMXN','USDZAR','USDSGD','USDNOK','USDSEK','USDPLN','USDTRY',
      'EURTRY','GBPTRY','EURNGN','GBPNGN','USDNGN','USDGHS','GBPGHS',
      'EURZAR','GBPZAR','AUDNZD','EURHUF','EURCZK','USDRUB',
      // Cross rates
      'EURCHF','GBPCHF','EURGBP','EURJPY','GBPJPY','EURNZD','GBPNZD',
      'AUDCAD','AUDCHF','AUDJPY','AUDNZD','CADCHF','CADJPY',
      'CHFJPY','EURAUD','EURCAD','GBPAUD','GBPCAD','NZDCAD','NZDCHF','NZDJPY',
    ]);
    const clean = asset.replace(/-PERP$/i, '').replace(/USDT$/i, '').toUpperCase();
    return !KNOWN_NON_CRYPTO.has(clean);
  }
}

module.exports = TAService;
