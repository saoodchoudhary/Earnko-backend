require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Use Node 18+ or install undici'); }
}

// singleton to avoid double handlers
if (global.__EARNKO_TELEGRAM_BOT_SINGLETON__ == null) {
  global.__EARNKO_TELEGRAM_BOT_SINGLETON__ = { started: false };
}

function safeBase(u, fallback) {
  const s = String(u || fallback || '').trim();
  return s.replace(/\/+$/, '');
}

function frontendBase() {
  return safeBase(process.env.FRONTEND_URL, 'http://localhost:3000');
}

function backendPublicBase() {
  // IMPORTANT: must be your public API domain in production, not localhost.
  // Example: https://api.earnko.com
  return safeBase(process.env.BACKEND_URL || process.env.BACKEND_API, `http://localhost:${process.env.PORT || 8080}`);
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

async function generateTelegramShortLink({ telegramUserId, url }) {
  const base = backendPublicBase();
  const res = await fetchFn(`${base}/api/integrations/telegram/link-from-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramUserId, url })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    return { ok: false, message: data?.message || `Request failed (${res.status})` };
  }

  const short = data?.data?.shareUrl;
  if (!short) return { ok: false, message: 'shareUrl not returned by backend' };

  return { ok: true, short };
}

function startTelegramBot() {
  if (global.__EARNKO_TELEGRAM_BOT_SINGLETON__.started) return;

  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    console.warn('[telegram-bot] TELEGRAM_TOKEN missing; bot not started.');
    return;
  }

  global.__EARNKO_TELEGRAM_BOT_SINGLETON__.started = true;

  const bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('[telegram-bot] polling_error:', err?.message || err);
  });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
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

  bot.onText(/\/connect/, (msg) => {
    const tgId = String(msg.from?.id || '');
    const url = `${frontendBase()}/telegram/connect?tgId=${encodeURIComponent(tgId)}`;

    bot.sendMessage(
      msg.chat.id,
      `Connect your Earnko account (secure):

${url}

If it says "Please login", then login to Earnko and open the same link again.
Once you see "Connected!", come back here and paste a product URL.`
    );
  });

  bot.onText(/\/logout/, (msg) => {
    // We are not unlinking DB here (optional). If you want unlink, do it via a backend endpoint.
    bot.sendMessage(msg.chat.id, 'To disconnect, please reconnect from /connect anytime. (Logout is optional)');
  });

  bot.on('message', async (msg) => {
    const text = msg.text || msg.caption || '';
    if (String(text).startsWith('/')) return;

    const url = extractUrl(text);
    if (!url) return;

    const telegramUserId = String(msg.from?.id || '');

    bot.sendMessage(msg.chat.id, 'Generating short link...');
    const r = await generateTelegramShortLink({ telegramUserId, url });

    if (!r.ok) {
      bot.sendMessage(msg.chat.id, `Failed: ${r.message}\nIf not connected, run /connect first.`);
      return;
    }

    bot.sendMessage(msg.chat.id, `Short link:\n${r.short}`);
  });

  console.log('[telegram-bot] started (polling).');
}

module.exports = { startTelegramBot };