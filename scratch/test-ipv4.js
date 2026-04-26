const axios = require('axios');
const http = require('http');
const https = require('https');

async function testIPv4() {
  const url = 'https://afx.kwayisi.org/ngx/';
  
  const httpClient = axios.create({
    httpAgent: new http.Agent({ family: 4 }),
    httpsAgent: new https.Agent({ family: 4 })
  });

  try {
    console.log(`Testing Kwayisi with IPv4 forced...`);
    const { data } = await httpClient.get(url, { 
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });
    console.log(`✅ SUCCESS! Got ${data.length} bytes`);
  } catch (e) {
    console.error(`❌ FAILED: ${e.message}`);
  }
}

testIPv4();
