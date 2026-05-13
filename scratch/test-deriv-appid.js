/**
 * 🧪 Test Deriv with YOUR specific App ID
 * Hardcoded with App ID: 33fY69rUAyjYH9yiOCtx2
 * 
 * Run: node scratch/test-deriv-appid.js
 */

const WebSocket = require('ws');

const APP_ID = '33fY69rUAyjYH9yiOCtx2'; // Your App ID from developers.deriv.com
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const FALLBACK_URL = `wss://ws.derivws.com/websockets/v3?app_id=1089`; // Public fallback

function fetchTick(url, symbol, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Timeout'));
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
      } catch (e) {}
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      reject(new Error(`Closed: ${code} ${reason || ''}`));
    });
  });
}

async function main() {
  console.log('🧪 Testing Deriv with YOUR App ID\n');
  console.log(`App ID: ${APP_ID}`);
  console.log(`WS URL: ${WS_URL}\n`);

  // Test 1: Your App ID
  console.log('1️⃣ YOUR APP ID — testing R_100...');
  const start1 = Date.now();
  try {
    const price = await fetchTick(WS_URL, 'R_100', 10000);
    console.log(`   ✅ $${price} (${Date.now() - start1}ms) — YOUR APP ID WORKS!`);
  } catch (e) {
    const elapsed = Date.now() - start1;
    console.log(`   ❌ FAILED after ${elapsed}ms: ${e.message}`);
    
    // If your App ID failed, try public fallback
    console.log('\n2️⃣ PUBLIC FALLBACK (1089) — testing R_100...');
    const start2 = Date.now();
    try {
      const price2 = await fetchTick(FALLBACK_URL, 'R_100', 10000);
      console.log(`   ✅ $${price2} (${Date.now() - start2}ms) — PUBLIC FALLBACK WORKS`);
    } catch (e2) {
      console.log(`   ❌ Also failed: ${e2.message}`);
    }
  }

  // Test 3: Multiple symbols with whichever worked
  const workingUrl = (() => {
    // We'll just test both and see
    return null;
  })();

  console.log('\n3️⃣ Testing multiple symbols...');
  const testSymbols = ['R_100', 'R_75', 'BOOM1000', 'CRASH500', '1HZ10V'];
  const urlsToTry = [WS_URL, FALLBACK_URL];
  
  for (const url of urlsToTry) {
    const label = url === WS_URL ? 'YOUR APP ID' : 'PUBLIC 1089';
    console.log(`\n   With ${label}:`);
    let allOk = true;
    for (const sym of testSymbols) {
      process.stdout.write(`     ${sym}... `);
      try {
        const price = await fetchTick(url, sym, 10000);
        console.log(`✅ $${price}`);
      } catch (e) {
        console.log(`❌ ${e.message}`);
        allOk = false;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (allOk) {
      console.log(`   ✅ ALL SYMBOLS WORK with ${label}`);
      break;
    }
  }

  console.log('\n🏁 Test complete.');
  process.exit(0);
}

main();
