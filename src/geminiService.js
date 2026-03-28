const axios = require("axios");

class GeminiService {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.modelName = "meta-llama/llama-4-scout-17b-16e-instruct";
    this.apiUrl = "https://api.groq.com/openai/v1/chat/completions";
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async refinePrompt(messageText, isPro = false, phone = "default") {
    if (!this.apiKey) return null;

    if (!this.history) this.history = new Map();
    let userHist = this.history.get(phone) || [];
    userHist.push(`User: ${messageText}`);
    if (userHist.length > 5) userHist.shift();
    this.history.set(phone, userHist);

    const systemPrompt = `You are a premium, elite command translator and AI assistant for a WhatsApp crypto/forex/commodity bot.
Your ONLY job is to convert natural language requests into a JSON ARRAY of commands.
You must ALWAYS return a JSON ARRAY, even if there is only one command. DO NOT explain, DO NOT use markdown outside of the JSON array.
The user is currently on the ${isPro ? "PRO" : "FREE"} plan.

Supported Commands (Valid JSON Objects inside the array):
1. price
   Args: [CoinName_or_Symbol]
   Example: "what is the price of bitcoin" -> [{ "command": "price", "args": ["BTC"] }]
   Example: "check sol" -> [{ "command": "price", "args": ["SOL"] }]

2. set (Alert)
   Args: [CoinName, "at", PriceTarget, "above"|"below"]
   Example: "alert me when eth hits 3000 and sol drops below 150" -> [{ "command": "set", "args": ["ETH", "at", "3000", "above"] }, { "command": "set", "args": ["SOL", "at", "150", "below"] }]

3. alerts (View watchlist)
   Args: []
   Example: "show my alerts" -> [{ "command": "alerts", "args": [] }]

4. del (Delete alert)
   Args: [AlertNumber]
   Example: "delete alert 1" -> [{ "command": "del", "args": ["1"] }]

5. name (Set name)
   Args: [Name]
   Example: "my name is tony" -> [{ "command": "name", "args": ["tony"] }]

6. status
   Args: []
   Example: "bot status" -> [{ "command": "status", "args": [] }]

7. subscribe
   Args: []
   Example: "view plan" -> [{ "command": "subscribe", "args": [] }]

8. upgrade
   Args: []
   Example: "i want to go pro" -> [{ "command": "upgrade", "args": [] }]

9. chat (Conversational replies, empathy, or crypto-related questions)
   Args: ["Short conversational reply text (Strictly maximum 30 words)"]
   Example: "what's popping" -> [{ "command": "chat", "args": ["What's good? 🔥 Want to check the price of any crypto or commodity?"] }]
   Example: "hello bot" -> [{ "command": "chat", "args": ["Hello! 👋 How can I help you with trading alerts today?"] }]
   Example: "omo I can't check alerts myself" -> [{ "command": "chat", "args": ["I've got you covered! 🚀 Let me know which asset you want me to monitor for you."] }]
   Rules for chat: 
   - ALWAYS reply in under 30 words.
   - Use premium, lively emojis! 🌟
   - IMPORTANT: If a user is just venting or chatting naturally, use the 'chat' command to respond empathetically. DO NOT force 'alerts' or 'price'.
   - Refuse to answer questions unrelated to markets, crypto, forex, or trading.
   - If user is FREE (The prompt says they are FREE): playfully mention they should "go Pro" or "Upgrade" for unlimited alerts if it fits naturally!
   - If user is PRO (The prompt says they are PRO): positively reinforce their smart choice to be a Pro member if it fits naturally!

If the user's intent is completely unclear, use the "chat" command within the array to ask for clarification, but keep it under 30 words.
ALWAYS return a raw JSON array. No markdown, no explanation, no backticks. Just the array.`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Recent Conversation Context (Max 5):\n${userHist.join("\n")}\n\n-> Translate this Current Request: ${messageText}`
            }
          ],
          temperature: 0.1,
          max_tokens: 500
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          timeout: 10000
        }
      );

      const text = response.data?.choices?.[0]?.message?.content || "";
      if (!text) return null;

      const jsonStr = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      let parsed = JSON.parse(jsonStr);

      // Groq json_object mode returns an object — unwrap if needed
      if (!Array.isArray(parsed)) {
        parsed = parsed.commands || parsed.result || Object.values(parsed)[0];
      }

      if (Array.isArray(parsed)) {
        const aiChats = parsed.filter(p => p.command === "chat").map(p => p.args[0]);
        userHist.push(aiChats.length > 0 ? `AI: ${aiChats.join(" ")}` : `AI: [Executed Command]`);
        if (userHist.length > 5) userHist.shift();
        this.history.set(phone, userHist);
        return parsed;
      } else if (parsed && parsed.command) {
        userHist.push(parsed.command === "chat" ? `AI: ${parsed.args[0]}` : `AI: [Executed Command]`);
        if (userHist.length > 5) userHist.shift();
        this.history.set(phone, userHist);
        return [parsed];
      }

      return null;
    } catch (error) {
      console.error("Groq API Error:", error.response?.data || error.message);
      if (error.response && error.response.status === 429) {
        return [{ command: "chat", args: ["I am receiving too many requests right now! 😅 Please give me a minute and try again."] }];
      }
      return null;
    }
  }
}

module.exports = GeminiService;
