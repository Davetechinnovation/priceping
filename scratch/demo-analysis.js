// scratch/demo-analysis.js — show exactly what a user sees when they type "Analyze AAPL"
require('dotenv').config({ path: '../.env' });

const PriceService = require('../src/priceService');
const GeminiService = require('../src/geminiService');
const fearGreedService = require('../src/fearGreedService');

async function demo() {
  const priceService = new PriceService(null);
  const gemini = new GeminiService(null);

  const assets = ['AAPL', 'TSLA'];

  for (const symbol of assets) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📱 User typed: "Analyze ${symbol}"`);
    console.log('═'.repeat(50));

    // 1. Get live price (same as commandParser does)
    const info = await priceService.getAssetInfo(symbol);
    if (!info) { console.log('❌ Price fetch failed'); continue; }

    // 2. Get Fear & Greed (only for crypto, but let's skip for stocks)
    const extras = {
      high52: info.high52 || null,
      low52:  info.low52  || null,
      volume: info.volume || null,
      marketCap: info.marketCap || null,
      fearGreed: null,
    };

    // 3. Get full analysis
    const analysis = await gemini.analyzeMarket(symbol, info.price, info.change24h, info.currency || 'USD', extras);

    // 4. Format output exactly as the bot sends it to WhatsApp
    const fPrice = `$${info.price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const changeLine = info.change24h != null
      ? `\n📊 *24h Change:* ${info.change24h >= 0 ? '+' : ''}${info.change24h.toFixed(2)}%`
      : '';

    const message = `🧠 *AI Market Intel: ${symbol}*
━━━━━━━━━━━━━━━━━
💰 *Current Price:* ${fPrice}${changeLine}

🤖 *Analysis:*
${analysis}

⚠️ _Not financial advice. Always DYOR._`;

    console.log('\n📲 WhatsApp Message Preview:\n');
    console.log(message);
  }
}

demo().catch(console.error);
