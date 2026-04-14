const axios = require('axios');

async function testITick() {
  const token = '4e6f333e9e3d4a8397a5bbe6c131203679c2528cb2cd46d5b7959c5465e4ddd1';
  const symbols = ['DANGCEM', 'ZENITHBANK', 'MTNN'];
  
  for (const sym of symbols) {
    try {
      console.log(`\n🔍 Checking iTick for: ${sym}`);
      const res = await axios.get(`https://api.itick.org/stock/quote?region=NG&code=${sym}`, {
        headers: {
          'accept': 'application/json',
          'token': token
        }
      });
      console.log(res.data);
    } catch (e) {
      console.error(`- Error for ${sym}:`, e.message);
    }
  }
}

testITick();
