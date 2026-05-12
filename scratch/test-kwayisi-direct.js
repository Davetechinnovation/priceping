/**
 * 🧪 Test: Send the EXACT same request to Kwayisi that the bot sends
 * Run: node scratch/test-kwayisi-direct.js
 */

const axios = require('axios');

const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-NG,en;q=0.9",
  Referer: "https://afx.kwayisi.org/",
};

async function testKwayisi() {
  console.log('🌐 Testing Kwayisi NGX scrape (same request as bot)...\n');

  for (const page of [1, 2]) {
    const url = page === 1
      ? "https://afx.kwayisi.org/ngx/"
      : `https://afx.kwayisi.org/ngx/?page=${page}`;

    console.log(`📄 Page ${page}: ${url}`);
    console.log(`   Headers: ${JSON.stringify(browserHeaders, null, 4)}`);
    console.log(`   Timeout: 30s`);

    const start = Date.now();

    try {
      const { data } = await axios.get(url, {
        family: 4,
        timeout: 30000,
        headers: browserHeaders,
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const sizeKB = (Buffer.byteLength(data, 'utf8') / 1024).toFixed(1);

      console.log(`   ✅ SUCCESS in ${elapsed}s (${sizeKB}KB)`);
      console.log(`   HTML preview (first 500 chars):`);
      console.log(`   ${data.trim().substring(0, 500)}...\n`);

      // Parse with cheerio to count actual stocks
      try {
        const cheerio = require('cheerio');
        const $ = cheerio.load(data);
        const rows = $('table tbody tr').length;
        console.log(`   📊 Rows found: ${rows}`);
        if (rows > 0) {
          const firstRow = $('table tbody tr').first();
          const cells = firstRow.find('td');
          console.log(`   First row cells: ${cells.map((i, el) => $(el).text().trim()).get().join(' | ')}`);
        }
      } catch (e) {
        console.log(`   ⚠️ Could not parse with cheerio: ${e.message}`);
      }

    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`   ❌ FAILED after ${elapsed}s`);
      console.log(`   Error: ${err.message}`);
      if (err.code) console.log(`   Code: ${err.code}`);
      if (err.response) {
        console.log(`   Status: ${err.response.status}`);
        console.log(`   StatusText: ${err.response.statusText}`);
      }
    }

    console.log(''); // blank line between pages
  }

  console.log('🏁 Test complete.');
}

testKwayisi().catch(console.error);
