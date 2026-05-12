/**
 * 🧪 Test alternative NGX data sources V2
 * Run: node scratch/test-ngx-v2.js
 * Tests more targeted approaches: Yahoo Finance NGX, Google Finance, proxy routes
 */

const axios = require('axios');
const cheerio = require('cheerio');

const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const ngxSymbols = ['MTNN', 'ZENITHBANK', 'DANGCEM', 'GTCO', 'ACCESSCORP', 'UBA', 'FBNH', 'SEPLAT', 'OANDO', 'AIRTELAFRI'];

async function testSource(name, url, options = {}, parser = null) {
  process.stdout.write(`📡 ${name}... `);
  const start = Date.now();
  try {
    const { data } = await axios.get(url, { timeout: 15000, family: 4, headers: browserHeaders, ...options });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const sizeKB = (Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data), 'utf8') / 1024).toFixed(1);
    
    if (parser) {
      const result = parser(data);
      if (result && result.length > 0) {
        console.log(`✅ ${elapsed}s (${sizeKB}KB) — ${result.length} results`);
        console.log(`   Sample: ${JSON.stringify(result.slice(0, 3))}`);
        return result;
      }
      console.log(`⚠️ ${elapsed}s (${sizeKB}KB) — No results parsed`);
      return null;
    }
    
    const preview = typeof data === 'string' ? data.substring(0, 150).replace(/\s+/g, ' ').trim() : JSON.stringify(data).substring(0, 150);
    console.log(`📡 ${elapsed}s (${sizeKB}KB) — ${preview}`);
    return data;
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`❌ ${elapsed}s — ${e.message.slice(0, 100)}`);
    return null;
  }
}

async function main() {
  console.log('🧪 Testing NGX data sources V2\n');

  // 1️⃣ Yahoo Finance for NGX stocks (try various suffixes)
  console.log('\n--- Yahoo Finance NGX tests ---');
  for (const sym of ngxSymbols.slice(0, 5)) {
    // Try direct symbol (sometimes Yahoo has NGX)
    await testSource(`Yahoo: ${sym}`, `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}`, {}, (data) => {
      const result = data?.quoteResponse?.result?.[0];
      return result ? [{ symbol: result.symbol, price: result.regularMarketPrice, name: result.shortName }] : [];
    });
  }

  // 2️⃣ Google Finance structured data (check if MTNN:NGX exists)
  console.log('\n--- Google Finance tests ---');
  await testSource('Google Finance MTNN', 'https://www.google.com/finance/quote/MTNN:NGX', {}, (data) => {
    const $ = cheerio.load(data);
    // Try to find data in script tags
    const scripts = $('script').map((i, el) => $(el).html()).get();
    const dataScript = scripts.find(s => s && s.includes('"MTNN"') && s.includes('regularMarketPrice'));
    if (dataScript) {
      try {
        const match = dataScript.match(/"regularMarketPrice"[^:]*:([\d.]+)/);
        if (match) return [{ symbol: 'MTNN', price: parseFloat(match[1]), source: 'google_finance_script' }];
      } catch(e) {}
    }
    // Also try to find price in visible elements
    const priceEl = $('.YMlKec').first().text();
    if (priceEl) {
      const price = parseFloat(priceEl.replace(/[^0-9.]/g, ''));
      if (!isNaN(price)) return [{ symbol: 'MTNN', price, source: 'google_finance_visible' }];
    }
    return [];
  });

  // 3️⃣ TheCable NGX — better parsing
  console.log('\n--- TheCable NGX (better parser) ---');
  await testSource('TheCable NGX', 'https://www.thecable.ng/stock-market', {}, (data) => {
    const $ = cheerio.load(data);
    const stocks = [];
    
    // Try different selectors
    $('table').each((ti, table) => {
      $(table).find('tr').each((i, row) => {
        const texts = $(row).find('td, th').map((i, el) => $(el).text().trim()).get();
        if (texts.length >= 2) {
          // Try to find ticker + price pattern
          for (let i = 0; i < texts.length; i++) {
            const price = parseFloat(texts[i].replace(/[₦$,]/g, ''));
            if (!isNaN(price) && price > 0 && i > 0) {
              const ticker = texts[0].split(' ')[0].toUpperCase();
              if (ticker.length >= 2 && ticker.length <= 15 && !stocks.find(s => s.ticker === ticker)) {
                stocks.push({ ticker, price });
              }
            }
          }
        }
      });
    });

    // Try looking for any numeric data in article content
    if (stocks.length === 0) {
      $('.entry-content, article').find('p, li').each((i, el) => {
        const text = $(el).text();
        const ngnMatch = text.match(/₦\s*([\d,]+\.?\d*)/g);
        if (ngnMatch) {
          ngnMatch.forEach(m => {
            const price = parseFloat(m.replace(/[₦,]/g, ''));
            // Try to find a ticker in the same text
            const ticker = ngxSymbols.find(s => text.includes(s));
            if (ticker && !isNaN(price) && !stocks.find(s => s.ticker === ticker)) {
              stocks.push({ ticker, price });
            }
          });
        }
      });
    }
    
    return stocks;
  });

  // 4️⃣ Yahoo Finance with NGX suffix
  console.log('\n--- Yahoo Finance suffix tests ---');
  const suffixes = ['', '.L', '.PA', '.DE', '.LAG', '.NG', '-NG'];
  for (const sym of ['MTNN', 'ZENITHBANK', 'DANGCEM']) {
    for (const suffix of suffixes) {
      const testSym = `${sym}${suffix}`;
      const result = await testSource(`Yahoo: ${testSym}`, `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${testSym}`, {}, (data) => {
        const result = data?.quoteResponse?.result?.[0];
        return result && result.regularMarketPrice ? [{ symbol: result.symbol, price: result.regularMarketPrice, name: result.shortName }] : [];
      });
      if (result) break; // Found one for this symbol
    }
  }

  // 5️⃣ Try CORS proxy to reach Kwayisi
  console.log('\n--- CORS Proxy tests ---');
  const proxies = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
  ];
  for (const proxy of proxies) {
    await testSource(`Proxy → Kwayisi (${proxy.slice(0, 30)}...)`, `${proxy}https://afx.kwayisi.org/ngx/`, { timeout: 20000 }, (data) => {
      const $ = cheerio.load(typeof data === 'string' ? data : '');
      const stocks = [];
      $('table tbody tr').each((i, el) => {
        const cells = $(el).find('td');
        if (cells.length >= 4) {
          const ticker = $(cells[0]).text().trim();
          const price = parseFloat($(cells[3]).text().trim().replace(/,/g, ''));
          if (ticker && !isNaN(price) && ticker.length <= 15) {
            stocks.push({ ticker, price });
          }
        }
      });
      return stocks;
    });
  }

  // 6️⃣ Market data APIs that might have NGX data
  console.log('\n--- Free API tests ---');
  await testSource('Alpha Vantage MTNN', `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=MTNN.LAG&apikey=demo`, { timeout: 10000 });
  await testSource('Twelve Data MTNN', 'https://api.twelvedata.com/price?symbol=MTNN&apikey=demo', { timeout: 10000 });
  
  console.log('\n🏁 Done!');
}

main().catch(console.error);
