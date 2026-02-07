const DatabaseManager = require('./src/database');
const PriceService = require('./src/priceService');

async function clearAllAlerts() {
    try {
        console.log('🧹 Clearing all alerts from database...');
        const db = new DatabaseManager();
        
        // Get all alerts and delete them
        const alerts = await db.getActiveAlerts();
        console.log(`📋 Found ${alerts.length} alerts to delete`);
        
        for (const alert of alerts) {
            await db.deleteAlert(alert.id, alert.phone_number);
            console.log(`🗑️ Deleted alert ${alert.id}: ${alert.asset} at ${alert.target_price}`);
        }
        
        console.log('✅ All alerts cleared successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing alerts:', error);
        process.exit(1);
    }
}

// Run the cleanup
clearAllAlerts();
