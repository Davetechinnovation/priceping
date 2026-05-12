/**
 * 🧪 Test alternative NGX data sources
 * Run: node scratch/test-alternative-ngx-sources.js
 * 
 * Tests multiple possible NGX stock price sources to find one that works.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-NG,en;q=0.9",
};

const sources = [
  {
    name: 'Kwayisi (page 1)',
    url: 'https://afx.kwayisi.org/ngx/',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      $('table tbody tr').each((i, el) => {
        const cells = $(el).find('td');
        if (cells.length >= 4) {
          const ticker = $(cells[0]).text().trim();
          const name = $(cells[1]).text().trim();
          const price = parseFloat($(cells[3]).text().trim().replace(/,/g, ''));
          if (ticker && !isNaN(price)) {
            stocks.push({ ticker, name, price });
          }
        }
      });
      return stocks;
    },
  },
  {
    name: 'Nairametrics (proshare partnership)',
    url: 'https://www.nairametrics.com/ngx-stock-prices/',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      // Try common table patterns
      $('table').each((ti, table) => {
        $(table).find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const ticker = $(cells[0]).text().trim();
            const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price) && ticker.length <= 15) {
              stocks.push({ ticker, price });
            }
          }
        });
      });
      return stocks;
    },
  },
  {
    name: 'Proshare NGX',
    url: 'https://proshare.co/market/stock-market',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      $('table').each((ti, table) => {
        $(table).find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const ticker = $(cells[0]).text().trim();
            const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price) && ticker.length <= 15) {
              stocks.push({ ticker, price });
            }
          }
        });
      });
      return stocks;
    },
  },
  {
    name: 'Nigerian Tribune NGX',
    url: 'https://tribuneonlineng.com/ngx-stock-prices/',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      $('table').each((ti, table) => {
        $(table).find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const ticker = $(cells[0]).text().trim();
            const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price) && ticker.length <= 15) {
              stocks.push({ ticker, price });
            }
          }
        });
      });
      return stocks;
    },
  },
  {
    name: 'Investors Chronicle NGX',
    url: 'https://www.investorschronicle.co.za/share-prices/africa/nigeria/',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      $('table').each((ti, table) => {
        $(table).find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const ticker = $(cells[0]).text().trim();
            const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price) && ticker.length <= 15) {
              stocks.push({ ticker, price });
            }
          }
        });
      });
      return stocks;
    },
  },
  {
    name: 'NGX Group Official (alternative endpoint)',
    url: 'https://ngxgroup.com/wp-json/wp/v2/posts?categories=1200&per_page=10',
    parser: (data) => {
      // This would be a REST API, not stock prices - just checking connectivity
      return Array.isArray(data) ? [{ ticker: 'API_RESPONDED', price: data.length }] : [];
    },
  },
  {
    name: 'TheCable NGX data',
    url: 'https://www.thecable.ng/stock-market',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      $('table').each((ti, table) => {
        $(table).find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const ticker = $(cells[0]).text().trim();
            const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price) && ticker.length <= 15) {
              stocks.push({ ticker, price });
            }
          }
        });
      });
      return stocks;
    },
  },
  {
    name: 'Simplified NGX (alternative scraper)',
    url: 'https://ngx.i-investonline.com/',
    parser: (data) => {
      const $ = cheerio.load(data);
      const stocks = [];
      $('table').each((ti, table) => {
        $(table).find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const ticker = $(cells[0]).text().trim();
            const price = parseFloat($(cells[1]).text().trim().replace(/,/g, ''));
            if (ticker && !isNaN(price) && ticker.length <= 15) {
              stocks.push({ ticker, price });
            }
          }
        });
      });
      return stocks;
    },
  },
];

async function testSources() {
  console.log('🧪 Testing alternative NGX data sources...\n');

  for (const source of sources) {
    process.stdout.write(`📡 ${source.name}... `);

    const start = Date.now();
    try {
      const { data } = await axios.get(source.url, {
        timeout: 15000,
        family: 4,
        headers: {
          ...browserHeaders,
          Referer: source.url,
        },
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const sizeKB = (Buffer.byteLength(data, 'utf8') / 1024).toFixed(1);
      
      let stocks = [];
      try {
        stocks = source.parser(data);
      } catch (e) {
        console.log(`❌ Parse error (${elapsed}s): ${e.message}`);
        continue;
      }

      if (stocks.length > 0) {
        console.log(`✅ ${elapsed}s (${sizeKB}KB) — ${stocks.length} stocks found!`);
        console.log(`   First 3: ${stocks.slice(0, 3).map(s => `${s.ticker}: ${s.price || ''}`).join(', ')}`);
      } else {
        console.log(`⚠️ ${elapsed}s (${sizeKB}KB) — No stocks parsed (structure may differ)`);
      }
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`❌ ${elapsed}s — ${e.message.slice(0, 100)}`);
    }
  }

  console.log('\n🏁 Done! Copy this script to Render and run it see what works there.');
}

testSources().catch(console.error);
