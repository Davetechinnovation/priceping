const cron = require('node-cron');

class AlertMonitor {
    constructor(database, priceService, whatsappService) {
        this.database = database;
        this.priceService = priceService;
        this.whatsappService = whatsappService;
        this.isChecking = false;
        this.isRunning = false;
        
        // Metrics for Admin Dashboard
        this.lastCheckDuration = 0; // Total time (Slow: includes API fetch)
        this.dbLatency = 0;         // ✅ NEW: Just DB time (Fast: System Health)
        this.lastCheckTime = null;
        this.lastCheckAlertCount = 0;
        this.lastCheckTriggered = 0;
    }

    start() {
        if (this.isRunning) {
            console.log('Alert monitor is already running');
            return;
        }

        console.log('🚀 Starting PricePing Alert Monitor...');
        this.isRunning = true;

        // Check alerts every 30 seconds
        cron.schedule('*/30 * * * * *', async () => {
            await this.checkAlerts();
        });

        // Update price history every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            await this.updatePriceHistory();
        });

        console.log('✅ Alert monitor started successfully');
    }

    async checkAlerts() {
        if (this.isChecking) return;
        this.isChecking = true;
        
        const checkStart = Date.now();
        
        try {
            // ⏱️ STEP 1: Measure Database Speed ONLY (This is your "Latency")
            const dbStart = Date.now();
            const activeAlerts = await this.database.getActiveAlerts();
            this.dbLatency = Date.now() - dbStart; // Should be < 50ms

            if (activeAlerts.length === 0) return;

            // ⏱️ STEP 2: The rest involves external APIs (This is "Duration")
            const uniqueAssets = [...new Set(activeAlerts.map(a => a.asset.toUpperCase()))];
            
            // This line takes 500ms - 2000ms (Internet speed)
            const allPrices = await this.priceService.getMultiplePrices(uniqueAssets);
            
            let alertsTriggered = 0;

            for (const alert of activeAlerts) {
                const currentPrice = allPrices[alert.asset.toUpperCase()];
                
                if (currentPrice === null || currentPrice === undefined) continue;

                let shouldTrigger = false;
                if (alert.direction === 'above' && currentPrice >= alert.target_price) shouldTrigger = true;
                else if (alert.direction === 'below' && currentPrice <= alert.target_price) shouldTrigger = true;

                if (shouldTrigger) {
                    const recipient = alert.phone_number || alert.whatsapp_number;
                    if (!recipient) continue;

                    console.log(`🚨 Trigger: ${alert.asset} ${alert.direction} ${alert.target_price}`);
                    
                    // Send message (Async to not block the loop too much)
                    const sent = await this.sendWithRetry(recipient, alert, currentPrice, 3);
                    
                    if (sent) {
                        await this.database.markAlertTriggered(alert.id);
                        alertsTriggered++;
                    }
                }
            }
            
            this.lastCheckAlertCount = activeAlerts.length;
            this.lastCheckTriggered = alertsTriggered;
            
        } catch (error) {
            console.error('❌ Error checking alerts:', error.message);
        } finally {
            this.isChecking = false;
            // Total time including external APIs (for debug, not health)
            this.lastCheckDuration = Date.now() - checkStart;
            this.lastCheckTime = new Date();
        }
    }

    // ============================================
    // 📨 SENDING LOGIC
    // ============================================
    async sendWithRetry(recipient, alert, currentPrice, maxRetries) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!this.whatsappService.isConnected) {
                    await this.sleep(2000);
                    continue;
                }

                const message = this.buildAlertMessage(alert, currentPrice);
                const jid = recipient.includes("@") ? recipient : `${recipient}@s.whatsapp.net`;
                
                // Using the raw socket for speed
                await this.whatsappService.sock.sendMessage(jid, { text: message });
                return true; 
                
            } catch (error) {
                console.error(`⚠️ Send failed (attempt ${attempt}):`, error.message);
                if (attempt < maxRetries) await this.sleep(attempt * 1000);
            }
        }
        return false;
    }

    buildAlertMessage(alert, currentPrice) {
        const asset = alert.asset.toUpperCase();
        const direction = alert.direction;
        const target = alert.target_price;
        const icon = direction === 'above' ? '📈' : '📉';
        const color = direction === 'above' ? '🟢' : '🔴';
        const pctDiff = ((currentPrice - target) / target * 100).toFixed(2);
        
        return `${color} *PRICE ALERT: ${asset}*
        
${icon} Target Hit: *${direction.toUpperCase()} $${target}*
💰 Current Price: *$${currentPrice}*
📊 Move: ${pctDiff}%

_Alert disabled. Reply to set new one._`;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async updatePriceHistory() {
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            const assets = [...new Set(activeAlerts.map(a => a.asset.toUpperCase()))];
            if (assets.length === 0) return;
            
            const prices = await this.priceService.getMultiplePrices(assets);
            for (const [asset, price] of Object.entries(prices)) {
                if (price) await this.database.recordPrice(asset, price);
            }
        } catch (error) {
            console.error('Price history update failed:', error.message);
        }
    }

    stop() {
        this.isRunning = false;
    }
}

module.exports = AlertMonitor;