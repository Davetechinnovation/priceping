const cron = require('node-cron');

class AlertMonitor {
    constructor(database, priceService, whatsappService) {
        this.database = database;
        this.priceService = priceService;
        this.whatsappService = whatsappService;
        this.isChecking = false; // Prevent overlapping checks
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('Alert monitor is already running');
            return;
        }

        console.log('Starting PricePing Alert Monitor...');
        this.isRunning = true;

        // Run every 30 seconds during market hours
        cron.schedule('*/30 * * * * *', async () => {
            await this.checkAlerts();
        });

        // Run every 5 minutes for non-critical updates
        cron.schedule('*/5 * * * *', async () => {
            await this.updatePriceHistory();
        });

        // Reset daily alert counters at midnight
        cron.schedule('0 0 * * *', async () => {
            await this.resetDailyCounters();
        });

        console.log('✅ Alert monitor started successfully');
        console.log('📊 Checking alerts every 30 seconds');
        console.log('📈 Updating price history every 5 minutes');
    }

    async checkAlerts() {
        if (this.isChecking) {
            console.log('⚠️ Previous check still running, skipping...');
            return;
        }
        
        this.isChecking = true;
        
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            
            if (activeAlerts.length === 0) {
                return;
            }

            console.log(`🔍 Checking ${activeAlerts.length} active alerts...`);

            // Get ALL unique assets in ONE API call
            const uniqueAssets = [...new Set(activeAlerts.map(alert => alert.asset.toUpperCase()))];
            console.log(`📊 Fetching prices for ${uniqueAssets.length} unique assets: ${uniqueAssets.join(', ')}`);
            
            // Single batch API call for all assets
            const allPrices = await this.priceService.getMultiplePrices(uniqueAssets);
            
            // Check each alert with pre-fetched prices
            let alertsTriggered = 0;
            for (const alert of activeAlerts) {
                const currentPrice = allPrices[alert.asset.toUpperCase()];
                
                if (currentPrice === null || currentPrice === undefined) {
                    console.warn(`⚠️ Could not get price for ${alert.asset}, skipping alert`);
                    continue;
                }

                let shouldTrigger = false;
                if (alert.direction === 'above' && currentPrice >= alert.target_price) {
                    shouldTrigger = true;
                } else if (alert.direction === 'below' && currentPrice <= alert.target_price) {
                    shouldTrigger = true;
                }

                if (shouldTrigger) {
                    console.log(`🚨 Alert triggered: ${alert.asset} ${alert.direction} ${alert.target_price} (Current: ${currentPrice})`);
                    
                    // Check if we have valid contact info
                    if (!alert.phone_number && !alert.whatsapp_number) {
                        console.error(`❌ Alert ${alert.id} has no contact information, skipping...`);
                        continue;
                    }
                    
                    try {
                        // Send notification
                        await this.whatsappService.sendAlert(alert.phone_number || alert.whatsapp_number, alert, currentPrice, this.priceService);
                        
                        // ONLY mark triggered if the line above didn't throw an error
                        await this.database.markAlertTriggered(alert.id);
                        alertsTriggered++;
                    } catch (sendError) {
                        console.error(`Failed to send alert to ${alert.phone_number || alert.whatsapp_number}, will retry next cycle:`, sendError.message);
                    }
                }
            }
            
            if (alertsTriggered > 0) {
                console.log(`✅ ${alertsTriggered} alerts triggered and sent successfully`);
            }
            
        } catch (error) {
            console.error('❌ Error checking alerts:', error);
        } finally {
            this.isChecking = false; // Always release lock
        }
    }

    async updatePriceHistory() {
        try {
            // Get only assets that have active alerts to minimize API calls
            const activeAlerts = await this.database.getActiveAlerts();
            const assetsWithAlerts = [...new Set(activeAlerts.map(alert => alert.asset.toUpperCase()))];
            
            if (assetsWithAlerts.length === 0) {
                console.log('📊 No active alerts, skipping price history update');
                return;
            }
            
            console.log(`📊 Updating price history for ${assetsWithAlerts.length} assets with active alerts`);
            
            // Single batch API call only for assets with active alerts
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

    async resetDailyCounters() {
        try {
            // This would reset daily alert counters for free users
            console.log('🔄 Resetting daily alert counters...');
            // Implementation would depend on your specific requirements
        } catch (error) {
            console.error('❌ Error resetting daily counters:', error);
        }
    }

    // Manual trigger for testing
    async testAlert(alertId) {
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            const alert = activeAlerts.find(a => a.id === alertId);
            
            if (!alert) {
                throw new Error(`Alert ${alertId} not found`);
            }

            const currentPrice = await this.priceService.getPrice(alert.asset);
            
            // Check if alert should trigger
            let shouldTrigger = false;
            if (alert.direction === 'above' && currentPrice >= alert.target_price) {
                shouldTrigger = true;
            } else if (alert.direction === 'below' && currentPrice <= alert.target_price) {
                shouldTrigger = true;
            }

            if (shouldTrigger) {
                try {
                    // Send notification
                    await this.whatsappService.sendAlert(alert.phone_number, alert, currentPrice, this.priceService);
                    
                    // ONLY mark triggered if the line above didn't throw an error
                    await this.database.markAlertTriggered(alert.id);
                    
                    console.log(`✅ Test alert ${alertId} sent to ${alert.phone_number}`);
                } catch (sendError) {
                    console.error(`Failed to send test alert to ${alert.phone_number}:`, sendError.message);
                }
            } else {
                console.log(`🧪 Test alert ${alertId} conditions not met (Current: ${currentPrice}, Target: ${alert.target_price}, Direction: ${alert.direction})`);
            }
            
            console.log(`🧪 Test alert ${alertId} processed`);
        } catch (error) {
            console.error(`❌ Error testing alert ${alertId}:`, error);
            throw error;
        }
    }

    // Get system statistics
    async getStats() {
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            const stats = {
                totalActiveAlerts: activeAlerts.length,
                alertsByAsset: {},
                alertsByDirection: { above: 0, below: 0 }
            };

            activeAlerts.forEach(alert => {
                stats.alertsByAsset[alert.asset] = (stats.alertsByAsset[alert.asset] || 0) + 1;
                stats.alertsByDirection[alert.direction]++;
            });

            return stats;
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            return null;
        }
    }

    stop() {
        if (!this.isRunning) {
            console.log('Alert monitor is not running');
            return;
        }

        console.log('Stopping PricePing Alert Monitor...');
        this.isRunning = false;
        
        // In a real implementation, you'd want to properly stop the cron jobs
        console.log('⏹️ Alert monitor stopped');
    }
}

module.exports = AlertMonitor;
