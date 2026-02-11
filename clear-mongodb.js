#!/usr/bin/env node

/**
 * Clear MongoDB Database Script
 * This script clears all collections for a fresh start
 */

const MongoDBManager = require('./src/mongoDBManager');
require('dotenv').config();

async function clearMongoDB() {
    console.log('🗑️ Clearing MongoDB database for fresh start...');
    
    const mongoDB = new MongoDBManager();
    
    try {
        // Connect to MongoDB
        await mongoDB.connect();
        
        // Get database instance
        const db = mongoDB.db;
        
        // List all collections
        const collections = await db.listCollections().toArray();
        console.log(`Found ${collections.length} collections:`, collections.map(c => c.name));
        
        // Drop each collection
        for (const collection of collections) {
            try {
                await db.collection(collection.name).drop();
                console.log(`✅ Dropped collection: ${collection.name}`);
            } catch (error) {
                if (error.code !== 26) { // Namespace not found is ok
                    console.error(`❌ Error dropping ${collection.name}:`, error.message);
                }
            }
        }
        
        // Recreate indexes
        await mongoDB.createIndexes();
        
        console.log('\n🎉 MongoDB cleared successfully!');
        console.log('📊 Database is now fresh and ready');
        
        // Close connection
        await mongoDB.close();
        
    } catch (error) {
        console.error('❌ Error clearing MongoDB:', error);
        process.exit(1);
    }
}

// Run clear script
if (require.main === module) {
    clearMongoDB().catch(console.error);
}

module.exports = clearMongoDB;
