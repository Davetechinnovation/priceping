const cron = require('node-cron');

class AlertMonitor {
    constructor(database, priceService, whatsappService, termiiService = null) {
        this.database = database;
        this.priceService = priceService;
        this.whatsappService = whatsappService;
        this.termiiService = termiiService;
        this.isChecking = false;
        this.isRunning = false;

        // Metrics for Admin Dashboard
        this.lastCheckDuration = 0; // Total time (Slow: includes API fetch)
        this.dbLatency = 0;         // ✅ NEW: Just DB time (Fast: System Health)
        this.lastCheckTime = null;
        this.lastCheckAlertCount = 0;
        this.lastCheckTriggered = 0;

        if (termiiService?.isAvailable) {
            console.log('📲 Termii multi-channel alerts: ENABLED (SMS + WhatsApp)');
        } else {
            console.log('📲 Termii multi-channel alerts: DISABLED (no API key)');
        }
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
                    if (!recipient) {
                        console.warn(`⚠️ Skipping alert ${alert.id}: No valid phone number found for user ${alert.user_id}`);
                        continue;
                    }

                    console.log(`🚨 Trigger: ${alert.asset} ${alert.direction} ${alert.target_price} for ${recipient}`);

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

    /**
     * Send alert across all available channels:
     *  1. Baileys WhatsApp (existing, with retry)
     *  2. Termii SMS
     *  3. Termii WhatsApp
     * Returns true if at least one channel succeeds.
     */
    async sendWithRetry(recipient, alert, currentPrice, maxRetries) {
        const results = await Promise.allSettled([
            this._sendViaBaileys(recipient, alert, currentPrice, maxRetries),
            this._sendViaTermii(recipient, alert, currentPrice),
        ]);

        const anySuccess = results.some(
            (r) => r.status === 'fulfilled' && r.value === true
        );
        return anySuccess;
    }

    // ── Private: Baileys WhatsApp ──────────────────
    async _sendViaBaileys(recipient, alert, currentPrice, maxRetries) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!this.whatsappService.isConnected) {
                    await this.sleep(2000);
                    continue;
                }

                const message = this.buildAlertMessage(alert, currentPrice);

                let jid;
                // If we have a fully qualified whatsapp_number from the database (e.g. 231...@lid or 234...@s.whatsapp.net), use it EXACTLY.
                if (alert.whatsapp_number && alert.whatsapp_number.includes('@')) {
                    jid = alert.whatsapp_number;
                } else {
                    // Fallback to legacy parsing if only phone number is available
                    let cleanRecipient = String(recipient).replace(/[^0-9+]/g, '');
                    if (cleanRecipient.startsWith('+')) cleanRecipient = cleanRecipient.substring(1);
                    if (cleanRecipient.startsWith('0')) cleanRecipient = '234' + cleanRecipient.substring(1);
                    jid = `${cleanRecipient}@s.whatsapp.net`;
                }

                await this.whatsappService.sock.sendMessage(jid, { text: message });
                console.log(`✅ [Baileys] Message sent to ${jid}`);
                return true;
            } catch (error) {
                console.error(`⚠️ [Baileys] Send failed (attempt ${attempt}):`, error.message);
                if (attempt < maxRetries) await this.sleep(attempt * 1000);
            }
        }
        return false;
    }

    // ── Private: Termii SMS only ──────────────────
    async _sendViaTermii(recipient, alert, currentPrice) {
        // 👑 SMS is a Pro-only perk. Only send if the user has registered their sms_number.
        if (!alert.sms_number) return false;
        if (!this.termiiService?.isAvailable) return false;

        const plainText = this.buildPlainAlertMessage(alert, currentPrice);
        // Use the stored sms_number directly — already normalised to 234... when saved
        const cleanNumber = String(alert.sms_number).replace(/[^0-9]/g, '');

        try {
            await this.termiiService.sendSMS(cleanNumber, plainText, 'generic');
            console.log(`✅ [Termii SMS] Sent to ${cleanNumber}`);
            return true;
        } catch (err) {
            console.error(`⚠️ [Termii SMS] Failed for ${cleanNumber}:`, err.message);
            return false;
        }
    }


    // ── Message builders ──────────────────────────

    // Rich markdown version (for Baileys WhatsApp)
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

    // Plain-text version (for Termii SMS / Termii WhatsApp)
    buildPlainAlertMessage(alert, currentPrice) {
        const asset = alert.asset.toUpperCase();
        const direction = alert.direction;
        const target = alert.target_price;
        const icon = direction === 'above' ? '📈' : '📉';
        const pctDiff = ((currentPrice - target) / target * 100).toFixed(2);

        return `${icon} PricePing Alert: ${asset}
Target hit: ${direction.toUpperCase()} $${target}
Current price: $${currentPrice}
Move: ${pctDiff}%
Alert disabled. Reply START to set a new one.`;
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