const YahooFinance = require('yahoo-finance2').default;

async function testYahoo() {
  const symbols = ['DANGCEM.LG', 'ZENITHBANK.LG', 'MTNN.LG', 'GTCO.LG', 'UBA.LG', 'FBNH.LG', 'AIRTELAFRI.LG', 'NB.LG', 'SEPLAT.LG'];
  
  for (const sym of symbols) {
    try {
      const quote = await YahooFinance.quote(sym);
      console.log(`✅ ${sym}: ${quote.regularMarketPrice} NGN (Change: ${quote.regularMarketChangePercent?.toFixed(2)}%)`);
    } catch (e) {
      console.log(`❌ ${sym} FAILED: ${e.message}`);
    }
  }
}

testYahoo();
