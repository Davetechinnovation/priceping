# 🚀 Deploy PricePing Bot on Render

## ⚠️ **IMPORTANT WARNING**

**Render FREE tier has limitations:**
- **Ephemeral Storage**: Database and WhatsApp session files will be **DELETED** on every deploy/restart
- **Sleeps**: Inactive apps sleep after 15 minutes
- **Limited Resources**: May struggle with WhatsApp WebSocket connections

**For production use, consider Render Pro ($7/mo) or a VPS (DigitalOcean $4/mo)**

---

## 📋 **Prerequisites**

1. ✅ Push code to GitHub repository
2. ✅ Have Render account (https://render.com)
3. ✅ Have WhatsApp Business API (optional, for better reliability)

---

## 🔧 **Step 1: Prepare Environment Variables**

In your GitHub repo, add these environment variables in Render:

### Required Variables:
```
NODE_ENV=production
PORT=10000
```

### Optional Variables:
```
# WhatsApp Business API (if available)
WHATSAPP_BUSINESS_PHONE=2349168071385
WHATSAPP_API_TOKEN=your_api_token
WHATSAPP_WEBHOOK_URL=https://your-app.onrender.com/webhook

# DiaData API (if you have API key)
DIADATA_API_KEY=your_diadata_key
```

---

## 🎯 **Step 2: Deploy to Render**

### Option A: Web Dashboard (Recommended)
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `priceping-whatsapp-bot`
   - **Branch**: `main` or `master`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
5. Click **"Create Web Service"**

### Option B: Render CLI
```bash
# Install Render CLI
npm install -g @render/cli

# Deploy
render create web-service --name priceping-whatsapp-bot --start-command "npm start" --health-check-path "/health"
```

---

## 📁 **Step 3: Persistent Storage (CRITICAL)**

### Problem:
Render's free tier uses **ephemeral storage** - your database and WhatsApp auth will be lost on every restart.

### Solutions:

#### Option 1: External Database (Recommended)
```javascript
// In src/database.js, replace local path with external DB
const { Database } = require('better-sqlite3');
const path = require('path');

// Use external PostgreSQL instead of SQLite
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

#### Option 2: Render Disk Storage (Paid)
1. Upgrade to Render Pro ($7/mo)
2. Add **Disk Storage** from Render Dashboard
3. Mount to `/data` directory

#### Option 3: Cloud Storage
```javascript
// Store session files in cloud
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

// Upload auth files to S3
await s3.upload({
  Bucket: 'your-bot-session-bucket',
  Key: 'auth/session.json',
  Body: JSON.stringify(authData)
}).promise();
```

---

## 🔍 **Step 4: Monitor Deployment**

### Health Check:
```bash
curl https://your-app.onrender.com/health
```

Expected Response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-07T17:00:00.000Z",
  "uptime": 123.456
}
```

### View Logs:
1. Go to Render Dashboard
2. Click on your service
3. Click **"Logs"** tab

---

## 📱 **Step 5: WhatsApp Connection**

### After Deployment:
1. Visit your app logs in Render Dashboard
2. Look for QR code generation
3. Scan QR with WhatsApp to connect
4. Verify bot responds to "Hi" message

### Expected Log Output:
```
🚀 Starting PricePing WhatsApp Bot...
✅ Database connected
📱 QR Code received for WhatsApp connection
✅ WhatsApp connection established
🎉 PricePing Bot is fully operational!
```

---

## 🔄 **Step 6: Updates and Maintenance**

### Automatic Updates:
```bash
# Push to main branch
git add .
git commit -m "Update bot features"
git push origin main

# Render auto-redeploys on push
```

### Manual Restart:
1. Go to Render Dashboard
2. Click your service
3. Click **"Manual Deploy"**

---

## ⚡ **Performance Optimization**

### For Render Free Tier:
```javascript
// In server.js, add connection pooling
const app = express();
app.set('trust proxy', 1); // Trust Render proxy

// Reduce memory usage
process.env.NODE_OPTIONS = '--max-old-space-size=256';
```

### Enable Caching:
```javascript
// Add Redis for session caching (if using Render Pro)
const redis = require('redis');
const client = redis.createClient(process.env.REDIS_URL);
```

---

## 🐛 **Troubleshooting**

### Common Issues:

#### 1. "Database locked" error
```bash
# Solution: Use external database or Render Disk Storage
```

#### 2. WhatsApp connection drops
```bash
# Check logs for WebSocket errors
# Add keep-alive mechanism
setInterval(() => {
  if (!whatsappService.isConnected) {
    whatsappService.initialize();
  }
}, 30000); // Reconnect every 30s
```

#### 3. "Memory exceeded" error
```bash
# Reduce Node.js memory limit
# In package.json:
"scripts": {
  "start": "node --max-old-space-size=256 src/server.js"
}
```

#### 4. Bot responds slowly
```bash
# Check DiaData API rate limits
# Monitor response times in logs
# Consider upgrading to DiaData Pro plan
```

---

## 📊 **Monitoring**

### Add Monitoring (Optional):
```javascript
// In server.js, add metrics
app.get('/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeUsers: database.getActiveUserCount(),
    totalAlerts: database.getTotalAlertCount()
  });
});
```

---

## 🎉 **Success Checklist**

- [ ] Service deploys successfully on Render
- [ ] Health check returns 200 OK
- [ ] WhatsApp connects and shows QR code
- [ ] Bot responds to "Hi" message
- [ ] Alert creation works ("Set BTC at 70000")
- [ ] Price queries work ("Price BTC")
- [ ] Alert monitoring runs every 30 seconds
- [ ] Database persists between restarts

---

## 🆘 **Need Help?**

1. **Render Docs**: https://render.com/docs
2. **WhatsApp API**: https://developers.facebook.com/docs/whatsapp
3. **DiaData API**: https://docs.diadata.org

---

## 🚀 **Production Recommendation**

For serious production use, consider:
- **VPS**: DigitalOcean ($4/mo) or Hetzner ($3/mo)
- **Database**: PostgreSQL or MongoDB
- **Monitoring**: PM2 + Uptime monitoring
- **Domain**: Custom domain with SSL certificate

This gives you full control and better reliability! 🎯
