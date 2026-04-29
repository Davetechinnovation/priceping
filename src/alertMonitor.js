const cron = require('node-cron');

class AlertMonitor {
    constructor(database, priceService, whatsappService, termiiService = null, userState = null) {
        this.database = database;
        this.priceService = priceService;
        this.whatsappService = whatsappService;
        this.termiiService = termiiService;
        this.userState = userState;
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

        // ── Crypto + Forex: Every 30 seconds (24/7, fast APIs) ────────────
        cron.schedule('*/30 * * * * *', async () => {
            await this.checkAlerts();
        });

        // ── NGX Stocks: Every 5 minutes during market hours ───────────────
        // NGX prices only update ~every few minutes anyway (not tick-by-tick)
        // Mon-Fri, 09:30-14:30 WAT
        cron.schedule('*/5 * * * 1-5', async () => {
            const markets = this.getActiveMarkets();
            if (markets.ngx) {
                console.log('🇳🇬 NGX market check...');
                await this.fetchNGXAndCheckAlerts();
            }
        });

        // ── US Stocks: Every 2 minutes during market hours ────────────────
        // Yahoo Finance has rate limits — 2min is safe
        // Mon-Fri only
        cron.schedule('*/2 * * * 1-5', async () => {
            const markets = this.getActiveMarkets();
            if (markets.us_stock) {
                // Stock alerts are handled in the main checkAlerts loop
                // This just warms the cache proactively
                await this.warmStockCache();
            }
        });

        // ── Price history: Every 5 minutes ────────────────────────────────
        cron.schedule('*/5 * * * *', async () => {
            await this.updatePriceHistory();
        });

        console.log('✅ Alert monitor started');
        console.log('   📡 Crypto/Forex: every 30s');
        console.log('   🇳🇬 NGX Stocks: every 5min (market hours only)');
        console.log('   📈 US Stocks: every 2min (market hours only)');
    }

