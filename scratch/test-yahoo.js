const yahooFinance = require('yahoo-finance2').default;

// Force a dummy call to see if it initializes
try {
  // Newer versions require this?
  // const yf = new (require('yahoo-finance2').YahooFinance)();
  // But usually .default.quote works.
} catch(e) {}

async function test() {
  const symbols = ['AAPL', 'MTNN.LG'];
  
  for (const sym of symbols) {
    try {
      console.log(`\n🔍 Checking ${sym}...`);
      // Use the actual exported object which should have .quote
      const result = await yahooFinance.quote(sym);
      console.log(`- Success: ${result.symbol} | ${result.regularMarketPrice}`);
    } catch (e) {
      console.error(`- Error for ${sym}:`, e.message);
      // Try to inspect the object
      console.log('Keys available on yahooFinance:', Object.keys(yahooFinance || {}));
    }
  }
}

test();
