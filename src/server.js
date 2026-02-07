const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const BaileysWhatsAppService = require('./baileysWhatsAppService');
const DatabaseManager = require('./database');
const CommandParser = require('./commandParser');
const AlertMonitor = require('./alertMonitor');
const PriceService = require('./priceService');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const database = new DatabaseManager();
const priceService = new PriceService();
const whatsappService = new BaileysWhatsAppService();
const commandParser = new CommandParser();

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'PricePing WhatsApp Bot API',
        status: 'running',
        endpoints: {
            health: '/health',
            docs: 'WhatsApp Bot - Use WhatsApp to interact'
        }
    });
});

// Initialize WhatsApp and start monitoring
async function initializeServices() {
    try {
        console.log('🚀 Starting PricePing WhatsApp Bot...');
        
        // Initialize database
        database.connect();
        console.log('✅ Database connected');
        
        // Register command handler
        whatsappService.on('message', async (message) => {
            try {
                const phoneNumber = message.key.remoteJid;
                const response = await commandParser.handleCommand(
                    message.message?.conversation || message.message?.extendedTextMessage?.text || '',
                    phoneNumber,
                    database,
                    priceService
                );
                
                if (response) {
                    await whatsappService.sendMessage(phoneNumber, response);
                }
            } catch (error) {
                console.error('Message handling error:', error);
            }
        });
        
        // Initialize WhatsApp
        await whatsappService.initialize();
        console.log('✅ WhatsApp service initialized');
        
        // Start alert monitoring
        const alertMonitor = new AlertMonitor(database, priceService, whatsappService);
        alertMonitor.start();
        console.log('✅ Alert monitoring started');
        
        console.log('🎉 PricePing Bot is fully operational!');
        
    } catch (error) {
        console.error('Failed to initialize services:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 Express server running on port ${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    
    // Initialize WhatsApp services after server starts
    initializeServices();
});

module.exports = app;
