const { MongoClient, ObjectId } = require("mongodb");

class MongoDBManager {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const uri = process.env.MONGODB_URI;
      if (!uri) {
        throw new Error("MONGODB_URI environment variable is required");
      }

      this.client = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        w: "majority",
      });

      await this.client.connect();
      this.db = this.client.db();
      this.isConnected = true;

      console.log("✅ Connected to MongoDB database");
      await this.createIndexes();
    } catch (error) {
      console.error("❌ MongoDB connection error:", error.message);
      // 🛠️ FIX: Don't self-retry here. Let start-render.js handle it.
      throw error;
    }
  }

  async createIndexes() {
    try {
      await this.db
        .collection("users")
        .createIndex({ phone_number: 1 }, { unique: true });
      await this.db.collection("users").createIndex({ whatsapp_number: 1 });
      await this.db.collection("alerts").createIndex({ user_id: 1 });
      await this.db.collection("alerts").createIndex({ asset: 1 });
      await this.db.collection("alerts").createIndex({ status: 1 });
      await this.db.collection("alerts").createIndex({ created_at: 1 });
      await this.db.collection("priceHistory").createIndex({ asset: 1 });
      await this.db.collection("priceHistory").createIndex({ timestamp: 1 });

      console.log("✅ Database indexes created");
    } catch (error) {
      console.error("❌ Error creating indexes:", error);
    }
  }

  // ==========================================
  // 👤 USER OPERATIONS
  // ==========================================

  async createUser(phoneNumber, whatsappNumber, name = null) {
    try {
      const user = {
        phone_number: phoneNumber,
        whatsapp_number: whatsappNumber,
        name: name,
        subscription_type: "free",
        subscription_start_date: null,
        subscription_end_date: null,
        // 🟢 ALERT LIMIT FIELDS
        alerts_used_this_period: 0,
        last_alert_reset: new Date(), // Timestamp of last reset
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = await this.db.collection("users").insertOne(user);
      return {
        id: result.insertedId.toString(),
        phone_number: phoneNumber,
        whatsapp_number: whatsappNumber,
        name,
        subscription_type: "free",
        alerts_used_this_period: 0,
        last_alert_reset: user.last_alert_reset,
      };
    } catch (error) {
      if (error.code === 11000) {
        return this.getUserByPhoneNumber(phoneNumber);
      }
      throw error;
    }
  }

  async getUserByPhoneNumber(phoneNumber) {
    try {
      const user = await this.db.collection("users").findOne({
        $or: [{ phone_number: phoneNumber }, { whatsapp_number: phoneNumber }],
      });

      if (user) {
        user.id = user._id.toString();
        delete user._id;
      }

      return user;
    } catch (error) {
      throw error;
    }
  }

  async updateUserName(phoneNumber, name) {
    try {
      const result = await this.db
        .collection("users")
        .updateOne(
          { phone_number: phoneNumber },
          { $set: { name, updated_at: new Date() } },
        );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  async updateUserSubscription(
    phoneNumber,
    subscriptionType,
    startDate,
    endDate,
  ) {
    try {
      const result = await this.db.collection("users").updateOne(
        { phone_number: phoneNumber },
        {
          $set: {
            subscription_type: subscriptionType,
            subscription_start_date: startDate,
            subscription_end_date: endDate,
            updated_at: new Date(),
          },
        },
      );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  // ==========================================
  // 🔒 ALERT LIMIT SYSTEM (12-HOUR RESET)
  // ==========================================

  /**
   * Returns the user's current alert usage.
   * Auto-resets the counter if 12 hours have passed.
   *
   * Returns: { used, limit, remaining, nextReset, isPro }
   */
  async getAlertUsage(phoneNumber) {
    try {
      let user = await this.getUserByPhoneNumber(phoneNumber);
      if (!user) {
        user = await this.createUser(phoneNumber, phoneNumber);
      }

      const isPro = user.subscription_type === "pro";
      const limit = isPro ? 999 : 3; // Pro = unlimited (999), Free = 3

      // Check if 12 hours have passed since last reset
      const lastReset = user.last_alert_reset
        ? new Date(user.last_alert_reset)
        : new Date(0);
      const now = new Date();
      const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

      let used = user.alerts_used_this_period || 0;

      // 🔄 AUTO-RESET after 12 hours
      if (hoursSinceReset >= 12) {
        await this.db.collection("users").updateOne(
          { phone_number: phoneNumber },
          {
            $set: {
              alerts_used_this_period: 0,
              last_alert_reset: now,
              updated_at: now,
            },
          },
        );
        used = 0;
      }

      // Calculate next reset time
      const nextReset = new Date(lastReset.getTime() + 12 * 60 * 60 * 1000);
      const timeUntilReset = Math.max(0, nextReset - now);
      const hoursLeft = Math.floor(timeUntilReset / (1000 * 60 * 60));
      const minutesLeft = Math.floor(
        (timeUntilReset % (1000 * 60 * 60)) / (1000 * 60),
      );

      return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        nextReset,
        resetIn: `${hoursLeft}h ${minutesLeft}m`,
        isPro,
      };
    } catch (error) {
      console.error("❌ Error getting alert usage:", error);
      return {
        used: 0,
        limit: 3,
        remaining: 3,
        nextReset: new Date(),
        resetIn: "12h 0m",
        isPro: false,
      };
    }
  }

  /**
   * Try to use an alert slot.
   * Returns: { allowed: true/false, usage: {...} }
   */
  async useAlertSlot(phoneNumber) {
    try {
      const usage = await this.getAlertUsage(phoneNumber);

      // Pro users always allowed
      if (usage.isPro) {
        await this.db.collection("users").updateOne(
          { phone_number: phoneNumber },
          {
            $inc: { alerts_used_this_period: 1 },
            $set: { updated_at: new Date() },
          },
        );
        usage.used += 1;
        usage.remaining -= 1;
        return { allowed: true, usage };
      }

      // Free user: check limit
      if (usage.remaining <= 0) {
        return { allowed: false, usage };
      }

      // Increment count
      await this.db.collection("users").updateOne(
        { phone_number: phoneNumber },
        {
          $inc: { alerts_used_this_period: 1 },
          $set: { updated_at: new Date() },
        },
      );

      usage.used += 1;
      usage.remaining -= 1;
      return { allowed: true, usage };
    } catch (error) {
      console.error("❌ Error using alert slot:", error);
      return {
        allowed: false,
        usage: { used: 0, limit: 3, remaining: 0, resetIn: "?", isPro: false },
      };
    }
  }

  // Legacy methods (kept for compatibility)
  async resetDailyAlertCount(phoneNumber) {
    try {
      const result = await this.db.collection("users").updateOne(
        { phone_number: phoneNumber },
        {
          $set: {
            alerts_used_this_period: 0,
            last_alert_reset: new Date(),
            updated_at: new Date(),
          },
        },
      );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  async incrementAlertCount(phoneNumber) {
    try {
      const result = await this.db.collection("users").updateOne(
        { phone_number: phoneNumber },
        {
          $inc: { alerts_used_this_period: 1 },
          $set: { updated_at: new Date() },
        },
      );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  async incrementCommandCount(phoneNumber) {
    await this.db.collection("users").updateOne(
      { phone_number: phoneNumber },
      {
        $inc: { total_commands: 1 },
        $set: { last_active: new Date(), updated_at: new Date() },
      },
    );
  }

  // ==========================================
  // 🔔 ALERT OPERATIONS
  // ==========================================

  async createAlert(userId, asset, targetPrice, direction = "above") {
    try {
      let user = await this.getUserByPhoneNumber(userId);
      if (!user) {
        user = await this.createUser(userId, userId);
      }

      const alert = {
        user_id: user.id,
        asset: asset.toUpperCase(),
        target_price: parseFloat(targetPrice),
        direction: direction,
        status: "active",
        triggered_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = await this.db.collection("alerts").insertOne(alert);
      return {
        id: result.insertedId.toString(),
        userId: user.id,
        asset,
        targetPrice,
        direction,
      };
    } catch (error) {
      throw error;
    }
  }

  async getActiveAlerts() {
    try {
      const alerts = await this.db
        .collection("alerts")
        .find({
          status: "active",
        })
        .toArray();

      if (alerts.length === 0) return [];

      const userIds = [...new Set(alerts.map((a) => a.user_id))];

      const objectIds = [];
      const phoneNumbers = [];

      userIds.forEach((id) => {
        if (
          id &&
          typeof id === "string" &&
          id.length === 24 &&
          ObjectId.isValid(id)
        ) {
          objectIds.push(new ObjectId(id));
        } else if (id) {
          phoneNumbers.push(id);
        }
      });

      const userQuery = { $or: [] };
      if (objectIds.length > 0) {
        userQuery.$or.push({ _id: { $in: objectIds } });
      }
      if (phoneNumbers.length > 0) {
        userQuery.$or.push({ phone_number: { $in: phoneNumbers } });
        userQuery.$or.push({ whatsapp_number: { $in: phoneNumbers } });
      }

      let users = [];
      if (userQuery.$or.length > 0) {
        users = await this.db.collection("users").find(userQuery).toArray();
      }

      const userMap = {};
      users.forEach((u) => {
        userMap[u._id.toString()] = u;
        if (u.phone_number) userMap[u.phone_number] = u;
        if (u.whatsapp_number) userMap[u.whatsapp_number] = u;
      });

      return alerts.map((alert) => {
        const user = userMap[alert.user_id] || {};
        return {
          ...alert,
          id: alert._id.toString(),
          target_price: alert.target_price,
          phone_number: user.phone_number || null,
          whatsapp_number: user.whatsapp_number || null,
        };
      });
    } catch (error) {
      console.error("❌ Error in getActiveAlerts:", error);
      throw error;
    }
  }

  async getUserAlerts(phoneNumber) {
    try {
      const user = await this.getUserByPhoneNumber(phoneNumber);
      if (!user) return [];

      const alerts = await this.db
        .collection("alerts")
        .find({
          user_id: user.id,
          status: "active",
        })
        .toArray();

      return alerts.map((alert, index) => ({
        ...alert,
        id: alert._id.toString(),
        displayId: index + 1,
        targetPrice: alert.target_price,
        asset: alert.asset,
        direction: alert.direction,
        createdAt: alert.created_at,
      }));
    } catch (error) {
      throw error;
    }
  }

  async deleteAlert(alertId) {
    try {
      const result = await this.db
        .collection("alerts")
        .updateOne(
          { _id: new ObjectId(alertId) },
          { $set: { status: "deleted", updated_at: new Date() } },
        );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  async deleteAllUserAlerts(phoneNumber) {
    try {
      const user = await this.getUserByPhoneNumber(phoneNumber);
      if (!user) return false;

      const result = await this.db
        .collection("alerts")
        .updateMany(
          { user_id: user.id },
          { $set: { status: "deleted", updated_at: new Date() } },
        );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  async markAlertTriggered(alertId) {
    try {
      const result = await this.db
        .collection("alerts")
        .updateOne(
          { _id: new ObjectId(alertId) },
          {
            $set: {
              status: "triggered",
              triggered_at: new Date(),
              updated_at: new Date(),
            },
          },
        );
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  // ==========================================
  // 📈 PRICE HISTORY
  // ==========================================

  async addPriceHistory(asset, price) {
    try {
      const history = {
        asset: asset.toUpperCase(),
        price: parseFloat(price),
        timestamp: new Date(),
      };

      await this.db.collection("priceHistory").insertOne(history);

      await this.db.collection("priceHistory").deleteMany({
        asset: asset.toUpperCase(),
        timestamp: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });
    } catch (error) {
      throw error;
    }
  }

  async recordPrice(asset, price) {
    return this.addPriceHistory(asset, price);
  }

  async getLatestPrice(asset) {
    try {
      const latest = await this.db
        .collection("priceHistory")
        .find({ asset: asset.toUpperCase() })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();
      return latest.length > 0 ? latest[0].price : null;
    } catch (error) {
      throw error;
    }
  }

  // ==========================================
  // 🛠️ UTILITY
  // ==========================================

  async getAllUsers() {
    try {
      const users = await this.db.collection("users").find({}).toArray();
      return users.map((user) => ({
        ...user,
        id: user._id.toString(),
        phoneNumber: user.phone_number,
        whatsappNumber: user.whatsapp_number,
      }));
    } catch (error) {
      throw error;
    }
  }

  async getAllAlerts() {
    try {
      const alerts = await this.db.collection("alerts").find({}).toArray();
      return alerts.map((alert) => ({
        ...alert,
        id: alert._id.toString(),
        userId: alert.user_id,
        targetPrice: alert.target_price,
        asset: alert.asset,
        direction: alert.direction,
      }));
    } catch (error) {
      throw error;
    }
  }

  async fixOrphanedAlerts() {
    const alerts = await this.db
      .collection("alerts")
      .find({ status: "active" })
      .toArray();

    for (const alert of alerts) {
      const userId = alert.user_id;
      let user = null;

      if (userId && userId.length === 24 && ObjectId.isValid(userId)) {
        user = await this.db
          .collection("users")
          .findOne({ _id: new ObjectId(userId) });
      }

      if (!user) {
        user = await this.db.collection("users").findOne({
          $or: [{ phone_number: userId }, { whatsapp_number: userId }],
        });
      }

      if (!user) {
        await this.db
          .collection("alerts")
          .updateOne({ _id: alert._id }, { $set: { status: "deleted" } });
      } else if (userId !== user._id.toString()) {
        await this.db
          .collection("alerts")
          .updateOne(
            { _id: alert._id },
            { $set: { user_id: user._id.toString() } },
          );
      }
    }
  }

  // ==========================================
  // 📱 WHATSAPP SESSION STORAGE
  // ==========================================

  async getWhatsAppSession() {
    try {
      const session = await this.db
        .collection("whatsapp_sessions")
        .findOne({ session_id: "primary_session" });

      if (session && session.session_data) {
        console.log("📖 Retrieved existing WhatsApp session from MongoDB");
        return session.session_data;
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting WhatsApp session:", error);
      return null;
    }
  }

  async saveWhatsAppSession(sessionData) {
    try {
      if (!sessionData) return;

      await this.db
        .collection("whatsapp_sessions")
        .updateOne(
          { session_id: "primary_session" },
          { $set: { session_data: sessionData, updated_at: new Date() } },
          { upsert: true },
        );

      console.log("💾 WhatsApp session saved to MongoDB");
    } catch (error) {
      console.error("❌ Error saving WhatsApp session:", error);
      throw error;
    }
  }

  async clearWhatsAppSession() {
    try {
      await this.db
        .collection("whatsapp_sessions")
        .deleteOne({ session_id: "primary_session" });
      console.log("🗑️ WhatsApp session cleared from MongoDB");
    } catch (error) {
      console.error("❌ Error clearing WhatsApp session:", error);
      throw error;
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log("🔌 MongoDB connection closed");
    }
  }
}

module.exports = MongoDBManager;
