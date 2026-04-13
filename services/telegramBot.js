// npm install node-telegram-bot-api node-fetch dotenv

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// === CONFIGURATION ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // Your bot token from BotFather
const BACKEND_API = process.env.BACKEND_API || 'http://localhost:8080'; // Your Earnko backend URL (no trailing slash)
const BOT_DOMAIN = process.env.BOT_DOMAIN || 'https://earnko.com';

if (!TELEGRAM_TOKEN) throw new Error('Set TELEGRAM_TOKEN in .env');

// === In-memory session: Map telegramUserId -> { verified: true, token, user }
const sessionMap = new Map();

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// === Helper: Extract URL from text ===
function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

// === Helper: Send OTP to email via backend ===
async function sendOtp(email) {
  const res = await fetch(`${BACKEND_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return res.ok;
}

// === Helper: Verify OTP via backend ===
async function verifyOtp(email, otp) {
  const res = await fetch(`${BACKEND_API}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp })
  });
  if (!res.ok) return null;
  return (await res.json())?.data?.token || null;
}

// === Helper: Fetch profile via token ===
async function getProfile(token) {
  const res = await fetch(`${BACKEND_API}/api/user/profile/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()).data?.user || null;
}

// === /start ===
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  sessionMap.delete(chatId);

  bot.sendMessage(
    chatId,
    `👋 Welcome to Earnko Affiliate Bot!\n\nSend /login to get started, or /help for commands.`
  );
});

// === /login ===
bot.onText(/\/login/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(
    chatId,
    `🔐 Please enter your registered email:\n(Just type your email as the next message)`,
    { reply_markup: { force_reply: true } }
  ).then(sentMsg => {
    bot.onReplyToMessage(sentMsg.chat.id, sentMsg.message_id, async (reply) => {
      const email = reply.text.trim().toLowerCase();
      // Send OTP link
      const sent = await sendOtp(email);
      if (!sent) {
        bot.sendMessage(chatId, `❌ Couldn't send OTP. Is your email correct/registered? Try /login again.`);
        return;
      }
      bot.sendMessage(
        chatId,
        `✅ OTP sent to your email. Please enter the code:`,
        { reply_markup: { force_reply: true } }
      ).then(sentOtpMsg => {
        bot.onReplyToMessage(sentOtpMsg.chat.id, sentOtpMsg.message_id, async (otpMsg) => {
          const otp = otpMsg.text.trim();
          const token = await verifyOtp(email, otp);
          if (!token) {
            bot.sendMessage(chatId, `❌ OTP invalid. Try /login again.`);
            return;
          }
          const user = await getProfile(token);
          sessionMap.set(chatId, { verified: true, token, user, email });
          bot.sendMessage(chatId, `🎉 Logged in! Welcome, ${user?.name || email}. Now you can paste product links to generate affiliate URLs. Use /logout to log out.`);
        });
      });
    });
  });
});

// === /logout ===
bot.onText(/\/logout/, (msg) => {
  sessionMap.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, `🚪 You have been logged out. Use /login to log in again.`);
});

// === /profile ===
bot.onText(/\/profile/, (msg) => {
  const sess = sessionMap.get(msg.chat.id);
  if (!sess?.verified) {
    bot.sendMessage(msg.chat.id, `You are not logged in. Use /login`);
    return;
  }
  const user = sess.user || {};
  bot.sendMessage(
    msg.chat.id,
    `👤 Profile\nName: ${user.name || '-'}\nEmail: ${user.email || sess.email || '-'}\nEarnko Affiliate ID: ${user._id || '-'}`
  );
});

// === /help ===
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🤖 *Earnko Telegram Bot Commands:*\n
/start - Show welcome/start
/login - Login with your registered email + OTP
/logout - Logout current session
/profile - Show your profile
/help - Show this help

*How to generate affiliate link:*
👉 Paste any Flipkart/Ajio/Myntra/Amazon product link, and you'll get your affiliate link if you are logged in.`,
    { parse_mode: 'Markdown' }
  );
});

// === Main link-generation handler ===
bot.on('message', async (msg) => {
  // Ignore commands (/...) & bot's own messages
  if ((!msg.text && !msg.caption) || (msg.text && msg.text.startsWith('/'))) return;
  const chatId = msg.chat.id;

  // If not logged in, reject
  const sess = sessionMap.get(chatId);
  if (!sess?.verified) {
    bot.sendMessage(chatId, `⚠️ Please /login first to generate affiliate links.`);
    return;
  }

  // Find URL in message
  const text = msg.text || msg.caption || '';
  const url = extractUrl(text);
  if (!url) return;

  bot.sendMessage(chatId, `🔗 Generating your link...`);
  try {
    // Call backend affiliate endpoint with login token
    const res = await fetch(`${BACKEND_API}/api/links/link-from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.token}`
      },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (res.ok && data.success && data.data && data.data.link) {
      bot.sendMessage(chatId, `✅ Here is your affiliate link:\n${data.data.link}`);
    } else {
      bot.sendMessage(chatId, `❌ Couldn't generate the link.\nReason: ${data.message || 'Unknown error'}`);
    }
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error! Try again later.`);
  }
});