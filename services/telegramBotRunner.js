require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Use Node 18+ or install undici'); }
}

// singleton to avoid double start
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
  return safeBase(process.env.BACKEND_URL || process.env.BACKEND_API, `http://localhost:${process.env.PORT || 8080}`);
}

// Extract ALL URLs (dedupe + preserve order)
function extractAllUrls(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s]+/gi) || [];
  const out = [];
  const seen = new Set();
  for (const u of matches) {
    const url = String(u).trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

// Remove URLs from text (keep other caption/text)
function stripUrls(text) {
  if (!text) return '';
  return String(text)
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Pick best media from telegram message
function getMediaFromMsg(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    return { type: 'photo', fileId: best.file_id };
  }
  if (msg.document?.file_id) return { type: 'document', fileId: msg.document.file_id };
  if (msg.video?.file_id) return { type: 'video', fileId: msg.video.file_id };
  if (msg.animation?.file_id) return { type: 'animation', fileId: msg.animation.file_id };
  return null;
}

function buildHelpText() {
  return `EarnkoBot Help

1) Connect your Earnko account:
• /connect
(Open the link, login to Earnko if needed, then it will connect automatically.)

2) Generate short links:
• Paste 1 link OR multiple product URLs in one message.
• You can also send an image/video + caption with link(s).
• Bot will reply with short share links.

Commands:
• /start   - Getting started
• /connect - Connect Telegram with Earnko
• /profile - Show connected account
• /logout  - Disconnect Telegram
• /help    - Help`;
}

function startMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Connect', callback_data: 'menu:connect' },
        { text: 'Profile', callback_data: 'menu:profile' }
      ],
      [
        { text: 'Help', callback_data: 'menu:help' },
        { text: 'Logout', callback_data: 'menu:logout' }
      ]
    ]
  };
}

function startMenuText() {
  return `Welcome to EarnkoBot ✅

What you can do:
• Connect your Earnko account
• Paste product links to generate short links
• Track clicks & analytics in your Earnko dashboard

Choose an option below:`;
}

async function generateTelegramShortLink({ telegramUserId, url }) {
  const base = backendPublicBase();
  const res = await fetchFn(`${base}/api/integrations/telegram/link-from-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramUserId, url })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Request failed (${res.status})` };
  const short = data?.data?.shareUrl;
  if (!short) return { ok: false, message: 'shareUrl not returned by backend' };
  return { ok: true, short };
}

async function generateTelegramShortLinksBulk({ telegramUserId, urls }) {
  const base = backendPublicBase();
  const res = await fetchFn(`${base}/api/integrations/telegram/link-from-url/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramUserId, urls })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Request failed (${res.status})` };
  const results = data?.data?.results || [];
  return { ok: true, results };
}

// fetch connected profile by telegramUserId
async function fetchTelegramProfile({ telegramUserId }) {
  const base = backendPublicBase();
  const res = await fetchFn(`${base}/api/integrations/telegram/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramUserId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Request failed (${res.status})` };
  return { ok: true, profile: data?.data?.user || null };
}

// disconnect telegram mapping
async function disconnectTelegram({ telegramUserId }) {
  const base = backendPublicBase();
  const res = await fetchFn(`${base}/api/integrations/telegram/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramUserId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Request failed (${res.status})` };
  return { ok: true };
}

// Send "Generating..." message, then edit it later
async function sendGenerating(bot, msg, count) {
  const chatId = msg.chat.id;
  const replyTo = msg.message_id;
  const txt = count > 1 ? `Generating ${count} short links...` : 'Generating short link...';
  return bot.sendMessage(chatId, txt, { reply_to_message_id: replyTo });
}

async function safeEdit(bot, chatId, messageId, text) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, disable_web_page_preview: true });
    return true;
  } catch {
    return false;
  }
}

async function replyWithMediaAndLinks({ bot, msg, userText, linksText }) {
  const chatId = msg.chat.id;
  const replyTo = msg.message_id;
  const media = getMediaFromMsg(msg);

  const captionParts = [];
  if (userText) captionParts.push(String(userText).trim());
  if (linksText) captionParts.push(String(linksText).trim());

  let caption = captionParts.filter(Boolean).join('\n\n');
  if (caption.length > 950) caption = caption.slice(0, 950) + '...';

  const commonOpts = { reply_to_message_id: replyTo, caption, disable_web_page_preview: true };

  if (!media) {
    const combined = [userText, linksText].filter(Boolean).join('\n\n').trim();
    if (combined) {
      await bot.sendMessage(chatId, combined, { reply_to_message_id: replyTo, disable_web_page_preview: true });
    }
    return;
  }

  if (media.type === 'photo') return bot.sendPhoto(chatId, media.fileId, commonOpts);
  if (media.type === 'video') return bot.sendVideo(chatId, media.fileId, commonOpts);
  if (media.type === 'animation') return bot.sendAnimation(chatId, media.fileId, commonOpts);
  return bot.sendDocument(chatId, media.fileId, commonOpts);
}

