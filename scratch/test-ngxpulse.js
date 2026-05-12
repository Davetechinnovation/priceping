/**
 * 🧪 Test NGX Pulse API
 * 
 * NGX Pulse: https://www.ngxpulse.ng
 * Free Personal tier: 100 requests/day, live prices, no scraping needed
 * 
 * Run: node scratch/test-ngxpulse.js
 * 
 * Get your free API key at: https://www.ngxpulse.ng (scroll to "Personal" → "Get started free")
 */

const axios = require('axios');

const API_KEY = process.env.NGX_PULSE_KEY || ''; // Set this or pass inline
const BASE_URL = 'https://www.ngxpulse.ng';

const testTickers = ['DANGCEM', 'GTCO', 'ZENITHBANK', 'MTNN', 'UBA', 'ACCESSCORP', 'FBNH', 'SEPLAT', 'OANDO', 'AIRTELAFRI'];

async function test() {
  if (!API_KEY) {
    console.log('⚠️  No NGX_PULSE_KEY set. Testing without API key to see the error response...');
  }

  console.log('🧪 Testing NGX Pulse API\n');

  // 1️⃣ Test all stocks endpoint
  console.log('1️⃣ GET /api/ngxdata/stocks (all 150+ equities)');
  const start1 = Date.now();
  try {
    const { data } = await axios.get(`${BASE_URL}/api/ngxdata/stocks`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 10000,
    });
    const elapsed = ((Date.now() - start1) / 1000).toFixed(1);
    if (Array.isArray(data)) {
      console.log(`   ✅ ${elapsed}s — ${data.length} stocks`);
      console.log(`   Sample: ${JSON.stringify(data.slice(0, 3), null, 2)}`);
    } else {
      console.log(`   ${elapsed}s —`, JSON.stringify(data).substring(0, 200));
    }
  } catch (e) {
    const elapsed = ((Date.now() - start1) / 1000).toFixed(1);
    console.log(`   ❌ ${elapsed}s — ${e.message}`);
    if (e.response?.data) console.log('   Response:', JSON.stringify(e.response.data));
  }

  // 2️⃣ Test individual stock price
  console.log('\n2️⃣ Individual stock prices:');
  for (const ticker of testTickers) {
    process.stdout.write(`   ${ticker}... `);
    const start = Date.now();
    try {
      const { data } = await axios.get(`${BASE_URL}/api/ngxdata/prices/${ticker}?days=1`, {
        headers: { 'X-API-Key': API_KEY },
        timeout: 8000,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (data?.prices?.[0]?.close_price) {
        console.log(`✅ ₦${data.prices[0].close_price} (${elapsed}s)`);
      } else if (data?.prices?.length >= 0) {
        console.log(`⚠️ No close price (${elapsed}s) — ${JSON.stringify(data).substring(0, 80)}`);
      } else {
        console.log(`⚠️ ${elapsed}s — ${JSON.stringify(data).substring(0, 80)}`);
      }
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 60)}`);
    }
  }

  // 3️⃣ Test market status endpoint
  console.log('\n3️⃣ GET /api/ngxdata/market (market overview)');
  const start3 = Date.now();
  try {
    const { data } = await axios.get(`${BASE_URL}/api/ngxdata/market`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 10000,
    });
    const elapsed = ((Date.now() - start3) / 1000).toFixed(1);
    console.log(`   ✅ ${elapsed}s — ASI: ${data.asi}, Gainers: ${data.advancers}, Losers: ${data.decliners}`);
  } catch (e) {
    const elapsed = ((Date.now() - start3) / 1000).toFixed(1);
    console.log(`   ❌ ${elapsed}s — ${e.message}`);
  }

  console.log('\n🏁 Done!');
}

test().catch(console.error);
