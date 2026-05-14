// Quick test: Is Kraken API working?
// Kraken = cryptocurrency exchange with free public OHLC data
const axios = require('axios');

async function testKraken() {
  console.log('=== Kraken API Test ===\n');
  
  // Test 1: BTC pair (XBTUSD)
  console.log('1️⃣  Testing Kraken XBTUSD (BTC)...');
  try {
    const start = Date.now();
    const { data } = await axios.get('https://api.kraken.com/0/public/OHLC', {
      params: { pair: 'XBTUSD', interval: 60 },
      timeout: 15000,
    });
    const elapsed = Date.now() - start;
    console.log(`   ✅ Response in ${elapsed}ms`);
    console.log(`   Error: ${JSON.stringify(data.error)}`);
    if (data.result) {
      const keys = Object.keys(data.result).filter(k => k !== 'last');
      console.log(`   Result keys: ${keys}`);
      console.log(`   Candle count: ${data.result[keys[0]]?.length || 0}`);
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    console.log(`   Code: ${e.code || 'N/A'}`);
  }

  // Test 2: ETH pair
  console.log('\n2️⃣  Testing Kraken ETHUSD...');
  try {
    const start = Date.now();
    const { data } = await axios.get('https://api.kraken.com/0/public/OHLC', {
      params: { pair: 'ETHUSD', interval: 60 },
      timeout: 15000,
    });
    const elapsed = Date.now() - start;
    console.log(`   ✅ Response in ${elapsed}ms`);
    console.log(`   Error: ${JSON.stringify(data.error)}`);
    if (data.result) {
      const keys = Object.keys(data.result).filter(k => k !== 'last');
      console.log(`   Candle count: ${data.result[keys[0]]?.length || 0}`);
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    console.log(`   Code: ${e.code || 'N/A'}`);
  }

  // Test 3: SOL pair (SOLUSD)
  console.log('\n3️⃣  Testing Kraken SOLUSD...');
  try {
    const start = Date.now();
    const { data } = await axios.get('https://api.kraken.com/0/public/OHLC', {
      params: { pair: 'SOLUSD', interval: 60 },
      timeout: 15000,
    });
    const elapsed = Date.now() - start;
    console.log(`   ✅ Response in ${elapsed}ms`);
    console.log(`   Error: ${JSON.stringify(data.error)}`);
    if (data.result) {
      const keys = Object.keys(data.result).filter(k => k !== 'last');
      console.log(`   Candle count: ${data.result[keys[0]]?.length || 0}`);
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    console.log(`   Code: ${e.code || 'N/A'}`);
  }

  // Test 4: CryptoCompare as backup
  console.log('\n4️⃣  Testing CryptoCompare BTC backup...');
  try {
    const start = Date.now();
    const { data } = await axios.get('https://min-api.cryptocompare.com/data/v2/histoday', {
      params: { fsym: 'BTC', tsym: 'USD', limit: 300 },
      timeout: 10000,
    });
    const elapsed = Date.now() - start;
    console.log(`   ✅ Response in ${elapsed}ms`);
    console.log(`   Candle count: ${data.Data?.Data?.length || 0}`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }

  console.log('\n=== Done ===');
}

testKraken().catch(console.error);
