/**
 * 🧪 Test if Yahoo Finance has NGX stock data
 * Run: node scratch/test-yahoo-ngx.js
 * 
 * This tests the EXACT yahoo-finance2 library the bot uses.
 */

const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const ngxSymbols = [
  // Direct tickers
  'MTNN', 'ZENITHBANK', 'DANGCEM', 'GTCO', 'ACCESSCORP',
  'UBA', 'FBNH', 'SEPLAT', 'OANDO', 'AIRTELAFRI',
  'FIDELITYBK', 'STERLINGBANK', 'TRANSCORP', 'BUACEMENT',
  // With Yahoo suffixes for Nigerian/Lagos exchange
  'MTNN.LAG', 'ZENITHBANK.LAG', 'DANGCEM.LAG', 'GTCO.LAG',
  'MTNN.L', 'ZENITHBANK.L', 
  // Emerging market suffixes
  'MTNN.NG', 'MTNN-PA', 'MTNN.DE',
];

async function test() {
  console.log('🧪 Testing Yahoo Finance for NGX stocks\n');

  for (const sym of ngxSymbols) {
    process.stdout.write(`📡 ${sym}... `);
    try {
      const quote = await yf.quote(sym);
      const price = quote.regularMarketPrice || quote.preMarketPrice;
      if (price) {
        console.log(`✅ \$${price} — ${quote.shortName || quote.longName || ''}`);
      } else {
        console.log(`❌ No price (exists but no market data)`);
      }
    } catch (e) {
      const code = e.message?.includes('404') ? 'Not found' : e.message?.includes('429') ? 'Rate limited' : e.message?.slice(0, 60);
      console.log(`❌ ${code}`);
    }
  }

  console.log('\n🏁 Done');
}

test().catch(console.error);
