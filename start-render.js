#!/usr/bin/env node

/**
 * Render Startup Script for PricePing WhatsApp Bot
 * This script handles specific requirements for Render deployment
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BaileysWhatsAppService = require('./src/baileysWhatsAppService');
const MongoDBManager = require('./src/mongoDBManager');
const CommandParser = require('./src/commandParser');
const AlertMonitor = require('./src/alertMonitor');
const PriceService = require('./src/priceService');
const MemoryMonitor = require('./src/memoryMonitor');

// Initialize Express app for Render health checks
const app = express();
const PORT = process.env.PORT || 10000;

// Initialize memory monitor
const memoryMonitor = new MemoryMonitor({
    interval: 30000, // 30 seconds
    warningThreshold: 450, // MB
    criticalThreshold: 500, // MB
    renderLimit: 512 // MB
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (required by Render)
app.get('/health', (req, res) => {
    const memory = memoryMonitor.getStats();
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: memory.current,
        version: require('./package.json').version
    });
});

// Memory stats endpoint for monitoring
app.get('/memory', (req, res) => {
    const stats = memoryMonitor.getStats();
    res.json(stats);
});

// Status endpoint for monitoring
app.get('/status', (req, res) => {
    const memory = memoryMonitor.getStats();
    res.json({
        service: 'PricePing WhatsApp Bot',
        status: 'running',
        uptime: process.uptime(),
        memory: memory.current,
        memoryStats: memory.stats,
        nodeVersion: process.version,
        platform: process.platform,
        renderLimit: memory.limits.render
    });
});

// Root endpoint
app.get('/', (req, res) => {
    const memory = memoryMonitor.getStats();
    res.json({
        message: '🤖 PricePing WhatsApp Bot',
        status: 'operational',
        memory: {
            current: memory.current.rss,
            peak: memory.stats.rss.max,
            limit: memory.limits.render,
            status: memory.current.rss > memory.limits.critical ? '🚨 CRITICAL' : 
                     memory.current.rss > memory.limits.warning ? '⚠️ WARNING' : '✅ OK'
        },
        endpoints: {
            health: '/health',
            memory: '/memory',
            status: '/status',
            whatsapp: 'Connect via WhatsApp to use bot'
        },
        documentation: 'See DEPLOYMENT.md for setup instructions'
    });
});

// Initialize bot services
let botInitialized = false;

// 🧠 STATE MEMORY (The "Press 1" Logic)
// Stores: { "phone_number": { type: "SELECT_CHAIN_PRICE", data: [...] } }
const userState = new Map();

async function initializeBot() {
    if (botInitialized) {
        console.log('🔄 Bot already initialized, skipping...');
        return;
    }

    try {
        console.log('🚀 Initializing PricePing WhatsApp Bot for Render...');
        
        // Clear WhatsApp sessions only if CLEAR_AUTH env var is set
        // This avoids having to re-link every time during development
        if (process.env.CLEAR_AUTH === 'true') {
            console.log('🗑️ CLEAR_AUTH detected, removing old auth files...');
            const authFiles = [
                './data/auth/creds.json',
                './data/auth_info_baileys.json',
                './data/auth_info_baileys_creds.json'
            ];
            
            authFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    console.log(`🗑️ Removing old auth file: ${file}`);
                    fs.unlinkSync(file);
                }
            });
        } else {
            console.log('🔐 Keeping existing auth session (set CLEAR_AUTH=true to clear)');
        }
        
        // Start memory monitoring immediately
        memoryMonitor.start();
        
        // Initialize database with error handling
        let database;
        try {
            database = new MongoDBManager();
            await database.connect();
            console.log('✅ MongoDB connected successfully');
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error.message);
            // Don't exit, Render will restart
            return;
        }
        
        // Initialize services
        const priceService = new PriceService();
        
        // ============================================================
        // 🔥 WARM UP CACHE (Add this block)
        // This downloads the lists immediately so first user request is fast
        console.log('🔥 Warming up Crypto and Forex caches...');
        try {
            await Promise.all([
                priceService.loadAssetList(), // 🟢 FIX: Changed name to match PriceService.js
                priceService.getForexCurrencies()
            ]);
            console.log('✅ Caches warmed up successfully');
        } catch (e) {
            console.log('⚠️ Cache warmup warning:', e.message);
        }
        // ============================================================

        const whatsappService = new BaileysWhatsAppService();
        const commandParser = new CommandParser();
        
        // Pass Express app to WhatsApp service for QR endpoint
        whatsappService.setExpressApp(app);
        
        // Register message handler
        whatsappService.registerMessageHandler('commandParser', async (messageText, phoneNumber, pushName) => {
            try {
                console.log(`📨 Processing message from ${phoneNumber} (${pushName}): "${messageText}"`);
                
                // 1️⃣ CHECK IF USER IS IN A MENU STATE (Replying 1, 2, etc.)
                const cleanPhone = phoneNumber.replace(/\D/g, "");
                if (userState.has(cleanPhone)) {
                    const state = userState.get(cleanPhone);
                    const selection = parseInt(messageText.trim());

                    if (!isNaN(selection) && selection > 0 && selection <= state.options.length) {
                        // User picked a valid number
                        const selectedOption = state.options[selection - 1]; // 0-indexed
                        
                        // CLEAR STATE
                        userState.delete(cleanPhone);

                        // ROUTE BASED ON STATE TYPE
                        if (state.type === 'SELECT_CHAIN_PRICE') {
                            // User selected a chain to VIEW PRICE
                            const cmd = `Price ${state.symbol} ${selectedOption.blockchain}`;
                            const response = await commandParser.handleCommand(
                                cmd, phoneNumber, database, priceService, pushName, userState
                            );
                            if (response) {
                                console.log(`📤 Response to ${phoneNumber}: ${response.substring(0, 50)}...`);
                                return response;
                            }
                        } 
                        
                        else if (state.type === 'SELECT_CHAIN_ALERT') {
                            // User selected a chain to SET ALERT
                            // We reconstruct the command: "Set [Symbol] [Chain] at [Price]"
                            const cmd = `Set ${state.symbol} ${selectedOption.blockchain} at ${state.targetPrice} ${state.direction || 'at'}`;
                            const response = await commandParser.handleCommand(
                                cmd, phoneNumber, database, priceService, pushName, userState
                            );
                            if (response) {
                                console.log(`📤 Response to ${phoneNumber}: ${response.substring(0, 50)}...`);
                                return response;
                            }
                        }
                    } else if (state) {
                        // User typed text instead of a number, cancel the menu and proceed as normal command
                        userState.delete(cleanPhone);
                    }
                }

                // 2️⃣ NORMAL COMMAND PROCESSING
                // Note: We pass 'userState' so Parser can SET a state if needed
                const response = await commandParser.handleCommand(
                    messageText,
                    phoneNumber,
                    database,
                    priceService,
                    pushName,
                    userState // 🟢 CRITICAL: Pass userState to parser!
                );
                
                if (response) {
                    console.log(`📤 Response to ${phoneNumber}: ${response.substring(0, 50)}...`);
                    return response;
                }
                return null;
            } catch (error) {
                console.error('❌ Message handling error:', error);
                return null;
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
        // Don't exit - Render will restart service
    }
}

// Handle graceful shutdown
function gracefulShutdown(signal) {
    console.log(`🛑 ${signal} received, shutting down gracefully...`);
    
    // Stop memory monitoring
    memoryMonitor.stop();
    
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
    console.log(`🧠 Memory stats: http://localhost:${PORT}/memory`);
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
