let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Install undici or use Node 18+'); }
}

/**
 * Clean pasted URLs:
 * - trims
 * - removes whitespace/newlines inside URL
 * - converts HTML entities like &amp; -> &
 */
function sanitizePastedUrl(input) {
  if (input == null) return '';
  let s = String(input).trim();

  // common paste issues from WhatsApp/notes: newlines, spaces inside long URLs
  s = s.replace(/[\u00A0]/g, ' ');           // non-breaking space -> space
  s = s.replace(/[\r\n\t]+/g, '');           // remove newlines/tabs entirely
  s = s.replace(/\s+/g, '');                 // remove remaining spaces inside

  // HTML entity decoding (minimal, safe)
  s = s.replace(/&amp;/gi, '&');

  // Ensure scheme
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`;

  return s;
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Follow redirects to get final URL.
 * Useful for app shortlinks like ajioapps.oneclick.me, bit.ly etc.
 *
 * - Uses HEAD first, falls back to GET if needed.
 * - Caps redirects to avoid loops.
 */
async function resolveFinalUrl(inputUrl, { maxHops = 8, timeoutMs = 8000 } = {}) {
  if (!isHttpUrl(inputUrl)) return inputUrl;

  let current = inputUrl;
  for (let i = 0; i < maxHops; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      // HEAD (some services block head; we'll fall back to GET)
      let res = await fetchFn(current, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), current).toString();
        current = next;
        continue;
      }

      if (res.status === 405 || res.status === 403 || res.status === 400) {
        // fallback GET
        res = await fetchFn(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          const next = new URL(res.headers.get('location'), current).toString();
          current = next;
          continue;
        }
      }

      return current; // no redirect
    } catch {
      return current; // if network fails, keep original
    } finally {
      clearTimeout(t);
    }
  }
  return current;
}

module.exports = { sanitizePastedUrl, resolveFinalUrl };