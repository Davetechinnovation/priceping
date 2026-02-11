class CommandParser {
  constructor() {
    this.commands = {
      hi: this.handleGreeting.bind(this),
      hello: this.handleGreeting.bind(this),
      start: this.handleGreeting.bind(this),
      help: this.handleHelp.bind(this),

      // 🟢 The "Universal" Price Command
      price: this.handleGenericPrice.bind(this),
      get: this.handleGenericPrice.bind(this),

      // Specifics
      crypto: this.handleCryptoPrice.bind(this),
      forex: this.handleForexPrice.bind(this),

      // Alerts
      set: this.handleSetAlert.bind(this),
      alerts: this.handleMyAlerts.bind(this),
      delete: this.handleDeleteAlert.bind(this),
      my: this.handleMyAlerts.bind(this),
      clear: this.handleClearAlerts.bind(this),
      deleteall: this.handleDeleteAllAlerts.bind(this),

      // Account
      status: this.handleStatus.bind(this),
      subscribe: this.handleSubscribe.bind(this),
      name: this.handleSetName.bind(this),
    };
  }

  // ============================================================
  // 🔮 WHATSAPP "READ MORE" TRICK
  // Creates a large empty space to force the "Read More" button
  // ============================================================
  getReadMore() {
    return String.fromCharCode(8206).repeat(4001);
  }

  parseMessage(message) {
    const text = message.toLowerCase().trim();
    const words = text.split(/\s+/);
    const command = words[0];

    return {
      command,
      args: words.slice(1),
      originalMessage: message,
    };
  }

  // UPDATED: NOW ACCEPTS 'pushName' (the 5th argument)
  async handleCommand(message, jid, database, priceService, pushName) {
    const cleanPhoneNumber = jid.replace(/\D/g, "");

    // Check DB using the CLEAN number
    let user = await database.getUserByPhoneNumber(cleanPhoneNumber);

    // 🆕 FIRST TIME USER CHECK
    if (!user) {
      // 🟢 Pass 'pushName' to creation
      await database.createUser(cleanPhoneNumber, cleanPhoneNumber, pushName);
      console.log(`👤 Created new user: ${cleanPhoneNumber} (${pushName})`);
      return this.getWelcomeDashboard(pushName || "Trader");
    } else {
      console.log(`👤 Found existing user: ${cleanPhoneNumber}`);
    }

    const { command, args, originalMessage } = this.parseMessage(message);

    // 🤖 Bot Loop Protection
    const botPatterns = [
      "━━━━━━━━━━━━",
      "PricePing",
      "Unknown Command",
      "Welcome to",
      "Upgrade to Premium",
      "Alert Set Successfully",
      "Working on it...",
    ];
    if (botPatterns.some((pattern) => originalMessage.includes(pattern))) {
      return null;
    }

    const handler = this.commands[command];
    if (!handler) {
      return this.handleHelp([], cleanPhoneNumber, database, priceService, pushName);
    }

    try {
      // 🟢 Pass 'pushName' to handlers (e.g., Greeting)
      return await handler(args, cleanPhoneNumber, database, priceService, pushName);
    } catch (error) {
      console.error(`Error handling command ${command}:`, error);
      return "⚠️ *System Error*";
    }
  }

  getWelcomeDashboard(name) {
    return `╔════════════════════╗
║   🚀 *PricePing Terminal*   ║
╚════════════════════╝

👋 *Welcome, ${name}!*
Your account is active.

👇 *QUICK START GUIDE*
━━━━━━━━━━━━━━━━━━━━
🔎 *Universal Search:* 
   Price [Asset] (e.g. Price Gold, Price DOGS)

🏆 *Commodities:*   Price Gold 
💎 *Check Crypto:*  Price BTC 
💱 *Check Forex:*   Price EURUSD 
🔔 *Set Alert:*     Set Gold at 2500
👤 *Set Name:*      Name [Your Name]
━━━━━━━━━━━━━━━━━━━━

*Reply with "Price Gold" to test!*`;
  }

  // ==========================================
  // 🏆 UNIVERSAL PRICE HANDLER (Updated!)
  // ==========================================
  async handleGenericPrice(args, phoneNumber, database, priceService) {
    if (args.length === 0)
      return '⚠️ *Format:* Price [Asset]\nExample: "Price Gold" or "Price BTC"';

    const assetInput = args.join(" ");
    console.log(`🔍 Smart searching for: ${assetInput}`);

    try {
      const info = await priceService.getAssetInfo(assetInput);

      if (!info || info.price === null) {
        return `❌ *Asset Not Found*\nWe could not find "${assetInput}".\n\n💡 *Try:* "Price BTC", "Price Gold", or "Price EURUSD"`;
      }

      const formattedPrice = priceService.formatPrice(info.price, info.symbol);

      // 3. 🎨 DYNAMIC CARD DESIGN
      let icon = "💎";
      let typeLabel = "Crypto Asset";

      if (info.blockchain === "Commodities") {
        icon = "🏆";
        typeLabel = "Commodity";
      } else if (info.blockchain === "Forex/Fiat") {
        icon = "💱";
        typeLabel = "Forex Rate";
      }

      let message = `${icon} *${info.name}*
━━━━━━━━━━━━━━━━━━━━━━
💵 *Price:* ${formattedPrice}
🏷️ *Type:* ${typeLabel}
⛓️ *Chain:* ${info.blockchain}
📅 *Time:* ${info.time || "Live"}
━━━━━━━━━━━━━━━━━━━━━━
💡 *Action:* "Set ${info.symbol} at ${info.price.toFixed(2)}"`;

      // 🟢 HANDLE MULTI-CHAIN LIST
      if (info.others && info.others.length > 0) {
        message += this.getReadMore(); // Force text collapse
        message += `\n\n📋 *Other Available Chains:*\n`;
        message += `_To check these, type: "Price ${info.symbol} [Chain]"_\n\n`;

        // Limit list to avoid spamming too much, but show enough
        info.others.slice(0, 15).forEach((chain, index) => {
          message += `${index + 1}. ${chain}\n`;
        });

        if (info.others.length > 15)
          message += `... and ${info.others.length - 15} more.`;
      }

      return message;
    } catch (error) {
      console.error(error);
      return `⚠️ *Error*\nCould not fetch data.`;
    }
  }

  // ==========================================
  // 🟢 GREETING & HELP
  // ==========================================

  // 🟢 UPDATED: GREETING LOGIC
  async handleGreeting(args, phoneNumber, database, priceService, pushName) {
    const user = await database.getUserByPhoneNumber(phoneNumber);
    
    // Logic: 1. DB Name -> 2. WhatsApp Name -> 3. "Trader"
    const displayName = (user && user.name) ? user.name : (pushName || "Trader");

    return `👋 *Welcome back, ${displayName}!* 
━━━━━━━━━━━━━━━━━━━━
Ready to check prices? Try:
• Price Gold • Price BTC • Price DOGS
• My alerts • Help
• Name [Your Name] to set your name`;
  }

  handleHelp(args, phoneNumber, database, priceService, pushName) {
    return `📖 *Command Reference*
━━━━━━━━━━━━━━━━━━━━━━

🔍 *Search*
• Price [Name] (Find anything)
  _Ex: Price DOGS, Price Gold_

🔔 *Alerts*
• Set [Asset] at [Price] 
• My alerts 
• Delete [ID] 

⚙️ *Account*
• Status 
• Subscribe
• Name [Your Name] (Set your display name)`;
  }

  // ==========================================
  // 💎 CRYPTO HANDLER (Updates to match Generic)
  // ==========================================
  async handleCryptoPrice(args, phoneNumber, database, priceService) {
    // Re-use Generic Logic for consistency
    return this.handleGenericPrice(args, phoneNumber, database, priceService);
  }

  // ==========================================
  // 💱 FOREX HANDLER
  // ==========================================
  async handleForexPrice(args, phoneNumber, database, priceService) {
    if (args.length === 0)
      return '⚠️ *Format:* Forex [Pair]\nExample: "Forex EURUSD"';
    const pair = args[0].toUpperCase();

    try {
      const currentPrice = await priceService.getForexPrice(pair);
      if (currentPrice === null)
        return `❌ *Pair Not Found*\nWe could not find "${pair}".`;

      const formattedPrice = priceService.formatPrice(currentPrice, pair);

      return `💱 *Foreign Exchange*
━━━━━━━━━━━━━━━━━━━━━━
💱 *Pair:* ${pair}
📉 *Rate:* ${formattedPrice}
━━━━━━━━━━━━━━━━━━━━━━
💡 *Action:* "Set ${pair} at [rate]"`;
    } catch (error) {
      return `⚠️ *Data Error*\nUnable to fetch forex data.`;
    }
  }

  // ==========================================
  // 🔔 ALERTS (UPDATED FOR USER-FRIENDLY IDs)
  // ==========================================\n
  async handleSetAlert(args, phoneNumber, database, priceService) {
    if (args.length < 2) return `⚠️ *Invalid Format*\nUse: "Set BTC at 65000"`;

    const asset = args[0].toUpperCase();
    let targetPrice = null;
    let directionWord = "at";
    const directionIndex = args.findIndex((arg) => ["above", "below", "at"].includes(arg.toLowerCase()));

    const priceStr = args.find((arg) => /^[\d,]+(\.\d+)?(k)?$/i.test(arg) && arg.toUpperCase() !== asset);
    if (priceStr) targetPrice = priceStr;

    if (!targetPrice) return `⚠️ *Missing Price*\nExample: "Set BTC at 65000"`;

    let cleanPrice = targetPrice.replace(/,/g, "");
    let parsedPrice = parseFloat(cleanPrice);
    if (targetPrice.toLowerCase().endsWith("k")) parsedPrice = parseFloat(cleanPrice) * 1000;

    const currentPrice = await priceService.getPrice(asset);
    if (currentPrice === null) return `❌ *Asset Not Found*\n"${asset}" is not supported.`;

    let condition = "";
    if (directionIndex !== -1) directionWord = args[directionIndex].toLowerCase();
    if (directionWord === "above") condition = "above";
    else if (directionWord === "below") condition = "below";
    else condition = parsedPrice > currentPrice ? "above" : "below";

    try {
      let user = await database.getUserByPhoneNumber(phoneNumber);
      if (!user) user = await database.createUser(phoneNumber, phoneNumber);

      // Check for existing alert for this asset
      const existingAlerts = await database.getUserAlerts(phoneNumber);
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

      // Get current count before adding (to show user which number this is)
      const newAlertNumber = existingAlerts.length + 1;

      const alert = await database.createAlert(phoneNumber, asset, parsedPrice, condition);
      const formattedTarget = priceService.formatPrice(parsedPrice, asset);
      const formattedCurrent = priceService.formatPrice(currentPrice, asset);
      const arrow = condition === "above" ? "📈" : "📉";

      return `✅ *Alert Set Successfully*
━━━━━━━━━━━━━━━━━━━━━━
📦 *Asset:* ${asset}
🎯 *Target:* ${formattedTarget}
${arrow} *Condition:* Price goes ${condition.toUpperCase()}
📊 *Current:* ${formattedCurrent}
━━━━━━━━━━━━━━━━━━━━━━
#️⃣ *List Number:* ${newAlertNumber}
💡 Type "My alerts" to see your list.`;
    } catch (error) {
      console.error(error);
      return `⚠️ *Database Error*`;
    }
  }

  async handleMyAlerts(args, phoneNumber, database, priceService) {
    // Fetch active alerts from DB using phone number (MongoDB method signature)
    const alerts = await database.getUserAlerts(phoneNumber);
    
    if (alerts.length === 0)
      return `📂 *No Active Alerts*\n\nStart tracking: "Set BTC at 90000"`;

    let message = `📋 *Your Active Alerts (${alerts.length})*\n━━━━━━━━━━━━━━━━━━━━━━\n`;

    // 🟢 UPDATE: Use Loop Index (i + 1) instead of alert.id
    alerts.forEach((alert, index) => {
      const formattedTarget = priceService.formatPrice(alert.targetPrice, alert.asset);
      const icon = alert.direction === "above" ? "📈" : "📉";
      
      // Shows: "1. BTC 📈 $90,000"
      message += `*${index + 1}.* ${alert.asset} ${icon} ${formattedTarget}\n`;
    });

    message += `━━━━━━━━━━━━━━━━━━━━━━\n🗑️ *Remove:* "Delete [Number]"\nExample: "Delete 1" to remove the first alert.`;
    return message;
  }

  async handleDeleteAlert(args, phoneNumber, database, priceService) {
    if (args.length === 0) return "⚠️ *Format:* `Delete [Number]`\nExample: Delete 1";
    
    // User enters "1", "2", etc.
    const userIndex = parseInt(args[0]);
    if (isNaN(userIndex) || userIndex < 1) return "⚠️ Please provide a valid alert number from your list.";

    // 1. Get ALL alerts for this user using phone number
    const userAlerts = await database.getUserAlerts(phoneNumber);

    // 2. Find the alert at the specific index (User says 1, Array is 0)
    const targetAlert = userAlerts[userIndex - 1];

    if (!targetAlert) {
        return `❌ *Alert #${userIndex} not found.*\nYou only have ${userAlerts.length} active alerts.`;
    }

    // 3. Delete using the MongoDB deleteAlert method (only needs alert ID)
    const result = await database.deleteAlert(targetAlert.id);
    
    if (!result) return `❌ System Error: Could not delete alert.`;

    return `🗑️ *Alert Deleted*
Removed: ${targetAlert.asset} (Alert #${userIndex})`;
  }

  async handleClearAlerts(args, phoneNumber, database, priceService) {
    const userAlerts = await database.getUserAlerts(phoneNumber);
    for (const alert of userAlerts)
      await database.deleteAlert(alert.id);
    return `🗑️ *Cleared All Alerts*`;
  }

  async handleDeleteAllAlerts(args, phoneNumber, database, priceService) {
    return this.handleClearAlerts(args, phoneNumber, database, priceService);
  }

  async handleStatus(args, phoneNumber, database, priceService) {
    const user = await database.getUserByPhoneNumber(phoneNumber);
    if (!user) return '👋 Send "Price BTC" to start.';
    const alerts = await database.getUserAlerts(user.id);
    return `📊 *Status*: ${(user.subscription_type || 'free').toUpperCase()} | Active Alerts: ${alerts.length}`;
  }

  async handleSubscribe(args, phoneNumber, database, priceService) {
    return `⭐ *Premium Upgrade*\nContact @YourUsername for $20/month unlimited access.`;
  }

  async handleSetName(args, phoneNumber, database, priceService) {
    if (args.length === 0) {
      return `⚠️ *Format:* Name [Your Name]
Example: "Name John Doe"`;
    }

    const newName = args.join(" ").trim();
    if (newName.length < 2 || newName.length > 50) {
      return `⚠️ *Name must be 2-50 characters long*`;
    }

    try {
      const success = await database.updateUserName(phoneNumber, newName);
      if (success) {
        return `✅ *Name Updated Successfully!*
━━━━━━━━━━━━━━━━━━━━━━
👋 Hello, *${newName}*!

Your name has been set. I'll use it for personalized messages.

💡 *Try:* "Hi" to see your personalized welcome!`;
      } else {
        return `❌ *Failed to update name*\nPlease try again.`;
      }
    } catch (error) {
      console.error('Error updating user name:', error);
      return `⚠️ *System Error*\nCould not update name.`;
    }
  }
}

module.exports = CommandParser;
