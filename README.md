# PricePing - WhatsApp Trading Alert Bot

A powerful WhatsApp-based trading alert bot that allows traders to set price alerts for crypto, forex, stocks, and commodities using simple chat commands.

## 🚀 Features

### Core Functionality
- **WhatsApp Bot Interface**: Natural language commands for setting alerts
- **Multi-Asset Support**: Bitcoin, Ethereum, Gold, and 13+ other assets
- **Real-time Monitoring**: 30-second price checking with instant notifications
- **Smart Alerts**: Above/below target price detection
- **SMS Backup**: Optional SMS notifications for critical alerts

### User Experience
- **Simple Commands**: "Set BTC at 95000", "My alerts", "Delete 2"
- **Free Tier**: 3 alerts per day for free users
- **Premium Plan**: Unlimited alerts for ₦2,000/month
- **Interactive Help**: Built-in command assistance

### Admin Dashboard
- **Real-time Statistics**: Active alerts, user counts, alert distribution
- **Alert Management**: View and manage all active alerts
- **Test Functions**: Send test messages, trigger test alerts
- **Price Monitoring**: Real-time price checking for supported assets

## 📋 Supported Assets

### Cryptocurrencies
- Bitcoin (BTC), Ethereum (ETH), Binance Coin (BNB)
- Cardano (ADA), Solana (SOL), Polkadot (DOT)
- Avalanche (AVAX), Polygon (MATIC), Chainlink (LINK)
- Litecoin (LTC), Ripple (XRP), Dogecoin (DOGE), Shiba Inu (SHIB)

### Commodities
- Gold (XAU), Silver (XAG) - Coming soon

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 16+ 
- Twilio Account (for WhatsApp Business API)
- SQLite3 (included)

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
# Twilio WhatsApp
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Database
DB_PATH=./data/priceping.db

# Server
PORT=3000
NODE_ENV=development
```

4. **Start the Server**
```bash
# Development
npm run dev

# Production
npm start
```

5. **Access Points**
- **Admin Dashboard**: http://localhost:3000/admin
- **Health Check**: http://localhost:3000/health
- **WhatsApp Webhook**: http://localhost:3000/webhook/whatsapp

## 📱 User Commands

### Basic Commands
- `Hi` / `Hello` - Get started with welcome message
- `Help` - Show all available commands
- `My alerts` / `alerts` - View your active alerts
- `Status` - Check your account status

### Alert Management
- `Set BTC at 95000` - Set Bitcoin alert at $95,000
- `Set GOLD below 3500` - Set Gold alert below $3,500
- `Set ETH alert at 5000` - Alternative format
- `Delete 2` - Delete alert with ID 2

### Subscription
- `Subscribe` - Get premium plan information

## 💰 Pricing Model

### Free Plan (₦0/month)
- Up to 3 active alerts
- WhatsApp notifications only
- 30-second price updates
- Basic support

### Premium Plan (₦2,000/month)
- Unlimited alerts
- WhatsApp + SMS notifications
- Real-time price updates
- Priority support
- Advanced analytics (coming soon)

## 🔧 Configuration

### Twilio Setup
1. Create a Twilio account
2. Enable WhatsApp Business API
3. Get your Account SID and Auth Token
4. Configure your WhatsApp number

### Database Setup
The bot uses SQLite by default. The database is automatically created on first run.

### Price APIs
- **Binance API**: Primary source for crypto prices
- **CoinGecko API**: Fallback for additional cryptocurrencies
- **Metals.live API**: Real-time gold and silver prices

## 📊 API Endpoints

### Public Endpoints
- `GET /health` - Service health check
- `POST /webhook/whatsapp` - WhatsApp webhook endpoint

### Admin Endpoints
- `GET /admin` - Admin dashboard
- `GET /api/stats` - System statistics
- `GET /api/alerts` - All active alerts
- `POST /api/test-message` - Send test message
- `POST /api/test-alert` - Trigger test alert
- `GET /api/price/:asset` - Get current asset price
- `GET /api/assets` - List supported assets

## 🚀 Deployment

### Local Development
```bash
npm run dev
```

### Production Deployment
```bash
# Using PM2
npm install -g pm2
pm2 start src/server.js --name priceping

# Using Docker (coming soon)
docker build -t priceping .
docker run -p 3000:3000 priceping
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3000
TWILIO_ACCOUNT_SID=prod_sid
TWILIO_AUTH_TOKEN=prod_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
DB_PATH=/app/data/priceping.db
TERMII_API_KEY=your_termii_key  # For SMS backup
```

## 🔔 Monitoring & Maintenance

### Alert Monitoring
- **Frequency**: Every 30 seconds
- **Price History**: Updated every 5 minutes
- **Daily Reset**: Midnight counter reset for free users

### Health Checks
- Database connectivity
- External API status
- WhatsApp service availability

### Logging
- Structured logging with Morgan
- Error tracking and alerting
- Performance monitoring

## 🛡️ Security Features

- **Input Validation**: All user inputs sanitized
- **Rate Limiting**: Prevent abuse of free tier
- **Secure Headers**: Helmet.js protection
- **CORS Configuration**: Proper cross-origin setup

## 📈 Scaling Considerations

### Database Scaling
- SQLite for MVP (up to 10,000 users)
- PostgreSQL for production scaling
- Redis for caching price data

### API Rate Limits
- Binance: 1,200 requests per minute
- CoinGecko: 10-50 requests per minute
- Implement caching to reduce API calls

### WhatsApp Limits
- Twilio message limits
- Optimize message batching
- Implement queue system for high volume

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- **WhatsApp**: +234 XXX XXX XXXX
- **Email**: support@priceping.com
- **Documentation**: [Coming Soon]

## 🗺️ Roadmap

### Phase 2 Features
- [ ] Web dashboard for users
- [ ] Stock market integration
- [ ] Forex pairs support
- [ ] Payment gateway integration
- [ ] Advanced alert types
- [ ] Group alerts functionality
- [ ] Mobile app

### Phase 3 Features
- [ ] AI-powered price predictions
- [ ] Social trading features
- [ ] Portfolio tracking
- [ ] Advanced analytics
- [ ] API for third-party integration

---

**PricePing** - Your Trading Alert Companion 🤖
