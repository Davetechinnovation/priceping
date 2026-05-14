// Test: What's the correct DIA API endpoint for BTC price?
const axios = require('axios');

async function main() {
  console.log('=== Testing DIA price endpoints ===\n');

  // The working base: quotedAssets gave us BTC:
  // Symbol: BTC, Blockchain: Bitcoin, Address: 0x00000...
  
  // Try different URL formats
  const urls = [
    // Current format used in code (returns 404)
    'https://api.diadata.org/v1/assetQuotation/Bitcoin/0x0000000000000000000000000000000000000000',
    // Try lowercase blockchain
    'https://api.diadata.org/v1/assetQuotation/bitcoin/0x0000000000000000000000000000000000000000',
    // Try symbol-based endpoint
    'https://api.diadata.org/v1/assetQuotation/Bitcoin/BTC',
    // Try just symbol
    'https://api.diadata.org/v1/assetQuotation/BTC',
    // Try coinGecko-like ID
    'https://api.diadata.org/v1/assetQuotation/bitcoin',
    // The actual coin listing
    'https://api.diadata.org/v1/assetQuotation/Ethereum/0x0000000000000000000000000000000000000000',
    // Just check what the root returns
    'https://api.diadata.org/v1/assetQuotation',
  ];

  for (const url of urls) {
    try {
      const start = Date.now();
      const { data, status } = await axios.get(url, { timeout: 10000 });
      console.log(`✅ ${status} (${Date.now() - start}ms) ${url.slice(30)}`);
      const preview = JSON.stringify(data).slice(0, 150);
      console.log(`   → ${preview}\n`);
    } catch (e) {
      const code = e.response?.status || e.code || '?';
      console.log(`❌ ${code} (${e.message.slice(0, 80)}) ${url.slice(30)}\n`);
    }
  }

  // Try the commodities endpoint too
  console.log('\n=== Testing DIA Commodities endpoint ===');
  try {
    const start = Date.now();
    const { data } = await axios.get('https://api.diadata.org/v1/rwa/Commodities/XAU-USD', { timeout: 10000 });
    console.log(`✅ Gold (${Date.now() - start}ms): $${data?.Price}`);
  } catch (e) {
    console.log(`❌ Gold: ${e.message}`);
  }

  // Try the quotedAsset with the exact BTC entry
  console.log('\n=== Re-fetching quotedAssets to find BTC entry ===');
  try {
    const { data } = await axios.get('https://api.diadata.org/v1/quotedAssets', { timeout: 15000 });
    const btc = data?.find?.(a => a.Symbol === 'BTC');
    if (btc) {
      console.log(`BTC entry:`, JSON.stringify(btc.Asset || btc));
      const asset = btc.Asset || btc;
      // Try constructing with what we found
      const url = `https://api.diadata.org/v1/assetQuotation/${asset.Blockchain}/${asset.Address}`;
      console.log(`Trying: ${url}`);
      try {
        const { data: priceData } = await axios.get(url, { timeout: 10000 });
        console.log(`✅ Price: $${priceData?.Price}`);
      } catch (e2) {
        console.log(`❌ ${e2.message}`);
      }
    }
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }
}

main().catch(console.error);
