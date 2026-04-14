// Log the full raw response to see what's happening
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance();

async function test() {
  const sym = 'MTNN.LG';
  try {
    const result = await yf.quote(sym);
    console.log('--- MTNN.LG Result: ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(`- Full error for ${sym}:`, e);
  }
}

test();
