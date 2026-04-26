const axios = require('axios');
const cheerio = require('cheerio');

async function testProxies() {
  const url = 'https://afx.kwayisi.org/ngx/';
  
  const proxies = [
    { name: 'AllOrigins', getUrl: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}` },
    { name: 'CodeTabs', getUrl: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
    { name: 'CorsProxy', getUrl: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
  ];

  for (const proxy of proxies) {
    try {
      console.log(`Testing ${proxy.name}...`);
      const { data } = await axios.get(proxy.getUrl(url), { timeout: 10000 });
      let html = typeof data === 'string' ? data : data.contents;
      if (!html) throw new Error("No HTML content returned");
      
      const $ = cheerio.load(html);
      const title = $('title').text();
      console.log(`✅ ${proxy.name} SUCCESS! Title: ${title.trim()}`);
      
      const firstRow = $('table tbody tr').first().find('td').first().text();
      console.log(`First ticker found: ${firstRow.trim()}`);
    } catch (e) {
      console.error(`❌ ${proxy.name} FAILED: ${e.message}`);
    }
  }
}

testProxies();
