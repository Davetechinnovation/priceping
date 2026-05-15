const axios = require("axios");

class PaystackService {
  constructor(db = null) {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
    this.apiBase = "https://api.paystack.co";
    this.db = db;
  }

  isConfigured() {
    return !!this.secretKey;
  }

  /**
   * Initialize a Paystack transaction for a Pro upgrade.
   * @param {string} phone - User's phone number (used as virtual email)
   * @param {number} amount - Amount in Naira (e.g. 2000 for ₦2,000)
   * @returns {{url: string, reference: string}}
   */
  async initializeTransaction(phone, amount = 2000) {
    if (!this.secretKey) throw new Error("PAYSTACK_SECRET_KEY not configured");
    
    const email = `${phone}@priceping.app`;
    const amountInKobo = amount * 100;
    // Base URL for the app (used for callback redirect after payment)
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    console.log(`🏦 [Paystack] Initializing transaction: ${phone} → ₦${amount}`);

    const response = await axios.post(
      `${this.apiBase}/transaction/initialize`,
      {
        email,
        amount: amountInKobo,
        metadata: { phone },
        callback_url: `${baseUrl}/payment/success`,
      },
      {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const { authorization_url, reference } = response.data.data;

    // Save pending payment to DB
    if (this.db) {
      try {
        await this.db.createPaymentRecord(phone, reference, amount);
      } catch (e) {
        console.warn(`⚠️ [Paystack] Failed to save payment record: ${e.message}`);
      }
    }

    console.log(`✅ [Paystack] Transaction initialized: ref=${reference} url=${authorization_url}`);
    return { url: authorization_url, reference };
  }

  /**
   * Verify a transaction by reference.
   * @param {string} reference
   * @returns {object} Transaction data from Paystack
   */
  async verifyTransaction(reference) {
    if (!this.secretKey) throw new Error("PAYSTACK_SECRET_KEY not configured");

    console.log(`🔍 [Paystack] Verifying transaction: ${reference}`);

    const response = await axios.get(
      `${this.apiBase}/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        timeout: 10000,
      }
    );

    return response.data.data;
  }

  /**
   * Verify Paystack webhook signature.
   * @param {string} body - Raw request body
   * @param {string} signature - x-paystack-signature header
   * @returns {boolean}
   */
  verifyWebhookSignature(body, signature) {
    if (!this.secretKey) return false;
    const crypto = require("crypto");
    const hash = crypto
      .createHmac("sha512", this.secretKey)
      .update(body)
      .digest("hex");
    return hash === signature;
  }
}

module.exports = PaystackService;
