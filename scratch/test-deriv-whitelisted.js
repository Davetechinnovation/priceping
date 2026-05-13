/**
 * 🧪 Test Deriv after whitelisting origin
 * Run: node scratch/test-deriv-whitelisted.js
 * Must be called AFTER adding https://priceping.onrender.com to Redirect URLs
 */

const WebSocket = require('ws');

const APP_ID = '33fZga850tbzHrgy40218';
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

async function main() {
  console.log('🧪 Testing whitelisted App ID: 33fZga850tbzHrgy40218\n');
  
  const symbols = ['R_100', 'R_75', 'BOOM1000', 'CRASH500', '1HZ10V'];
  let successCount = 0;

  for (const sym of symbols) {
    process.stdout.write(`   ${sym}... `);
    try {
      const price = await new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('Timeout')); }, 10000);
        ws.on('open', () => ws.send(JSON.stringify({ ticks: sym, subscribe: 1 })));
        ws.on('message', (data) => {
          try {
            const resp = JSON.parse(data);
            if (resp.tick) { clearTimeout(timer); ws.close(); resolve(parseFloat(resp.tick.quote)); }
            if (resp.error) { clearTimeout(timer); ws.terminate(); reject(new Error(resp.error.message)); }
          } catch (e) {}
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
      console.log(`✅ $${price}`);
      successCount++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
  }

  console.log(`\n✅ Results: ${successCount}/${symbols.length} worked`);
  process.exit(0);
}

main();
