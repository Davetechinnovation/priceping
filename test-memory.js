#!/usr/bin/env node

/**
 * Memory Stress Test for PricePing Bot
 * Simulates heavy load to test memory usage before deploying to Render
 */

const MemoryMonitor = require('./src/memoryMonitor');
const DatabaseManager = require('./src/database');
const PriceService = require('./src/priceService');
const CommandParser = require('./src/commandParser');

// Initialize memory monitor with tighter thresholds for testing
const memoryMonitor = new MemoryMonitor({
    interval: 5000, // 5 seconds for more frequent updates
    warningThreshold: 400, // MB
    criticalThreshold: 480, // MB
    renderLimit: 512 // MB
});

async function stressTest() {
    console.log('🧪 Starting Memory Stress Test for PricePing Bot');
    console.log('This simulates heavy usage to test memory limits');
    console.log('Watch the memory usage to see if it stays under 512MB\n');

    // Start memory monitoring
    memoryMonitor.start();

    // Initialize services
    const database = new DatabaseManager(); // Constructor handles connection
    const priceService = new PriceService();
    const commandParser = new CommandParser();
    
    console.log('✅ Database initialized');

    const testPhoneNumber = '1234567890@s.whatsapp.net';
    const testCommands = [
        'Hi',
        'Price BTC',
        'Price ETH', 
        'Price SOL',
        'Price ADA',
        'Set BTC at 95000',
        'Set ETH at 3000',
        'Set SOL at 200',
        'My alerts',
        'Status',
        'Help'
    ];

    console.log('\n🔄 Starting stress test cycles...');
    console.log('Each cycle runs all commands to simulate heavy usage\n');

    let cycle = 1;
    const maxCycles = 10;

    const stressInterval = setInterval(async () => {
        console.log(`\n📊 Cycle ${cycle}/${maxCycles}`);
        
        for (const command of testCommands) {
            try {
                console.log(`⚡ Testing: "${command}"`);
                
                const response = await commandParser.handleCommand(
                    command,
                    testPhoneNumber,
                    database,
                    priceService
                );
                
                if (response) {
                    console.log(`   ✅ Response: ${response.substring(0, 50)}...`);
                }
                
                // Small delay between commands
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`   ❌ Error with "${command}":`, error.message);
            }
        }

        // Check current memory after each cycle
        const currentMemory = memoryMonitor.getStats();
        console.log(`   🧠 Memory after cycle: ${currentMemory.current.rss}MB (Peak: ${currentMemory.stats.rss.max}MB)`);

        if (currentMemory.current.rss > 480) {
            console.log('🚨 CRITICAL: Memory approaching Render limit!');
        }

        cycle++;

        if (cycle > maxCycles) {
            clearInterval(stressInterval);
            console.log('\n🏁 Stress test completed!');
            
            // Generate final report
            setTimeout(() => {
                memoryMonitor.stop();
                process.exit(0);
            }, 2000);
        }
    }, 3000); // Run cycle every 3 seconds

    // Handle cleanup
    process.on('SIGINT', () => {
        console.log('\n🛑 Stress test interrupted by user');
        memoryMonitor.stop();
        process.exit(0);
    });
}

// Enable garbage collection for testing
if (global.gc) {
    console.log('🗑️ Garbage collection enabled');
} else {
    console.log('⚠️ Run with --expose-gc for better memory testing: node --expose-gc test-memory.js');
}

// Start stress test
stressTest().catch(error => {
    console.error('❌ Stress test failed:', error);
    memoryMonitor.stop();
    process.exit(1);
});
