const cron = require('node-cron');

class AlertMonitor {
    constructor(database, priceService, whatsappService) {
        this.database = database;
        this.priceService = priceService;
        this.whatsappService = whatsappService;
        this.isChecking = false;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('Alert monitor is already running');
            return;
        }

        console.log('Starting PricePing Alert Monitor...');
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
        console.log('📊 Checking alerts every 30 seconds');
        console.log('📈 Updating price history every 5 minutes');
    }

    async checkAlerts() {
        if (this.isChecking) return;
        this.isChecking = true;
        
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            if (activeAlerts.length === 0) return;

            console.log(`🔍 Checking ${activeAlerts.length} active alerts...`);

            const uniqueAssets = [...new Set(activeAlerts.map(a => a.asset.toUpperCase()))];
            console.log(`📊 Fetching prices for ${uniqueAssets.length} unique assets: ${uniqueAssets.join(', ')}`);
            
            const allPrices = await this.priceService.getMultiplePrices(uniqueAssets);
            
            let alertsTriggered = 0;
            let alertsFailed = 0;

            for (const alert of activeAlerts) {
                const currentPrice = allPrices[alert.asset.toUpperCase()];
                
                if (currentPrice === null || currentPrice === undefined) {
                    continue;
                }

                let shouldTrigger = false;
                if (alert.direction === 'above' && currentPrice >= alert.target_price) {
                    shouldTrigger = true;
                } else if (alert.direction === 'below' && currentPrice <= alert.target_price) {
                    shouldTrigger = true;
                }

                if (shouldTrigger) {
                    const recipient = alert.phone_number || alert.whatsapp_number;
                    
                    if (!recipient) {
                        console.error(`❌ Alert ${alert.id} has no contact info, skipping`);
                        continue;
                    }

                    console.log(`🚨 Alert triggered: ${alert.asset} ${alert.direction} ${alert.target_price} (Current: ${currentPrice})`);
                    console.log(`📤 Sending notification to: ${recipient}`);

                    // ============================================
                    // 🛠️ FIX: Use sendAlertNotification with retry
                    // ============================================
                    const sent = await this.sendWithRetry(recipient, alert, currentPrice, 3);
                    
                    if (sent) {
                        await this.database.markAlertTriggered(alert.id);
                        alertsTriggered++;
                        console.log(`✅ Alert sent to ${recipient} successfully`);
                    } else {
                        alertsFailed++;
                        console.error(`❌ FAILED to send alert to ${recipient} after 3 retries. Will try next cycle.`);
                        // Do NOT mark as triggered - it will retry next cycle
                    }
                }
            }
            
            if (alertsTriggered > 0) {
                console.log(`✅ ${alertsTriggered} alerts sent successfully`);
            }
            if (alertsFailed > 0) {
                console.log(`⚠️ ${alertsFailed} alerts failed to send (will retry)`);
            }
            
        } catch (error) {
            console.error('❌ Error checking alerts:', error);
        } finally {
            this.isChecking = false;
        }
    }

    // ============================================
    // 🔄 RETRY LOGIC: Try sending up to maxRetries
    // ============================================
    async sendWithRetry(recipient, alert, currentPrice, maxRetries) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Check if WhatsApp is connected
                if (!this.whatsappService.isConnected) {
                    console.log(`⏳ WhatsApp not connected, waiting... (attempt ${attempt}/${maxRetries})`);
                    await this.sleep(3000);
                    continue;
                }

                // Build beautiful alert message
                const message = this.buildAlertMessage(alert, currentPrice);
                
                // Send directly using sock (bypass the silent error catch)
                const jid = recipient.includes("@") ? recipient : `${recipient}@s.whatsapp.net`;
                await this.whatsappService.sock.sendMessage(jid, { text: message });
                
                console.log(`📨 Alert delivered to ${recipient} (attempt ${attempt})`);
                return true; // SUCCESS
                
            } catch (error) {
                console.error(`❌ Send attempt ${attempt}/${maxRetries} failed:`, error.message);
                
                if (attempt < maxRetries) {
                    console.log(`⏳ Retrying in ${attempt * 2} seconds...`);
                    await this.sleep(attempt * 2000); // Wait longer each retry
                }
            }
        }
        
        return false; // All retries failed
    }

    // ============================================
    // 🎨 BEAUTIFUL ALERT MESSAGE
    // ============================================
    buildAlertMessage(alert, currentPrice) {
        const asset = alert.asset.toUpperCase();
        const direction = alert.direction;
        const target = alert.target_price;
        
        // Choose icon based on direction
        const dirIcon = direction === 'above' ? '📈' : '📉';
        const alertIcon = direction === 'above' ? '🟢' : '🔴';
        
        // Format prices
        const formattedTarget = this.formatAlertPrice(target);
        const formattedCurrent = this.formatAlertPrice(currentPrice);
        
        // Calculate percentage difference
        const pctDiff = ((currentPrice - target) / target * 100).toFixed(2);
        const pctSign = pctDiff >= 0 ? '+' : '';

        return `╔══════════════════════════╗
║  🚨 *PRICE ALERT TRIGGERED!* 🚨
╚══════════════════════════╝

${alertIcon} *${asset}* hit your target!

━━━━━━━━━━━━━━━━━
🎯 *Your Target:* ${formattedTarget}
💰 *Current Price:* ${formattedCurrent}
${dirIcon} *Direction:* Price went *${direction.toUpperCase()}*
📊 *Difference:* ${pctSign}${pctDiff}%
⏰ *Time:* ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━

✅ _This alert has been completed._
💡 _Set a new one: "Set ${asset} at ${formattedTarget}"_`;
    }

    // Simple price formatter for alerts
    formatAlertPrice(price) {
        if (!price) return "N/A";
        if (price < 0.01) return `$${price.toFixed(8)}`;
        if (price < 1) return `$${price.toFixed(6)}`;
        if (price > 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return `$${price.toFixed(4)}`;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async updatePriceHistory() {
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            const assetsWithAlerts = [...new Set(activeAlerts.map(a => a.asset.toUpperCase()))];
            
            if (assetsWithAlerts.length === 0) return;
            
            console.log(`📊 Updating price history for ${assetsWithAlerts.length} assets`);
            
            const prices = await this.priceService.getMultiplePrices(assetsWithAlerts);
            
            for (const [asset, price] of Object.entries(prices)) {
                if (price !== null && price !== undefined) {
                    await this.database.recordPrice(asset, price);
                }
            }
            
            console.log(`📊 Price history updated for ${assetsWithAlerts.length} assets`);
        } catch (error) {
            console.error('❌ Error updating price history:', error);
        }
    }

    stop() {
        if (!this.isRunning) return;
        console.log('⏹️ Alert monitor stopped');
        this.isRunning = false;
    }
}

module.exports = AlertMonitor;
