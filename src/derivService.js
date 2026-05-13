const WebSocket = require('ws');

class DerivService {
  constructor() {
    // App ID from env (supports both numeric 1089 and alphanumeric from developers.deriv.com)
    this.primaryAppId = (process.env.DERIV_APP_ID || '1089').trim();
    this.fallbackAppId = '1089'; // Public fallback
    this.appId = this.primaryAppId;
    this.apiToken = process.env.DERIV_API_TOKEN || null;
    this.wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;

    // Symbol registry
    /** @type {Array<{symbol: string, displayName: string, market: string, submarket: string}>} */
    this.activeSymbols = [];
    this.activeSymbolSet = new Set();
    this.syntheticSymbols = new Set();
    this._lastFetch = 0;
    this._fetchPromise = null;

    // ── Persistent WebSocket ──────────────────────────────────
    /** @type {WebSocket | null} */
    this.ws = null;
    this.wsConnected = false;
    this.wsConnecting = false;
    this.wsReconnectTimer = null;
    this.wsIntentionalClose = false;

    // Ticks from the persistent connection: { symbol → { price, ts } }
    this.tickCache = new Map();
    this.tickTTL = 60000; // 60s cache

    // Promise queue: { symbol → resolve/reject list }
    this.tickWaiters = new Map();

    // Symbols currently subscribed on the persistent WS
    this.subscribedSymbols = new Set();

    // Keep-alive ping interval
    this._pingTimer = null;

    // Start connecting immediately
    this._connectPersistentWS();
  }

  // ═══════════════════════════════════════════════════════════
  // PERSISTENT WEBSOCKET
  // ═══════════════════════════════════════════════════════════

  _connectPersistentWS() {
    if (this.wsConnecting || this.wsConnected) return;
    this.wsConnecting = true;
    this.wsIntentionalClose = false;

    console.log('🔌 [Deriv] Connecting persistent WebSocket...');

    try {
      const ws = new WebSocket(this.wsUrl);

      ws.on('open', () => {
        console.log('✅ [Deriv] Persistent WebSocket connected');
        this.ws = ws;
        this.wsConnected = true;
        this.wsConnecting = false;

        // Re-subscribe any symbols that were subscribed before reconnect
        if (this.subscribedSymbols.size > 0) {
          for (const sym of this.subscribedSymbols) {
            ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
          }
          console.log(`📡 [Deriv] Re-subscribed to ${this.subscribedSymbols.size} symbols`);
        }

        // Start keep-alive ping every 30s
        this._startPing();
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data);

          if (response.error) {
            console.warn(`⚠️ [Deriv] WS error: ${response.error.message}`);
            return;
          }

          // Handle tick data
          if (response.msg_type === 'tick' && response.tick) {
            const symbol = response.tick.symbol;
            const price = parseFloat(response.tick.quote);
            if (symbol && !isNaN(price)) {
              this.tickCache.set(symbol, { price, ts: Date.now() });

              // Resolve any waiters
              const waiters = this.tickWaiters.get(symbol);
              if (waiters && waiters.length > 0) {
                const resolvers = [...waiters];
                this.tickWaiters.delete(symbol);
                for (const resolve of resolvers) {
                  resolve(price);
                }
              }
            }
          }

          // Handle subscription acknowledgement
          if (response.msg_type === 'subscription' && response.subscription?.id) {
            // Subscription confirmed — nothing extra needed
          }

        } catch (e) {
          // Ignore parse errors
        }
      });

      ws.on('error', (err) => {
        const is401 = err.message?.includes('401') || err.message?.includes('Unexpected server response');
        if (is401 && this.appId !== this.fallbackAppId) {
          console.warn(`⚠️ [Deriv] App ID "${this.appId}" rejected (401). Falling back to public App ID ${this.fallbackAppId}`);
          this.appId = this.fallbackAppId;
          this.wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
          this.wsIntentionalClose = true;
          if (this.ws) { try { this.ws.removeAllListeners(); this.ws.close(); } catch (e) {} }
          this.ws = null;
          this.wsConnected = false;
          this.wsConnecting = false;
          this.wsIntentionalClose = false;
          this._clearReconnect();
          this.wsReconnectTimer = setTimeout(() => this._connectPersistentWS(), 1000);
          return;
        }
        console.warn(`⚠️ [Deriv] WS error: ${err.message}`);
      });

