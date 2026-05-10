const PriceService = require('../src/priceService');
const derivService = require('../src/derivService');

(async () => {
  console.log('=== Testing Synthetic Indices ===\n');

  // First load deriv symbols
  await derivService.loadActiveSymbols();
  console.log('Active Deriv symbols:', derivService.activeSymbols.length);
  console.log('Synthetic symbols:', derivService.syntheticSymbols.size);
  console.log('Sample synthetics:', [...derivService.syntheticSymbols].slice(0, 15).join(', '));
  console.log();

  // Test classification via PriceService
  const ps = new PriceService();

  // Wait for bootstrap
  await new Promise(r => setTimeout(r, 2000));

  // Test various synthetic queries
  const tests = ['R_100', 'volatility 10', 'boom 500', 'crash 300', 'jump 50', 'range 100', 'step'];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const info = await ps.getAssetInfo(test);
    if (info && info.price !== null) {
      console.log('✅ %s → $%s (blockchain: %s)', test, info.price, info.blockchain);
      passed++;
    } else if (info) {
      console.log('⚠️ %s → classified but no price', test);
      failed++;
    } else {
      console.log('❌ %s → null result', test);
      failed++;
    }
  }

  console.log('\n--- Synthetic Results: %d passed, %d failed out of %d ---', passed, failed, tests.length);
  console.log('\n=== Now testing that non-synthetic uses correct paths ===\n');

  // Test that stocks/futures still work via the bot
  const stockInfo = await ps.getAssetInfo('AAPL');
  console.log('AAPL stock: %s, price=%s', stockInfo?.symbol || 'NULL', stockInfo?.price || 'NULL');
  
  const cocoaInfo = await ps.getAssetInfo('cocoa futures');
  console.log('Cocoa futures: %s, price=%s', cocoaInfo?.symbol || 'NULL', cocoaInfo?.price || 'NULL');

  const spInfo = await ps.getAssetInfo('S&P 500 futures');
  console.log('S&P 500 futures: %s, price=%s', spInfo?.symbol || 'NULL', spInfo?.price || 'NULL');

  const volInfo = await ps.getAssetInfo('volatility 75 index');
  console.log('Volatility 75: %s, price=%s', volInfo?.symbol || 'NULL', volInfo?.price || 'NULL');

  console.log('\n=== Done ===');
})();