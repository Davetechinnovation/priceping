require('dotenv').config();
const BaileysWhatsAppService = require('./baileysWhatsAppService');
const DatabaseManager = require('./database');
const PriceService = require('./priceService');
const CommandParser = require('./commandParser');
const AlertMonitor = require('./alertMonitor');

class BaileysPricePingServer {
    constructor() {
        this.whatsappService = new BaileysWhatsAppService();
        this.database = new DatabaseManager();
        this.priceService = new PriceService();
        this.commandParser = new CommandParser();
        this.alertMonitor = new AlertMonitor();
    }

    async start() {
        console.log('🚀 Starting PricePing with Baileys WhatsApp Integration...');
        
        try {
            // Initialize WhatsApp service
            await this.whatsappService.initialize();
            
            // Register command handler
            this.whatsappService.registerMessageHandler('commandParser', async (message, jid, pushName) => {
                console.log(`🔍 Server Debug: message="${message}", jid="${jid}", pushName="${pushName}"`);
                return await this.commandParser.handleCommand(
                    message, 
                    jid, 
                    this.database, 
                    this.priceService,
                    pushName
                );
            });

            // Start alert monitor
            this.alertMonitor.database = this.database;
            this.alertMonitor.priceService = this.priceService;
            this.alertMonitor.whatsappService = this.whatsappService;
            this.alertMonitor.start();

            // Show connection status
            this.showConnectionStatus();
            
            console.log('✅ PricePing Baileys server started successfully!');
            console.log('📱 Scan QR code with WhatsApp to connect');
            
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }

    showConnectionStatus() {
        const status = this.whatsappService.getConnectionStatus();
        
        console.log('\n📊 Connection Status:');
        console.log('==================');
        console.log(`Connected: ${status.isConnected ? '✅ Yes' : '❌ No'}`);
        console.log(`QR Code: ${status.hasQRCode ? '✅ Generated' : '❌ None'}`);
        
        if (status.hasQRCode) {
            console.log(`\n📱 QR Code File: ${status.qrCodePath}`);
            console.log('🌐 Open this file in your browser and scan with WhatsApp');
            console.log('💡 Or use a QR code scanner app to scan the terminal output');
        }
        console.log('==================\n');
    }

    // Graceful shutdown
    async shutdown() {
        console.log('\n🛑 Shutting down PricePing...');
        
        try {
            await this.whatsappService.disconnect();
            this.alertMonitor.stop();
            this.database.close();
            console.log('✅ Shutdown complete');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
        
        process.exit(0);
    }
}

// Handle process signals
const server = new BaileysPricePingServer();

process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

// Start the server
if (require.main === module) {
    server.start();
}

module.exports = BaileysPricePingServer;
