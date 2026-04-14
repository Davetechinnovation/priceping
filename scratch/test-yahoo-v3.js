const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance();

async function test() {
  const symbols = ['AAPL', 'MTNN.LG'];
  
  for (const sym of symbols) {
    try {
      console.log(`\n🔍 Checking ${sym}...`);
      const result = await yf.quote(sym);
      console.log(`- Success: ${result.symbol} | ${result.regularMarketPrice} ${result.currency}`);
    } catch (e) {
      console.error(`- Error for ${sym}:`, e.message);
    }
  }
}

test();
