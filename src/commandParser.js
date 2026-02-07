class CommandParser {
    constructor() {
        this.commands = {
            'hi': this.handleGreeting.bind(this),
            'hello': this.handleGreeting.bind(this),
            'help': this.handleHelp.bind(this),
            'set': this.handleSetAlert.bind(this),
            'alerts': this.handleMyAlerts.bind(this),
            'delete': this.handleDeleteAlert.bind(this),
            'my': this.handleMyAlerts.bind(this),
            'status': this.handleStatus.bind(this),
            'subscribe': this.handleSubscribe.bind(this),
            'price': this.handleGetPrice.bind(this),
            'get': this.handleGetPrice.bind(this),
            'clear': this.handleClearAlerts.bind(this),
            'deleteall': this.handleDeleteAllAlerts.bind(this)
        };
    }

    parseMessage(message) {
        const text = message.toLowerCase().trim();
        const words = text.split(/\s+/);
        const command = words[0];

        return {
            command,
            args: words.slice(1),
            originalMessage: message
        };
    }

    async handleCommand(message, phoneNumber, database, priceService) {
        const { command, args, originalMessage } = this.parseMessage(message);
        
        // Prevent infinite loop - ignore messages that look like bot responses
        const isBotMessage = originalMessage.includes('❓') || 
                             originalMessage.includes('📖') || 
                             originalMessage.includes('Available Commands') || 
                             originalMessage.includes('Unknown Command') ||
                             originalMessage.includes('Welcome to PricePing') ||
                             originalMessage.includes('Your Trading Alert Bot') ||
                             originalMessage.includes('Price Commands') ||
                             originalMessage.includes('Alert Commands') ||
                             originalMessage.includes('Management Commands') ||
                             originalMessage.includes('Examples') ||
                             originalMessage.includes('Supported Assets') ||
                             originalMessage.includes('Quick Start') ||
                             originalMessage.includes('💰 *') ||
                             originalMessage.includes('🎯 *') ||
                             originalMessage.includes('📊 *') ||
                             originalMessage.includes('📈 *') ||
                             originalMessage.includes('📅 *') ||
                             originalMessage.includes('💡 *Usage') ||
                             originalMessage.includes('Could not get price') ||
                             originalMessage.includes('Error getting price');
        
        if (isBotMessage) {
            return null; // Don't respond to potential bot messages
        }
        
        const handler = this.commands[command];
        if (!handler) {
            return this.getHelpMessage();
        }

        try {
            return await handler(args, phoneNumber, database, priceService);
        } catch (error) {
            console.error(`Error handling command ${command}:`, error);
            return '❌ Sorry, something went wrong. Please try again.';
        }
    }

    async handleGreeting(args, phoneNumber, database, priceService) {
        try {
            // Create user if doesn't exist
            let user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                user = await database.createUser(phoneNumber, phoneNumber);
            }
            
            return `👋 Welcome to PricePing!

🤖 *Your Trading Alert Bot* - I can help you track cryptocurrency prices and set alerts:

💰 *Price Commands*:
• Price [ASSET] - Get current price (e.g., "Price BTC")
• Get [ASSET] - Alternative price command (e.g., "Get ETH")

🎯 *Alert Commands*:
• Set [ASSET] at [PRICE] - Create price alert
• Set [ASSET] below [PRICE] - Alert when price drops
• Set [ASSET] above [PRICE] - Alert when price rises

📋 *Management Commands*:
• My alerts / alerts - View your active alerts
• Delete [ID] - Remove specific alert
• Status - Check your account status
• Help - Show this command menu

💚 *Examples*:
• "Price BTC" - Get Bitcoin price
• "Set ETH at 3000" - Alert when ETH hits $3000
• "Set SOL below 100" - Alert when SOL drops below $100
• "My alerts" - See all your alerts

🪙 *Supported Assets*: ANY cryptocurrency symbol (BTC, ETH, ADA, SOL, DOT, AVAX, MATIC, LINK, LTC, XRP, DOGE, SHIB, and more!)

💡 *Quick Start*: Try "Price BTC" to see current prices!

Ready to track prices? Set your first alert! 🚀`;
        } catch (error) {
            console.error('Error in handleGreeting:', error);
            return '❌ Sorry, something went wrong. Please try again.';
        }
    }

    handleHelp(args, phoneNumber, database, priceService) {
        return `📖 *PricePing Help*

🔧 *Commands:*
• Set [ASSET] at [PRICE] - Set price alert
• Set [ASSET] alert at [PRICE] - Alternative format
• My alerts / alerts - View your active alerts
• Delete [NUMBER] - Delete alert by ID
• Help - Show this message

💰 *Supported Cryptocurrencies:*
🪙 *Major*: BTC, ETH, BNB, ADA, SOL, DOT, AVAX, MATIC
🪙 *Tokens*: LINK, LTC, XRP, DOGE, SHIB
🚀 *ANY CRYPTO*: We now support ANY cryptocurrency symbol!
💡 *Examples*: BTC, ETH, ADA, SOL, DOT, AVAX, MATIC, LINK, LTC, XRP, DOGE, SHIB, and many more!

📝 *Examples:*
• "Set BTC at 95000"
• "Set ETH alert at 5000"
• "My alerts"
• "Delete 3"

⚠️ *Alert Types:*
• Above target: "Set BTC at 95000" (alerts when price > $95,000)
• Below target: "Set BTC below 90000" (alerts when price < $90,000)

💡 *Note*: Currently supports cryptocurrencies only. Commodities coming soon!

Need more help? Just ask! 🤖`;
    }

    async handleSetAlert(args, phoneNumber, database, priceService) {
        if (args.length < 2) {
            return '❌ Please use format: "Set [ASSET] at [PRICE]" or "Set [ASSET] [PRICE]"\n💡 Examples: "Set BTC at 95000" or "Set BTC 95000"';
        }

        const asset = args[0].toUpperCase();
        let targetPrice;
        
        // Try to find price using "at" keyword first
        const priceIndex = args.indexOf('at');
        
        if (priceIndex !== -1 && args[priceIndex + 1]) {
            // Strict "at" format
            targetPrice = args[priceIndex + 1];
        } else {
            // Try to find the first number in the args (excluding the asset name)
            const numberRegex = /^[\d,]+(k)?$/i;
            const foundPrice = args.find(arg => numberRegex.test(arg) && arg !== args[0]);
            if (foundPrice) {
                targetPrice = foundPrice;
            }
        }

        if (!targetPrice) {
            return '❌ Could not find a price. Please use format: "Set [ASSET] at [PRICE]" or "Set [ASSET] [PRICE]"\n💡 Examples: "Set BTC at 95000" or "Set BTC 95000"';
        }

        // Clean and parse price - remove commas and handle "k" notation
        let cleanPrice = targetPrice.replace(/,/g, ''); // Remove commas
        let parsedPrice = parseFloat(cleanPrice);
        
        // Handle "k" notation (e.g., "90k" = 90000)
        if (cleanPrice.toLowerCase().endsWith('k')) {
            parsedPrice = parseFloat(cleanPrice.slice(0, -1)) * 1000;
        }

        if (isNaN(parsedPrice) || parsedPrice <= 0) {
            return '❌ Please provide a valid positive price.\n💡 Examples: "Set BTC at 95000" or "Set BTC 95000"';
        }

        // Check if asset is supported (now accepts any crypto)
        const supportedAssets = priceService.getSupportedAssets();
        
        // For now, we'll accept any 3-5 letter crypto symbol
        if (asset.length < 2 || asset.length > 10) {
            return `❌ Invalid asset symbol "${asset}".\n\n💡 Please use a valid cryptocurrency symbol (e.g., BTC, ETH, ADA, etc.)`;
        }

        try {
            // Get user first to check alert limit
            let user = await database.getUserByPhoneNumber(phoneNumber);
            if (user) {
                const userAlerts = await database.getUserAlerts(user.id);
                const activeAlerts = userAlerts.filter(alert => !alert.triggered);
                
                if (activeAlerts.length >= 5) {
                    return `❌ You have reached the maximum of 5 active alerts.\n\n📱 Type "My alerts" to see your alerts.\n💡 Type "Delete [ID]" to remove an alert.`;
                }
            }

            // Get current price for reference
            const currentPrice = await priceService.getPrice(asset);
            const formattedCurrentPrice = priceService.formatPrice(currentPrice, asset);

            // Create alert
            const alert = await database.createAlert(phoneNumber, asset, parsedPrice, 'above');
            
            const directionEmoji = '📈';
            const formattedTargetPrice = priceService.formatPrice(parsedPrice, asset);

            return `✅ *Alert Created Successfully!*

${directionEmoji} *Asset*: ${asset}
🎯 *Target*: ${formattedTargetPrice}
📊 *Current*: ${formattedCurrentPrice}
🔔 *Direction*: Above target
🆔 *Alert ID*: ${alert.id}

📱 You'll get a WhatsApp message when ${asset} hits ${formattedTargetPrice}!

💡 *Manage alerts*: "My alerts" to view, "Delete ${alert.id}" to remove`;
        } catch (error) {
            if (error.message.includes('Unsupported asset')) {
                return `❌ Unsupported asset: ${asset}

🪙 *Supported Crypto*: BTC, ETH, BNB, ADA, SOL, DOT, AVAX, MATIC, LINK, LTC, XRP, DOGE, SHIB
💡 *Note*: Currently supports cryptocurrencies only. Commodities coming soon!

Type "Help" for more examples.`;
            }
            throw error;
        }
    }

    async handleMyAlerts(args, phoneNumber, database, priceService) {
        try {
            const user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                return '❌ No account found. Send "Hi" to get started!';
            }

            const alerts = await database.getUserAlerts(user.id);
            if (alerts.length === 0) {
                return `📋 *No Active Alerts*

You don't have any active price alerts.

💡 *Set your first alert*: "Set BTC at 95000"`;
            }

            let message = `📋 *Your Active Alerts* (${alerts.length})\n\n`;
            
            for (const alert of alerts) {
                const currentPrice = await priceService.getPrice(alert.asset);
                const formattedCurrentPrice = priceService.formatPrice(currentPrice, alert.asset);
                const formattedTargetPrice = priceService.formatPrice(alert.target_price, alert.asset);
                const directionEmoji = alert.direction === 'above' ? '📈' : '📉';
                
                message += `${directionEmoji} *ID ${alert.id}*: ${alert.asset}\n`;
                message += `   🎯 Target: ${formattedTargetPrice} (${alert.direction})\n`;
                message += `   📊 Current: ${formattedCurrentPrice}\n`;
                message += `   📅 Created: ${new Date(alert.created_at).toLocaleDateString()}\n\n`;
            }

            message += `💡 *Delete alert*: "Delete [ID]" (e.g., "Delete 2")`;
            return message;
        } catch (error) {
            throw error;
        }
    }

    async handleDeleteAlert(args, phoneNumber, database, priceService) {
        if (args.length === 0) {
            return '❌ Please specify alert ID. Use: "Delete [NUMBER]"';
        }

        const alertId = parseInt(args[0]);
        if (isNaN(alertId)) {
            return '❌ Invalid alert ID. Please use a number.';
        }

        try {
            const user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                return '❌ No account found. Send "Hi" to get started!';
            }

            const result = await database.deleteAlert(alertId, user.id);
            if (result.changes === 0) {
                return `❌ Alert #${alertId} not found or doesn't belong to you.`;
            }

            return `✅ *Alert Deleted*

Alert #${alertId} has been removed successfully.

📋 *View remaining alerts*: "My alerts"`;
        } catch (error) {
            throw error;
        }
    }

    async handleSubscribe(args, phoneNumber, database, priceService) {
        return `💰 *Upgrade to Premium*

🚀 *Premium Features*:
• 🔄 Unlimited price alerts
• 📱 SMS backup notifications  
• ⚡ Real-time price updates (every 30 seconds)
• 📊 Price history and analytics
• 🎯 Custom alert conditions
• 💬 Priority support

💵 *Pricing*: $2,000/month

📞 *To Subscribe*:
1. Pay $2,000 to: [Your Payment Details]
2. Send payment screenshot
3. We'll activate your premium account within 30 Minutes

🎁 *Limited Offer*: Get 50% off your first month!

📞 *Questions*: Reply here or call [Support Number]`;
    }

    async handleStatus(args, phoneNumber, database, priceService) {
        try {
            const user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                return '❌ No account found. Send "Hi" to get started!';
            }

            const alerts = await database.getUserAlerts(user.id);
            const subscriptionType = user.subscription_type.toUpperCase();
            
            return `📊 *Your Account Status*

👤 *Phone*: ${phoneNumber}
📦 *Plan*: ${subscriptionType}
🔔 *Active Alerts*: ${alerts.length}/${user.subscription_type === 'free' ? '5' : '∞'}
📅 *Member Since*: ${new Date(user.created_at).toLocaleDateString()}

💡 *Upgrade*: "Subscribe" for unlimited alerts`;
        } catch (error) {
            throw error;
        }
    }

    async handleClearAlerts(args, phoneNumber, database, priceService) {
        try {
            // Get user first
            const user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                return '❌ No account found. Send "Hi" to get started!';
            }
            
            // Get user's alerts
            const userAlerts = await database.getUserAlerts(user.id);
            
            if (userAlerts.length === 0) {
                return '📋 You have no alerts to clear.\n\n💡 *Set your first alert*: "Set BTC at 95000"';
            }

            // Delete all user's alerts
            let deletedCount = 0;
            for (const alert of userAlerts) {
                await database.deleteAlert(alert.id, user.id);
                deletedCount++;
            }

            return `✅ *All Alerts Cleared!*

🗑️ Deleted ${deletedCount} alerts successfully

📋 *Your alert list is now empty*

💡 *Set new alerts*: "Set BTC at 95000" or "Price ETH"

🔄 *Fresh start!*
Ready to track new price targets! 🚀`;
        } catch (error) {
            console.error('Error clearing alerts:', error);
            return '❌ Sorry, I couldn\'t clear your alerts. Please try again.';
        }
    }

    async handleDeleteAllAlerts(args, phoneNumber, database, priceService) {
        try {
            // Get user first
            const user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                return '❌ No account found. Send "Hi" to get started!';
            }
            
            // Get all alerts for this user
            const userAlerts = await database.getUserAlerts(user.id);
            
            if (userAlerts.length === 0) {
                return '📋 You have no alerts to delete.\n\n💡 *Set your first alert*: "Set BTC at 95000"';
            }

            // Delete all user's alerts
            let deletedCount = 0;
            for (const alert of userAlerts) {
                await database.deleteAlert(alert.id, user.id);
                deletedCount++;
            }

            return `✅ *All ${deletedCount} Alerts Deleted!*

🗑️ Successfully cleared all your alerts

📋 *Your alert list is now empty*

💡 *Set new alerts*: "Set BTC at 95000" or "Price ETH"

🔄 *Fresh start!*
Ready to track new price targets! 🚀`;
        } catch (error) {
            console.error('Error clearing all alerts:', error);
            return '❌ Sorry, I couldn\'t clear all your alerts. Please try again.';
        }
    }

    async handleGetPrice(args, phoneNumber, database, priceService) {
        if (args.length === 0) {
            return '❌ Please specify a cryptocurrency symbol.\n💡 Example: "Price BTC" or "Get BTC"';
        }

        const asset = args[0].toUpperCase();
        
        try {
            const currentPrice = await priceService.getPrice(asset);
            const formattedPrice = priceService.formatPrice(currentPrice, asset);
            
            // Get additional info if available
            try {
                const assetInfo = await priceService.getAssetInfo(asset);
                const change = assetInfo.priceYesterday ? 
                    ((currentPrice - assetInfo.priceYesterday) / assetInfo.priceYesterday * 100).toFixed(2) : null;
                const changeEmoji = change && change > 0 ? '📈' : change && change < 0 ? '📉' : '➡️';
                
                return `💰 *${asset} Price*

📊 *Current Price*: ${formattedPrice}
📈 *24h Change*: ${change ? `${changeEmoji} ${change}%` : 'No data'}
📅 *Last Updated*: ${assetInfo.time || 'Just now'}

💡 *Usage*: "Set ${asset} at [price]" to create alert`;
            } catch (infoError) {
                return `💰 *${asset} Price*

📊 *Current Price*: ${formattedPrice}
📅 *Last Updated*: Just now

💡 *Usage*: "Set ${asset} at [price]" to create alert`;
            }
        } catch (error) {
            console.error(`Error getting price for ${asset}:`, error.message);
            return `❌ Could not get price for ${asset}. Please check the symbol and try again.\n\n💡 Example: "Price BTC"`;
        }
    }

    getHelpMessage() {
        return `❓ *Unknown Command*

📖 *Available Commands*:
• Hi/Hello - Get started
• Price/Get [ASSET] - Get current price
• Set [ASSET] at [PRICE] - Create alert
• Clear - Clear all your alerts
• Delete All - Delete all your alerts
• My alerts - View your active alerts
• Delete [ID] - Remove alert
• Help - Show this message
• Status - Account status
• Subscribe - Upgrade to premium

💡 *Example*: "Set BTC at 95000"

Type "Help" for detailed instructions.`;
    }
}

module.exports = CommandParser;
