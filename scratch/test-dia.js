// Debug: Why is DIA (diadata.org) failing?
const axios = require('axios');

async function testDIA() {
  console.log('=== DIA Data API Test ===\n');

  // Test 1: BTC via assetQuotation (crypto endpoint)
  // BTC on bitcoin blockchain, address is the contract address (empty for native coins)
  console.log('1️⃣  BTC via assetQuotation/bitcoin/...');
  try {
    const start = Date.now();
    const { data } = await axios.get(
      'https://api.diadata.org/v1/assetQuotation/bitcoin/0x0000000000000000000000000000000000000000',
      { timeout: 10000 }
    );
    console.log(`   ✅ (${Date.now() - start}ms)`, JSON.stringify(data).slice(0, 200));
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
    console.log(`   Code: ${e.code || e.response?.status || 'N/A'}`);
  }

  // Test 2: BTC via quotedAssets (alternative endpoint)
  console.log('\n2️⃣  quotedAssets endpoint...');
  try {
    const start = Date.now();
    const { data } = await axios.get(
      'https://api.diadata.org/v1/quotedAssets',
      { timeout: 10000 }
    );
    console.log(`   ✅ (${Date.now() - start}ms)`);
    // Find BTC in the list
    const btcAsset = data?.find?.(a => a.Symbol === 'BTC');
    if (btcAsset) {
      console.log(`   BTC found: blockchain=${btcAsset.Blockchain}, address=${btcAsset.Address}`);
      // Now try to fetch that specific one
      console.log(`\n3️⃣  Fetching BTC via specific endpoint...`);
      try {
        const start2 = Date.now();
        const { data: priceData } = await axios.get(
          `https://api.diadata.org/v1/assetQuotation/${btcAsset.Blockchain}/${btcAsset.Address}`,
          { timeout: 10000 }
        );
        console.log(`   ✅ (${Date.now() - start2}ms)`);
        console.log(`   Price: $${priceData?.Price}, Yesterday: $${priceData?.PriceYesterday}`);
      } catch (e2) {
        console.log(`   ❌ ${e2.message}`);
      }
    } else {
      console.log(`   Data count: ${data?.length || 0}, BTC not found in first 10`);
      console.log(`   First few:`, JSON.stringify(data?.slice(0, 3)));
    }
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
    console.log(`   Code: ${e.code || e.response?.status || 'N/A'}`);
  }

  // Test 4: Raw HTTP test - is the server even reachable?
  console.log('\n4️⃣  Raw HTTP check (is api.diadata.org reachable?)');
  try {
    const start = Date.now();
    const { data } = await axios.get('https://api.diadata.org/v1/quotedAssets?limit=1', {
      timeout: 5000
    });
    console.log(`   ✅ (${Date.now() - start}ms)`);
    console.log(`   Status: reachable, data type: ${typeof data}`);
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
    if (e.code === 'ENOTFOUND') {
      console.log('   → Same DNS block as Kraken!');
    } else if (e.code === 'ECONNREFUSED') {
      console.log('   → Connection refused by server');
    } else if (e.code === 'ECONNABORTED') {
      console.log('   → Timeout - server too slow');
    }
  }

  console.log('\n=== Done ===');
}

testDIA().catch(console.error);
