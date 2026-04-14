const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance();

async function findCorrectTicker() {
  const queries = ['MTN Nigeria', 'Zenith Bank', 'Guaranty Trust Holding'];
  
  for (const q of queries) {
    try {
      console.log(`\n🔍 Searching Yahoo for: "${q}"...`);
      const searchResult = await yf.search(q);
      if (searchResult.quotes && searchResult.quotes.length > 0) {
        console.log(`- Best Match: ${searchResult.quotes[0].symbol} (${searchResult.quotes[0].longname})`);
        
        // Try to fetch price for that match
        const quote = await yf.quote(searchResult.quotes[0].symbol);
        console.log(`- Confirmed Price: ${quote.regularMarketPrice} ${quote.currency}`);
      } else {
        console.log('- No results found!');
      }
    } catch (e) {
      console.error(`- Error for ${q}:`, e.message);
    }
  }
}

findCorrectTicker();
