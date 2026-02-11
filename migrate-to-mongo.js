#!/usr/bin/env node

/**
 * Migration Script: SQLite to MongoDB
 * This script migrates all data from SQLite to MongoDB
 */

const DatabaseManager = require('./src/database');
const MongoDBManager = require('./src/mongoDBManager');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting SQLite to MongoDB migration...');
    
    const sqliteDB = new DatabaseManager();
    const mongoDB = new MongoDBManager();
    
    try {
        // Connect to MongoDB
        await mongoDB.connect();
        
        // Migrate Users
        console.log('📥 Migrating users...');
        const sqliteUsers = sqliteDB.getAllUsers();
        console.log(`Found ${sqliteUsers.length} users in SQLite`);
        
        let migratedUsers = 0;
        for (const user of sqliteUsers) {
            try {
                await mongoDB.createUser(
                    user.phone_number,
                    user.whatsapp_number,
                    user.name
                );
                
                // Update additional fields if they exist
                if (user.subscription_type !== 'free' || user.subscription_start_date) {
                    await mongoDB.updateUserSubscription(
                        user.phone_number,
                        user.subscription_type,
                        user.subscription_start_date,
                        user.subscription_end_date
                    );
                }
                
                migratedUsers++;
            } catch (error) {
                console.error(`❌ Error migrating user ${user.phone_number}:`, error.message);
            }
        }
        
        console.log(`✅ Migrated ${migratedUsers} users`);
        
        // Migrate Alerts
        console.log('📥 Migrating alerts...');
        const sqliteAlerts = sqliteDB.getAllAlerts();
        console.log(`Found ${sqliteAlerts.length} alerts in SQLite`);
        
        let migratedAlerts = 0;
        for (const alert of sqliteAlerts) {
            try {
                // Get the corresponding user in MongoDB by SQLite user_id
                const sqliteUser = sqliteDB.getUserByPhoneNumber(alert.user_id.toString());
                if (sqliteUser) {
                    const mongoUser = await mongoDB.getUserByPhoneNumber(sqliteUser.phone_number);
                    if (mongoUser) {
                        await mongoDB.createAlert(
                            mongoUser.id,
                            alert.asset,
                            alert.target_price,
                            alert.direction
                        );
                        
                        // Update status if not active
                        if (alert.status !== 'active') {
                            // Get the alert ID (this is a simplified approach)
                            const userAlerts = await mongoDB.getUserAlerts(sqliteUser.phone_number);
                            const latestAlert = userAlerts[userAlerts.length - 1];
                            
                            if (alert.status === 'triggered') {
                                await mongoDB.markAlertTriggered(latestAlert.id);
                            } else if (alert.status === 'deleted') {
                                await mongoDB.deleteAlert(latestAlert.id);
                            }
                        }
                        
                        migratedAlerts++;
                    } else {
                        console.error(`❌ MongoDB user not found for SQLite user: ${sqliteUser.phone_number}`);
                    }
                } else {
                    console.error(`❌ SQLite user not found for alert: ${alert.user_id}`);
                }
            } catch (error) {
                console.error(`❌ Error migrating alert ${alert.id}:`, error.message);
            }
        }
        
        console.log(`✅ Migrated ${migratedAlerts} alerts`);
        
        // Summary
        console.log('\n🎉 Migration Complete!');
        console.log(`📊 Summary:`);
        console.log(`   - Users: ${migratedUsers}/${sqliteUsers.length}`);
        console.log(`   - Alerts: ${migratedAlerts}/${sqliteAlerts.length}`);
        
        // Close connections
        await mongoDB.close();
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
if (require.main === module) {
    migrate().catch(console.error);
}

module.exports = migrate;
