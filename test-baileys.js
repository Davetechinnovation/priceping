const BaileysPricePingServer = require('./src/baileysServer');

console.log('🧪 Testing PricePing with Baileys WhatsApp...');

// Start the server
const server = new BaileysPricePingServer();
server.start();
