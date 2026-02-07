const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

class BaileysWhatsAppService {
    constructor() {
        this.sock = null;
        this.qrCode = null;
        this.isConnected = false;
        this.messageHandlers = new Map();
        this.logger = pino({ level: 'info' });
    }

    async initialize() {
        try {
            // Load auth state
            const { state, saveCreds } = await this.useMultiFileAuthState();
            
            // Create WhatsApp socket
            this.sock = makeWASocket({
                printQRInTerminal: false,
                auth: state,
                logger: this.logger,
                browser: ['PricePing-Bot', 'Chrome', '4.0.0'],
                markOnlineOnConnect: true
            });

            // Save credentials whenever updated
            this.sock.ev.on('creds.update', saveCreds);

            // Handle connection updates
            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;
                console.log('🔄 Connection update received:', { connection, hasQR: !!qr });
                
                if (qr) {
                    this.qrCode = qr;
                    console.log('📱 QR Code received for WhatsApp connection');
                    console.log('🔍 QR Code data length:', qr.length);
                    this.generateQRCodeFile(qr);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    console.log('🔌 Connection closed, reconnecting:', shouldReconnect);
                    this.isConnected = false;
                    
                    if (shouldReconnect) {
                        this.initialize();
                    }
                } else if (connection === 'open') {
                    console.log('✅ WhatsApp connection established');
                    this.isConnected = true;
                    this.qrCode = null;
                }
            });

            // Handle incoming messages
            this.sock.ev.on('messages.upsert', async (m) => {
                const message = m.messages[0];
                if (!message.message) return;

                // Only process messages from users (not groups or broadcasts)
                if (message.key.remoteJid.endsWith('@g.us') || message.key.remoteJid.endsWith('@broadcast')) {
                    return;
                }

                await this.handleMessage(message);
            });

            // Start the connection (no explicit connect() call needed)
            console.log('🔄 Initializing WhatsApp connection...');
            
        } catch (error) {
            console.error('❌ Error initializing WhatsApp:', error);
            throw error;
        }
    }

    async useMultiFileAuthState() {
        const authFolder = path.join(__dirname, '..', 'data', 'auth');
        
        // Create auth folder if it doesn't exist
        if (!fs.existsSync(authFolder)) {
            fs.mkdirSync(authFolder, { recursive: true });
        }

        return useMultiFileAuthState(authFolder);
    }

    async generateQRCodeFile(qr) {
        try {
            console.log('🔍 Starting QR code generation...');
            const qrCodeData = await qrcode.toString(qr, { type: 'svg', margin: 1 });
            const qrFilePath = path.join(process.cwd(), 'data', 'qr-code.svg');
            
            console.log('💾 Writing QR code to file:', qrFilePath);
            fs.writeFileSync(qrFilePath, qrCodeData);
            console.log(`📱 QR Code saved to: ${qrFilePath}`);
            console.log('🌐 Open this file in a browser and scan with WhatsApp');
            
            return qrFilePath;
        } catch (error) {
            console.error('❌ Error generating QR code:', error);
            console.error('❌ Full error details:', error.stack);
        }
    }

    async handleMessage(message) {
        try {
            const remoteJid = message.key.remoteJid;
            
            // Extract text from different message types
            let messageText = '';
            
            if (message.message.conversation) {
                messageText = message.message.conversation;
            } else if (message.message.extendedTextMessage) {
                messageText = message.message.extendedTextMessage.text;
            } else if (message.message.imageMessage) {
                messageText = message.message.imageMessage.caption || '';
            } else if (message.message.videoMessage) {
                messageText = message.message.videoMessage.caption || '';
            } else if (message.message.documentMessage) {
                messageText = message.message.documentMessage.caption || '';
            }

            if (!messageText || !messageText.trim()) {
                console.log('📨 Empty or non-text message, ignoring');
                return;
            }

            console.log(`📨 Received message from ${remoteJid}: "${messageText}"`);

            // Process message through all registered handlers
            for (const [handlerName, handler] of this.messageHandlers) {
                try {
                    const response = await handler(messageText, remoteJid);
                    if (response && response.trim()) {
                        await this.sendMessage(remoteJid, response);
                        return; // Stop after first handler responds
                    }
                } catch (error) {
                    console.error(`❌ Error in handler ${handlerName}:`, error);
                }
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
        }
    }

    async sendMessage(to, message) {
        try {
            if (!this.isConnected) {
                throw new Error('WhatsApp not connected - message cannot be sent');
            }

            const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
            
            await this.sock.sendMessage(jid, { 
                text: message 
            });

            console.log(`📤 Message sent to ${to}: ${message.substring(0, 50)}...`);
            return true;
        } catch (error) {
            console.error('❌ Error sending message:', error);
            throw error; // Propagate error so AlertMonitor knows it failed
        }
    }

    async sendAlert(to, alert, currentPrice, priceService) {
        const asset = alert.asset.toUpperCase();
        const targetPrice = alert.target_price;
        const direction = alert.direction;
        
        const formattedCurrentPrice = priceService.formatPrice(currentPrice, asset);
        const formattedTargetPrice = priceService.formatPrice(targetPrice, asset);
        
        const directionEmoji = direction === 'above' ? '📈' : '📉';
        const hitEmoji = direction === 'above' ? 
            (currentPrice >= targetPrice ? '🎯' : '⏳') : 
            (currentPrice <= targetPrice ? '🎯' : '⏳');

        const message = `🚨 *PRICE ALERT TRIGGERED!* 🚨

${directionEmoji} *${asset}* Alert Hit!

🎯 *Target*: ${formattedTargetPrice}
📊 *Current*: ${formattedCurrentPrice}
📈 *Direction*: ${direction === 'above' ? 'Above' : 'Below'} target
⏰ *Time*: ${new Date().toLocaleString()}

📈 *Quick Actions*:
• Set new alert: "Set ${asset} at [new_price]"
• View all alerts: "My alerts"
• Delete this alert: "Delete ${alert.id}"

💡 *Tip*: Price alerts help you catch important market movements!

---
*PricePing - Your Trading Alert Companion* 🤖`;

        return await this.sendMessage(to, message);
    }

    async sendPriceUpdate(to, asset, price, priceService) {
        const formattedPrice = priceService.formatPrice(price, asset);
        
        const message = `📊 *Price Update*

💰 ${asset}: ${formattedPrice}
⏰ ${new Date().toLocaleString()}

🎯 *Set Alert*: "Set ${asset} at [your_price]"

---
*PricePing - Your Trading Alert Companion* 🤖`;

        return await this.sendMessage(to, message);
    }

    // Register message handler (for command parser)
    registerMessageHandler(name, handler) {
        this.messageHandlers.set(name, handler);
        console.log(`📝 Registered message handler: ${name}`);
    }

    // Get connection status
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            hasQRCode: !!this.qrCode,
            qrCodePath: this.qrCode ? path.join(__dirname, '..', 'data', 'qr-code.svg') : null
        };
    }

    // Disconnect from WhatsApp
    async disconnect() {
        try {
            if (this.sock) {
                await this.sock.logout();
                console.log('🔌 Disconnected from WhatsApp');
            }
        } catch (error) {
            console.error('❌ Error disconnecting:', error);
        }
    }

    // Get phone number from JID
    extractPhoneNumber(jid) {
        return jid.replace('@s.whatsapp.net', '').replace('@whatsapp.net', '');
    }
}

module.exports = BaileysWhatsAppService;
