// scratch/test-groq.js — verify Groq API key is working
require('dotenv').config({ path: '../.env' });
const axios = require('axios');

axios.post('https://api.groq.com/openai/v1/chat/completions', {
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
  max_tokens: 20
}, {
  headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }
}).then(r => console.log('✅ Groq works:', r.data.choices[0].message.content))
  .catch(e => console.error('❌ Groq error:', e.response?.data || e.message));
