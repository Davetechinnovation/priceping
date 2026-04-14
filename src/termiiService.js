const https = require('https');

// Use the dashboard-provided base URL (termii.com is the default for Number API)
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || 'termii.com';

class TermiiService {
    constructor() {
        this.apiKey = process.env.Termii_api_key;
        this.senderId = process.env.TERMII_SENDER_ID || 'fastbeep';

        if (!this.apiKey) {
            console.warn('⚠️  Termii: No API key found. SMS alerts will be disabled.');
        } else {
            console.log(`✅ Termii service initialized (SMS API on ${TERMII_BASE_URL}, Sender: ${this.senderId})`);
        }
    }

    get isAvailable() {
        return !!this.apiKey;
    }

    /**
     * Send SMS using Termii Standard SMS API.
     * Endpoint: /api/sms/send
     */
    async sendSMS(to, text, channel = 'generic') {
        if (!this.isAvailable) {
            throw new Error('Termii API key not configured');
        }

        const cleanTo = String(to).replace(/^\+/, '').replace(/\s+/g, '');

        // Standard SMS API payload
        const payload = JSON.stringify({
            api_key: this.apiKey,
            to: cleanTo,
            from: this.senderId,
            sms: text,
            type: 'plain',
            channel: channel,
        });

        return new Promise((resolve, reject) => {
            const options = {
                hostname: TERMII_BASE_URL,
                path: '/api/sms/send',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    try {
                        let parsed = null;
                        try {
                            parsed = JSON.parse(body);
                        } catch (e) {
                            // Body wasn't JSON, which is common for 404s
                        }

                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed || body);
                        } else {
                            // Detailed error logging to help identify why POST is failing
                            console.error(`❌ Termii API Error ${res.statusCode} at ${TERMII_BASE_URL}${options.path}`);
                            console.error(`Response Body: ${body}`);
                            
                            const errorMsg = parsed && parsed.message ? parsed.message : body;
                            reject(new Error(`Termii error ${res.statusCode}: ${errorMsg}`));
                        }
                    } catch (err) {
                        reject(new Error(`Termii request failed: ${err.message}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`HTTPS request error to ${TERMII_BASE_URL}: ${err.message}`));
            });
            req.write(payload);
            req.end();
        });
    }
}

module.exports = TermiiService;
