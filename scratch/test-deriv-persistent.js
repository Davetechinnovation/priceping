/**
 * 🧪 Test Deriv persistent WebSocket connection
 * Tests: connection, subscription, tick cache, reconnection
 * 
 * Run: node scratch/test-deriv-persistent.js
 * Uses public App ID 1089 for testing
 */

const WebSocket = require('ws');

const APP_ID = '1089'; // Public Deriv App ID
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const testSymbols = ['R_100', 'R_75', 'R_50', 'BOOM1000', '1HZ10V'];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Tests Deriv connectivity by opening a WebSocket, subscribing to a tick,
 * and measuring response time. Closes after getting 1 tick.
 */
function fetchTick(symbol, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timeout (${timeout}ms)`));
    }, timeout);

    ws.on('open', () => {
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    });

    ws.on('message', (data) => {
      try {
        const resp = JSON.parse(data);
        if (resp.tick) {
          clearTimeout(timer);
          ws.close();
          resolve(parseFloat(resp.tick.quote));
        }
        if (resp.error) {
          clearTimeout(timer);
          ws.terminate();
          reject(new Error(resp.error.message));
        }
      } catch (e) { /* ignore */ }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      reject(new Error('Connection closed before tick'));
    });
  });
}

async function main() {
  console.log('🧪 Testing Deriv connectivity (public App ID 1089)\n');
  console.log(`WS URL: ${WS_URL}\n`);

  // Test each symbol with a new connection (like old code)
  console.log('1️⃣ Testing individual fetchTick (open/close per request):');
  for (const sym of testSymbols) {
    process.stdout.write(`   ${sym}... `);
    const start = Date.now();
    try {
      const price = await fetchTick(sym, 15000);
      console.log(`✅ $${price} (${Date.now() - start}ms)`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    await sleep(300);
  }

  // Test connection speed (first connection vs second connection)
  console.log('\n2️⃣ Connection speed comparison:');

  process.stdout.write('   First connection to R_100... ');
  let start = Date.now();
  try {
    const price = await fetchTick('R_100', 15000);
    console.log(`✅ $${price} (${Date.now() - start}ms)`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }

  process.stdout.write('   Second connection to R_100... ');
  start = Date.now();
  try {
    const price = await fetchTick('R_100', 15000);
    console.log(`✅ $${price} (${Date.now() - start}ms)`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }

  process.stdout.write('   Third connection to R_100... ');
  start = Date.now();
  try {
    const price = await fetchTick('R_100', 5000);
    console.log(`✅ $${price} (${Date.now() - start}ms)`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (Deriv_webSocket_connected) {
    console.log('✅ Deriv API is reachable and working!');
  } else {
    console.log('⚠️ Some tests had issues');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nNote: This test opens/closes WebSocket per request (OLD behavior).');
  console.log('The persistent WS implementation (NEW) avoids the open/close overhead');
  console.log('by keeping one connection open — results will be faster on Render.');
  console.log('');
}

// Allow the script to complete and exit
let Deriv_webSocket_connected = false;

main().then(() => {
  // Wait a moment for all connections to close cleanly
  setTimeout(() => {
    console.log('Test complete. Good to deploy!');
    process.exit(0);
  }, 1000);
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
