let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Install undici or use Node 18+'); }
}

// ====== Shortener host list and check util (for fast deeplink optimization) =======
const SHORTENER_HOSTS = [
  // common shorteners
  't.co', 'bit.ly', 'bitly.com', 'tinyurl.com', 'cutt.ly', 'rb.gy', 's.id', 'tiny.cc', 'rebrand.ly',

  // india/affiliate/app shorteners
  'fkrt.it', 'fkrt.cc', 'fktr.in', 'fkrt.to',
  'zngy.in', 'myntr.it', 'hyyzo.com', 'fpkrt.cc',
  'ajioapps.onelink.me', 'ajio.page.link',

  // extrape short
  'extp.in',

  // earnkaro (common)
  'earnkaro.com', 'ekaro.in',

  // earnko itself (so our own short links can be re-processed)
  'earnko.com'
];

function isShortenerHost(host) {
  host = (host || '').toLowerCase();
  return SHORTENER_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

// ======== URL Sanitization, Canonicalization ==========

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

/**
 * Fix common pasted URL issues that break merchant deeplinks.
 */
function cleanupTrailingUrlJunk(inputUrl) {
  if (!inputUrl) return '';
  let s = String(inputUrl).trim();
  while (s.endsWith('#')) s = s.slice(0, -1);
  while (s.endsWith('?') || s.endsWith('&')) s = s.slice(0, -1);
  return s;
}

function toMerchantSafeUrl(inputUrl) {
  const cleaned = cleanupTrailingUrlJunk(inputUrl);
  if (!cleaned) return '';
  try {
    const u = new URL(cleaned);
    if (u.search === '?') u.search = '';
    return cleanupTrailingUrlJunk(u.toString());
  } catch {
    return cleanupTrailingUrlJunk(cleaned);
  }
}

function normalizeAffiliateInputUrl(input) {
  const cleaned = sanitizePastedUrl(input);
  if (!cleaned) return '';
  return toMerchantSafeUrl(toCanonicalUrl(cleaned));
}

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ======= Platform-specific normalization: Myntra Example =========

function normalizeMyntraUrl(inputUrl) {
  try {
    const host = normalizeHost(inputUrl);
    if (!(host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it'))
      return inputUrl;

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
  const base = toMerchantSafeUrl(toCanonicalUrl(sanitizePastedUrl(inputUrl)));
  const host = normalizeHost(base);

  if (
    host === 'myntra.com' ||
    host.endsWith('.myntra.com') ||
    host === 'myntr.it'
  ) {
    return toMerchantSafeUrl(normalizeMyntraUrl(base));
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
 * - Non-shortener hosts: return instantly (no network).
 * - Shortener hosts: resolves redirects via GET (fallback HEAD), with timeout.
 */
async function resolveFinalUrl(inputUrl, { timeoutMs = 2000 } = {}) {
  if (!isHttpUrl(inputUrl)) return inputUrl;
  let host = '';
  try { host = new URL(inputUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch {}

  if (!isShortenerHost(host)) return toMerchantSafeUrl(inputUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; EarnkoBot/1.0; +https://earnko.com)'
  };

  try {
    // Try GET
    try {
      const res = await fetchFn(inputUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers
      });
      return res?.url ? toMerchantSafeUrl(res.url) : toMerchantSafeUrl(inputUrl);
    } catch {
      // Try HEAD fallback
      try {
        const res2 = await fetchFn(inputUrl, {
          method: 'HEAD',
          redirect: 'follow',
          signal: ctrl.signal,
          headers
        });
        return res2?.url ? toMerchantSafeUrl(res2.url) : toMerchantSafeUrl(inputUrl);
      } catch {
        return toMerchantSafeUrl(inputUrl);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ✅ Deep resolver for multi-hop shorteners (earnko -> /r -> /api/affiliate/redirect -> store)
 */
async function resolveFinalUrlDeep(inputUrl, { timeoutMs = 2000, maxHops = 6 } = {}) {
  let current = toMerchantSafeUrl(toCanonicalUrl(sanitizePastedUrl(inputUrl)));
  if (!current) return '';

  for (let i = 0; i < maxHops; i += 1) {
    const next = await resolveFinalUrl(current, { timeoutMs });
    if (!next) return current;
    if (next === current) return next;

    const host = normalizeHost(next);
    if (!isShortenerHost(host)) return next;

    current = next;
  }

  return current;
}

module.exports = {
  sanitizePastedUrl,
  toCanonicalUrl,
  normalizeAffiliateInputUrl,
  normalizeHost,
  normalizeMyntraUrl,
  makeProviderSafeUrl,
  resolveFinalUrl,
  resolveFinalUrlDeep,
  // for custom logic/testing
  toMerchantSafeUrl,
  cleanupTrailingUrlJunk,
  isShortenerHost
};