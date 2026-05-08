// scratch/test-ta.js — test the TA service + analysis pipeline
require('dotenv').config({ path: '../.env' });

const TAService = require('../src/taService');
const GeminiService = require('../src/geminiService');

async function main() {
  const ta = new TAService();
  const gemini = new GeminiService(null);

  const testAssets = [
    { symbol: 'BTC',   isCrypto: true,  label: 'Bitcoin (crypto)' },
    { symbol: 'AAPL',  isCrypto: false, label: 'Apple (stock)' },
  ];

  for (const { symbol, label } of testAssets) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📊 Testing: ${label} (${symbol})`);

    // 1. Get raw indicators
    const indicators = await ta.getIndicators(symbol);
    if (!indicators) {
      console.log(`❌ Could not fetch candles for ${symbol} (probably ISP block locally)`);
    } else {
      console.log(`✅ Indicators for ${symbol}:`, JSON.stringify(indicators, null, 2));
      const { signals, warnings } = ta.interpretIndicators(indicators, indicators.currentPrice);
      console.log('   Signals:', signals);
      console.log('   Warnings:', warnings);
    }

    // 2. Test the full analysis prompt  
    console.log(`\n🤖 Calling analyzeMarket (Groq AI)...`);
    const analysis = await gemini.analyzeMarket(symbol, indicators?.currentPrice || 100, -1.5, 'USD', {});
    console.log(`Analysis:\n${analysis || '❌ No response from Groq'}`);
  }
}

main().catch(console.error);
