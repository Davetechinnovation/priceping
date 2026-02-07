#!/usr/bin/env node

/**
 * Render Startup Script for PricePing WhatsApp Bot
 * This script handles the specific requirements for Render deployment
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const BaileysWhatsAppService = require('./src/baileysWhatsAppService');
const DatabaseManager = require('./src/database');
const CommandParser = require('./src/commandParser');
const AlertMonitor = require('./src/alertMonitor');
const PriceService = require('./src/priceService');

// Initialize Express app for Render health checks
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (required by Render)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: require('./package.json').version
    });
});

// Status endpoint for monitoring
app.get('/status', (req, res) => {
    res.json({
        service: 'PricePing WhatsApp Bot',
        status: 'running',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: '🤖 PricePing WhatsApp Bot',
        status: 'operational',
        endpoints: {
            health: '/health',
            status: '/status',
            whatsapp: 'Connect via WhatsApp to use bot'
        },
        documentation: 'See DEPLOYMENT.md for setup instructions'
    });
});

// Initialize bot services
let botInitialized = false;

async function initializeBot() {
    if (botInitialized) {
        console.log('🔄 Bot already initialized, skipping...');
        return;
    }

    try {
        console.log('🚀 Initializing PricePing WhatsApp Bot for Render...');
        
        // Initialize database with error handling
        try {
            const database = new DatabaseManager();
            database.connect();
            console.log('✅ Database connected successfully');
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            // Don't exit, Render will restart
            return;
        }
        
        // Initialize services
        const database = new DatabaseManager();
        const priceService = new PriceService();
        const whatsappService = new BaileysWhatsAppService();
        const commandParser = new CommandParser();
        
        // Register message handler
        whatsappService.on('message', async (message) => {
            try {
                const phoneNumber = message.key.remoteJid;
                const messageText = message.message?.conversation || 
                                  message.message?.extendedTextMessage?.text || '';
                
                if (!messageText.trim()) return;
                
                console.log(`📨 Received message from ${phoneNumber}: "${messageText}"`);
                
                const response = await commandParser.handleCommand(
                    messageText,
                    phoneNumber,
                    database,
                    priceService
                );
                
                if (response) {
                    await whatsappService.sendMessage(phoneNumber, response);
                    console.log(`📤 Message sent to ${phoneNumber}: ${response.substring(0, 50)}...`);
                }
            } catch (error) {
                console.error('❌ Message handling error:', error);
            }
        });
        
        // Initialize WhatsApp
        try {
            await whatsappService.initialize();
            console.log('✅ WhatsApp service initialized');
        } catch (error) {
            console.error('❌ WhatsApp initialization failed:', error.message);
            // Don't exit, allow retry
            return;
        }
        
        // Start alert monitoring
        try {
            const alertMonitor = new AlertMonitor(database, priceService, whatsappService);
            alertMonitor.start();
            console.log('✅ Alert monitoring started');
        } catch (error) {
            console.error('❌ Alert monitor failed:', error.message);
        }
        
        botInitialized = true;
        console.log('🎉 PricePing Bot is fully operational on Render!');
        
    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        // Don't exit - Render will restart the service
    }
}

// Handle graceful shutdown
function gracefulShutdown(signal) {
    console.log(`🛑 ${signal} received, shutting down gracefully...`);
    botInitialized = false;
    
    setTimeout(() => {
        process.exit(0);
    }, 5000); // Give 5 seconds for cleanup
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start Express server
app.listen(PORT, () => {
    console.log(`🌐 Express server running on port ${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    
    // Initialize bot services after server starts
    setTimeout(initializeBot, 2000); // Small delay to ensure server is ready
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Don't exit immediately on Render
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
