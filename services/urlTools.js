let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Install undici or use Node 18+'); }
}

function sanitizePastedUrl(input) {
  if (input == null) return '';
  let s = String(input).trim();
  s = s.replace(/[\u00A0]/g, ' ');
  s = s.replace(/[\r\n\t]+/g, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/&amp;/gi, '&');
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

function toCanonicalUrl(inputUrl) {
  if (!inputUrl) return '';
  try {
    const u = new URL(inputUrl);
    return u.toString();
  } catch {
    return inputUrl;
  }
}

function normalizeAffiliateInputUrl(input) {
  const cleaned = sanitizePastedUrl(input);
  if (!cleaned) return '';
  return toCanonicalUrl(cleaned);
}

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeMyntraUrl(inputUrl) {
  try {
    const host = normalizeHost(inputUrl);
    if (!(host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it')) return inputUrl;

    const u = new URL(inputUrl);
    const path = u.pathname || '';
    const m = path.match(/\/(\d{6,12})(\/|$)/);
    const productId = m?.[1] || null;
    if (!productId) return inputUrl;

    return `https://www.myntra.com/${productId}`;
  } catch {
    return inputUrl;
  }
}

function makeProviderSafeUrl(inputUrl) {
  const base = toCanonicalUrl(sanitizePastedUrl(inputUrl));
  const host = normalizeHost(base);

  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') {
    return normalizeMyntraUrl(base);
  }

  return base;
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
 * Resolve final URL for short/app links (Ajio OneLink, fkrt.it, etc).
 * Try GET first, then fallback to HEAD if GET fails.
 */
async function resolveFinalUrl(inputUrl, { timeoutMs = 15000 } = {}) {
  if (!isHttpUrl(inputUrl)) return inputUrl;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; EarnkoBot/1.0; +https://earnko.com)'
  };

  try {
    // 1) GET (best for providers that only redirect on GET)
    const res = await fetchFn(inputUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers
    });
    return res?.url || inputUrl;
  } catch {
    // 2) HEAD fallback (some providers block GET)
    try {
      const res2 = await fetchFn(inputUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: ctrl.signal,
        headers
      });
      return res2?.url || inputUrl;
    } catch {
      return inputUrl;
    }
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  sanitizePastedUrl,
  toCanonicalUrl,
  normalizeAffiliateInputUrl,
  normalizeMyntraUrl,
  makeProviderSafeUrl,
  resolveFinalUrl
};