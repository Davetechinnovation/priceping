const DatabaseLib = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.init();
    }

    init() {
        const dbPath = process.env.DB_PATH || './data/priceping.db';
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
    }

    // User operations
    createUser(phoneNumber, whatsappNumber) {
        try {
            const stmt = this.db.prepare(`INSERT OR IGNORE INTO users (phone_number, whatsapp_number) VALUES (?, ?)`);
            const result = stmt.run(phoneNumber, whatsappNumber);
            return { id: result.lastInsertRowid, phoneNumber, whatsappNumber };
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
    async createAlert(userId, asset, targetPrice, direction) {
        try {
            // Ensure user exists first
            let user = await this.getUserByPhoneNumber(userId);
            if (!user) {
                // Create user if doesn't exist (use same number for both fields)
                user = await this.createUser(userId, userId);
            }
            
            const stmt = this.db.prepare(`INSERT INTO alerts (user_id, asset, target_price, direction) VALUES (?, ?, ?, ?)`);
            const result = stmt.run(user.id, asset, targetPrice, direction);
            return { id: result.lastInsertRowid, userId: user.id, asset, targetPrice, direction };
        } catch (error) {
            throw error;
        }
    }

    getUserAlerts(userId) {
        try {
            const stmt = this.db.prepare(`SELECT * FROM alerts WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`);
            return stmt.all(userId);
        } catch (error) {
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
            return { id: result.lastInsertRowid };
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
