require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Use Node 18+ or install undici'); }
}

let started = false;

function extractUrl(text) {
  if (!text) return null;
  const match = String(text).match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

async function loginWithPassword({ backendApi, email, password }) {
  const res = await fetchFn(`${backendApi}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: data?.message || 'Login failed' };
  const token = data?.data?.token;
  if (!token) return { ok: false, message: 'Token not returned by backend' };
  return { ok: true, token };
}

async function fetchMe({ backendApi, token }) {
  const res = await fetchFn(`${backendApi}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return data?.data?.user || null;
}

async function generateShortLinkOnly({ backendApi, token, url }) {
  const res = await fetchFn(`${backendApi}/api/affiliate/link-from-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || 'Failed to generate link' };

  // ✅ Only return shareUrl (short link)
  const short = data?.data?.shareUrl || null;
  if (!short) return { ok: false, message: 'shareUrl not returned by backend' };
  return { ok: true, short };
}

function startTelegramBot() {
  if (started) return;
  started = true;

  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  if (!TELEGRAM_TOKEN) {
    console.warn('[telegram-bot] TELEGRAM_TOKEN missing, bot not started.');
    return;
  }

  const BACKEND_API = (process.env.BACKEND_API || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, '');
  const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  const sessionMap = new Map(); // chatId -> { token, user }

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `Welcome to EarnkoBot.

Login options:
1) /login  (email + password)
2) /google (Google login; then send /token <JWT>)

After login: paste any product URL and I will return ONLY a short link.`
    );
  });

  bot.onText(/\/logout/, (msg) => {
    sessionMap.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Logged out. Use /login or /google again.');
  });

  bot.onText(/\/profile/, (msg) => {
    const sess = sessionMap.get(msg.chat.id);
    if (!sess?.token) return bot.sendMessage(msg.chat.id, 'Please /login first.');
    const u = sess.user || {};
    return bot.sendMessage(msg.chat.id, `Profile:\nName: ${u.name || '-'}\nEmail: ${u.email || '-'}\nRole: ${u.role || '-'}`);
  });

  // ✅ Google login helper
  bot.onText(/\/google/, (msg) => {
    const chatId = msg.chat.id;
    const url = `${BACKEND_API}/api/auth/google?redirect=${encodeURIComponent(`${FRONTEND_URL}/oauth/callback`)}`;
    bot.sendMessage(
      chatId,
      `Google login link:
${url}

Login in browser, then copy the token from the callback URL and send:
 /token <PASTE_TOKEN_HERE>`
    );
  });

  // ✅ token set (for google users)
  bot.onText(/\/token (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = String(match?.[1] || '').trim();
    if (!token) return bot.sendMessage(chatId, 'Token missing. Example: /token eyJhbGciOi...');

    const user = await fetchMe({ backendApi: BACKEND_API, token });
    if (!user) return bot.sendMessage(chatId, 'Invalid token (or expired). Please /google again.');

    sessionMap.set(chatId, { token, user });
    bot.sendMessage(chatId, `Logged in as ${user?.name || user?.email}. Now paste a product URL.`);
  });

  // email+password login (for local users)
  bot.onText(/\/login/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, 'Enter your registered email:', { reply_markup: { force_reply: true } })
      .then((emailPrompt) => {
        bot.onReplyToMessage(chatId, emailPrompt.message_id, async (emailReply) => {
          const email = String(emailReply.text || '').trim().toLowerCase();
          if (!email || !email.includes('@')) return bot.sendMessage(chatId, 'Invalid email. Send /login again.');

          bot.sendMessage(chatId, 'Enter your password:', { reply_markup: { force_reply: true } })
            .then((passPrompt) => {
              bot.onReplyToMessage(chatId, passPrompt.message_id, async (passReply) => {
                const password = String(passReply.text || '').trim();
                if (!password) return bot.sendMessage(chatId, 'Password required. Send /login again.');

                bot.sendMessage(chatId, 'Logging in...');
                const r = await loginWithPassword({ backendApi: BACKEND_API, email, password });
                if (!r.ok) return bot.sendMessage(chatId, `Login failed: ${r.message}`);

                const user = await fetchMe({ backendApi: BACKEND_API, token: r.token });
                sessionMap.set(chatId, { token: r.token, user });

                bot.sendMessage(chatId, `Logged in as ${user?.name || email}. Now paste a product URL.`);
              });
            });
        });
      });
  });

  // URL handler: return only shareUrl (short link)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';

    if (text.startsWith('/')) return;

    const url = extractUrl(text);
    if (!url) return;

    const sess = sessionMap.get(chatId);
    if (!sess?.token) return bot.sendMessage(chatId, 'Please login first: /login or /google');

    bot.sendMessage(chatId, 'Generating short link...');
    const r = await generateShortLinkOnly({ backendApi: BACKEND_API, token: sess.token, url });
    if (!r.ok) return bot.sendMessage(chatId, `Failed: ${r.message}`);

    bot.sendMessage(chatId, `Short link:\n${r.short}`);
  });

  bot.on('polling_error', (err) => {
    console.error('[telegram-bot] polling_error:', err?.message || err);
  });

  console.log('[telegram-bot] started with polling.');
}

module.exports = { startTelegramBot };