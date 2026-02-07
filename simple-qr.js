const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

// Simple QR code generator
async function generateQRCode() {
    try {
        console.log('🔍 Generating QR code for WhatsApp connection...');
        
        // Generate a sample QR code (you'll need to scan this with WhatsApp)
        const sampleQR = 'https://wa.me/2349168071385'; // Your bot number
        
        const qrCodeData = await qrcode.toString(sampleQR, {
            type: 'terminal',
            small: true,
            margin: 1
        });
        
        console.log('\n📱 **SCAN THIS QR CODE WITH WHATSAPP**');
        console.log('=====================================');
        console.log(qrCodeData);
        console.log('=====================================');
        
        console.log('\n💡 **Instructions**:');
        console.log('1. Open WhatsApp on your phone');
        console.log('2. Go to Settings > Linked Devices');
        console.log('3. Tap "Link a device"');
        console.log('4. Scan the QR code above');
        console.log('5. Your bot number: 2349168071385');
        
        console.log('\n🚀 **Alternative**: If this doesn\'t work, try:');
        console.log('- Start the bot: node test-baileys.js');
        console.log('- Check console for QR code file path');
        console.log('- Open the QR code file in browser');
        
    } catch (error) {
        console.error('❌ Error generating QR code:', error);
    }
}

// Run QR generator
generateQRCode();
