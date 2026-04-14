// End-to-end validation: test the full getAssetInfo pipeline
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const PriceService = require('./src/priceService');

async function validate() {
  const ps = new PriceService();

  const tests = [
    { input: 'AAPL', expected: 'Stock Market' },         // US stock
    { input: 'MTNN', expected: 'Stock Market' },         // Nigerian stock
    { input: 'ZENITHBANK', expected: 'Stock Market' },   // Nigerian stock
    { input: 'BTC', expected: 'Bitcoin' },               // Crypto
    { input: 'GOLD', expected: 'Commodities' },          // Commodity
    { input: 'EURUSD', expected: 'Forex Market' },       // Forex
  ];

  for (const test of tests) {
    try {
      process.stdout.write(`🔍 Testing "${test.input}"... `);
      const info = await ps.getAssetInfo(test.input);
      if (!info) {
        console.log(`❌ NULL returned`);
      } else {
        const pass = test.expected === 'Bitcoin' 
          ? info.blockchain === 'Bitcoin'
          : info.blockchain === test.expected;
        console.log(`${pass ? '✅' : '⚠️'} ${info.name} | Price: ${info.price} ${info.currency || ''} | Market: ${info.blockchain}`);
      }
    } catch (e) {
      console.log(`❌ ERROR: ${e.message}`);
    }
  }
}

validate();
