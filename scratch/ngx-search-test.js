// Research: Test what Yahoo Finance's search() does return for Nigerian stocks
// and check if there's a working alternative like Finnhub or Alpha Vantage
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const axios = require('axios');

async function testSearch() {
  const queries = ['MTNN Nigeria stock', 'Zenith Bank Nigeria', 'Dangote Cement Nigeria'];
  
  console.log('=== Yahoo Search API Test ===');
  for (const q of queries) {
    try {
      const res = await yf.search(q, { quotesCount: 5 });
      console.log(`\n"${q}":`);
      if (res.quotes && res.quotes.length) {
        res.quotes.forEach(r => console.log(`  -> ${r.symbol} | ${r.longname || r.shortname} | ${r.exchange}`));
      } else {
        console.log('  -> No results');
      }
    } catch(e) {
      console.log(`  -> Error: ${e.message}`);
    }
  }

  // Also test the Yahoo Finance autoc API directly for Nigerian stocks
  console.log('\n=== Direct Yahoo Autocomplete API Test ===');
  const testNames = ['MTN Nigeria', 'Zenith Bank', 'Dangote'];
  for (const name of testNames) {
    try {
      const res = await axios.get(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=5&region=NG`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
      });
      const quotes = res.data?.quotes || [];
      console.log(`\n"${name}":`);
      if (quotes.length) {
        quotes.forEach(r => console.log(`  -> ${r.symbol} | ${r.longname || r.shortname} | ${r.exchange}`));
      } else {
        console.log('  -> No results');
      }
    } catch(e) {
      console.log(`  -> Error: ${e.message}`);
    }
  }
}

testSearch();
