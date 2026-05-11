// ════════════════════════════════════════════════════
// PRICEPING — API HEALTH CHECK (self-deleting)
// Tests ALL external APIs used by the bot
// Auto-deletes itself when done
// ════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');

const SELF = __filename;

const PASS = '✅';
const FAIL = '🔴';
const SKIP = '⚠️';

const results = [];
let startTime;

// ── Helpers ──
function log(name, status, detail = '') {
  const elapsed = startTime ? `\t${Date.now() - startTime}ms` : '';
  const icon = status === 'pass' ? PASS : status === 'skip' ? SKIP : FAIL;
  console.log(`${icon} ${name}${detail ? ` → ${detail}` : ''}${elapsed}`);
  results.push({ name, status, detail });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testHttp(url, name, options = {}) {
  const s = Date.now();
  try {
    const res = await axios.get(url, { timeout: 10000, ...options });
    const latency = Date.now() - s;
    log(name, 'pass', `HTTP ${res.status}`, latency);
    return { ok: true, latency, status: res.status };
  } catch (e) {
    const latency = Date.now() - s;
    const msg = e.response ? `HTTP ${e.response.status}` : e.code || e.message;
    log(name, 'fail', msg);
    return { ok: false, latency, error: msg };
  }
}

async function testDerivTick(symbol, name) {
  const s = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const latency = Date.now() - s;
        log(name, 'fail', `10s timeout for ${symbol}`);
        resolve({ ok: false, latency });
      }
    }, 10000);

    try {
      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
      ws.on('open', () => {
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      });
      ws.on('message', (data) => {
        if (resolved) return;
        try {
          const resp = JSON.parse(data);
          if (resp.msg_type === 'tick' && resp.tick) {
            resolved = true;
            clearTimeout(timeout);
            const latency = Date.now() - s;
            log(name, 'pass', `${symbol} = ${resp.tick.quote}`);
            ws.close();
            resolve({ ok: true, latency, price: resp.tick.quote });
          }
          if (resp.error) {
            resolved = true;
            clearTimeout(timeout);
            log(name, 'fail', `${resp.error.message}`);
            ws.close();
            resolve({ ok: false, error: resp.error.message });
          }
        } catch (e) { /* ignore */ }
      });
      ws.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          log(name, 'fail', err.message);
          resolve({ ok: false });
        }
      });
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log(name, 'fail', err.message);
        resolve({ ok: false });
      }
    }
  });
}

async function run() {
  console.log('\n════════════════════════════════════════');
  console.log('   PRICEPING — API HEALTH CHECK');
  console.log('════════════════════════════════════════\n');
  startTime = Date.now();

  // ── 1. Twelve Data ──
  await testHttp(
    'https://api.twelvedata.com/price?symbol=AAPL&apikey=demo',
    'Twelve Data (AAPL price)'
  );

  await testHttp(
    'https://api.twelvedata.com/quote?symbol=AAPL&apikey=demo',
    'Twelve Data (AAPL quote)'
  );

  // ── 2. DIA Crypto ──
  await testHttp(
    'https://api.diadata.org/v1/assetQuotation/Bitcoin/0x0000000000000000000000000000000000000000',
    'DIA Crypto (BTC)'
  );

  // ── 3. DIA Commodities (FIXED ENDPOINT) ──
  await testHttp(
    'https://api.diadata.org/v1/rwa/commodities',
    'DIA Commodities (Gold etc.)'
  );

  // ── 4. NGX Doclib ──
  await testHttp(
    'https://doclib.ngxgroup.com/api/security?page=1&pageSize=10',
    'NGX Doclib API',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );

  // ── 5. Kwayisi (NGX fallback) ──
  await testHttp(
    'https://afx.kwayisi.org/ngx/',
    'Kwayisi (NGX fallback)',
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
  );

  // ── 6. FX Rates ──
  await testHttp(
    'https://api.frankfurter.dev/latest?base=USD',
    'FX Rates (EUR/USD)'
  );

  // ── 7. Yahoo Finance (search) ──
  await testHttp(
    'https://query1.finance.yahoo.com/v1/finance/search?q=AAPL',
    'Yahoo Finance (search)'
  );

  // ── 8. Yahoo Finance (chart/quote) ──
  await testHttp(
    'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d',
    'Yahoo Finance (chart)'
  );

  // ── 9. Deriv WebSocket (load symbols) ──
  try {
    await testDerivTick('R_100', 'Deriv WebSocket Tick (R_100)');
  } catch (e) {
    log('Deriv WebSocket Tick', 'fail', e.message);
  }

  // ── 10. Groq AI ──
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    await testHttp(
      'https://api.groq.com/openai/v1/models',
      'Groq AI (models list)',
      { headers: { Authorization: `Bearer ${groqKey}` } }
    );
  } else {
    log('Groq AI', 'skip', 'No GROQ_API_KEY');
  }

  // ── 11. News API (Google RSS) ──
  await testHttp(
    'https://news.google.com/rss',
    'News API (Google RSS)'
  );

  // ── 12. Termii (FIXED ENDPOINT) ──
  const termiiKey = process.env.TERMII_API_KEY;
  if (termiiKey) {
    await testHttp(
      `https://api.ng.termii.com/api/get-balance?api_key=${termiiKey}`,
      'Termii SMS (balance)'
    );
  } else {
    log('Termii SMS', 'skip', 'No TERMII_API_KEY');
  }

  // ── Summary ──
  console.log('\n════════════════════════════════════════');
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const totalTime = Date.now() - startTime;
  console.log(`   Results: ${PASS} ${passed} passed | ${FAIL} ${failed} failed | ${SKIP} ${skipped} skipped`);
  console.log(`   Total time: ${totalTime}ms`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('🔴 Failed APIs:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`   ${FAIL} ${r.name} → ${r.detail}`);
    });
    console.log();
    process.exit(1);
  } else {
    console.log('✅ All APIs passed!\n');
    process.exit(0);
  }
}

// ── Self-delete after run ──
run().finally(() => {
  try {
    fs.unlinkSync(SELF);
    console.log('🧹 Test file auto-deleted.');
  } catch (e) {
    // ignore
  }
});