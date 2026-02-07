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
            'crypto': this.handleCryptoPrice.bind(this),
            'forex': this.handleForexPrice.bind(this),
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
        // Check for common bot response patterns
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
                             originalMessage.includes('Error getting price') ||
                             originalMessage.includes('No account found') ||
                             originalMessage.includes('Send "Hi" to get started') ||
                             originalMessage.includes('❌ No account found') ||
                             originalMessage.includes('Alert Created Successfully') ||
                             originalMessage.includes('Your Active Alerts') ||
                             originalMessage.includes('No Active Alerts') ||
                             originalMessage.includes('Alert Deleted') ||
                             originalMessage.includes('All Alerts Cleared') ||
                             originalMessage.includes('Account Status') ||
                             originalMessage.includes('Upgrade to Premium') ||
                             originalMessage.includes('Invalid asset symbol') ||
                             originalMessage.includes('Please provide a valid') ||
                             originalMessage.includes('Please use format') ||
                             originalMessage.includes('Please specify') ||
                             originalMessage.includes('📋 *Your Active Alerts*') ||
                             originalMessage.includes('📋 *No Active Alerts*') ||
                             originalMessage.includes('✅ *Alert Created*') ||
                             originalMessage.includes('❌ Alert #') ||
                             originalMessage.includes('📊 *Your Account Status*') ||
                             originalMessage.includes('💰 *Upgrade to Premium*') ||
                             originalMessage.includes('🔔 *Direction*') ||
                             originalMessage.includes('🆔 *Alert ID*') ||
                             originalMessage.includes('📱 You\'ll get a WhatsApp message') ||
                             originalMessage.includes('💡 *Manage alerts*') ||
                             originalMessage.includes('🔄 *Fresh start*') ||
                             originalMessage.includes('Ready to track new price targets') ||
                             originalMessage.includes('💰 *') ||
                             originalMessage.includes('📊 *Current Price*') ||
                             originalMessage.includes('📈 *24h Change*') ||
                             originalMessage.includes('📅 *Last Updated*') ||
                             originalMessage.includes('💡 *Usage*') ||
                             // Working/waiting messages
                             originalMessage.includes('⏳ *Working on it...*') ||
                             originalMessage.includes('🔍 *Searching...*') ||
                             originalMessage.includes('💹 *Checking prices...*') ||
                             originalMessage.includes('⚡ *Processing...*') ||
                             originalMessage.includes('📊 *Loading data...*') ||
                             // Check if message starts with common bot response patterns
                             originalMessage.startsWith('❌') ||
                             originalMessage.startsWith('✅') ||
                             originalMessage.startsWith('📋') ||
                             originalMessage.startsWith('📊') ||
                             originalMessage.startsWith('💰') ||
                             originalMessage.startsWith('🎯') ||
                             originalMessage.startsWith('📈') ||
                             originalMessage.startsWith('📅') ||
                             originalMessage.startsWith('💡') ||
                             originalMessage.startsWith('🔔') ||
                             originalMessage.startsWith('🆔') ||
                             originalMessage.startsWith('📱') ||
                             originalMessage.startsWith('🔄') ||
                             originalMessage.startsWith('👋') ||
                             originalMessage.startsWith('🤖') ||
                             originalMessage.startsWith('⏳') ||
                             originalMessage.startsWith('🔍') ||
                             originalMessage.startsWith('💹') ||
                             originalMessage.startsWith('⚡');
        
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

🤖 *Your Trading Alert Bot* - I can help you track cryptocurrency and forex prices:

💰 *Price Commands*:
• Crypto [ASSET] - Get cryptocurrency price (e.g., "Crypto BTC")
• Forex [ASSET] - Get forex price (e.g., "Forex TJS" or "Forex EURUSD")

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
• "Crypto BTC" - Get Bitcoin price
• "Forex TJS" - Get Tajikistani Somoni to USD rate
• "Forex EURUSD" - Get Euro to Dollar rate
• "Set ETH at 3000" - Alert when ETH hits $3000
• "My alerts" - See all your alerts

🪙 *Supported Assets*: 
• Crypto: ANY cryptocurrency symbol (BTC, ETH, ADA, SOL, DOT, AVAX, MATIC, LINK, LTC, XRP, DOGE, SHIB, and more!)
• Forex: ANY currency pair (USD, EUR, TJS, BRL, INR, EURUSD, USDBRL, etc.)