      ws.on('close', () => {
        this.wsConnected = false;
        this.wsConnecting = false;
        this.ws = null;
        this._stopPing();

        // Reject all pending waiters
        for (const [sym, waiters] of this.tickWaiters) {
          for (const reject of waiters) {
            reject(new Error(`Deriv WS disconnected: ${sym}`));
          }
        }
        this.tickWaiters.clear();

        if (!this.wsIntentionalClose) {
          const delay = 5000;
          console.log(`🔄 [Deriv] Reconnecting in ${delay / 1000}s...`);
          this._clearReconnect();
          this.wsReconnectTimer = setTimeout(() => this._connectPersistentWS(), delay);
        }
      });
    } catch (err) {
      this.wsConnecting = false;
      console.warn(`⚠️ [Deriv] WS connection failed: ${err.message}`);
      this._clearReconnect();
      this.wsReconnectTimer = setTimeout(() => this._connectPersistentWS(), 5000);
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this.wsConnected) {
        try { this.ws.send(JSON.stringify({ ping: 1 })); } catch (e) { /* ignore */ }
      }
    }, 30000);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _clearReconnect() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  _disconnectPersistentWS() {
    this.wsIntentionalClose = true;
    this._clearReconnect();
    this._stopPing();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this.wsConnected = false;
    this.wsConnecting = false;
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Fetch the latest tick price for a symbol.
   * Uses the persistent WebSocket — subscribes if not already subscribed.
   * Returns instantly from cache if available and fresh (< 60s).
   * Returns from a pending tick wait if not cached.
   *
   * @param {string} symbol - Deriv internal symbol (e.g., 'R_75', 'BOOM1000')
   * @param {number} [timeout=10000] - Max wait time in ms
   * @returns {Promise<number>} The latest quote price
   */
  fetchTick(symbol, timeout = 10000) {
    const now = Date.now();
    const cached = this.tickCache.get(symbol);

    // Return from cache if fresh (avoids waiting for a new tick)
    if (cached && now - cached.ts < this.tickTTL) {
      return Promise.resolve(cached.price);
    }

    // If WS is connected, subscribe and wait for the next tick
    if (this.wsConnected && this.ws) {
      if (!this.subscribedSymbols.has(symbol)) {
        this.subscribedSymbols.add(symbol);
        try {
          this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
          console.log(`📡 [Deriv] Subscribed to ${symbol}`);
        } catch (e) {
          console.warn(`⚠️ [Deriv] Failed to subscribe to ${symbol}: ${e.message}`);
        }
      }

      // Return stale cache as fallback while waiting
      if (cached) {
        // Also set a short timeout to return stale if no new tick arrives quickly
        return new Promise((resolve, reject) => {
          const waiters = this.tickWaiters.get(symbol) || [];
          waiters.push(resolve);
          this.tickWaiters.set(symbol, waiters);

          // Timeout — return stale cache if available, otherwise reject
          setTimeout(() => {
            const waiters2 = this.tickWaiters.get(symbol) || [];
            const idx = waiters2.indexOf(resolve);
            if (idx !== -1) {
              waiters2.splice(idx, 1);
              if (waiters2.length === 0) this.tickWaiters.delete(symbol);
              // Return stale cache as fallback
              const stale = this.tickCache.get(symbol);
              if (stale) {
                resolve(stale.price);
              } else {
                reject(new Error(`Deriv fetch timed out for ${symbol}`));
              }
            }
          }, timeout);
        });
      }

      // No cache at all — wait for first tick
      return new Promise((resolve, reject) => {
        const waiters = this.tickWaiters.get(symbol) || [];
        waiters.push(resolve);
        this.tickWaiters.set(symbol, waiters);

        setTimeout(() => {
          const waiters2 = this.tickWaiters.get(symbol) || [];
          const idx = waiters2.indexOf(resolve);
          if (idx !== -1) {
            waiters2.splice(idx, 1);
            if (waiters2.length === 0) this.tickWaiters.delete(symbol);
            reject(new Error(`Deriv fetch timed out for ${symbol}`));
          }
        }, timeout);
      });
    }

    // WS not connected — try opening one and wait briefly
    if (!this.wsConnecting) {
      this._connectPersistentWS();
    }

    // Return stale cache if available, otherwise reject
    if (cached) {
      return Promise.resolve(cached.price);
    }

    // Wait briefly for WS to connect and deliver a tick
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const now2 = Date.now();
        const cached2 = this.tickCache.get(symbol);
        if (cached2 && now2 - cached2.ts < this.tickTTL) {
          clearInterval(checkInterval);
          resolve(cached2.price);
        }
      }, 500);

      setTimeout(() => {
        clearInterval(checkInterval);
        const stale = this.tickCache.get(symbol);
        if (stale) {
          resolve(stale.price);
        } else {
          reject(new Error(`Deriv fetch timed out for ${symbol}`));
        }
      }, timeout);
    });
  }

  /**
   * Fetches the full list of active Deriv symbols via WebSocket (one-time).
   * Caches for 1 hour.
   */
  loadActiveSymbols(force = false) {
    const CACHE_TTL = 3600000;
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
          ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
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
              this.activeSymbols = response.active_symbols.map(s => ({
                symbol: s.symbol,
                displayName: s.display_name || s.symbol,
                market: s.market,
                submarket: s.submarket,
              }));

              this.activeSymbolSet = new Set(this.activeSymbols.map(s => s.symbol));
              this.syntheticSymbols = new Set(
                this.activeSymbols.filter(s => s.market === 'synthetic_index').map(s => s.symbol)
              );

              this._lastFetch = Date.now();
              isResolved = true;
              clearTimeout(timeout);
              ws.close();
              console.log(`✅ [Deriv] Loaded ${this.activeSymbols.length} active symbols (${this.syntheticSymbols.size} synthetics)`);
              resolve(this.activeSymbols);
            }
          } catch (e) { /* ignore */ }
        });

        ws.on('error', (err) => {
          if (!isResolved) { isResolved = true; clearTimeout(timeout); reject(err); }
        });

        ws.on('close', () => {
          if (!isResolved) { isResolved = true; clearTimeout(timeout); reject(new Error('Deriv WebSocket closed unexpectedly')); }
        });
      } catch (err) {
        if (!isResolved) { isResolved = true; clearTimeout(timeout); reject(err); }
      }
    }).finally(() => { this._fetchPromise = null; });

    return this._fetchPromise;
  }

  hasSymbol(symbol) { return this.activeSymbolSet.has(symbol); }
  isSynthetic(symbol) { return this.syntheticSymbols.has(symbol); }

  searchSymbols(query) {
    const q = query.toUpperCase();
    return this.activeSymbols
      .filter(s => s.symbol.includes(q) || s.displayName.toUpperCase().includes(q))
      .map(s => ({ symbol: s.symbol, displayName: s.displayName }));
  }
}

module.exports = new DerivService();
