const axios = require('axios');
async function findPrice() {
  const r = await axios.get('https://www.google.com/finance/quote/ZENITHBANK:NSE', {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  
  const html = r.data;
  console.log('Total size:', html.length);
  
  // Search around "ZENITHBANK" occurrences for nearby numbers
  let idx = 0;
  let found = 0;
  while (found < 5) {
    idx = html.indexOf('ZENITHBANK', idx + 1);
    if (idx === -1) break;
    found++;
    console.log('\n--- Match ' + found + ' at ' + idx + ' ---');
    console.log(html.slice(Math.max(0, idx - 20), idx + 200).replace(/\s+/g, ' '));
  }
  
  // Look for patterns with numbers close to known price range (30-50 NGN for Zenith)
  const patterns = [
    /\"(3[0-9]\.\d+|4[0-9]\.\d+)\"/g,
    /\\\\"(3[0-9]\.\d+|4[0-9]\.\d+)\\\\"/g,
    /(38|39|40|41|42|43)\.\d{2}/g
  ];
  for (const p of patterns) {
    const matches = [...html.matchAll(p)].slice(0, 5);
    if (matches.length) console.log('\nPattern', p.source, ':', matches.map(m => m[0]));
  }
}
findPrice().catch(console.error);
