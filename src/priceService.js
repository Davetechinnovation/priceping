const axios = require('axios');

class PriceService {
    constructor() {
        // Try IP address first, fallback to domain
        this.diadataApi = 'https://api.diadata.org/v1/assetQuotation';
        // Alternative: 'https://188.166.227.175/v1/assetQuotation'; // Backup IP if DNS fails
        this.assetMap = this.initializeAssetMap();
    }

    initializeAssetMap() {
        return {
            // Cryptocurrencies with their blockchain and address
            'BTC': { blockchain: 'Bitcoin', address: '0x0000000000000000000000000000000000000000' },
            'BITCOIN': { blockchain: 'Bitcoin', address: '0x0000000000000000000000000000000000000000' },
            'ETH': { blockchain: 'Ethereum', address: '0x0000000000000000000000000000000000000000' },
            'ETHEREUM': { blockchain: 'Ethereum', address: '0x0000000000000000000000000000000000000000' },
            'BNB': { blockchain: 'Binance', address: '0x0000000000000000000000000000000000000000' },
            'BINANCE': { blockchain: 'Binance', address: '0x0000000000000000000000000000000000000000' },
            'ADA': { blockchain: 'Cardano', address: '0x0000000000000000000000000000000000000000' },
            'CARDANO': { blockchain: 'Cardano', address: '0x0000000000000000000000000000000000000000' },
            'SOL': { blockchain: 'Solana', address: '0x0000000000000000000000000000000000000000' },
            'SOLANA': { blockchain: 'Solana', address: '0x0000000000000000000000000000000000000000' },
            'DOT': { blockchain: 'Polkadot', address: '0x0000000000000000000000000000000000000000' },
            'POLKADOT': { blockchain: 'Polkadot', address: '0x0000000000000000000000000000000000000000' },
            'AVAX': { blockchain: 'Avalanche', address: '0x0000000000000000000000000000000000000000' },
            'AVALANCHE': { blockchain: 'Avalanche', address: '0x0000000000000000000000000000000000000000' },
            'MATIC': { blockchain: 'Polygon', address: '0x0000000000000000000000000000000000000000' },
            'POLYGON': { blockchain: 'Polygon', address: '0x0000000000000000000000000000000000000000' },
            'LINK': { blockchain: 'Ethereum', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
            'CHAINLINK': { blockchain: 'Ethereum', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
            'LTC': { blockchain: 'Litecoin', address: '0x0000000000000000000000000000000000000000' },
            'LITECOIN': { blockchain: 'Litecoin', address: '0x0000000000000000000000000000000000000000' },
            'XRP': { blockchain: 'Ripple', address: '0x0000000000000000000000000000000000000000' },
            'RIPPLE': { blockchain: 'Ripple', address: '0x0000000000000000000000000000000000000000' },
            'DOGE': { blockchain: 'Dogecoin', address: '0x0000000000000000000000000000000000000000' },
            'DOGECOIN': { blockchain: 'Dogecoin', address: '0x0000000000000000000000000000000000000000' },
            'SHIB': { blockchain: 'Ethereum', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
            'SHIBA': { blockchain: 'Ethereum', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
            'SHIBAINU': { blockchain: 'Ethereum', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' }
        };
    }

    // Get price from DiaData API
    async getDiaDataPrice(blockchain, address) {
        try {
            const url = `${this.diadataApi}/${blockchain}/${address}`;
            console.log(`🔍 Fetching price from: ${url}`);
            
            const response = await axios.get(url, {
                timeout: 30000, // 30 second timeout - increased from 10 seconds
                headers: {
                    'User-Agent': 'PricePing/1.0'
                }
            });
            
            console.log(`✅ DiaData response status: ${response.status}`);
            console.log(`📊 Response data:`, response.data);
            
            if (response.data && response.data.Price) {
                return {
                    price: parseFloat(response.data.Price),
                    symbol: response.data.Symbol,
                    name: response.data.Name,
                    time: response.data.Time,
                    priceYesterday: response.data.PriceYesterday,
                    volumeYesterdayUSD: response.data.VolumeYesterdayUSD
                };
            }
            throw new Error('Invalid response from DiaData API');
        } catch (error) {
            console.error(`❌ Error fetching DiaData price for ${blockchain}:`, error.message);
            console.error(`🔧 Full error:`, error);
            
            // Add more detailed error information
            if (error.code === 'ENOTFOUND') {
                console.error(`🌐 DNS Resolution Error: Cannot resolve ${this.diadataApi}`);
                console.error(`💡 Check your internet connection or API endpoint URL`);
            } else if (error.code === 'ECONNREFUSED') {
                console.error(`🔌 Connection Error: Server refused connection`);
            } else if (error.response) {
                console.error(`📡 HTTP Error: ${error.response.status} - ${error.response.statusText}`);
            }
            
            throw error;
        }
    }

    // Get price for any supported asset
    async getPrice(asset) {
        const upperAsset = asset.toUpperCase();
        
        // Check if asset is in our predefined map
        if (this.assetMap[upperAsset]) {
            const { blockchain, address } = this.assetMap[upperAsset];
            try {
                const priceData = await this.getDiaDataPrice(blockchain, address);
                return priceData.price; // Return just the price number
            } catch (error) {
                console.error(`❌ Failed to get price for ${asset} from primary API:`, error.message);
                return null;
            }
        }
        
        // For any other crypto, try common blockchain mappings with fallback
        const blockchainMappings = {
            // Default to Ethereum for most ERC-20 tokens
            'DEFAULT': 'Ethereum',
            // Major blockchains
            'BTC': 'Bitcoin',
            'ETH': 'Ethereum',
            'BNB': 'Binance',
            'ADA': 'Cardano',
            'SOL': 'Solana',
            'DOT': 'Polkadot',
            'AVAX': 'Avalanche',
            'MATIC': 'Polygon',
            'LTC': 'Litecoin',
            'XRP': 'Ripple',
            'DOGE': 'Dogecoin'
        };
        
        const blockchain = blockchainMappings[upperAsset] || 'Ethereum';
        const address = '0x0000000000000000000000000000000000000000';
        
        // Try multiple endpoints with fallback
        const endpoints = [
            `${this.diadataApi}/${blockchain}/${address}`,
            `https://api.coingecko.com/api/v3/simple/price?ids=${asset.toLowerCase()}&vs_currencies=usd`,
            `https://api.binance.com/api/v3/ticker/price?symbol=${asset.toUpperCase()}USDT`
        ];
        
        for (const endpoint of endpoints) {
            try {
                console.log(`🔍 Trying ${asset} on endpoint: ${endpoint}`);
                const response = await axios.get(endpoint, {
                    timeout: 30000, // 30 second timeout - increased from 10 seconds
                    headers: {
                        'User-Agent': 'PricePing/1.0'
                    }
                });
                
                if (endpoint.includes('coingecko')) {
                    if (response.data && response.data[asset.toLowerCase()] && response.data[asset.toLowerCase()].usd) {
                        return parseFloat(response.data[asset.toLowerCase()].usd);
                    }
                } else if (endpoint.includes('binance')) {
                    if (response.data && response.data.price) {
                        return parseFloat(response.data.price);
                    }
                } else {
                    if (response.data && response.data.Price) {
                        return parseFloat(response.data.Price);
                    }
                }
                
                throw new Error('Invalid response from API');
            } catch (error) {
                console.warn(`⚠️ Endpoint ${endpoint} failed:`, error.message);
                continue; // Try next endpoint
            }
        }
        
        console.error(`❌ All endpoints failed for ${asset}`);
        return null;
    }

    // Get multiple prices at once (sequentially to avoid rate limits)
    async getMultiplePrices(assets) {
        const prices = {};
        
        for (const asset of assets) {
            try {
                const price = await this.getPrice(asset);
                prices[asset.toUpperCase()] = price;
                
                // Wait 500ms between requests to be polite to APIs
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Failed to get price for ${asset}:`, error.message);
                prices[asset.toUpperCase()] = null;
            }
        }
        
        return prices;
    }

    // Format price for display
    formatPrice(price, asset) {
        if (price === null || price === undefined) {
            return 'Price unavailable';
        }

        const assetUpper = asset.toUpperCase();
        
        // Handle gold/silver formatting
        if (assetUpper === 'GOLD' || assetUpper === 'XAU' || assetUpper === 'SILVER' || assetUpper === 'XAG') {
            return `$${price.toFixed(2)}`;
        }

        // Handle crypto formatting
        if (price >= 1000) {
            return `$${price.toFixed(2)}`;
        } else if (price >= 1) {
            return `$${price.toFixed(4)}`;
        } else {
            return `$${price.toFixed(6)}`;
        }
    }

    // Get supported assets list
    getSupportedAssets() {
        return {
            crypto: [
                'BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC',
                'LINK', 'LTC', 'XRP', 'DOGE', 'SHIB'
            ],
            commodities: []
            // Note: DiaData API currently supports cryptocurrencies only
            // Commodities like Gold/Silver may have different endpoints
        };
    }

    // Get detailed asset information (for advanced features)
    async getAssetInfo(asset) {
        const upperAsset = asset.toUpperCase();
        const assetInfo = this.assetMap[upperAsset];
        
        try {
            if (assetInfo) {
                // For mapped assets, get detailed info from DiaData API
                const priceData = await this.getDiaDataPrice(assetInfo.blockchain, assetInfo.address);
                return {
                    symbol: priceData.symbol,
                    name: priceData.name,
                    price: priceData.price,
                    priceYesterday: priceData.priceYesterday,
                    volumeYesterdayUSD: priceData.volumeYesterdayUSD,
                    time: priceData.time,
                    blockchain: assetInfo.blockchain,
                    address: assetInfo.address
                };
            } else {
                // For fallback assets, return basic info
                const price = await this.getPrice(asset);
                return {
                    symbol: upperAsset,
                    name: upperAsset,
                    price: price,
                    time: new Date().toISOString()
                };
            }
        } catch (error) {
            console.error(`Error getting asset info for ${asset}:`, error.message);
            throw error;
        }
    }
}

module.exports = PriceService;