💡 *Quick Start*: Try "Crypto BTC" or "Forex TJS" to see current prices!

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
        // Basic validation: Needs at least 4 parts: "Set", "BTC", "at", "50000"
        if (args.length < 2) {
            return `⚠️ *Invalid Format*\n\nUsage:\n• "Set BTC at 65000"\n• "Set TJS at 0.12"`;
        }

        const asset = args[0].toUpperCase();
        
        // Parse the command to find direction and price
        let directionWord = 'at'; // default
        let targetPrice = null;
        
        // Check for explicit direction words
        const directionIndex = args.findIndex(arg => ['above', 'below', 'at'].includes(arg.toLowerCase()));
        
        if (directionIndex !== -1) {
            directionWord = args[directionIndex].toLowerCase();
            // Price should be the next argument after direction
            if (args[directionIndex + 1]) {
                targetPrice = args[directionIndex + 1];
            }
        } else {
            // Try to find the first number in the args (excluding the asset name)
            const numberRegex = /^[\d,]+(k)?$/i;
            const foundPrice = args.find(arg => numberRegex.test(arg) && arg !== args[0]);
            if (foundPrice) {
                targetPrice = foundPrice;
            }
        }

        if (!targetPrice) {
            return `❌ Please provide a valid number for the price.\n\nUsage:\n• "Set BTC at 65000"\n• "Set TJS at 0.12"`;
        }

        // Clean and parse price - remove commas and handle "k" notation
        let cleanPrice = targetPrice.replace(/,/g, ''); // Remove commas
        let parsedPrice = parseFloat(cleanPrice);
        
        // Handle "k" notation (e.g., "90k" = 90000)
        if (cleanPrice.toLowerCase().endsWith('k')) {
            parsedPrice = parseFloat(cleanPrice.slice(0, -1)) * 1000;
        }

        if (isNaN(parsedPrice) || parsedPrice <= 0) {
            return `❌ Please provide a valid positive number for the price.\n\nUsage:\n• "Set BTC at 65000"\n• "Set TJS at 0.12"`;
        }

        // 1. GET CURRENT PRICE FIRST (To be smart!)
        // This checks BOTH Crypto and Forex because we updated priceService
        const currentPrice = await priceService.getPrice(asset);

        if (currentPrice === null) {
            return `❌ Could not find asset "${asset}".\n\nPlease check if it's a valid Crypto or Forex pair.\n\n💡 Examples: "Set BTC at 65000" or "Set TJS at 0.12"`;
        }

        // 2. DETERMINE CONDITION (The Smart Logic)
        let condition = '';

        if (directionWord === 'above') {
            condition = 'above';
        } else if (directionWord === 'below') {
            condition = 'below';
        } else {
            // User used "at" - Automatic Decision
            if (parsedPrice > currentPrice) {
                condition = 'above'; // Price is 50k, Target is 60k -> Alert when ABOVE
            } else {
                condition = 'below'; // Price is 50k, Target is 40k -> Alert when BELOW
            }
        }

        // 3. LOGIC CHECK (Prevent immediate triggers)
        // If user says "Set BTC above 50000" but BTC is already 60000
        if (condition === 'above' && currentPrice >= parsedPrice) {
            return `⚠️ *Alert Not Set*\n\nCurrent price (${priceService.formatPrice(currentPrice, asset)}) is already *above* ${parsedPrice}.`;
        }
        if (condition === 'below' && currentPrice <= parsedPrice) {
            return `⚠️ *Alert Not Set*\n\nCurrent price (${priceService.formatPrice(currentPrice, asset)}) is already *below* ${parsedPrice}.`;
        }

        // 4. CHECK USER ALERT LIMIT
        try {
            let user = await database.getUserByPhoneNumber(phoneNumber);
            if (!user) {
                user = await database.createUser(phoneNumber, phoneNumber);
            }
            
            const userAlerts = await database.getUserAlerts(user.id);
            const activeAlerts = userAlerts.filter(alert => !alert.triggered);
            
            if (activeAlerts.length >= 5) {
                return `❌ You have reached the maximum of 5 active alerts.\n\n📱 Type "My alerts" to see your alerts.\n💡 Type "Delete [ID]" to remove an alert.`;
            }

            // 5. SAVE ALERT (Database Logic)
            const alert = await database.createAlert(phoneNumber, asset, parsedPrice, condition);
            
            const directionEmoji = condition === 'above' ? '📈' : '📉';
            const formattedTargetPrice = priceService.formatPrice(parsedPrice, asset);
            const formattedCurrentPrice = priceService.formatPrice(currentPrice, asset);

            return `✅ *Alert Set Successfully!*
            
📦 *Asset:* ${asset}
🎯 *Target:* ${formattedTargetPrice}
📊 *Current:* ${formattedCurrentPrice}
🔔 *Condition:* Alert when price goes *${condition.toUpperCase()}* target.
🆔 *Alert ID:* ${alert.id}

📱 You'll get a WhatsApp message when ${asset} hits ${formattedTargetPrice}!

💡 *Manage alerts*: "My alerts" to view, "Delete ${alert.id}" to remove`;

        } catch (error) {
            console.error('Error creating alert:', error);
            return `❌ Database error while creating alert.`;
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

    // Handle explicit crypto price requests
    async handleCryptoPrice(args, phoneNumber, database, priceService) {
        if (args.length === 0) {
            return '❌ Please specify a cryptocurrency. Use: "Crypto [SYMBOL]"\n💡 Examples: "Crypto BTC", "Crypto ETH", "Crypto SOL"';
        }

        const asset = args[0].toUpperCase();
        
        try {
            console.log(`🔍 Getting crypto price for ${asset}`);
            const currentPrice = await priceService.getCryptoPrice(asset);
            
            if (currentPrice === null) {
                return `❌ Cryptocurrency "${asset}" not found or price unavailable.\n\n💡 Try: "Crypto BTC" or "Crypto ETH"`;
            }

            const formattedPrice = priceService.formatPrice(currentPrice, asset);
            
            try {
                const assetInfo = await priceService.getAssetInfo(asset);
                const change = assetInfo.priceYesterday ? 
                    ((currentPrice - assetInfo.priceYesterday) / assetInfo.priceYesterday * 100).toFixed(2) : null;
                const changeEmoji = change && change > 0 ? '📈' : change && change < 0 ? '📉' : '➡️';
                
                return `💰 *${asset} Crypto Price*

📊 *Current Price*: ${formattedPrice}
📈 *24h Change*: ${change ? `${changeEmoji} ${change}%` : 'No data'}
📅 *Last Updated*: ${assetInfo.time || 'Just now'}

💡 *Usage*: "Set ${asset} at [price]" to create alert`;
            } catch (infoError) {
                return `💰 *${asset} Crypto Price*

📊 *Current Price*: ${formattedPrice}
📅 *Last Updated*: Just now

💡 *Usage*: "Set ${asset} at [price]" to create alert`;
            }
        } catch (error) {
            console.error(`Error getting crypto price for ${asset}:`, error.message);
            return `❌ Could not get crypto price for ${asset}. Please check the symbol and try again.\n\n💡 Example: "Crypto BTC"`;
        }
    }

    // Handle explicit forex price requests
    async handleForexPrice(args, phoneNumber, database, priceService) {
        if (args.length === 0) {
            return '❌ Please specify a forex pair. Use: "Forex [PAIR]"\n💡 Examples: "Forex TJS", "Forex EURUSD", "Forex USDBRL"';
        }

        const pair = args[0].toUpperCase();
        
        try {
            console.log(`🔍 Getting forex price for ${pair}`);
            const currentPrice = await priceService.getForexPrice(pair);
            
            if (currentPrice === null) {
                return `❌ Forex pair "${pair}" not found or price unavailable.\n\n💡 Try: "Forex TJS", "Forex EURUSD", or "Forex USDBRL"`;
            }

            const formattedPrice = priceService.formatPrice(currentPrice, pair);
            
            return `💰 *${pair} Forex Rate*

📊 *Current Rate*: ${formattedPrice}
📅 *Last Updated*: Just now

💡 *Usage*: "Set ${pair} at [rate]" to create alert`;
        } catch (error) {
            console.error(`Error getting forex price for ${pair}:`, error.message);
            return `❌ Could not get forex rate for ${pair}. Please check the pair and try again.\n\n💡 Example: "Forex EURUSD"`;
        }
    }

    getHelpMessage() {
        return `❓ *Unknown Command*

📖 *Available Commands*:
• Hi/Hello - Get started
• Crypto [ASSET] - Get cryptocurrency price
• Forex [ASSET] - Get forex price
• Set [ASSET] at [PRICE] - Create alert
• Clear - Clear all your alerts
• Delete All - Delete all your alerts
• My alerts - View your active alerts
• Delete [ID] - Remove alert
• Help - Show this message
• Status - Account status
• Subscribe - Upgrade to premium

💡 *Examples*: 
• "Crypto BTC" - Get Bitcoin price
• "Forex TJS" - Get Tajikistani Somoni rate
• "Forex EURUSD" - Get Euro to Dollar rate
• "Set BTC at 95000" - Create Bitcoin alert

Type "Help" for detailed instructions.`;
    }
}

module.exports = CommandParser;