// ===== Menu actions (used by /command and button callbacks) =====
async function actionConnect(bot, msg) {
  const tgId = String(msg.from?.id || '');
  const url = `${frontendBase()}/telegram/connect?tgId=${encodeURIComponent(tgId)}`;

  await bot.sendMessage(
    msg.chat.id,
    `Connect your Earnko account (secure):

${url}

If it says "Please login", then login to Earnko and open the same link again.
Once you see "Connected!", come back here and paste product URLs.

Login Link: ${frontendBase()}/login`,
    { disable_web_page_preview: true }
  );
}

async function actionHelp(bot, msg) {
  await bot.sendMessage(msg.chat.id, buildHelpText(), { disable_web_page_preview: true });
}

async function actionProfile(bot, msg) {
  const telegramUserId = String(msg.from?.id || '');
  const genMsg = await bot.sendMessage(msg.chat.id, 'Checking profile...', { reply_to_message_id: msg.message_id });

  const r = await fetchTelegramProfile({ telegramUserId });
  if (!r.ok) {
    await safeEdit(bot, genMsg.chat.id, genMsg.message_id, `Failed: ${r.message}\nRun /connect first.`);
    return;
  }

  const u = r.profile || {};
  const text =
    `Connected Account ✅\n\n` +
    `Name: ${u.name || '-'}\n` +
    `Email: ${u.email || '-'}\n` +
    `User ID: ${u.id || u._id || '-'}\n` +
    `Provider: ${u.provider || '-'}\n\n` +
    `To change account: /logout then /connect`;

  await safeEdit(bot, genMsg.chat.id, genMsg.message_id, text);
}

async function actionLogout(bot, msg) {
  const telegramUserId = String(msg.from?.id || '');
  const genMsg = await bot.sendMessage(msg.chat.id, 'Logging out...', { reply_to_message_id: msg.message_id });

  const r = await disconnectTelegram({ telegramUserId });
  if (!r.ok) {
    await safeEdit(bot, genMsg.chat.id, genMsg.message_id, `Failed: ${r.message}`);
    return;
  }

  await safeEdit(bot, genMsg.chat.id, genMsg.message_id, `Disconnected ✅\nNow run /connect to link another Earnko account.`);
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

  // ✅ Professional /start with buttons
  bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(msg.chat.id, startMenuText(), {
      reply_markup: startMenuKeyboard(),
      disable_web_page_preview: true
    });
  });

  bot.onText(/\/help/, (msg) => actionHelp(bot, msg));
  bot.onText(/\/connect/, (msg) => actionConnect(bot, msg));
  bot.onText(/\/profile/, (msg) => actionProfile(bot, msg));
  bot.onText(/\/logout/, (msg) => actionLogout(bot, msg));

  // ✅ Handle button clicks
  bot.on('callback_query', async (q) => {
    try {
      const data = String(q?.data || '');
      const msg = q?.message;
      if (!msg) return;

      // remove "loading" state on button
      try { await bot.answerCallbackQuery(q.id); } catch {}

      if (data === 'menu:connect') return actionConnect(bot, msg);
      if (data === 'menu:profile') return actionProfile(bot, msg);
      if (data === 'menu:help') return actionHelp(bot, msg);
      if (data === 'menu:logout') return actionLogout(bot, msg);

      // fallback
      return bot.sendMessage(msg.chat.id, 'Unknown action. Type /help', { disable_web_page_preview: true });
    } catch (err) {
      console.error('callback_query error', err);
    }
  });

  // Link generator
  bot.on('message', async (msg) => {
    const rawText = msg.text || msg.caption || '';
    if (String(rawText).startsWith('/')) return;

    const urls = extractAllUrls(rawText);
    if (!urls.length) return;

    const telegramUserId = String(msg.from?.id || '');
    const userText = stripUrls(rawText);

    const genMsg = await sendGenerating(bot, msg, Math.min(urls.length, 25));

    if (urls.length > 1) {
      const r = await generateTelegramShortLinksBulk({ telegramUserId, urls: urls.slice(0, 25) });

      if (!r.ok) {
        await safeEdit(bot, genMsg.chat.id, genMsg.message_id, `Failed: ${r.message}\nIf not connected, run /connect first.`);
        return;
      }

      const results = Array.isArray(r.results) ? r.results : [];
      if (!results.length) {
        await safeEdit(bot, genMsg.chat.id, genMsg.message_id, 'No results returned.');
        return;
      }

      const okLinks = results
        .filter(x => x?.success && x?.shareUrl)
        .map(x => String(x.shareUrl));

      const failLines = results
        .filter(x => !x?.success)
        .map(x => `Failed: ${x?.message || 'Error'}`);

      const linksText = [
        okLinks.join('\n'),
        failLines.length ? `\n\n${failLines.join('\n\n')}` : ''
      ].join('').trim();

      await safeEdit(bot, genMsg.chat.id, genMsg.message_id, 'Done ✅');
      await replyWithMediaAndLinks({ bot, msg, userText, linksText });
      return;
    }

    const r = await generateTelegramShortLink({ telegramUserId, url: urls[0] });
    if (!r.ok) {
      await safeEdit(bot, genMsg.chat.id, genMsg.message_id, `Failed: ${r.message}\nIf not connected, run /connect first.`);
      return;
    }

    await safeEdit(bot, genMsg.chat.id, genMsg.message_id, 'Done ✅');
    await replyWithMediaAndLinks({ bot, msg, userText, linksText: r.short });
  });

  console.log('[telegram-bot] started (polling).');
}

module.exports = { startTelegramBot };