const axios = require('axios');

class FearGreedService {
  constructor() {
    this.apiUrl = 'https://api.alternative.me/fng/';
    this.cache = null;
    this.lastFetch = 0;
    this.cacheTTL = 3600000; // 1 hour cache
  }

  async getScore() {
    const now = Date.now();
    if (this.cache && now - this.lastFetch < this.cacheTTL) {
      return this.cache;
    }

    try {
      const response = await axios.get(this.apiUrl);
      if (response.data && response.data.data && response.data.data.length > 0) {
        const item = response.data.data[0];
        const score = parseInt(item.value);
        const classification = item.value_classification;
        
        let emoji = '⚪';
        if (score >= 75) emoji = '🟢';     // Extreme Greed
        else if (score >= 55) emoji = '🟢';// Greed
        else if (score >= 45) emoji = '🟡';// Neutral
        else if (score >= 25) emoji = '🟠';// Fear
        else emoji = '🔴';                 // Extreme Fear

        this.cache = {
          score,
          classification,
          emoji,
          formatted: `🌡️ Market Mood: ${score}/100 — *${classification.toUpperCase()}* ${emoji}`
        };
        this.lastFetch = now;
        return this.cache;
      }
    } catch (error) {
      console.error('⚠️ [FearGreedService] Fetch failed:', error.message);
      // Fallback to cache if available, even if expired
      if (this.cache) return this.cache;
    }
    
    return null; // Silent fail if API down and no cache
  }
}

module.exports = new FearGreedService();
