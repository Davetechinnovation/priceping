require("dotenv").config();
const MongoDBManager = require("./src/mongoDBManager"); // MongoDB database
const BaileysWhatsAppService = require("./src/baileysWhatsAppService"); // Your file
const CommandParser = require("./src/commandParser"); // Updated below
const PriceService = require("./src/priceService"); // Updated below

// Services
const db = new MongoDBManager();
const whatsapp = new BaileysWhatsAppService(db); // Pass database to WhatsApp service
const priceService = new PriceService();
const parser = new CommandParser();

// 🧠 STATE MEMORY (The "Press 1" Logic)
// Stores: { "phone_number": { type: "SELECT_CHAIN_PRICE", data: [...] } }
const userState = new Map();

async function start() {
  try {
    await db.connect();
    
    // Initialize WhatsApp
    await whatsapp.initialize();

    // 📨 MESSAGE HANDLER
    whatsapp.registerMessageHandler("main", async (text, jid, pushName) => {
      const cleanPhone = jid.replace(/\D/g, "");

      // 1️⃣ CHECK IF USER IS IN A MENU STATE (Replying 1, 2, etc.)
      if (userState.has(cleanPhone)) {
        const state = userState.get(cleanPhone);
        const selection = parseInt(text.trim());

        if (!isNaN(selection) && selection > 0 && selection <= state.options.length) {
          // User picked a valid number
          const selectedOption = state.options[selection - 1]; // 0-indexed
          
          // CLEAR STATE
          userState.delete(cleanPhone);

          // ROUTE BASED ON STATE TYPE
          if (state.type === 'SELECT_CHAIN_PRICE') {
              // User selected a chain to VIEW PRICE
              const cmd = `Price ${state.symbol} ${selectedOption.blockchain}`;
              return await parser.handleCommand(cmd, jid, db, priceService, pushName, userState);
          } 
          
          else if (state.type === 'SELECT_CHAIN_ALERT') {
              // User selected a chain to SET ALERT
              // We reconstruct the command: "Set [Symbol] [Chain] at [Price]"
              const cmd = `Set ${state.symbol} ${selectedOption.blockchain} at ${state.targetPrice} ${state.direction || 'at'}`;
              return await parser.handleCommand(cmd, jid, db, priceService, pushName, userState);
          }
        } else if (state) {
          // User typed text instead of a number, cancel the menu and proceed as normal command
          userState.delete(cleanPhone);
        }
      }

      // 2️⃣ NORMAL COMMAND PROCESSING
      // Note: We pass 'userState' so Parser can SET a state if needed
      return await parser.handleCommand(text, jid, db, priceService, pushName, userState);
    });

    console.log('🎉 PricePing Terminal started successfully!');
    
  } catch (error) {
    console.error('❌ Failed to start PricePing Terminal:', error.message);
    console.log('🔄 Retrying startup in 10 seconds...');
    setTimeout(() => start(), 10000);
  }
}

start();
