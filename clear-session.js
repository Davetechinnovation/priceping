const fs = require('fs');
const path = require('path');

console.log('🧹 WhatsApp Session Cleanup Tool');
console.log('================================');

const authFolder = path.join(__dirname, 'data', 'auth');

try {
    if (fs.existsSync(authFolder)) {
        // Count files before deletion
        const files = fs.readdirSync(authFolder);
        console.log(`📁 Found ${files.length} session files in: ${authFolder}`);
        
        // Delete the entire auth folder
        fs.rmSync(authFolder, { recursive: true, force: true });
        
        console.log('✅ Session data cleared successfully!');
        console.log('');
        console.log('📱 Next Steps:');
        console.log('1. Open WhatsApp on your phone');
        console.log('2. Go to Settings > Linked Devices');
        console.log('3. Logout from any existing bot sessions');
        console.log('4. Restart your bot: node test-baileys.js');
        console.log('5. Scan the fresh QR code that appears');
        console.log('');
        console.log('🚀 Your bot will now generate a fresh QR code!');
        
    } else {
        console.log('ℹ️ No session data found to clear.');
        console.log('📂 Auth folder does not exist:', authFolder);
        console.log('');
        console.log('💡 If you want to start fresh, just run:');
        console.log('   node test-baileys.js');
    }
} catch (error) {
    console.error('❌ Error clearing session data:', error.message);
    console.log('');
    console.log('🔧 Manual cleanup:');
    console.log('1. Stop your bot (Ctrl+C)');
    console.log('2. Delete the data/auth folder manually');
    console.log('3. Restart the bot');
}
