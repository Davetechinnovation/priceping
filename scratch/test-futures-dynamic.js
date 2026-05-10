const PriceService = require('../src/priceService.js');
const AssetClassifier = require('../src/assetClassifier.js');
const dotenv = require('dotenv');

dotenv.config({ path: '../.env' });

async function testDynamicFutures() {
  console.log("=== Dynamic Traditional Futures Test ===\n");
  const classifier = new AssetClassifier();
  const priceService = new PriceService(null, classifier);

  // Wait for initialization
  await new Promise(r => setTimeout(r, 2000));

  const tests = [
    'SUGAR',         // Should resolve via Yahoo search → SB=F
    'COFFEE',        // Should resolve via Yahoo search → KC=F
    'PLATINUM',      // Should resolve via Yahoo search → PL=F
    'PALLADIUM',     // Should resolve via Yahoo search → PA=F
    'WHEAT',         // Should resolve via Yahoo search → ZW=F
    'LUMBER',        // Should resolve via Yahoo search → LB=F
  ];

  for (const t of tests) {
    console.log(`\n--- Testing: "${t}" ---`);
    const classification = classifier.classify(t);
    console.log(`Classification: ${classification.type} → ${classification.symbol}`);

    try {
      const result = await priceService.getAssetInfo(t);
      if (result) {
        console.log(`✅ ${result.name || result.symbol} → $${result.price?.toFixed(2) || 'N/A'} (${result.blockchain})`);
        if (result.change24h != null) {
          console.log(`   24h Change: ${result.change24h >= 0 ? '+' : ''}${result.change24h.toFixed(2)}%`);
        }
      } else {
        console.log('❌ No result returned');
      }
    } catch (e) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  console.log('\n=== All Done ===');
  process.exit(0);
}

testDynamicFutures().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});