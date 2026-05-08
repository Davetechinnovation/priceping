const PriceService = require('../src/priceService.js');
const AssetClassifier = require('../src/assetClassifier.js');
const dotenv = require('dotenv');

dotenv.config({ path: '../.env' });

async function testFutures() {
  console.log("--- Initializing Services ---");
  const classifier = new AssetClassifier();
  const priceService = new PriceService(null, classifier);

  const testAssets = [
    "BTC perp",          // Crypto future (should hit Bybit if Binance is blocked)
    "ETH futures",       // Crypto future
    "Cocoa futures",     // Traditional commodity future
    "S&P 500 futures",   // Traditional index future
    "Euro futures"       // Traditional forex future
  ];

  for (const query of testAssets) {
    console.log(`\n--- Testing: "${query}" ---`);
    const sym = query.toUpperCase();
    const classification = classifier.classify(sym);
    console.log("Classification:", classification);

    try {
      const result = await priceService.getAssetInfo(sym);
      if (result) {
        console.log("✅ Result:", result.name || result.asset, "->", priceService.formatPrice(result.price, sym));
        if (result.source) console.log("   Source:", result.source);
      } else {
        console.log("❌ Result: Not found or failed");
      }
    } catch (e) {
      console.log("❌ Error:", e.message);
    }
  }

  // Also test the alert resolver directly
  console.log("\n--- Testing Alert Resolver ---");
  for (const query of ["BTC perp", "S&P 500 futures"]) {
    const price = await priceService._resolveAlertPrice(query);
    console.log(`Alert Resolver [${query}]:`, price);
  }
}

testFutures().catch(console.error);
