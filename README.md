# PricePing - WhatsApp Trading Alert Bot

A powerful WhatsApp-based trading alert bot that allows traders to set price alerts for crypto, forex, stocks, and commodities using simple chat commands. Built with Baileys WhatsApp library and MongoDB for scalable production deployment.

## 🚀 Features

### Core Functionality
- **WhatsApp Bot Interface**: Direct WhatsApp integration using Baileys library
- **Multi-Asset Support**: 500+ cryptocurrencies via DiaData API
- **Real-time Monitoring**: 30-second price checking with instant notifications
- **Smart Retry Logic**: 3-attempt retry with exponential backoff for failed alerts
- **Beautiful Alert Messages**: Formatted notifications with price details and percentage changes

### User Experience
- **Simple Commands**: "Set BTC at 95000", "My alerts", "Delete 2"
- **Free Tier**: 3 alerts per 12 hours for free users
- **Premium Plan**: Unlimited alerts for ₦2,000/month
- **Interactive Help**: Built-in command assistance and upgrade prompts
- **Multi-Chain Support**: Select specific blockchain for crypto assets

### Technical Features
- **MongoDB Database**: Production-ready with proper indexing
- **Memory Monitoring**: Built-in memory usage tracking for Render deployment
- **Session Persistence**: WhatsApp sessions stored in MongoDB
- **Graceful Error Handling**: Errors properly propagated and logged
- **Render Optimized**: Configured for Render.com deployment

## 📋 Supported Assets

### Cryptocurrencies (500+ via DiaData API)
- **Major**: Bitcoin (BTC), Ethereum (ETH), Binance Coin (BNB)
- **DeFi**: Cardano (ADA), Solana (SOL), Polkadot (DOT), Avalanche (AVAX)
- **Layer 2**: Polygon (MATIC), Chainlink (LINK)
- **Payments**: Litecoin (LTC), Ripple (XRP)
- **Meme**: Dogecoin (DOGE), Shiba Inu (SHIB)
- **And 480+ more** with multi-chain support

### Forex & Commodities
- **Forex Pairs**: EUR/USD, GBP/USD, USD/JPY, etc.
- **Commodities**: Gold (XAU), Silver (XAG) - Coming soon

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 16+ 
- MongoDB (local or cloud)
- DiaData API access (free tier available)

### Quick Start

1. **Clone and Install**
```bash
cd priceping
npm install
```

2. **Environment Configuration**
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. **Required Environment Variables**
```env
# MongoDB (Required)
MONGODB_URI=mongodb://localhost:27017/priceping

# Server
PORT=3000
NODE_ENV=development

# WhatsApp (Baileys - Auto-generated)
# No API keys required - uses WhatsApp Web protocol

# Subscription Settings
FREE_ALERTS_PER_12HOURS=3
PREMIUM_ALERTS_PER_12HOURS=999
SUBSCRIPTION_PRICE=2000

# SMS Backup (Optional)
TERMII_API_KEY=your_termii_api_key
```

4. **Start the Server**
```bash
# Development
npm run dev

# Production (Render)
npm start

# Local Development
npm run local
```

5. **Access Points**
- **Health Check**: http://localhost:3000/health
- **Bot Status**: http://localhost:3000/
- **Memory Monitoring**: Built-in console logging

## 📱 User Commands

### Basic Commands
- `Hi` / `Hello` - Get started with welcome message
- `Help` - Show all available commands
- `My alerts` / `alerts` - View your active alerts
- `Status` - Check your account status and limits
- `Subscribe` - Get premium plan information
- `Upgrade` - Get upgrade link with pre-filled message

### Alert Management
- `Set BTC at 95000` - Set Bitcoin alert at $95,000
- `Set GOLD below 3500` - Set Gold alert below $3,500
- `Set ETH alert at 5000` - Alternative format
- `Set BNB BSC at 300` - Set BNB on BSC blockchain at $300
- `Delete 2` - Delete alert with ID 2

### Price Checking
- `Price BTC` - Get current Bitcoin price
- `Price ETH BSC` - Get Ethereum price on BSC
- `Price EUR/USD` - Get forex pair price

## 💰 Pricing Model

### Free Plan (₦0/month)
- Up to 3 active alerts per 12 hours
- WhatsApp notifications only
- 30-second price updates
- Basic support
- Multi-chain access

### Premium Plan (₦2,000/month)
- Unlimited alerts
- WhatsApp + SMS notifications (optional)
- Real-time price updates
- Priority support
- Advanced analytics (coming soon)

### Payment Plans
- **Monthly**: ₦2,000
- **Quarterly**: ₦6,000 (save 20%)
- **Yearly**: ₦20,000 (save 33%)

## 🔧 Configuration

