const Parser = require('rss-parser');

class NewsService {
  constructor() {
    this.parser = new Parser();
    this.cache = new Map();
    this.cacheTTL = 1800000; // 30 mins
  }

  async getLatestHeadlines(assetSymbol, assetType = 'crypto') {
    const cacheKey = assetSymbol.toLowerCase();
    const now = Date.now();
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.ts < this.cacheTTL) {
      return cached.headlines;
    }

    try {
      // Use Google News RSS with proper keyword for asset type
      // Crypto → "BTC crypto", Stocks → "AAPL stock", Commodities → "GOLD commodity"
      const keywords = {
        'crypto': 'crypto',
        'stock': 'stock',
        'forex': 'forex',
        'commodity': 'commodity',
        'futures': 'futures',
      };
      const keyword = keywords[assetType] || assetType;
      const query = encodeURIComponent(`${assetSymbol} ${keyword} when:1d`);
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
      
      const feed = await this.parser.parseURL(url);
      
      if (!feed.items || feed.items.length === 0) {
        return [];
      }

      // Grab the top 3-5 headlines
      const headlines = feed.items.slice(0, 5).map(item => item.title.split(' - ')[0].trim());
      
      this.cache.set(cacheKey, { headlines, ts: now });
      return headlines;
    } catch (error) {
      console.error(`⚠️ [NewsService] Failed to fetch news for ${assetSymbol}:`, error.message);
      // Fallback to stale cache if available
      if (cached) return cached.headlines;
      return [];
    }
  }
}

module.exports = new NewsService();
