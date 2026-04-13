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

// Extract ALL URLs (not just first)
function extractAllUrls(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s]+/gi) || [];
  // dedupe + keep order
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

function buildHelpText() {
  return `EarnkoBot Help

1) Connect your Earnko account:
• /connect
(Open the link, login to Earnko if needed, then it will connect automatically.)

2) Generate short links:
• Paste 1 link OR multiple product URLs in one message.
• Bot will reply with short share links for all.

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
• Paste 1 or multiple product URLs in a single message
• I will generate short share links for all URLs.

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
Once you see "Connected!", come back here and paste product URLs.`
    );
  });

  bot.on('message', async (msg) => {
    const text = msg.text || msg.caption || '';
    if (String(text).startsWith('/')) return;

    const urls = extractAllUrls(text);
    if (!urls.length) return;

    const telegramUserId = String(msg.from?.id || '');

    // If multiple URLs -> bulk
    if (urls.length > 1) {
      bot.sendMessage(msg.chat.id, `Generating ${Math.min(urls.length, 25)} short links...`);

      const r = await generateTelegramShortLinksBulk({ telegramUserId, urls: urls.slice(0, 25) });
      if (!r.ok) {
        bot.sendMessage(msg.chat.id, `Failed: ${r.message}\nIf not connected, run /connect first.`);
        return;
      }

      const results = Array.isArray(r.results) ? r.results : [];
      if (!results.length) {
        bot.sendMessage(msg.chat.id, 'No results returned.');
        return;
      }

      // Build a readable list
      const lines = results.map((it, idx) => {
        if (it?.success) return `${idx + 1}) ${it.shareUrl}`;
        return `${idx + 1}) Failed: ${it?.message || 'Error'}\n   URL: ${it?.inputUrl || ''}`;
      });

      // Telegram message limit is ~4096 chars; chunk if needed
      const out = lines.join('\n\n');
      if (out.length <= 3500) {
        bot.sendMessage(msg.chat.id, out);
      } else {
        // chunk
        let chunk = '';
        for (const line of lines) {
          if ((chunk + '\n\n' + line).length > 3500) {
            // eslint-disable-next-line no-await-in-loop
            await bot.sendMessage(msg.chat.id, chunk.trim());
            chunk = '';
          }
          chunk += (chunk ? '\n\n' : '') + line;
        }
        if (chunk.trim()) await bot.sendMessage(msg.chat.id, chunk.trim());
      }
      return;
    }

    // Single URL
    bot.sendMessage(msg.chat.id, 'Generating short link...');
    const r = await generateTelegramShortLink({ telegramUserId, url: urls[0] });

    if (!r.ok) {
      bot.sendMessage(msg.chat.id, `Failed: ${r.message}\nIf not connected, run /connect first.`);
      return;
    }

    bot.sendMessage(msg.chat.id, `Short link:\n${r.short}`);
  });

  console.log('[telegram-bot] started (polling).');
}

module.exports = { startTelegramBot };