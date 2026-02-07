# 🚀 Render Deployment Checklist

## ✅ **Pre-Deployment**

- [ ] Code pushed to GitHub repository
- [ ] All files committed to main/master branch
- [ ] Environment variables documented in DEPLOYMENT.md
- [ ] Database persistence strategy chosen (see ⚠️ WARNING below)

## ⚠️ **CRITICAL WARNING - READ FIRST!**

### Render Free Tier Limitations:
1. **Ephemeral Storage**: Database & WhatsApp auth files **DELETED** on every restart
2. **Sleep Mode**: App sleeps after 15 minutes of inactivity
3. **Resource Limits**: May struggle with WhatsApp WebSocket connections

### Solutions:
- **Option A**: Upgrade to Render Pro ($7/mo) for persistent storage
- **Option B**: Use external database (PostgreSQL/MongoDB)
- **Option C**: Use a VPS instead (DigitalOcean $4/mo)

## 📋 **Deployment Steps**

### 1. Render Setup
- [ ] Login to [Render Dashboard](https://dashboard.render.com)
- [ ] Click "New +" → "Web Service"
- [ ] Connect GitHub repository
- [ ] Select correct branch (main/master)

### 2. Configuration
- [ ] Name: `priceping-whatsapp-bot`
- [ ] Runtime: `Node`
- [ ] Build Command: `npm install`
- [ ] Start Command: `npm start`
- [ ] Health Check Path: `/health`
- [ ] Plan: Free (or Pro for production)

### 3. Environment Variables
Add these in Render Dashboard → Environment:

```
NODE_ENV=production
PORT=10000
```

Optional:
```
# For external database (recommended)
DATABASE_URL=postgresql://user:pass@host:port/dbname

# For WhatsApp Business API
WHATSAPP_BUSINESS_PHONE=2349168071385
WHATSAPP_API_TOKEN=your_token
```

### 4. Deploy
- [ ] Click "Create Web Service"
- [ ] Wait for build to complete
- [ ] Check deployment logs

## 🔍 **Post-Deployment Verification**

### Health Check
```bash
curl https://your-app.onrender.com/health
```
Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-07T17:00:00.000Z",
  "uptime": 123.456,
  "memory": {...},
  "version": "1.0.0"
}
```

### WhatsApp Connection
- [ ] Check Render logs for QR code
- [ ] Scan QR with WhatsApp
- [ ] Send "Hi" to test bot
- [ ] Verify welcome message appears

### Bot Functions Test
- [ ] Test price query: "Price BTC"
- [ ] Test alert creation: "Set BTC at 70000"
- [ ] Test alert view: "My alerts"
- [ ] Test alert deletion: "Delete 1"

## 🐛 **Common Issues & Solutions**

### Issue: "Database locked" error
**Cause**: SQLite file conflicts on Render restart
**Solution**: Use external PostgreSQL database

### Issue: WhatsApp connection drops frequently
**Cause**: Render free tier sleep mode
**Solution**: Upgrade to Render Pro or use VPS

### Issue: "Memory exceeded" error
**Cause**: Node.js memory limit
**Solution**: Add to start command:
```bash
node --max-old-space-size=256 start-render.js
```

### Issue: Bot responds slowly
**Cause**: DiaData API rate limits
**Solution**: Monitor API response times in logs

## 📊 **Monitoring**

### Check Logs Regularly
1. Go to Render Dashboard
2. Click your service
3. Click "Logs" tab
4. Look for:
   - ✅ "Database connected successfully"
   - ✅ "WhatsApp connection established"
   - ✅ "Alert monitoring started"
   - ❌ Any error messages

### Key Metrics to Monitor
- Uptime (should be > 95%)
- Memory usage (should be < 512MB)
- Response time (should be < 2 seconds)
- Error rate (should be < 1%)

## 🔄 **Updates**

### Automatic Updates
```bash
git add .
git commit -m "Update: fix bug or add feature"
git push origin main
# Render auto-redeploys
```

### Manual Restart
1. Go to Render Dashboard
2. Click service
3. Click "Manual Deploy"

## 🎯 **Production Recommendations**

### For Serious Production Use:

1. **Upgrade to Render Pro** ($7/mo)
   - Persistent storage
   - No sleep mode
   - Better performance

2. **Or Use VPS** (Recommended)
   - DigitalOcean: $4/mo
   - Hetzner: $3/mo
   - Vultr: $3.5/mo

3. **Add External Database**
   - PostgreSQL (Render provides free tier)
   - MongoDB Atlas (free tier available)
   - Redis for caching

4. **Add Monitoring**
   - UptimeRobot (free)
   - Better Uptime (paid)
   - Custom health checks

## 📞 **Support Resources**

- **Render Docs**: https://render.com/docs
- **WhatsApp API**: https://developers.facebook.com/docs/whatsapp
- **DiaData API**: https://docs.diadata.org
- **Node.js Best Practices**: https://nodejs.org/en/docs/

---

## 🎉 **Success!**

When all checklist items are complete, your bot is:
- ✅ Deployed on Render
- ✅ Accessible via HTTPS endpoint
- ✅ Responding to WhatsApp messages
- ✅ Monitoring prices and sending alerts
- ✅ Ready for production use!

**Your WhatsApp Price Alert Bot is LIVE! 🚀**
