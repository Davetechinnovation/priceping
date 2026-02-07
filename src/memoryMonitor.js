/**
 * Memory Monitor for PricePing Bot
 * Tracks RSS (Resident Set Size) and Heap usage
 * Critical for Render.com deployment (512MB limit)
 */

class MemoryMonitor {
    constructor(options = {}) {
        this.interval = options.interval || 30000; // 30 seconds default
        this.warningThreshold = options.warningThreshold || 450; // MB
        this.criticalThreshold = options.criticalThreshold || 500; // MB
        this.renderLimit = options.renderLimit || 512; // MB
        this.monitoring = false;
        this.intervalId = null;
        this.maxMemory = 0;
        this.memoryHistory = [];
        this.maxHistoryLength = options.maxHistoryLength || 100;
    }

    formatBytes(bytes) {
        return Math.round(bytes / 1024 / 1024 * 100) / 100;
    }

    getMemoryUsage() {
        const used = process.memoryUsage();
        return {
            rss: this.formatBytes(used.rss), // Resident Set Size (what Render sees)
            heapTotal: this.formatBytes(used.heapTotal),
            heapUsed: this.formatBytes(used.heapUsed),
            external: this.formatBytes(used.external),
            arrayBuffers: this.formatBytes(used.arrayBuffers || 0),
            timestamp: new Date().toISOString()
        };
    }

    logMemoryUsage() {
        const usage = this.getMemoryUsage();
        
        // Track maximum memory usage
        this.maxMemory = Math.max(this.maxMemory, usage.rss);
        
        // Add to history
        this.memoryHistory.push(usage);
        if (this.memoryHistory.length > this.maxHistoryLength) {
            this.memoryHistory.shift();
        }

        // Calculate trend (last 5 readings)
        const recent = this.memoryHistory.slice(-5);
        const avgRecent = recent.reduce((sum, h) => sum + h.rss, 0) / recent.length;
        const trend = recent.length >= 2 ? 
            (recent[recent.length - 1].rss - recent[0].rss > 0 ? '📈' : '📉') : '➡️';

        // Color-coded status
        let status = '✅';
        let warning = '';
        
        if (usage.rss > this.criticalThreshold) {
            status = '🚨';
            warning = ` - CRITICAL! Near Render limit (${this.renderLimit}MB)`;
        } else if (usage.rss > this.warningThreshold) {
            status = '⚠️';
            warning = ` - WARNING! High memory usage`;
        }

        console.log(`${status} Memory: RSS: ${usage.rss}MB | Heap: ${usage.heapUsed}MB | Peak: ${this.maxMemory}MB ${trend}${warning}`);
        
        // Detailed breakdown for debugging
        if (process.env.NODE_ENV === 'development' || usage.rss > this.warningThreshold) {
            console.log(`   📊 Details: HeapTotal: ${usage.heapTotal}MB | External: ${usage.external}MB | ArrayBuffers: ${usage.arrayBuffers}MB`);
        }

        // Force garbage collection if memory is high
        if (usage.rss > this.criticalThreshold && global.gc) {
            console.log('🗑️ Forcing garbage collection...');
            global.gc();
            
            // Check again after GC
            setTimeout(() => {
                const afterGC = this.getMemoryUsage();
                console.log(`   🧹 After GC: RSS: ${afterGC.rss}MB | Heap: ${afterGC.heapUsed}MB`);
            }, 1000);
        }

        return usage;
    }

    start() {
        if (this.monitoring) {
            console.log('⚠️ Memory monitor already running');
            return;
        }

        console.log(`🧠 Starting memory monitor (interval: ${this.interval/1000}s, warning: ${this.warningThreshold}MB, critical: ${this.criticalThreshold}MB)`);
        this.monitoring = true;
        
        // Initial reading
        console.log('📊 Initial memory usage:');
        this.logMemoryUsage();
        
        // Start monitoring
        this.intervalId = setInterval(() => {
            this.logMemoryUsage();
        }, this.interval);
    }

    stop() {
        if (!this.monitoring) {
            return;
        }

        console.log('🛑 Stopping memory monitor...');
        this.monitoring = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        // Final report
        this.generateReport();
    }

    generateReport() {
        if (this.memoryHistory.length === 0) {
            console.log('📊 No memory data to report');
            return;
        }

        const rssValues = this.memoryHistory.map(h => h.rss);
        const heapValues = this.memoryHistory.map(h => h.heapUsed);
        
        const stats = {
            rss: {
                min: Math.min(...rssValues),
                max: Math.max(...rssValues),
                avg: rssValues.reduce((a, b) => a + b, 0) / rssValues.length,
                current: rssValues[rssValues.length - 1]
            },
            heap: {
                min: Math.min(...heapValues),
                max: Math.max(...heapValues),
                avg: heapValues.reduce((a, b) => a + b, 0) / heapValues.length,
                current: heapValues[heapValues.length - 1]
            }
        };

        console.log('\n📊 Memory Usage Report:');
        console.log(`   RSS: Min: ${stats.rss.min}MB | Max: ${stats.rss.max}MB | Avg: ${stats.rss.avg.toFixed(2)}MB | Current: ${stats.rss.current}MB`);
        console.log(`   Heap: Min: ${stats.heap.min}MB | Max: ${stats.heap.max}MB | Avg: ${stats.heap.avg.toFixed(2)}MB | Current: ${stats.heap.current}MB`);
        console.log(`   Render Limit: ${this.renderLimit}MB | Safety Margin: ${(this.renderLimit - stats.rss.max).toFixed(2)}MB`);
        
        if (stats.rss.max > this.renderLimit) {
            console.log('🚨 CRITICAL: Memory exceeded Render limit! Bot will crash!');
        } else if (stats.rss.max > this.warningThreshold) {
            console.log('⚠️ WARNING: High memory usage detected');
        } else {
            console.log('✅ Memory usage within safe limits');
        }
    }

    // Get current memory stats as JSON (for API endpoints)
    getStats() {
        const current = this.getMemoryUsage();
        const rssValues = this.memoryHistory.map(h => h.rss);
        const heapValues = this.memoryHistory.map(h => h.heapUsed);
        
        return {
            current,
            history: this.memoryHistory,
            stats: {
                rss: {
                    min: rssValues.length > 0 ? Math.min(...rssValues) : 0,
                    max: rssValues.length > 0 ? Math.max(...rssValues) : 0,
                    avg: rssValues.length > 0 ? rssValues.reduce((a, b) => a + b, 0) / rssValues.length : 0
                },
                heap: {
                    min: heapValues.length > 0 ? Math.min(...heapValues) : 0,
                    max: heapValues.length > 0 ? Math.max(...heapValues) : 0,
                    avg: heapValues.length > 0 ? heapValues.reduce((a, b) => a + b, 0) / heapValues.length : 0
                }
            },
            limits: {
                warning: this.warningThreshold,
                critical: this.criticalThreshold,
                render: this.renderLimit
            },
            uptime: process.uptime()
        };
    }
}

module.exports = MemoryMonitor;
