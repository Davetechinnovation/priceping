const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const stocks = {};
  
  for (let page = 1; page <= 2; page++) {
    try {
      console.log(`Fetching page ${page}...`);
      const url = page === 1 ? 'https://afx.kwayisi.org/ngx/' : `https://afx.kwayisi.org/ngx/?page=${page}`;
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const $ = cheerio.load(data);
      $('table tbody tr').each((i, element) => {
        const cells = $(element).find('td');
        if (cells.length >= 4) {
          const ticker = $(cells[0]).text().trim();
          const name = $(cells[1]).text().trim();
          const price = parseFloat($(cells[3]).text().trim());
          const change = parseFloat($(cells[4]).text().trim()) || null;
          if (ticker && !isNaN(price)) {
            stocks[ticker] = { ticker, name, price, change };
          }
        }
      });
    } catch (e) {
      console.error(`Failed on page ${page}:`, e.message);
    }
  }
  
  console.log(`Loaded ${Object.keys(stocks).length} stocks.`);
  console.log("ZENITHBANK details:", stocks['ZENITHBANK']);
  console.log("DANGCEM details:", stocks['DANGCEM']);
}

test();
