const { MongoClient, ObjectId } = require('mongodb');

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
                throw new Error('MONGODB_URI environment variable is required');
            }

            this.client = new MongoClient(uri, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 10000, // Increased timeout
                socketTimeoutMS: 45000,
                retryWrites: true,
                w: 'majority'
            });

            await this.client.connect();
            this.db = this.client.db();
            this.isConnected = true;
            
            console.log('✅ Connected to MongoDB database');
            await this.createIndexes();
            
        } catch (error) {
            console.error('❌ MongoDB connection error:', error.message);
            // Retry connection after 5 seconds
            console.log('🔄 Retrying MongoDB connection in 5 seconds...');
            setTimeout(() => this.connect(), 5000);
            throw error;
        }
    }

    async createIndexes() {
        try {
            // Users collection indexes
            await this.db.collection('users').createIndex({ phone_number: 1 }, { unique: true });
            await this.db.collection('users').createIndex({ whatsapp_number: 1 });
            
            // Alerts collection indexes
            await this.db.collection('alerts').createIndex({ user_id: 1 });
            await this.db.collection('alerts').createIndex({ asset: 1 });
            await this.db.collection('alerts').createIndex({ status: 1 });
            await this.db.collection('alerts').createIndex({ created_at: 1 });
            
            // Price history collection indexes
            await this.db.collection('priceHistory').createIndex({ asset: 1 });
            await this.db.collection('priceHistory').createIndex({ timestamp: 1 });
            
            console.log('✅ Database indexes created');
        } catch (error) {
            console.error('❌ Error creating indexes:', error);
        }
    }

    // User operations
    async createUser(phoneNumber, whatsappNumber, name = null) {
        try {
            const user = {
                phone_number: phoneNumber,
                whatsapp_number: whatsappNumber,
                name: name,
                subscription_type: 'free',
                subscription_start_date: null,
                subscription_end_date: null,
                alerts_used_today: 0,
                last_reset_date: null,
                created_at: new Date(),
                updated_at: new Date()
            };

            const result = await this.db.collection('users').insertOne(user);
            return { 
                id: result.insertedId.toString(), 
                phoneNumber, 
                whatsappNumber, 
                name 
            };
        } catch (error) {
            if (error.code === 11000) {
                // Duplicate key error - user already exists
                return this.getUserByPhoneNumber(phoneNumber);
            }
            throw error;
        }
    }

    async getUserByPhoneNumber(phoneNumber) {
        try {
            const user = await this.db.collection('users').findOne({
                $or: [
                    { phone_number: phoneNumber },
                    { whatsapp_number: phoneNumber }
                ]
            });
            
            if (user) {
                // Convert ObjectId to string for consistency
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
            const result = await this.db.collection('users').updateOne(
                { phone_number: phoneNumber },
                { 
                    $set: { 
                        name: name,
                        updated_at: new Date()
                    }
                }
            );
            
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    async updateUserSubscription(phoneNumber, subscriptionType, startDate, endDate) {
        try {
            const result = await this.db.collection('users').updateOne(
                { phone_number: phoneNumber },
                { 
                    $set: { 
                        subscription_type: subscriptionType,
                        subscription_start_date: startDate,
                        subscription_end_date: endDate,
                        updated_at: new Date()
                    }
                }
            );
            
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    async resetDailyAlertCount(phoneNumber) {
        try {
            const result = await this.db.collection('users').updateOne(
                { phone_number: phoneNumber },
                { 
                    $set: { 
                        alerts_used_today: 0,
                        last_reset_date: new Date().toISOString().split('T')[0],
                        updated_at: new Date()
                    }
                }
            );
            
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    async incrementAlertCount(phoneNumber) {
        try {
            const result = await this.db.collection('users').updateOne(
                { phone_number: phoneNumber },
                { 
                    $inc: { alerts_used_today: 1 },
                    $set: { updated_at: new Date() }
                }
            );
            
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    // Alert operations
    async createAlert(userId, asset, targetPrice, direction = 'above') {
        try {
            // Resolve phone number to user (like SQLite did)
            let user = await this.getUserByPhoneNumber(userId);
            
            if (!user) {
                user = await this.createUser(userId, userId);
            }
            
            const alert = {
                user_id: user.id,
                asset: asset.toUpperCase(),
                target_price: parseFloat(targetPrice),
                direction: direction,
                status: 'active',
                triggered_at: null,
                created_at: new Date(),
                updated_at: new Date()
            };

            const result = await this.db.collection('alerts').insertOne(alert);
            return { 
                id: result.insertedId.toString(),
                userId: user.id,
                asset,
                targetPrice,
                direction
            };
        } catch (error) {
            throw error;
        }
    }

    async getActiveAlerts() {
        try {
            const alerts = await this.db.collection('alerts').find({ 
                status: 'active' 
            }).toArray();
            
            if (alerts.length === 0) return [];
            
            // Separate user_ids into ObjectIds vs phone numbers
            const userIds = [...new Set(alerts.map(a => a.user_id))];
            
            const objectIds = [];
            const phoneNumbers = [];
            
            userIds.forEach(id => {
                if (id && typeof id === 'string' && id.length === 24 && ObjectId.isValid(id)) {
                    objectIds.push(new ObjectId(id));
                } else if (id) {
                    phoneNumbers.push(id);
                }
            });
            
            // Fetch users by BOTH ObjectId AND phone number
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
                users = await this.db.collection('users').find(userQuery).toArray();
            }
            
            // Build lookup map keyed by BOTH _id and phone numbers
            const userMap = {};
            users.forEach(u => {
                userMap[u._id.toString()] = u;
                if (u.phone_number) userMap[u.phone_number] = u;
                if (u.whatsapp_number) userMap[u.whatsapp_number] = u;
            });
            
            return alerts.map(alert => {
                const user = userMap[alert.user_id] || {};
                return {
                    ...alert,
                    id: alert._id.toString(),
                    target_price: alert.target_price,
                    phone_number: user.phone_number || null,
                    whatsapp_number: user.whatsapp_number || null
                };
            });
        } catch (error) {
            console.error('❌ Error in getActiveAlerts:', error);
            throw error;
        }
    }

    async getUserAlerts(phoneNumber) {
        try {
            const user = await this.getUserByPhoneNumber(phoneNumber);
            if (!user) return [];

            const alerts = await this.db.collection('alerts').find({ 
                user_id: user.id,
                status: 'active'
            }).toArray();
            
            return alerts.map((alert, index) => ({
                ...alert,
                id: alert._id.toString(),
                displayId: index + 1, // User-friendly ID starting from 1
                targetPrice: alert.target_price,
                asset: alert.asset,
                direction: alert.direction,
                createdAt: alert.created_at
            }));
        } catch (error) {
            throw error;
        }
    }

    async deleteAlert(alertId) {
        try {
            const result = await this.db.collection('alerts').updateOne(
                { _id: new ObjectId(alertId) },
                { 
                    $set: { 
                        status: 'deleted',
                        updated_at: new Date()
                    }
                }
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

            const result = await this.db.collection('alerts').updateMany(
                { user_id: user.id },
                { 
                    $set: { 
                        status: 'deleted',
                        updated_at: new Date()
                    }
                }
            );
            
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    async markAlertTriggered(alertId) {
        try {
            const result = await this.db.collection('alerts').updateOne(
                { _id: new ObjectId(alertId) },
                { 
                    $set: { 
                        status: 'triggered',
                        triggered_at: new Date(),
                        updated_at: new Date()
                    }
                }
            );
            
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    // Price history operations
    async addPriceHistory(asset, price) {
        try {
            const history = {
                asset: asset.toUpperCase(),
                price: parseFloat(price),
                timestamp: new Date()
            };

            await this.db.collection('priceHistory').insertOne(history);
            
            // Keep only last 100 records per asset to prevent bloat
            await this.db.collection('priceHistory').deleteMany({
                asset: asset.toUpperCase(),
                timestamp: { 
                    $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Keep only last 24 hours
                }
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
            const latest = await this.db.collection('priceHistory')
                .find({ asset: asset.toUpperCase() })
                .sort({ timestamp: -1 })
                .limit(1)
                .toArray();
            
            return latest.length > 0 ? latest[0].price : null;
        } catch (error) {
            throw error;
        }
    }

    // Utility methods
    async getAllUsers() {
        try {
            const users = await this.db.collection('users').find({}).toArray();
            return users.map(user => ({
                ...user,
                id: user._id.toString(),
                phoneNumber: user.phone_number,
                whatsappNumber: user.whatsapp_number
            }));
        } catch (error) {
            throw error;
        }
    }

    async getAllAlerts() {
        try {
            const alerts = await this.db.collection('alerts').find({}).toArray();
            return alerts.map(alert => ({
                ...alert,
                id: alert._id.toString(),
                userId: alert.user_id,
                targetPrice: alert.target_price,
                asset: alert.asset,
                direction: alert.direction
            }));
        } catch (error) {
            throw error;
        }
    }

    async fixOrphanedAlerts() {
        const alerts = await this.db.collection('alerts').find({ status: 'active' }).toArray();
        
        for (const alert of alerts) {
            const userId = alert.user_id;
            let user = null;
            
            // Try as ObjectId
            if (userId && userId.length === 24 && ObjectId.isValid(userId)) {
                user = await this.db.collection('users').findOne({ _id: new ObjectId(userId) });
            }
            
            // Try as phone number
            if (!user) {
                user = await this.db.collection('users').findOne({
                    $or: [
                        { phone_number: userId },
                        { whatsapp_number: userId }
                    ]
                });
            }
            
            if (!user) {
                console.log(`🗑️ Deleting orphaned alert ${alert._id} (user_id: ${userId} not found)`);
                await this.db.collection('alerts').updateOne(
                    { _id: alert._id },
                    { $set: { status: 'deleted' } }
                );
            } else if (userId !== user._id.toString()) {
                // Fix the user_id to use proper ObjectId string
                console.log(`🔧 Fixing alert ${alert._id}: user_id ${userId} → ${user._id.toString()}`);
                await this.db.collection('alerts').updateOne(
                    { _id: alert._id },
                    { $set: { user_id: user._id.toString() } }
                );
            }
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.log('🔌 MongoDB connection closed');
        }
    }
}

module.exports = MongoDBManager;
