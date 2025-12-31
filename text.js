// main.js - WhatsApp Bot dengan Custom Pairing Code
import { Boom } from '@hapi/boom';
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import pino from 'pino';
import chalk from 'chalk';

// ========== KONFIGURASI ==========
const CONFIG = {
    sessionPath: './auth_session',
    phoneNumber: '628123456789', // Nomor HP dengan kode negara (tanpa +)
    customPairingCode: 'ABCD1234', // 8 karakter custom code atau null untuk random
    botName: 'MyBot',
    logLevel: 'silent' // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent'
};

const logger = pino({ level: CONFIG.logLevel });
let sock;

// ========== FUNGSI UTAMA ==========
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    console.log(chalk.cyan('╔════════════════════════════════════╗'));
    console.log(chalk.cyan('║   WhatsApp Bot - Pairing Code      ║'));
    console.log(chalk.cyan('╚════════════════════════════════════╝'));
    console.log(chalk.yellow(`📦 Baileys Version: ${version.join('.')}\n`));

    sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true
    });

    // ========== PAIRING CODE ==========
    if (!state.creds.registered) {
        console.log(chalk.blue('🔐 Requesting pairing code...'));
        
        // PENTING: Ini fungsi yang sudah kamu modifikasi di Socket.ts
        const code = await sock.requestPairingCode(
            CONFIG.phoneNumber, 
            CONFIG.customPairingCode
        );
        
        console.log(chalk.green('\n╔════════════════════════════════════╗'));
        console.log(chalk.green('║      PAIRING CODE KAMU             ║'));
        console.log(chalk.green('╠════════════════════════════════════╣'));
        console.log(chalk.green(`║         ${code}                ║`));
        console.log(chalk.green('╚════════════════════════════════════╝'));
        console.log(chalk.yellow('\n📱 Masukkan code ini di WhatsApp kamu:'));
        console.log(chalk.yellow('   WhatsApp > Linked Devices > Link a Device\n'));
    }

    // ========== EVENT HANDLERS ==========
    
    // Connection Update
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
                : true;

            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(chalk.red(`\n❌ Connection closed: ${reason}`));

            if (shouldReconnect) {
                console.log(chalk.yellow('🔄 Reconnecting in 3 seconds...'));
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log(chalk.red('🚫 Logged out. Delete auth_session folder to login again.'));
                process.exit(0);
            }
        } else if (connection === 'open') {
            console.log(chalk.green('\n✅ Successfully connected to WhatsApp!'));
            console.log(chalk.cyan(`📱 Bot Number: ${sock.user?.id.split(':')[0]}`));
            console.log(chalk.cyan(`👤 Bot Name: ${sock.user?.name || CONFIG.botName}\n`));
        } else if (connection === 'connecting') {
            console.log(chalk.yellow('🔌 Connecting to WhatsApp...'));
        }
    });

    // Credentials Update
    sock.ev.on('creds.update', saveCreds);

    // Messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || '';
        const sender = msg.key.participant || from;
        const isGroup = from.endsWith('@g.us');

        console.log(chalk.magenta('\n📨 New Message:'));
        console.log(chalk.white(`From: ${sender.split('@')[0]}`));
        console.log(chalk.white(`Group: ${isGroup ? from.split('@')[0] : 'Private Chat'}`));
        console.log(chalk.white(`Text: ${text}\n`));

        // ========== COMMAND HANDLER ==========
        if (text.startsWith('!')) {
            const command = text.slice(1).toLowerCase().split(' ')[0];
            
            switch (command) {
                case 'ping':
                    await sock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
                    break;

                case 'info':
                    const info = `
*Bot Information*

📱 Bot Number: ${sock.user?.id.split(':')[0]}
👤 Bot Name: ${sock.user?.name || CONFIG.botName}
⚡ Status: Online
🔗 Session: Active
                    `.trim();
                    await sock.sendMessage(from, { text: info }, { quoted: msg });
                    break;

                case 'menu':
                    const menu = `
*📋 Bot Commands*

!ping - Check bot status
!info - Bot information
!menu - Show this menu
!sticker - Reply to image to make sticker
!hello - Say hello
                    `.trim();
                    await sock.sendMessage(from, { text: menu }, { quoted: msg });
                    break;

                case 'hello':
                    const name = msg.pushName || 'User';
                    await sock.sendMessage(from, { 
                        text: `👋 Hello ${name}! Welcome to ${CONFIG.botName}` 
                    }, { quoted: msg });
                    break;

                case 'sticker':
                    if (!msg.message?.imageMessage && !msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        await sock.sendMessage(from, { 
                            text: '❌ Reply to an image with !sticker' 
                        }, { quoted: msg });
                        return;
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '⏳ Creating sticker...' 
                    }, { quoted: msg });
                    // Add sticker creation logic here
                    break;

                default:
                    await sock.sendMessage(from, { 
                        text: `❌ Unknown command: ${command}\nType !menu for available commands` 
                    }, { quoted: msg });
            }
        }
    });

    // Group Updates
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        
        for (const participant of participants) {
            if (action === 'add') {
                await sock.sendMessage(id, { 
                    text: `👋 Welcome @${participant.split('@')[0]}!`,
                    mentions: [participant]
                });
            } else if (action === 'remove') {
                await sock.sendMessage(id, { 
                    text: `👋 Goodbye @${participant.split('@')[0]}!`,
                    mentions: [participant]
                });
            }
        }
    });
}

// ========== ERROR HANDLER ==========
process.on('uncaughtException', (err) => {
    console.error(chalk.red('Uncaught Exception:'), err);
});

process.on('unhandledRejection', (err) => {
    console.error(chalk.red('Unhandled Rejection:'), err);
});

// ========== START BOT ==========
connectToWhatsApp().catch((err) => {
    console.error(chalk.red('Failed to start bot:'), err);
    process.exit(1);
});

console.log(chalk.gray('\n💡 Press Ctrl+C to stop the bot\n'));