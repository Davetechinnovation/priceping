const PriceService = require('../src/priceService');
const ps = new PriceService();

async function test() {
  console.log("--- Testing Price Formatting ---");
  
  const mtn = ps.formatPrice(35.50, "MTNN");
  console.log(`MTNN (NGN): ${mtn} (Expected: ₦35.50)`);

  const zen = ps.formatPrice(40.00, "ZENITHBANK");
  console.log(`Zenith (NGN): ${zen} (Expected: ₦40.00)`);

  const btc = ps.formatPrice(65000.123, "BTC");
  console.log(`BTC (USD): ${btc} (Expected: $65,000.12)`);

  const eth = ps.formatPrice(0.00012345, "ETH");
  console.log(`ETH (USD - low): ${eth} (Expected: $0.000123)`);

  const gold = ps.formatPrice(2300.50, "GOLD");
  console.log(`Gold (USD): ${gold} (Expected: $2,300.50)`);

  const eurusd = ps.formatPrice(1.085432, "EURUSD");
  console.log(`EURUSD (Forex): ${eurusd} (Expected: 1.08543)`);
  
  const unknown = ps.formatPrice(100, "ABC", "JPY");
  console.log(`Unknown JPY: ${unknown} (Expected: ¥100.00)`);
}

test();
