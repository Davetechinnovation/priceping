const DatabaseLib = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.init();
    }

    init() {
        const dbPath = process.env.DB_PATH || './data/priceping.db';
        const dbDir = path.dirname(dbPath);
        
        // Create database directory if it doesn't exist
        const fs = require('fs');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log(`📁 Created database directory: ${dbDir}`);
        }
        
        this.db = new DatabaseLib(dbPath);
        console.log('Connected to SQLite database (better-sqlite3)');
        this.createTables();
    }

    createTables() {
        // Users table
        const usersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                whatsapp_number TEXT NOT NULL,
                name TEXT DEFAULT NULL,
                subscription_type TEXT DEFAULT 'free',
                subscription_start_date DATETIME,
                subscription_end_date DATETIME,
                alerts_used_today INTEGER DEFAULT 0,
                last_reset_date DATE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // Alerts table
        const alertsTable = `
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                asset TEXT NOT NULL,
                target_price REAL NOT NULL,
                direction TEXT CHECK(direction IN ('above', 'below')) NOT NULL,
                status TEXT DEFAULT 'active',
                triggered_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `;

        // Price history table for tracking
        const priceHistoryTable = `
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset TEXT NOT NULL,
                price REAL NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        this.db.exec(usersTable);
        this.db.exec(alertsTable);
        this.db.exec(priceHistoryTable);

        // Add name column to existing users table if it doesn't exist
        try {
            this.db.exec(`ALTER TABLE users ADD COLUMN name TEXT DEFAULT NULL`);
            console.log("✅ Added name column to users table");
        } catch (error) {
            // Column already exists, which is fine
            console.log("ℹ️ Name column already exists in users table");
        }
    }

    // User operations
    // 🟢 UPDATED: Accept 'name' parameter
    createUser(phoneNumber, whatsappNumber, name = null) {
        try {
            const stmt = this.db.prepare(`INSERT OR IGNORE INTO users (phone_number, whatsapp_number, name) VALUES (?, ?, ?)`);
            const result = stmt.run(phoneNumber, whatsappNumber, name);
            return { id: result.lastInsertRowid, phoneNumber, whatsappNumber, name };
        } catch (error) {
            throw error;
        }
    }

    updateUserName(phoneNumber, name) {
        try {
            const stmt = this.db.prepare(`UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE phone_number = ?`);
            const result = stmt.run(name, phoneNumber);
            return result.changes > 0;
        } catch (error) {
            throw error;
        }
    }

    getUserByPhoneNumber(phoneNumber) {
        try {
            // Try whatsapp_number field first (primary)
            let stmt = this.db.prepare(`SELECT * FROM users WHERE whatsapp_number = ?`);
            let user = stmt.get(phoneNumber);
            
            // Fallback to phone_number if not found
            if (!user) {
                stmt = this.db.prepare(`SELECT * FROM users WHERE phone_number = ?`);
                user = stmt.get(phoneNumber);
            }
            
            return user;
        } catch (error) {
            throw error;
        }
    }

    // Alert operations
    async createAlert(phoneNumber, asset, targetPrice, direction) {
        try {
            console.log(`🔍 createAlert called with phoneNumber: ${phoneNumber}, asset: ${asset}, price: ${targetPrice}, direction: ${direction}`);
            
            // Ensure user exists first
            let user = this.getUserByPhoneNumber(phoneNumber);
            console.log(`👤 User lookup in createAlert:`, user);
            
            if (!user) {
                // Create user if doesn't exist (use same number for both fields)
                console.log(`🆕 Creating user in createAlert: ${phoneNumber}`);
                user = this.createUser(phoneNumber, phoneNumber);
                console.log(`👤 Created user in createAlert:`, user);
            }
            
            console.log(`📋 Inserting alert with user_id: ${user.id}, asset: ${asset}, price: ${targetPrice}, direction: ${direction}`);
            const stmt = this.db.prepare(`INSERT INTO alerts (user_id, asset, target_price, direction) VALUES (?, ?, ?, ?)`);
            const result = stmt.run(user.id, asset, targetPrice, direction);
            console.log(`✅ Alert inserted successfully:`, result);
            
            return { id: result.lastInsertRowid, userId: user.id, asset, targetPrice, direction };
        } catch (error) {
            console.error(`❌ createAlert Error:`, error);
            console.error(`❌ createAlert Stack:`, error.stack);
            throw error;
        }
    }

    // Debug method to check alerts by phone number
    getAlertsByPhoneNumber(phoneNumber) {
        try {
            console.log(`🔍 getAlertsByPhoneNumber called with: ${phoneNumber}`);
            const stmt = this.db.prepare(`
                SELECT a.*, u.phone_number, u.whatsapp_number 
                FROM alerts a 
                JOIN users u ON a.user_id = u.id 
                WHERE u.phone_number = ? OR u.whatsapp_number = ?
            `);
            const alerts = stmt.all(phoneNumber, phoneNumber);
            console.log(`🔍 getAlertsByPhoneNumber result: ${alerts.length} alerts found:`, alerts);
            return alerts;
        } catch (error) {
            console.error(`❌ getAlertsByPhoneNumber error:`, error);
            throw error;
        }
    }

    getUserAlerts(userId) {
        try {
            console.log(`🔍 getUserAlerts called with userId: ${userId}`);
            const stmt = this.db.prepare(`SELECT * FROM alerts WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`);
            const alerts = stmt.all(userId);
            console.log(`🔍 getUserAlerts query result: ${alerts.length} alerts found:`, alerts);
            return alerts;
        } catch (error) {
            console.error(`❌ getUserAlerts error:`, error);
            throw error;
        }
    }

    deleteAlert(alertId, userId) {
        try {
            const stmt = this.db.prepare(`UPDATE alerts SET status = 'deleted' WHERE id = ? AND user_id = ?`);
            const result = stmt.run(alertId, userId);
            return { changes: result.changes };
        } catch (error) {
            throw error;
        }
    }

    getActiveAlerts() {
        try {
            const stmt = this.db.prepare(`
                SELECT a.*, u.phone_number, u.whatsapp_number 
                FROM alerts a 
                JOIN users u ON a.user_id = u.id 
                WHERE a.status = 'active'
            `);
            return stmt.all();
        } catch (error) {
            throw error;
        }
    }

    markAlertTriggered(alertId) {
        try {
            const stmt = this.db.prepare(`UPDATE alerts SET status = 'triggered', triggered_at = CURRENT_TIMESTAMP WHERE id = ?`);
            const result = stmt.run(alertId);
            return { changes: result.changes };
        } catch (error) {
            throw error;
        }
    }

    // Price history operations
    recordPrice(asset, price) {
        try {
            const stmt = this.db.prepare(`INSERT INTO price_history (asset, price) VALUES (?, ?)`);
            const result = stmt.run(asset, price);
            return { id: result.lastInsertRowid, asset, price };
        } catch (error) {
            throw error;
        }
    }

    // Utility methods for migration
    getAllUsers() {
        try {
            const stmt = this.db.prepare(`SELECT * FROM users ORDER BY created_at DESC`);
            return stmt.all();
        } catch (error) {
            throw error;
        }
    }

    getAllAlerts() {
        try {
            const stmt = this.db.prepare(`SELECT * FROM alerts ORDER BY created_at DESC`);
            return stmt.all();
        } catch (error) {
            throw error;
        }
    }

    close() {
        if (this.db) {
            this.db.close();
            console.log('Database connection closed');
        }
    }
}

module.exports = DatabaseManager;
 