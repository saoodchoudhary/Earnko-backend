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

// Pick best media from telegram message
function getMediaFromMsg(msg) {
  // Photo: pick largest size (last is usually largest)
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    return { type: 'photo', fileId: best.file_id };
  }
  // Document (sometimes images come as doc)
  if (msg.document?.file_id) {
    return { type: 'document', fileId: msg.document.file_id };
  }
  // Video
  if (msg.video?.file_id) {
    return { type: 'video', fileId: msg.video.file_id };
  }
  // Animation/GIF
  if (msg.animation?.file_id) {
    return { type: 'animation', fileId: msg.animation.file_id };
  }
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

async function sendTextInChunks(bot, chatId, text, opts = {}) {
  const MAX = 3500; // keep safe margin
  const s = String(text || '').trim();
  if (!s) return;

  if (s.length <= MAX) {
    await bot.sendMessage(chatId, s, opts);
    return;
  }

  let chunk = '';
  const parts = s.split('\n');
  for (const line of parts) {
    const next = chunk ? `${chunk}\n${line}` : line;
    if (next.length > MAX) {
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(chatId, chunk, opts);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) await bot.sendMessage(chatId, chunk, opts);
}

async function replyWithMediaAndLinks({ bot, msg, userText, linksText }) {
  const chatId = msg.chat.id;
  const replyTo = msg.message_id;
  const media = getMediaFromMsg(msg);

  // Caption limit ~1024. Keep it short.
  const captionParts = [];
  if (userText) captionParts.push(String(userText).trim());
  if (linksText) captionParts.push(String(linksText).trim());

  let caption = captionParts.filter(Boolean).join('\n\n');
  if (caption.length > 950) caption = caption.slice(0, 950) + '...';

  const commonOpts = { reply_to_message_id: replyTo };

  if (!media) {
    // no media: just reply with text chunks
    const combined = [userText, linksText].filter(Boolean).join('\n\n').trim();
    await sendTextInChunks(bot, chatId, combined, commonOpts);
    return;
  }

  // If media exists: send same media with caption (text + links)
  if (media.type === 'photo') {
    await bot.sendPhoto(chatId, media.fileId, { ...commonOpts, caption });
    return;
  }
  if (media.type === 'video') {
    await bot.sendVideo(chatId, media.fileId, { ...commonOpts, caption });
    return;
  }
  if (media.type === 'animation') {
    await bot.sendAnimation(chatId, media.fileId, { ...commonOpts, caption });
    return;
  }
  // document
  await bot.sendDocument(chatId, media.fileId, { ...commonOpts, caption });
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
• Send 1 or multiple product URLs in a single message
• You can also send an image/video + caption with link(s)
• I will generate short share links for all URLs

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
Once you see "Connected!", come back here and paste product URLs.

Login Link: ${backendPublicBase()}/auth/login}
`
    );
  });

  // MAIN HANDLER: works for text, captions, media
  bot.on('message', async (msg) => {
    const rawText = msg.text || msg.caption || '';
    if (String(rawText).startsWith('/')) return;

    const urls = extractAllUrls(rawText);
    if (!urls.length) return;

    const telegramUserId = String(msg.from?.id || '');

    // userText: original message/caption but WITHOUT urls (optional)
    const userText = String(rawText || '').trim();

    // MULTI
    if (urls.length > 1) {
      const r = await generateTelegramShortLinksBulk({ telegramUserId, urls: urls.slice(0, 25) });
      if (!r.ok) {
        await replyWithMediaAndLinks({
          bot,
          msg,
          userText,
          linksText: `Failed: ${r.message}\nIf not connected, run /connect first.`
        });
        return;
      }

      const results = Array.isArray(r.results) ? r.results : [];
      if (!results.length) {
        await replyWithMediaAndLinks({ bot, msg, userText, linksText: 'No results returned.' });
        return;
      }

      // ✅ Remove numbering: just print links line-by-line
      const okLinks = results.filter(x => x?.success && x?.shareUrl).map(x => String(x.shareUrl));
      const failLines = results
        .filter(x => !x?.success)
        .map(x => `Failed: ${x?.message || 'Error'}\n${x?.inputUrl || ''}`);

      const linksText = [
        okLinks.join('\n'),
        failLines.length ? `\n\n${failLines.join('\n\n')}` : ''
      ].join('').trim();

      await replyWithMediaAndLinks({ bot, msg, userText, linksText });
      return;
    }

    // SINGLE
    const r = await generateTelegramShortLink({ telegramUserId, url: urls[0] });
    if (!r.ok) {
      await replyWithMediaAndLinks({
        bot,
        msg,
        userText,
        linksText: `Failed: ${r.message}\nIf not connected, run /connect first.`
      });
      return;
    }

    await replyWithMediaAndLinks({
      bot,
      msg,
      userText,
      linksText: r.short
    });
  });

  console.log('[telegram-bot] started (polling).');
}

module.exports = { startTelegramBot };