    async checkAlerts() {
        if (this.isChecking) return;
        this.isChecking = true;

        const checkStart = Date.now();

        try {
            // ⏱️ Measure DB latency separately
            const dbStart = Date.now();
            const activeAlerts = await this.database.getActiveAlerts();
            this.dbLatency = Date.now() - dbStart;

            if (activeAlerts.length === 0) return;

            // ── Which markets are open right now? ──────────────────────────
            const activeMarkets = this.getActiveMarkets();

            // ── Group alerts by asset type ─────────────────────────────────
            // Only fetch prices for markets that are currently open
            const assetsToCheck = new Set();
            const skippedAssets = new Set();

            for (const alert of activeAlerts) {
                const sym = alert.asset.toUpperCase();
                const classification = this.priceService.classifier.classify(sym);
                
                if (this.shouldCheckAsset(classification.type, activeMarkets)) {
                    assetsToCheck.add(sym);
                } else {
                    skippedAssets.add(sym);
                }
            }

            if (skippedAssets.size > 0) {
                // Only log this occasionally to avoid log spam
                if (Math.random() < 0.1) { // Log ~10% of the time
                    console.log(`💤 Market closed — skipping: ${[...skippedAssets].join(', ')}`);
                }
            }

            if (assetsToCheck.size === 0) return;

            // ── Fetch prices for open markets only ────────────────────────
            const allPrices = await this.priceService.getMultiplePrices([...assetsToCheck]);

            let alertsTriggered = 0;

            for (const alert of activeAlerts) {
                const sym = alert.asset.toUpperCase();
                
                // Skip assets whose markets are closed
                if (!assetsToCheck.has(sym)) continue;

                const currentPrice = allPrices[sym];
                if (currentPrice === null || currentPrice === undefined) continue;

                let shouldTrigger = false;
                if (alert.direction === 'above' && currentPrice >= alert.target_price) {
                    shouldTrigger = true;
                } else if (alert.direction === 'below' && currentPrice <= alert.target_price) {
                    shouldTrigger = true;
                }

                if (!shouldTrigger) continue;

                const recipient = alert.phone_number || alert.whatsapp_number;
                if (!recipient) {
                    console.warn(`⚠️ Skipping alert ${alert.id}: No phone number`);
                    continue;
                }

                console.log(`🚨 Trigger: ${alert.asset} ${alert.direction} ${alert.target_price} for ${recipient}`);

                const sent = await this.sendWithRetry(recipient, alert, currentPrice, 3);

                if (sent) {
                    await this.database.markAlertTriggered(alert.id);
                    alertsTriggered++;

                    // Clean up any pending SMS prompt state for this user
                    if (this.userState?.has(recipient)) {
                        const state = this.userState.get(recipient);
                        if (
                            state.type === 'CONFIRM_SMS_NUMBER' ||
                            state.type === 'AWAITING_SMS_NUMBER'
                        ) {
                            console.log(`🔓 [Cleanup] Lifting SMS prompt for ${recipient}`);
                            this.userState.delete(recipient);
                        }
                    }
                }
            }

            this.lastCheckAlertCount = activeAlerts.length;
            this.lastCheckTriggered = alertsTriggered;

        } catch (error) {
            console.error('❌ Error checking alerts:', error.message);
        } finally {
            this.isChecking = false;
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

        const fTarget = this.priceService.formatPrice(target, asset);
        const fPrice = this.priceService.formatPrice(currentPrice, asset);

        return `${color} *PRICE ALERT: ${asset}*
        
${icon} Target Hit: *${direction.toUpperCase()} ${fTarget}*
💰 Current Price: *${fPrice}*
📊 Move: ${pctDiff}%

_Alert disabled. Reply to set new one._`;
    }

    // Plain-text version (for Termii SMS / Termii WhatsApp)
    buildPlainAlertMessage(alert, currentPrice) {
        const asset = alert.asset.toUpperCase();
        const direction = alert.direction;
        const target = alert.target_price;
        const icon = direction === 'above' ? '▲' : '▼';
        
        const fTarget = this.priceService.formatPrice(target, asset);
        const fPrice = this.priceService.formatPrice(currentPrice, asset);
        const pctDiff = ((currentPrice - target) / target * 100).toFixed(2);

        // Build a dynamic link to the bot
        let botNumber = (process.env.WHATSAPP_PHONE_NUMBER || '2348103393608').replace(/[^0-9]/g, '');
        if (this.whatsappService?.myJid) {
            botNumber = this.whatsappService.myJid.split('@')[0].split(':')[0];
        }
        const botLink = `wa.me/${botNumber}?text=START`;

        return `[PricePing Alert] ${icon} ${asset}
--------------------
Target: ${direction.toUpperCase()} ${fTarget}
Current: ${fPrice}
Move: ${pctDiff}%
--------------------
Set new alerts here:
https://${botLink}`;
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

    // ============================================
    // 🕐 MARKET HOURS AWARENESS
    // Avoids pointless API calls when markets are closed
    // ============================================

    getActiveMarkets() {
        // Returns which markets are currently open
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMin = now.getUTCMinutes();
        const utcDay = now.getUTCDay(); // 0=Sun, 1=Mon...6=Sat
        const utcTime = utcHour * 60 + utcMin; // Minutes since midnight UTC

        const markets = {
            crypto: true, // 24/7, always monitor
            forex: true, // 24/5 (closed Sat-Sun), but we still check
        };

        // 🇳🇬 NGX: Mon-Fri, 09:30-14:30 WAT = 08:30-13:30 UTC
        const isWeekday = utcDay >= 1 && utcDay <= 5;
        markets.ngx = isWeekday && utcTime >= 510 && utcTime <= 810; // 8:30-13:30 UTC

        // 📈 US Markets: Mon-Fri, 09:30-16:00 EST = 14:30-21:00 UTC
        // Extended hours: 04:00-20:00 EST = 09:00-01:00 UTC next day
        markets.us_stock =
            isWeekday &&
            ((utcTime >= 870 && utcTime <= 1260) || // Regular: 14:30-21:00 UTC
                (utcTime >= 540 && utcTime < 870)); // Pre-market: 09:00-14:30 UTC

        return markets;
    }

    shouldCheckAsset(assetType, markets) {
        switch (assetType) {
            case "CRYPTO":
                return markets.crypto; // Always
            case "FOREX":
                return markets.forex; // Always (with caching)
            case "COMMODITY":
                return markets.crypto; // Treat like 24/7
            case "NGX_STOCK":
                return markets.ngx; // Only during NGX hours
            case "US_STOCK":
            case "STOCK":
                return markets.us_stock; // Only during US hours
            default:
                return true; // Check unknown types anyway
        }
    }

    // Proactively refresh NGX cache and check NGX-specific alerts
    async fetchNGXAndCheckAlerts() {
        try {
            // This refreshes the 5-minute NGX cache
            await this.priceService.fetchNGXMarket(this.priceService.db);
            // The next checkAlerts() call will pick up fresh NGX prices from cache
        } catch (e) {
            console.error("NGX refresh failed:", e.message);
        }
    }

    // Warm Yahoo Finance cache for stocks that have active alerts
    async warmStockCache() {
        try {
            const activeAlerts = await this.database.getActiveAlerts();
            const stockAlerts = activeAlerts.filter((a) => {
                const cls = this.priceService.classifier.classify(
                    a.asset.toUpperCase(),
                );
                return cls.type === "US_STOCK" || cls.type === "STOCK";
            });

            if (stockAlerts.length === 0) return;

            const symbols = [
                ...new Set(stockAlerts.map((a) => a.asset.toUpperCase())),
            ];
            // Warm the cache silently
            await this.priceService.getMultiplePrices(symbols);
        } catch (e) {
            // Silent fail — this is just cache warming
        }
    }

    stop() {
        this.isRunning = false;
    }
}

module.exports = AlertMonitor;