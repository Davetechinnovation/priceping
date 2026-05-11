const WebSocket = require('ws');

class DerivService {
  constructor() {
    this.appId = process.env.DERIV_APP_ID || '1089'; // Generic public Deriv API App ID
    this.wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
    /** @type {Array<{symbol: string, displayName: string, market: string, submarket: string}>} */
    this.activeSymbols = [];
    /** @type {Set<string>} Quick lookup: symbol → exists */
    this.activeSymbolSet = new Set();
    /** @type {Set<string>} Submarket-filtered synthetics */
    this.syntheticSymbols = new Set();
    this._lastFetch = 0;
    this._fetchPromise = null;
  }

  /**
   * Fetches the full list of active Deriv symbols via WebSocket.
   * Caches for 1 hour to avoid hammering Deriv.
   * @param {boolean} [force=false] - Force re-fetch even if cache is fresh
   * @returns {Promise<Array>} Active symbols list
   */
  loadActiveSymbols(force = false) {
    const CACHE_TTL = 3600000; // 1 hour
    if (!force && this._lastFetch && Date.now() - this._lastFetch < CACHE_TTL && this.activeSymbols.length > 0) {
      return Promise.resolve(this.activeSymbols);
    }

    if (this._fetchPromise) return this._fetchPromise;

    this._fetchPromise = new Promise((resolve, reject) => {
      let isResolved = false;
      let ws;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (ws) try { ws.close(); } catch (e) {}
          console.warn('⚠️ [Deriv] loadActiveSymbols timed out');
          reject(new Error('Deriv loadActiveSymbols timed out'));
        }
      }, 10000);

      try {
        ws = new WebSocket(this.wsUrl);

        ws.on('open', () => {
          ws.send(JSON.stringify({
            active_symbols: 'brief',
            product_type: 'basic'
          }));
        });

        ws.on('message', (data) => {
          if (isResolved) return;
          try {
            const response = JSON.parse(data);

            if (response.error) {
              isResolved = true;
              clearTimeout(timeout);
              ws.close();
              return reject(new Error(response.error.message));
            }

            if (response.msg_type === 'active_symbols' && Array.isArray(response.active_symbols)) {
              // Store all symbols
              this.activeSymbols = response.active_symbols.map(s => ({
                symbol: s.symbol,
                displayName: s.display_name || s.symbol,
                market: s.market,
                submarket: s.submarket,
              }));

              // Build fast lookup sets
              this.activeSymbolSet = new Set(this.activeSymbols.map(s => s.symbol));
              this.syntheticSymbols = new Set(
                this.activeSymbols
                  .filter(s => s.market === 'synthetic_index')
                  .map(s => s.symbol)
              );

              this._lastFetch = Date.now();
              isResolved = true;
              clearTimeout(timeout);
              ws.close();

              console.log(`✅ [Deriv] Loaded ${this.activeSymbols.length} active symbols (${this.syntheticSymbols.size} synthetics)`);
              resolve(this.activeSymbols);
            }
          } catch (e) {
            // Wait for next message
          }
        });

        ws.on('error', (err) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            reject(err);
          }
        });

        ws.on('close', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            reject(new Error('Deriv WebSocket closed unexpectedly'));
          }
        });
      } catch (err) {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
    }).finally(() => {
      this._fetchPromise = null;
    });

    return this._fetchPromise;
  }

  /**
   * Check if a symbol exists on Deriv
   * @param {string} symbol
   * @returns {boolean}
   */
  hasSymbol(symbol) {
    return this.activeSymbolSet.has(symbol);
  }

  /**
   * Check if a symbol is a synthetic index on Deriv
   * @param {string} symbol
   * @returns {boolean}
   */
  isSynthetic(symbol) {
    return this.syntheticSymbols.has(symbol);
  }

  /**
   * Search for symbols by display name (partial match)
   * @param {string} query
   * @returns {Array<{symbol: string, displayName: string}>}
   */
  searchSymbols(query) {
    const q = query.toUpperCase();
    return this.activeSymbols
      .filter(s =>
        s.symbol.includes(q) ||
        s.displayName.toUpperCase().includes(q)
      )
      .map(s => ({ symbol: s.symbol, displayName: s.displayName }));
  }

  /**
   * Fetches the latest tick price for a given Deriv symbol via WebSocket.
   * Opens connection, sends payload, awaits the first tick, and closes.
   *
   * @param {string} symbol - Deriv internal symbol (e.g., 'R_75', 'BOOM1000')
   * @returns {Promise<number>} The latest quote price
   */
  fetchTick(symbol) {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let ws;

      // Ensure we don't hang if Deriv is slow
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (ws) {
            try { ws.close(); } catch (e) {}
          }
          console.warn(`⚠️ [Deriv] Fetch timed out for ${symbol}`);
          reject(new Error(`Deriv fetch timed out for ${symbol}`));
        }
      }, 15000);

      try {
        ws = new WebSocket(this.wsUrl);

        ws.on('open', () => {
          ws.send(JSON.stringify({
            ticks: symbol
          }));
        });

        ws.on('message', (data) => {
          if (isResolved) return;
          try {
            const response = JSON.parse(data);

            if (response.error) {
              isResolved = true;
              clearTimeout(timeout);
              ws.close();
              return reject(new Error(response.error.message));
            }

            if (response.msg_type === 'tick' && response.tick) {
              const price = parseFloat(response.tick.quote);
              isResolved = true;
              clearTimeout(timeout);
              ws.close();
              resolve(price);
            }
          } catch (e) {
            // Ignore parse errors, just wait for next message
          }
        });

        ws.on('error', (err) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            reject(err);
          }
        });

        ws.on('close', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            reject(new Error('Deriv WebSocket closed unexpectedly'));
          }
        });

      } catch (err) {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
    });
  }
}

module.exports = new DerivService();
