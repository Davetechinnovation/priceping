const WebSocket = require('ws');

class DerivService {
  constructor() {
    this.appId = process.env.DERIV_APP_ID || '1089'; // Generic public Deriv API App ID
    this.wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
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
      }, 5000);

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
