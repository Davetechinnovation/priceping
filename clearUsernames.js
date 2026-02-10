const DatabaseManager = require('./src/database');

async function clearUsernames() {
    const database = new DatabaseManager();
    
    try {
        // Clear all usernames
        const stmt = database.db.prepare("UPDATE users SET name = NULL");
        const result = stmt.run();
        
        console.log(`✅ Cleared usernames for ${result.changes} users`);
        
        // Show remaining users
        const users = database.db.prepare("SELECT phone_number, whatsapp_number, name FROM users").all();
        console.log('\n📋 Current users:');
        users.forEach(user => {
            console.log(`📱 ${user.phone_number} - Name: ${user.name || 'NULL'}`);
        });
        
    } catch (error) {
        console.error('❌ Error clearing usernames:', error);
    } finally {
        database.close();
    }
}

clearUsernames();
