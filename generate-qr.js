const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

class QRGenerator {
    constructor() {
        this.qrCodePath = path.join(__dirname, 'data', 'qr-code.svg');
    }

    async generateQRCode() {
        try {
            // Check if QR code already exists
            if (fs.existsSync(this.qrCodePath)) {
                console.log('📱 QR Code already exists!');
                console.log(`📂 Path: ${this.qrCodePath}`);
                
                // Display QR code in terminal
                await this.displayQRCode();
                return;
            }

            console.log('⚠️ No QR code found. Please start the bot first to generate QR code.');
            console.log('💡 Run: node test-baileys.js');
            
        } catch (error) {
            console.error('❌ Error generating QR code:', error);
        }
    }

    async displayQRCode() {
        try {
            if (!fs.existsSync(this.qrCodePath)) {
                console.log('❌ QR code file not found!');
                return;
            }

            // Read QR code data
            const qrData = fs.readFileSync(this.qrCodePath, 'utf8');
            
            console.log('\n📱 **SCAN THIS QR CODE WITH WHATSAPP**');
            console.log('=====================================');
            
            // Generate QR code in terminal
            const qrCode = await qrcode.toString(qrData, {
                type: 'terminal',
                small: true
            });
            
            console.log(qrCode);
            console.log('=====================================');
            console.log('📂 QR code also saved to:', this.qrCodePath);
            console.log('\n💡 **Instructions**:');
            console.log('1. Open WhatsApp on your phone');
            console.log('2. Go to Settings > Linked Devices');
            console.log('3. Tap "Link a device"');
            console.log('4. Scan the QR code above');
            console.log('\n🚀 Once connected, your bot number will be active!');
            
        } catch (error) {
            console.error('❌ Error displaying QR code:', error);
        }
    }
}

// Run QR generator
const qrGenerator = new QRGenerator();
qrGenerator.generateQRCode();
