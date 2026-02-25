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
      upgrade: this.handleUpgradePro.bind(this),
    };
    
    
    this.adminNumber = "2349160766236";
  }

  // ==========================================
  // 🛠️ UTILITIES
  // ==========================================

  extractPhone(jid) {
    if (!jid) return "";
    let number = jid.split('@')[0];
    number = number.split(':')[0];
    return number;
  }

  formatPhone(number) {
    if (!number) return "Unknown";
    if (number.startsWith('+')) return number;
    return `+${number}`;
  }

  getDisplayName(user, pushName) {
    return user?.name || pushName || "Trader";
  }

  getReadMore() {
    return String.fromCharCode(8206).repeat(4001);
  }

  getHeader(title) {
    return `╔══════════════════════════╗
║ 🚀 *${title}*
╚══════════════════════════╝`;
  }

  getUsageBar(used, limit) {
    if (limit >= 999) return "♾️ Unlimited (Pro)";
    const filled = Math.min(used, limit);
    const bar = "█".repeat(filled) + "░".repeat(limit - filled);
    return `${bar} ${used}/${limit}`;
  }

  // ==========================================
  // 🛡️ SMART ADMIN LINK GENERATOR
  // ==========================================
  getAdminLink(phoneNumber, displayName) {
    let displayPhone = this.formatPhone(phoneNumber);

    // 🛑 DETECT LID (Internal ID)
    // If the number is too long (15+ digits), it's not a real phone number.
    // It is a WhatsApp Device ID. We shouldn't show it.
    if (phoneNumber.length > 14) {
        displayPhone = "[Enter Your Number]";
    }

    const msg = encodeURIComponent(
      `Hi, my name is ${displayName}. I would like to upgrade to PricePing Pro.\n\nMy number: ${displayPhone}`
    );
    return `wa.me/${this.adminNumber}?text=${msg}`;
  }

  parseMessage(message) {
    const text = message.toLowerCase().trim();
    
    if (text.startsWith("upgrade")) {
      return { command: "upgrade", args: text.split(/\s+/).slice(1) };
    }
    
    const words = text.split(/\s+/);
    return { command: words[0], args: words.slice(1) };
  }

  // ==========================================
  // 🎯 MAIN HANDLER
  // ==========================================
  async handleCommand(message, jid, db, priceService, pushName, userState) {
    const { command, args } = this.parseMessage(message);
    const cleanPhone = this.extractPhone(jid);

    let user = await db.getUserByPhoneNumber(cleanPhone);
    if (!user) {
      user = await db.createUser(cleanPhone, cleanPhone, null);
    }

    const handler = this.commands[command];
    if (!handler) {
        if(["hey", "bot", "test"].includes(command)) return this.handleGreeting([], cleanPhone, db, priceService, pushName);
        return this.handleUnknownCommand(command, args);
    }

    try {
      return await handler(args, cleanPhone, db, priceService, pushName, userState);
    } catch (error) {
      console.error(error);
      return "⚠️ *System Error*: Something went wrong. Try again!";
    }
  }

  // ==========================================
  // ❌ UNKNOWN COMMAND
  // ==========================================
  handleUnknownCommand(command, args) {
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
• Subscribe
• Help`;
      } else {
          return `🤔 *Unknown Command: "${command}"*

🎯 *Try these commands:*
━━━━━━━━━━━━━━━━━
🔎 *Price [asset]* - Check prices
🔔 *Set [asset] at [price]* - Create alerts
📋 *My alerts* - View watchlist
📧 *Subscribe* - View plan & limits
❓ *Help* - All commands`;
      }
  }

  getSuggestions(command) {
      const availableCommands = Object.keys(this.commands);
      const suggestions = [];
      
      availableCommands.forEach(cmd => {
          if (cmd.includes(command) || command.includes(cmd)) {
              suggestions.push(cmd);
          }
      });
      
      const commonTypos = {
          'pric': 'price', 'prices': 'price',
          'alert': 'alerts', 'alret': 'alerts',
          'remove': 'del', 'stat': 'status',
          'subscription': 'subscribe', 'sub': 'subscribe',
          'pro': 'upgrade'
      };
      
      if (commonTypos[command]) suggestions.push(commonTypos[command]);
      
      return [...new Set(suggestions)].slice(0, 3);
  }

  // ==========================================
  // 🟢 GREETING
  // ==========================================
  async handleGreeting(args, phoneNumber, db, priceService, pushName) {
    const user = await db.getUserByPhoneNumber(phoneNumber);
    const name = this.getDisplayName(user, pushName);
    const usage = await db.getAlertUsage(phoneNumber);

    return `${this.getHeader("PricePing Terminal")}

👋 *Hi, ${name}!*
I'm ready to track markets for you.

📊 *Your Alert Quota:*
${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Pro Plan - Unlimited alerts!" : `⏰ Resets in: ${usage.resetIn}`}

🎯 *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━
🔎 *Check Price:* 
   Type \`Price BTC\` or \`Price Gold\` 
   
🔔 *Set Alert:*
   Type \`Set ETH at 3500\` 

📋 *My Dashboard:*
   Type \`My Alerts\` 

${usage.isPro ? "" : "🚀 Want unlimited alerts? Type *Subscribe*\n"}
💡 *Tip:* _I support Crypto, Forex, and Commodities!_`;
  }

  // ==========================================
  // 🔎 PRICE CHECKER
  // ==========================================
  async handleGenericPrice(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length === 0) return "⚠️ *Usage:* `Price [CoinName]` (e.g., Price SOL)";

    const input = args.join(" ");
    const info = await priceService.getAssetInfo(input);

    if (!info) {
        return `❌ *Not Found*\n\nI searched high and low for *"${input.toUpperCase()}"* but couldn't find it.\n\n💡 *Try:* \`Price BTC\` or \`Price Gold\``;
    }

    let icon = "💎";
    let label = "Crypto Asset";
    
    if (info.blockchain === 'Commodities') { icon = "🏆"; label = "Commodity"; }
    else if (info.blockchain === 'Forex Market') { icon = "💱"; label = "Foreign Exchange"; }

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

    if (info.others && info.others.length > 0) {
        userState.set(phoneNumber, {
            type: 'SELECT_CHAIN_PRICE',
            symbol: info.symbol,
            options: info.others
        });

        response += this.getReadMore();
        response += `\n\n📋 *Wait! I found other versions:*`;
        response += `\n_Reply with a number to check specific price:_\n`;

        info.others.slice(0, 10).forEach((opt, i) => {
            response += `\n*${i + 1}.* ${opt.blockchain} Chain`;
        });
    }

    return response;
  }

  // ==========================================
  // 🔔 SET ALERT
  // ==========================================
  async handleSetAlert(args, phoneNumber, db, priceService, pushName, userState) {
    if (args.length < 2) return "⚠️ *Usage:* `Set [Coin] at [Price]`\nExample: `Set SOL at 150`";

    const asset = args[0].toUpperCase();
    
    let targetPrice = null;
    let direction = null;

    if(args.includes("below")) direction = "below";
    if(args.includes("above")) direction = "above";

    const priceArg = args.find(a => /^\d+(\.\d+)?$/.test(a.replace(/,/g, '')));
    if(priceArg) targetPrice = parseFloat(priceArg.replace(/,/g, ''));

    if(!targetPrice) return "⚠️ I need a target price! Example: `Set BTC at 65000`";

    const usage = await db.getAlertUsage(phoneNumber);
    
    if (!usage.isPro && usage.remaining <= 0) {
        return `🚫 *Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
📊 *Used:* ${this.getUsageBar(usage.used, usage.limit)}
⏰ *Resets in:* ${usage.resetIn}

You've used all *${usage.limit} free alerts* for this 12-hour period.

🚀 *Want unlimited alerts?*
━━━━━━━━━━━━━━━━━
Type *Subscribe* to see Pro benefits
or *Upgrade* to get started now!

💡 _Your limit resets automatically in ${usage.resetIn}_`;
    }

    const info = await priceService.getAssetInfo(asset);

    if (info && info.others && info.others.length > 0 && args.length < 4) {
        const optionsToDisplay = [
            { blockchain: info.blockchain, price: info.price },
            ...info.others.slice(0, 5)
        ];

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
        optionsToDisplay.forEach((opt, i) => {
            menu += `\n*${i+1}.* ${opt.blockchain}`;
        });

        menu += `\n\n👇 *Reply with number (e.g., 1 or 2)*`;
        return menu;
    }

    const currentPrice = info ? info.price : null;
    if (currentPrice === null) return `❌ I couldn't find a price for ${asset}.`;

    if (!direction) {
        direction = targetPrice > currentPrice ? "above" : "below";
    }

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

    const slotResult = await db.useAlertSlot(phoneNumber);
    
    if (!slotResult.allowed) {
        return `🚫 *Alert Limit Reached!*
━━━━━━━━━━━━━━━━━
📊 *Used:* ${this.getUsageBar(slotResult.usage.used, slotResult.usage.limit)}
⏰ *Resets in:* ${slotResult.usage.resetIn}

Type *Subscribe* for unlimited alerts!`;
    }

    await db.createAlert(phoneNumber, asset, targetPrice, direction);

    const u = slotResult.usage;

    return `✅ *Alert Activated!*
━━━━━━━━━━━━━━━━━
🔔 *Asset:* ${asset}
📉 *Target:* ${priceService.formatPrice(targetPrice, asset)}
📊 *Current:* ${priceService.formatPrice(currentPrice, asset)}
🎯 *Condition:* When price goes *${direction.toUpperCase()}*
━━━━━━━━━━━━━━━━━
📊 *Alerts:* ${this.getUsageBar(u.used, u.limit)}
${u.isPro ? "👑 Pro Plan" : `⏰ Resets in: ${u.resetIn}`}
━━━━━━━━━━━━━━━━━
_I'll message you the moment it hits!_`;
  }

  // ==========================================
  // 📋 MY ALERTS
  // ==========================================
  async handleMyAlerts(args, phoneNumber, db, priceService) {
    const alerts = await db.getUserAlerts(phoneNumber);
    const usage = await db.getAlertUsage(phoneNumber);
    
    if (alerts.length === 0) {
        return `📂 *Your watchlist is empty.*

📊 *Alert Quota:* ${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Pro Plan" : `⏰ Resets in: ${usage.resetIn}`}

Try: \`Set BTC at 70000\``;
    }

    let msg = `${this.getHeader("Your Watchlist")}\n`;
    
    alerts.forEach((a, i) => {
        const icon = a.direction === 'above' ? '📈' : '📉';
        msg += `\n*${i+1}.* ${a.asset} ${icon} ${priceService.formatPrice(a.targetPrice, a.asset)}`;
    });

    msg += `\n\n━━━━━━━━━━━━━━━━━`;
    msg += `\n📊 *Quota:* ${this.getUsageBar(usage.used, usage.limit)}`;
    msg += usage.isPro ? "\n👑 Pro Plan" : `\n⏰ Resets in: ${usage.resetIn}`;
    msg += `\n\n🗑️ *To Delete:* Reply \`Delete 1\``;
    return msg;
  }

  // ==========================================
  // ❓ HELP
  // ==========================================
  async handleHelp(args, phoneNumber, db) {
      const usage = await db.getAlertUsage(phoneNumber);
      
      return `❓ *PricePing Help*
━━━━━━━━━━━━━━━━━

1️⃣ *Check Prices*
   "Price XRP"
   "Price Gold"

2️⃣ *Set Alerts* (${usage.remaining} left)
   "Set SOL at 200"
   "Set EURUSD at 1.05"

3️⃣ *Manage Alerts*
   "My alerts" - View list
   "Delete 1" - Remove alert

4️⃣ *Account*
   "Name Tony Stark" - Set name
   "Status" - Bot info
   "Subscribe" - View plan
   "Upgrade" - Go Pro

━━━━━━━━━━━━━━━━━
📊 *Your Quota:* ${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Unlimited" : `⏰ Resets every 12 hours (${usage.resetIn} left)`}`;
  }
  
  // ==========================================
  // 🗑️ DELETE ALERT
  // ==========================================
  async handleDeleteAlert(args, phoneNumber, db) {
      if(!args[0]) return "⚠️ Which one? Usage: `Delete 1`";
      const index = parseInt(args[0]) - 1;
      const alerts = await db.getUserAlerts(phoneNumber);
      if(!alerts[index]) return "❌ Alert number not found.";
      
      await db.deleteAlert(alerts[index].id);
      return `🗑️ *Deleted:* Alert for ${alerts[index].asset}\n\n💡 _Note: Deleting an alert does not refund your quota._`;
  }
  
  // ==========================================
  // ✏️ SET NAME
  // ==========================================
  async handleSetName(args, phoneNumber, db) {
      const name = args.join(" ");
      if(!name) return "⚠️ Usage: `Name Tony Stark`";
      await db.updateUserName(phoneNumber, name);
      return `✅ Nice to meet you, *${name}*!\n\n💡 _This name will be used everywhere including admin messages._`;
  }

  // ==========================================
  // 📊 STATUS
  // ==========================================
  async handleStatus(args, phoneNumber, db, priceService, pushName) {
      try {
          const user = await db.getUserByPhoneNumber(phoneNumber);
          const alerts = await db.getUserAlerts(phoneNumber);
          const usage = await db.getAlertUsage(phoneNumber);
          const activeAlerts = alerts.filter(a => a.status === 'active');
          const name = this.getDisplayName(user, pushName);
          
          const uptime = process.uptime();
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          
          return `${this.getHeader("System Status")}

👤 *User:* ${name}
📱 *Phone:* ${this.formatPhone(phoneNumber)}
🤖 *Bot Status:* Online ✅
⏰ *Uptime:* ${hours}h ${minutes}m
📊 *Your Alerts:* ${activeAlerts.length} active
💾 *Database:* Connected
🌐 *Markets:* Crypto, Forex, Commodities

━━━━━━━━━━━━━━━━━
📊 *Alert Quota:*
${this.getUsageBar(usage.used, usage.limit)}
${usage.isPro ? "👑 Pro Plan - Unlimited!" : `🆓 Free Plan - ${usage.remaining} remaining\n⏰ Resets in: ${usage.resetIn}`}

━━━━━━━━━━━━━━━━━
${usage.isPro ? "" : "🚀 Type *Subscribe* for unlimited alerts!"}`;
      } catch (error) {
          console.error("Status command error:", error);
          return "⚠️ *System Error*: Couldn't fetch status right now.";
      }
  }

  // ==========================================
  // 📧 SUBSCRIBE
  // ==========================================
  async handleSubscribe(args, phoneNumber, db, priceService, pushName) {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      const usage = await db.getAlertUsage(phoneNumber);
      const alerts = await db.getUserAlerts(phoneNumber);
      const name = this.getDisplayName(user, pushName);
      
      if (usage.isPro) {
          return `${this.getHeader("Your Subscription")}

👑 *You're on the Pro Plan!*

📊 *Current Usage:*
• Active Alerts: ${alerts.length}
• Alerts Used: ${usage.used} (Unlimited)
• Plan: ⭐ Pro

_Thank you for being a Pro member, ${name}!_
📱 Need help? Message admin:
wa.me/${this.adminNumber}`;
      }
      
      return `${this.getHeader("Your Plan")}

👋 *Hi ${name}!*

📊 *Current Usage:*
━━━━━━━━━━━━━━━━━
• Active Alerts: ${alerts.length}
• Alerts Used: ${this.getUsageBar(usage.used, usage.limit)}
• Plan: 🆓 Free Tier
• Resets in: ${usage.resetIn}

🆓 *Free Plan Includes:*
━━━━━━━━━━━━━━━━━
✅ 3 alerts every 12 hours
✅ Price checking (unlimited)
✅ Crypto, Forex, Commodities
❌ No priority notifications
❌ Limited alert slots

👑 *Want MORE?*
━━━━━━━━━━━━━━━━━
Type *Upgrade* to see Pro benefits
and unlock unlimited alerts! 🚀`;
  }

  // ==========================================
  // 🚀 UPGRADE PRO
  // ==========================================
  async handleUpgradePro(args, phoneNumber, db, priceService, pushName) {
      const user = await db.getUserByPhoneNumber(phoneNumber);
      const usage = await db.getAlertUsage(phoneNumber);
      
      if (usage.isPro) {
          return `👑 *You're already on Pro!*\nEnjoy your unlimited alerts! 🎉`;
      }

      const name = this.getDisplayName(user, pushName);
      const link = this.getAdminLink(phoneNumber, name);

      return `${this.getHeader("🚀 Upgrade to Pro")}

👋 *Hi ${name}!*
Here's what you unlock with Pro:

🆓 *Free (Current):*
━━━━━━━━━━━━━━━━━
• 3 alerts per 12 hours
• Basic price checking
• Standard notifications

👑 *Pro Plan:*
━━━━━━━━━━━━━━━━━
✅ *Unlimited* alert slots
✅ *Unlimited* alert creation
✅ Priority notifications (faster!)
✅ Advanced market analytics
✅ Portfolio tracking
✅ Multi-asset alerts
✅ Priority support
✅ No cooldown period

💰 *Pricing:*
━━━━━━━━━━━━━━━━━
🥉 *Monthly:* ₦2,500/month
🥈 *Quarterly:* ₦6,000 (save 20%)
🥇 *Yearly:* ₦20,000 (save 33%)

🚀 *Ready? Tap to message Admin:*
━━━━━━━━━━━━━━━━━
📱 ${link}
━━━━━━━━━━━━━━━━━
🎁 Mention *PRICEPING50* for 10% off
your first month! 🔥`;
  }
}

module.exports = CommandParser;