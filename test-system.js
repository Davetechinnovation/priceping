const DatabaseManager = require('./src/database');
const PriceService = require('./src/priceService');
const CommandParser = require('./src/commandParser');

async function testCompleteSystem() {
    console.log('🧪 Testing Complete PricePing System...');
    
    try {
        // Initialize components
        const database = new DatabaseManager();
        const priceService = new PriceService();
        const commandParser = new CommandParser();
        
        console.log('✅ Components initialized');
        
        // Test database operations
        console.log('📊 Testing database...');
        const testUser = await database.createUser('234123456789', '234123456789');
        console.log('✅ User created:', testUser);
        
        const testAlert = await database.createAlert(testUser.id, 'BTC', 70000, 'above');
        console.log('✅ Alert created:', testAlert);
        
        // Test price service
        console.log('💰 Testing price service...');
        const btcPrice = await priceService.getPrice('BTC');
        console.log('✅ BTC Price:', priceService.formatPrice(btcPrice, 'BTC'));
        
        // Test command parser
        console.log('🤖 Testing command parser...');
        const helpResponse = await commandParser.handleCommand('help', '234123456789', database, priceService);
        console.log('✅ Help command response length:', helpResponse.length);
        
        const alertResponse = await commandParser.handleCommand('set ETH at 3000', '234123456789', database, priceService);
        console.log('✅ Alert command response:', alertResponse.substring(0, 50) + '...');
        
        console.log('🎉 All system tests passed!');
        console.log('💡 PricePing is ready for deployment');
        
        // Cleanup
        database.close();
        
    } catch (error) {
        console.error('❌ System test failed:', error.message);
    }
}

testCompleteSystem();
