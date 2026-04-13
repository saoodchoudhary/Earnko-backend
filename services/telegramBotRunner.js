require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Node 18+ has global fetch. If not, fallback to undici
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('undici').fetch;
  } catch {
    throw new Error('No fetch available. Use Node 18+ or install undici');
  }
}

let started = false;

function safeBase(u, fallback) {
  const s = String(u || fallback || '').trim();
  return s.replace(/\/+$/, '');
}

function frontendBase() {
  return safeBase(process.env.FRONTEND_URL, 'http://localhost:3000');
}

function backendBase() {
  // This should be your public API base if deployed, otherwise local
  // Used only for calling API endpoints from the bot.
  return safeBase(process.env.BACKEND_API || process.env.BACKEND_URL, `http://localhost:${process.env.PORT || 8080}`);
}

function extractUrl(text) {
  if (!text) return null;
  const match = String(text).match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

function buildHelpText() {
  return `EarnkoBot Help

1) Connect your Earnko account:
• /connect
(Open the link, login to Earnko if needed, then it will connect automatically.)

2) Generate a short link:
• Paste any product URL (Flipkart/Myntra/Ajio etc.)
• Bot will reply with a short share link.

Commands:
• /start   - Getting started
• /connect - Connect Telegram with Earnko
• /logout  - Disconnect
• /help    - Help`;
}

/**
 * Find connected user by Telegram userId.
 * Assumes user schema has telegram.userId = String (or Number stored as string).
 */
async function findUserByTelegramId(telegramUserId) {
  const tg = String(telegramUserId || '').trim();
  if (!tg) return null;

  // Try common shapes
  // 1) telegram.userId
  let user = await User.findOne({ 'telegram.userId': tg }).lean();
  if (user) return user;

  // 2) telegramUserId flat (if some code uses this)
  user = await User.findOne({ telegramUserId: tg }).lean();
  if (user) return user;

  // 3) telegram.id
  user = await User.findOne({ 'telegram.id': tg }).lean();
  return user || null;
}

/**
 * Issue a server-side JWT for the user (same as normal auth middleware expects).
 * This avoids needing user password/token inside Telegram.
 */
function issueJwtForUser(user) {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
  return jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
}

async function generateShortLinkOnly({ token, url }) {
  const base = backendBase();

  const res = await fetchFn(`${base}/api/affiliate/link-from-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ url })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data?.success) {
    const msg = data?.message || `Request failed (${res.status})`;
    return { ok: false, message: msg };
  }

  const short = data?.data?.shareUrl;
  if (!short) return { ok: false, message: 'shareUrl not returned by backend' };

  return { ok: true, short };
}

function startTelegramBot() {
  if (started) return;
  started = true;

  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    console.warn('[telegram-bot] TELEGRAM_TOKEN missing; bot not started.');
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

  // /start (professional steps)
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `Welcome to EarnkoBot ✅

Step 1: Connect your Earnko account
• Type: /connect
• Open the secure link and login (Google or Email) if required.
• After connection, come back to Telegram.

Step 2: Generate short links
• Paste any product URL (Flipkart/Myntra/Ajio etc.)
• I will generate a short share link for you.

Type /help to see all commands.`
    );
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, buildHelpText());
  });

  // /connect: provide frontend connect URL
  bot.onText(/\/connect/, (msg) => {
    const chatId = msg.chat.id;
    const tgId = String(msg.from?.id || '');

    const url = `${frontendBase()}/telegram/connect?tgId=${encodeURIComponent(tgId)}`;

    bot.sendMessage(
      chatId,
      `Connect your Earnko account (secure):

${url}

If it says "Please login", then login to Earnko and open the same link again.
Once you see "Connected!", come back here and paste a product URL.`
    );
  });

  // /logout: disconnect telegram
  // NOTE: This only clears Telegram field in DB if you want. If you don't want DB write here, remove it.
  bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = String(msg.from?.id || '');

    try {
      // Best-effort: unset telegram link in DB
      await User.updateOne(
        { 'telegram.userId': tgId },
        { $set: { 'telegram.userId': '', 'telegram.connectedAt': null } }
      );
    } catch (e) {
      // ignore
    }

    bot.sendMessage(chatId, 'Disconnected. Use /connect to link again.');
  });

  // Handle normal messages: if contains URL -> generate short link
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';

    // ignore commands
    if (String(text).startsWith('/')) return;

    const url = extractUrl(text);
    if (!url) return;

    // check if connected
    const tgId = String(msg.from?.id || '');
    const user = await findUserByTelegramId(tgId);

    if (!user) {
      bot.sendMessage(chatId, `Your Telegram is not connected to Earnko yet.\nPlease type /connect first.`);
      return;
    }

    // issue server-side JWT and call affiliate API
    const userJwt = issueJwtForUser(user);

    bot.sendMessage(chatId, 'Generating short link...');
    const r = await generateShortLinkOnly({ token: userJwt, url });

    if (!r.ok) {
      bot.sendMessage(chatId, `Failed: ${r.message}\nTry again or run /connect again.`);
      return;
    }

    bot.sendMessage(chatId, `Short link:\n${r.short}`);
  });

  bot.on('polling_error', (err) => {
    console.error('[telegram-bot] polling_error:', err?.message || err);
  });

  console.log('[telegram-bot] started (polling).');
}

module.exports = { startTelegramBot };