### WhatsApp Setup (Baileys)
- **No API Keys Required**: Uses WhatsApp Web protocol
- **Auto-Pairing**: Generates pairing code automatically
- **Session Persistence**: Sessions stored in MongoDB
- **Reconnection**: Automatic reconnection on disconnect

### Database Setup (MongoDB)
```javascript
// Required indexes automatically created
users: { phone_number: 1 }, { whatsapp_number: 1 }
alerts: { user_id: 1 }, { asset: 1 }, { status: 1 }, { created_at: 1 }
priceHistory: { asset: 1 }, { timestamp: 1 }
whatsapp_sessions: { _id: 1 }
```

### Price APIs
- **DiaData API**: Primary source for 500+ crypto assets
- **FXRatesAPI**: Real-time forex rates
- **Metals.live API**: Gold and silver prices (coming soon)

## 📊 API Endpoints

### Public Endpoints
- `GET /health` - Service health check with memory stats
- `GET /` - Bot status endpoint

### Internal Endpoints
- WhatsApp message handling via Baileys (no webhook needed)
- Alert monitoring via internal cron jobs

## 🚀 Deployment

### Local Development
```bash
npm run dev
```

### Render Deployment (Recommended)
```bash
# Automatic deployment via GitHub
# Uses start-render.js as entry point
# MongoDB Atlas for database
# Built-in memory monitoring
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=10000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/priceping
FREE_ALERTS_PER_12HOURS=3
SUBSCRIPTION_PRICE=2000
TERMII_API_KEY=your_termii_key
```

### Render Configuration
```yaml
services:
  - type: web
    name: priceping-whatsapp-bot
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: node start-render.js
    healthCheckPath: /health
    autoDeploy: false
```

## 🔔 Monitoring & Maintenance

### Alert Monitoring
- **Frequency**: Every 30 seconds
- **Price History**: Updated every 5 minutes
- **12-Hour Reset**: Alert counter reset for free users
- **Retry Logic**: 3 attempts with exponential backoff (2s, 4s, 6s)

### Memory Monitoring (Render Optimized)
- **Warning Threshold**: 450MB
- **Critical Threshold**: 500MB
- **Render Limit**: 512MB
- **Auto-reporting**: Detailed memory usage logs

### Health Checks
- Database connectivity (MongoDB)
- External API status (DiaData)
- WhatsApp service availability (Baileys)
- Memory usage monitoring

### Logging
- Structured logging with timestamps
- Error tracking and alerting
- Performance monitoring
- Memory usage tracking

## 🛡️ Security Features

- **Input Validation**: All user inputs sanitized
- **Rate Limiting**: Alert limits prevent abuse
- **Secure Headers**: Helmet.js protection
- **MongoDB Security**: Connection with authentication
- **Session Encryption**: WhatsApp sessions encrypted in DB

## 📈 Architecture & Scaling

### Current Architecture
- **Baileys WhatsApp**: Direct WhatsApp integration
- **MongoDB**: Scalable document database
- **DiaData API**: 500+ cryptocurrency data
- **Node.js**: Efficient runtime with cron jobs

### Scaling Considerations
- **Database**: MongoDB Atlas for horizontal scaling
- **API Caching**: 1-hour cache for asset lists
- **Connection Pooling**: MongoDB connection pool (max 10)
- **Memory Management**: Built-in monitoring for Render limits

### Performance Optimizations
- **Batch API Calls**: Single call for multiple assets
- **Smart Caching**: Asset list cached for 1 hour
- **Efficient Indexing**: Optimized database queries
- **Memory Monitoring**: Prevents Render crashes

## 🔄 Alert System Flow

1. **User sets alert** → Stored in MongoDB
2. **30-second cron** → Fetches all active alerts
3. **Batch price fetch** → Single API call for all assets
4. **Condition check** → Above/below target comparison
5. **Retry logic** → 3 attempts with backoff
6. **Beautiful notification** → Formatted WhatsApp message
7. **Mark triggered** → Alert removed from active list

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- **WhatsApp Admin**: +234 916 807 1385
- **Upgrade**: Message "Upgrade" to get premium plan
- **Issues**: Check logs for error details

## 🗺️ Roadmap

### Phase 2 Features (Coming Soon)
- [ ] Web dashboard for users
- [ ] Stock market integration
- [ ] Advanced alert types (percentage, trend)
- [ ] Payment gateway integration
- [ ] Group alerts functionality
- [ ] Mobile app

### Phase 3 Features (Future)
- [ ] AI-powered price predictions
- [ ] Social trading features
- [ ] Portfolio tracking
- [ ] Advanced analytics dashboard
- [ ] API for third-party integration

---

**PricePing** - Your Trading Alert Companion 🤖

*Built with ❤️ using Baileys, MongoDB, and Node.js*
