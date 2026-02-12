class CommandParser {
  constructor() {
    this.commands = {
      hi: this.handleGreeting.bind(this),
      hello: this.handleGreeting.bind(this),
      start: this.handleGreeting.bind(this),
      menu: this.handleGreeting.bind(this),
      help: this.handleHelp.bind(this),

      // Price
      price: this.handleGenericPrice.bind(this),
      p: this.handleGenericPrice.bind(this),

      // Alerts
      set: this.handleSetAlert.bind(this),
      alert: this.handleSetAlert.bind(this),
      alerts: this.handleMyAlerts.bind(this),
      my: this.handleMyAlerts.bind(this),
      del: this.handleDeleteAlert.bind(this),
      delete: this.handleDeleteAlert.bind(this),
      
      // Account
      name: this.handleSetName.bind(this),
      
      // System
      status: this.handleStatus.bind(this),
      subscribe: this.handleSubscribe.bind(this),
      "upgrade pro": this.handleUpgradePro.bind(this),
    };
  }

  // 🎨 UI UTILITY: The "Read More" Spacer
  getReadMore() {
    return String.fromCharCode(8206).repeat(4001);
  }

  // 🎨 UI UTILITY: Header Builder
  getHeader(title) {
    return `╔══════════════════════════╗
║ 🚀 *${title}*
╚══════════════════════════╝`;
  }

  parseMessage(message) {
    const text = message.toLowerCase().trim();
    const words = text.split(/\s+/);
    return { command: words[0], args: words.slice(1) };
  }

  // MAIN HANDLER
  async handleCommand(message, jid, db, priceService, pushName, userState) {
    const { command, args } = this.parseMessage(message);
    const cleanPhone = jid.replace(/\D/g, "");

    // 1. Get/Create User
    let user = await db.getUserByPhoneNumber(cleanPhone);
    if (!user) user = await db.createUser(cleanPhone, cleanPhone, pushName);

    const handler = this.commands[command];
    if (!handler) {
        // If not a command, maybe just show menu if it looks like "Hi"
        if(["hey", "bot", "test"].includes(command)) return this.handleGreeting([], jid, db, priceService, pushName);
        
        // 🆕 Handle unknown commands with helpful message
        return this.handleUnknownCommand(command, args);
    }

    try {
      return await handler(args, cleanPhone, db, priceService, pushName, userState);
    } catch (error) {
      console.error(error);
      return "⚠️ *System Error*: My brain confused itself. Try again!";
    }
  }

  // ==========================================
  // ❌ UNKNOWN COMMAND HANDLER
  // ==========================================
  async handleUnknownCommand(command, args) {
      // Try to suggest similar commands
      const suggestions = this.getSuggestions(command);
      
      if (suggestions.length > 0) {
          return `🤔 *Unknown Command: "${command}"*

💡 *Did you mean:*
${suggestions.map(s => `• ${s}`).join('\n')}

━━━━━━━━━━━━━━━━━
🎯 *Popular Commands:*
• Price BTC
• Set ETH at 3500  
• My alerts
• Status
• Help

💡 *Type "Help" for all commands*`;
      } else {
          return `🤔 *Unknown Command: "${command}"*

🎯 *Try these commands:*
━━━━━━━━━━━━━━━━━
🔎 *Price [asset]* - Check prices
🔔 *Set [asset] at [price]* - Create alerts
📋 *My alerts* - View watchlist
📊 *Status* - System status
📧 *Subscribe* - Premium features
❓ *Help* - All commands

💡 *Examples:* "Price BTC" or "Set ETH at 3500"`;
      }
  }

  // Helper method to find similar commands
  getSuggestions(command) {
      const availableCommands = Object.keys(this.commands);
      const suggestions = [];
      
      // Check for partial matches
      availableCommands.forEach(cmd => {
          if (cmd.includes(command) || command.includes(cmd)) {
              suggestions.push(cmd);
          }
      });
      
      // Check for common typos
      const commonTypos = {
          'pric': 'price',
          'prices': 'price',
          'alert': 'alerts',
          'alret': 'alerts',
          'delete': 'del',
          'remove': 'del',
          'stat': 'status',
          'subscription': 'subscribe',
          'sub': 'subscribe'
      };
      
      if (commonTypos[command]) {
          suggestions.push(commonTypos[command]);
      }
      
      return [...new Set(suggestions)].slice(0, 3); // Remove duplicates, max 3 suggestions
  }

  // ==========================================
  // 🟢 GREETING (Friendly UI)
  // ==========================================
  async handleGreeting(args, phoneNumber, db, priceService, pushName) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const name = user.name || pushName || "Trader";

    return `${this.getHeader("PricePing Terminal")}

👋 *Hi, ${name}!*
I'm ready to track markets for you.

🎯 *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━
🔎 *Check Price:* 
   Type \`Price BTC\` or \`Price Gold\` 
   
🔔 *Set Alert:*
   Type \`Set ETH at 3500\` 

📋 *My Dashboard:*
   Type \`My Alerts\` 

⚙️ *Personalize:*
   Type \`Name ${name}\` to change nickname.

💡 *Tip:* _I support Crypto, Forex, and Commodities!_`;
  }

  // ==========================================
  // 🔎 PRICE CHECKER (With "Press 1" Logic)
  // ==========================================
  async handleGenericPrice(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length === 0) return "⚠️ *Usage:* `Price [CoinName]` (e.g., Price SOL)";

    const input = args.join(" ");
    
    // 1. Fetch Info
    const info = await priceService.getAssetInfo(input);

    // ❌ ERROR HANDLING (Visual Fix)
    // We use .toUpperCase() here so the error says "EURUSD", not "eurusd"
    if (!info) {
        return `❌ *Not Found*\n\nI searched high and low for *"${input.toUpperCase()}"* but couldn't find it.\n\n💡 *Try:* \`Price BTC\` or \`Price Gold\``;
    }

    // 🎨 DYNAMIC ICON & LABEL
    let icon = "💎"; // Default Crypto
    let label = "Crypto Asset";
    
    if (info.blockchain === 'Commodities') {
        icon = "🏆";
        label = "Commodity";
    } else if (info.blockchain === 'Forex Market') {
        icon = "💱";
        label = "Foreign Exchange";
    }

    const fPrice = priceService.formatPrice(info.price, info.symbol);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let response = `${icon} *${info.name}*
━━━━━━━━━━━━━━━━━
💰 *Price:* ${fPrice}
🏷️ *Type:* ${label}
⛓️ *Chain:* ${info.blockchain}
⏰ *Time:* ${time}
━━━━━━━━━━━━━━━━━
💡 *Quick Alert:* 
Reply "Set ${info.symbol} at ${info.price.toFixed(2)}"`;

    // 🟢 MULTI-CHAIN LOGIC
    if (info.others && info.others.length > 0) {
        // SAVE STATE
        userState.set(phoneNumber, {
            type: 'SELECT_CHAIN_PRICE',
            symbol: info.symbol,
            options: info.others // Array of { name, blockchain }
        });

        response += this.getReadMore(); // Hide list behind Read More
        response += `\n\n📋 *Wait! I found other versions:*`;
        response += `\n_Reply with a number to check specific price:_\n`;

        info.others.slice(0, 10).forEach((opt, i) => {
            response += `\n*${i + 1}.* ${opt.blockchain} Chain`;
        });
    }

    return response;
  }

  // ==========================================
  // 🔔 SET ALERT (With Price Preview & Selection)
  // ==========================================
  async handleSetAlert(args, phoneNumber, db, priceService, pushName, userState) {
    // Parse: "Set BTC at 50000" or "Set BTC 50000"
    if (args.length < 2) return "⚠️ *Usage:* `Set [Coin] at [Price]`\nExample: `Set SOL at 150`";

    const asset = args[0].toUpperCase();
    
    // Find price in arguments
    let targetPrice = null;
    let direction = null;

    // Detect "below" or "above" manually if user typed it
    if(args.includes("below")) direction = "below";
    if(args.includes("above")) direction = "above";

    // Extract number
    const priceArg = args.find(a => /^\d+(\.\d+)?$/.test(a.replace(/,/g, '')));
    if(priceArg) targetPrice = parseFloat(priceArg.replace(/,/g, ''));

    if(!targetPrice) return "⚠️ I need a target price! Example: `Set BTC at 65000`";

    // 1. CHECK IF ASSET IS MULTI-CHAIN (Unless chain specified in args)
    // We do a "Search" first to see options
    const info = await priceService.getAssetInfo(asset);

    // 🟢 IF MULTI-CHAIN & User didn't specify chain in arg
    // We check if info.others exists and user input didn't look like "Price USDT TRON"
    if (info && info.others && info.others.length > 0 && args.length < 4) {
        
        // Fetch LIVE PRICES for top 5 options to help user decide
        const optionsToDisplay = [
            { blockchain: info.blockchain, price: info.price }, // The default one
            ...info.others.slice(0, 5) // Top 5 others
        ];

        // We need to fetch prices for 'others' to display them nicely
        // (Assuming PriceService has a way to get price by exact chain, 
        //  if not, we just list names. But let's assume we want to be fancy)
        
        // SAVE STATE
        userState.set(phoneNumber, {
            type: 'SELECT_CHAIN_ALERT',
            symbol: info.symbol,
            targetPrice: targetPrice,
            direction: direction,
            options: optionsToDisplay
        });

        let menu = `⚖️ *Which ${info.symbol} chain?*
━━━━━━━━━━━━━━━━━
You are setting an alert at *${targetPrice}*.
Please select specific chain:
`;
        // List options
        optionsToDisplay.forEach((opt, i) => {
            // Note: In a real scenario, we might need to fetch the price for 'opt' if it's not the main one.
            // For now, we display the Chain Name.
            menu += `\n*${i+1}.* ${opt.blockchain}`;
        });

        menu += `\n\n👇 *Reply with number (e.g., 1 or 2)*`;
        return menu;
    }

    // 2. NORMAL ALERT SETTING (Single chain or chain resolved)
    const currentPrice = info ? info.price : null;
    if (currentPrice === null) return `❌ I couldn't find a price for ${asset}.`;

    // Auto-detect direction if not specified
    if (!direction) {
        direction = targetPrice > currentPrice ? "above" : "below";
    }

    // Check for existing alert for this asset
    const existingAlerts = await db.getUserAlerts(phoneNumber);
    const duplicateAlert = existingAlerts.find(alert => 
      alert.asset.toUpperCase() === asset && alert.status === 'active'
    );

    if (duplicateAlert) {
      const formattedTarget = priceService.formatPrice(duplicateAlert.targetPrice, asset);
      return `⚠️ *Alert Already Exists*
━━━━━━━━━━━━━━━━━━━━━━
📦 *Asset:* ${asset}
🎯 *Existing Target:* ${formattedTarget}
📊 *Current:* ${priceService.formatPrice(currentPrice, asset)}
━━━━━━━━━━━━━━━━━━━━━━
💡 *Delete first:* "Delete 1" then set new alert.`;
    }

    // Save to DB
    const newAlert = await db.createAlert(phoneNumber, asset, targetPrice, direction);

    return `✅ *Alert Activated!*
━━━━━━━━━━━━━━━━━
🔔 *Asset:* ${asset}
📉 *Target:* ${priceService.formatPrice(targetPrice, asset)}
📊 *Current:* ${priceService.formatPrice(currentPrice, asset)}
🎯 *Condition:* When price goes *${direction.toUpperCase()}*
━━━━━━━━━━━━━━━━━
_I'll message you the moment it hits!_`;
  }

  // ==========================================
  // 📋 MY ALERTS (Clean List)
  // ==========================================
  async handleMyAlerts(args, phoneNumber, db, priceService) {
    const alerts = await db.getUserAlerts(phoneNumber);
    if (alerts.length === 0) return "📂 *Your watchlist is empty.*\n\nTry: `Set BTC at 70000`";

    let msg = `${this.getHeader("Your Watchlist")}\n`;
    
    alerts.forEach((a, i) => {
        const icon = a.direction === 'above' ? '📈' : '📉';
        msg += `\n*${i+1}.* ${a.asset} ${icon} ${priceService.formatPrice(a.targetPrice, a.asset)}`;
    });

    msg += `\n\n━━━━━━━━━━━━━━━━━\n🗑️ *To Delete:* Reply \`Delete 1\``;
    return msg;
  }

  async handleHelp() {
      return `❓ *Need Help?*
━━━━━━━━━━━━━━━━━
1️⃣ *Check Prices*
   "Price XRP"
   "Price Gold"

2️⃣ *Set Alerts*
   "Set SOL at 200"
   "Set EURUSD at 1.05"

3️⃣ *Manage*
   "My alerts" - View list
   "Delete 1" - Remove alert

_Simply reply with any command!_`;
  }
  
  async handleDeleteAlert(args, phoneNumber, db) {
      if(!args[0]) return "⚠️ Which one? Usage: `Delete 1`";
      const index = parseInt(args[0]) - 1;
      const alerts = await db.getUserAlerts(phoneNumber);
      if(!alerts[index]) return "❌ Alert number not found.";
      
      await db.deleteAlert(alerts[index].id);
      return `🗑️ *Deleted:* Alert for ${alerts[index].asset}`;
  }
  
  async handleSetName(args, phoneNumber, db) {
      const name = args.join(" ");
      if(!name) return "⚠️ Usage: `Name Tony Stark`";
      await db.updateUserName(phoneNumber, name);
      return `✅ Nice to meet you, *${name}*!`;
  }

  // ==========================================
  // 📊 SYSTEM STATUS
  // ==========================================
  async handleStatus(args, phoneNumber, db, priceService) {
      try {
          const alerts = await db.getUserAlerts(phoneNumber);
          const activeAlerts = alerts.filter(a => a.status === 'active');
          
          // Get system uptime (simplified)
          const uptime = process.uptime();
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          
          return `${this.getHeader("System Status")}
          
🤖 *Bot Status:* Online ✅
⏰ *Uptime:* ${hours}h ${minutes}m
📊 *Your Alerts:* ${activeAlerts.length} active
💾 *Database:* Connected
🌐 *Markets:* Crypto, Forex, Commodities

━━━━━━━━━━━━━━━━━
🔧 *Commands Available:*
• Price [asset] - Check prices
• Set [asset] at [price] - Create alerts
• My alerts - View your watchlist
• Status - Show this status
• Help - Show all commands

💡 *Pro Tip:* Try "Price BTC" or "Set ETH at 3500"`;
      } catch (error) {
          console.error("Status command error:", error);
          return "⚠️ *System Error*: Couldn't fetch status right now.";
      }
  }

  // ==========================================
  // 📧 SUBSCRIBE/PREMIUM INFO
  // ==========================================
  async handleSubscribe(args, phoneNumber, db) {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      const alerts = await db.getUserAlerts(phoneNumber);
      const activeAlerts = alerts.filter(a => a.status === 'active');
      
      return `${this.getHeader("Premium Features")}

👋 *Hi ${user.name || 'Trader'}!*

📊 *Current Usage:*
• Active Alerts: ${activeAlerts.length}
• Plan: Free Tier

🌟 *Premium Benefits:*
━━━━━━━━━━━━━━━━━
✅ Unlimited alerts (vs 5 free)
✅ Real-time price notifications  
✅ Advanced market analytics
✅ Portfolio tracking
✅ Priority support
✅ Custom price thresholds

💰 *Pricing:*
━━━━━━━━━━━━━━━━━
🥉 *Monthly:* $9.99/month
🥈 *Quarterly:* $24.99 (save 17%)
🥇 *Yearly:* $79.99 (save 33%)

🚀 *Ready to upgrade?*
━━━━━━━━━━━━━━━━━
Reply "Upgrade Pro" to get started


💡 *Free Forever:*
Basic price checking & 5 alerts
always free - no credit card required!

Need help? Reply "Support"`;
  }

  // ==========================================
  // 🚀 UPGRADE PRO HANDLER
  // ==========================================
  async handleUpgradePro(args, phoneNumber, db) {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      const alerts = await db.getUserAlerts(phoneNumber);
      const activeAlerts = alerts.filter(a => a.status === 'active');
      
      return `${this.getHeader("🚀 Upgrade to Pro")}

👋 *Hi ${user.name || 'Trader'}!*

📊 *Current Usage:*
• Active Alerts: ${activeAlerts.length}
• Plan: Free Tier

🌟 *Premium Benefits:*
━━━━━━━━━━━━━━━━━
✅ Unlimited alerts (vs 5 free)
✅ Real-time price notifications  
✅ Advanced market analytics
✅ Portfolio tracking
✅ Priority support
✅ Custom price thresholds

💰 *Pricing:*
━━━━━━━━━━━━━━━━━
🥉 *Monthly:* $9.99/month
🥈 *Quarterly:* $24.99 (save 17%)
🥇 *Yearly:* $79.99 (save 33%)

🚀 *Ready to Upgrade?*
━━━━━━━━━━━━━━━━━
📞 *Contact Admin Directly:*
• WhatsApp: +2349160766236
• Message: "Upgrade Pro"

💡 *What to say:*
"Hi, I want to upgrade to Pro plan. My number is ${phoneNumber}"

━━━━━━━━━━━━━━━━━
🎁 *Special Offer:* 
Mention this message for 10% discount!

📧 *Need help?*
Reply "Support" for assistance`;
  }
}

module.exports = CommandParser;
