# 🧠 Memory Monitoring Guide for PricePing Bot

## 📊 **Why Memory Monitoring is Critical**

**Render Free/Starter Plan Limit: 512MB RAM**
- If your bot exceeds this, it crashes with "Out of Memory" error
- RSS (Resident Set Size) is what Render sees - not heap usage
- Baileys + SQLite + Node.js can easily exceed 512MB under load

## 🎯 **Expected Memory Usage**

### **Normal Operation:**
- **Idle**: 80-150MB RSS
- **Active Users**: 150-300MB RSS  
- **Price Checks**: +20-50MB temporary spikes
- **WhatsApp Sync**: 200-350MB RSS (danger zone!)

### **Warning Zones:**
- ⚠️ **450MB+**: Warning - approaching limit
- 🚨 **480MB+**: Critical - will crash soon
- 💥 **512MB+**: Bot crashes immediately

## 🧪 **Local Testing Before Deploy**

### **1. Basic Memory Test:**
```bash
# Run with garbage collection enabled
node --expose-gc test-memory.js
```

### **2. Real-World Simulation:**
```bash
# Start bot locally
npm run local

# In WhatsApp, send rapid commands:
# Hi, Price BTC, Price ETH, Set BTC at 95000, My alerts, etc.
```

### **3. Monitor Memory:**
Watch console output:
```
✅ Memory: RSS: 125.5MB | Heap: 45.2MB | Peak: 125.5MB ➡️
⚠️ Memory: RSS: 465.2MB | Heap: 180.5MB | Peak: 465.2MB 📈 - WARNING! High memory usage
🚨 Memory: RSS: 495.8MB | Heap: 210.3MB | Peak: 495.8MB 📈 - CRITICAL! Near Render limit
```

## 📈 **Render Deployment Monitoring**

### **1. Memory Endpoints:**
```bash
# Current memory usage
curl https://your-app.onrender.com/memory

# Full status with memory
curl https://your-app.onrender.com/status

# Health check with memory
curl https://your-app.onrender.com/health
```

### **2. Expected JSON Response:**
```json
{
  "current": {
    "rss": 145.5,
    "heapUsed": 65.2,
    "heapTotal": 85.0,
    "external": 12.3,
    "timestamp": "2026-02-07T17:00:00.000Z"
  },
  "stats": {
    "rss": {
      "min": 85.2,
      "max": 145.5,
      "avg": 115.3
    }
  },
  "limits": {
    "warning": 450,
    "critical": 500,
    "render": 512
  }
}
```

## 🔍 **What to Monitor**

### **Key Metrics:**
1. **RSS (Resident Set Size)**: Most important - what Render sees
2. **Peak Memory**: Maximum usage during session
3. **Memory Trend**: Is it growing over time (memory leak)?

### **Warning Signs:**
- RSS consistently > 400MB
- Memory increasing without bound (memory leak)
- Sudden spikes during WhatsApp sync
- Garbage collection not freeing memory

## ⚡ **Optimization Strategies**

### **1. Reduce WhatsApp Sync Load:**
```javascript
// In baileysWhatsAppService.js
this.sock = makeWASocket({
    // ... other options
    syncFullHistory: false, // Don't sync all chat history
    markOnlineOnConnect: false, // Reduce memory usage
});
```

### **2. Database Optimization:**
```javascript
// In database.js
// Use WAL mode for better performance
this.db.pragma('journal_mode = WAL');
this.db.pragma('synchronous = NORMAL');
```

### **3. Memory Cleanup:**
```javascript
// Force garbage collection periodically
setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🗑️ Forced garbage collection');
    }
}, 60000); // Every minute
```

### **4. Alert Monitoring Optimization:**
```javascript
// In alertMonitor.js
// Process alerts in smaller batches
const batchSize = 10;
for (let i = 0; i < alerts.length; i += batchSize) {
    const batch = alerts.slice(i, i + batchSize);
    await processBatch(batch);
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
}
```

## 🚨 **Troubleshooting High Memory**

### **Problem: Memory Keeps Growing**
**Cause**: Memory leak in Baileys or database connections
**Solution**: 
- Restart bot periodically (Render auto-restarts on crashes)
- Check for unclosed database connections
- Monitor Baileys event listeners

### **Problem: WhatsApp Sync Uses Too Much Memory**
**Cause**: Large chat history being synced
**Solution**:
- Use `syncFullHistory: false`
- Clear WhatsApp chat history
- Use fresh WhatsApp number for bot

### **Problem: Price Checks Cause Memory Spikes**
**Cause**: Too many concurrent API calls
**Solution**:
- Sequential API calls (already implemented)
- Add delays between price fetches
- Cache price data

## 📊 **Render-Specific Considerations**

### **1. Ephemeral Storage:**
- Database files deleted on restart
- WhatsApp auth files deleted on restart
- **Solution**: Use Render Disk or external database

### **2. Sleep Mode:**
- App sleeps after 15 minutes inactivity
- Memory resets when waking up
- **Solution**: Use Render Pro or keep-alive ping

### **3. Resource Limits:**
- 512MB RAM limit
- CPU throttling under load
- **Solution**: Monitor and optimize

## 🎯 **Production Recommendations**

### **For Stable Operation:**
1. **Upgrade to Render Pro** ($7/mo):
   - 1GB RAM limit
   - No sleep mode
   - Persistent storage

2. **Or Use VPS** (Better option):
   - DigitalOcean: $4/mo, 1GB RAM
   - Hetzner: $3/mo, 2GB RAM
   - Full control over resources

3. **Add External Monitoring**:
   - UptimeRobot (free)
   - Better Uptime ($5/mo)
   - Custom health checks

### **Memory Thresholds for Production:**
- **Safe**: < 400MB RSS
- **Warning**: 400-450MB RSS  
- **Critical**: > 450MB RSS
- **Action Required**: > 480MB RSS

## 📋 **Testing Checklist**

Before deploying to Render:

- [ ] Run `node --expose-gc test-memory.js`
- [ ] Verify RSS stays < 400MB during stress test
- [ ] Test with 10+ rapid WhatsApp commands
- [ ] Monitor memory during WhatsApp sync
- [ ] Check for memory leaks (growing over time)
- [ ] Verify garbage collection works

## 🆘 **Emergency Actions**

### **If Bot Crashes on Render:**
1. Check logs: "Out of Memory" error
2. Reduce memory usage (see optimization strategies)
3. Upgrade to plan with more RAM
4. Add external database to reduce memory load

### **If Memory Leaks Detected:**
1. Restart bot frequently
2. Monitor memory growth rate
3. Identify and fix leak source
4. Consider memory leak detection tools

---

**Remember**: RSS < 400MB = Safe for Render Starter Plan
**RSS > 450MB = Upgrade needed** 🚀
