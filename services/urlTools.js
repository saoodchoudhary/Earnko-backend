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
  if (!inputUrl) return inputUrl;
  let s = String(inputUrl);
  // remove trailing punctuation commonly copied from chats
  s = s.replace(/[)\],.]+$/g, '');
  return s;
}

function toMerchantSafeUrl(inputUrl) {
  if (!inputUrl) return '';
  try {
    const u = new URL(inputUrl);
    if (u.search === '?') u.search = '';
    return cleanupTrailingUrlJunk(u.toString());
  } catch {
    return cleanupTrailingUrlJunk(String(inputUrl));
  }
}

function normalizeAffiliateInputUrl(input) {
  const s = cleanupTrailingUrlJunk(sanitizePastedUrl(input));
  if (!s) return '';
  return toMerchantSafeUrl(toCanonicalUrl(s));
}

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * NEW: Normalize/alias hosts so Store detection works even if resolved URL lands on alternate domains.
 * Example: dl.flipkart.com -> flipkart.com
 */
function normalizeStoreHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').trim();
  if (!h) return '';

  // Flipkart variants
  if (h === 'dl.flipkart.com') return 'flipkart.com';
  if (h.endsWith('.flipkart.com')) return 'flipkart.com';

  // Myntra short domain
  if (h === 'myntr.it') return 'myntra.com';

  // Ajio app/short domains
  if (h === 'ajioapps.onelink.me' || h === 'ajio.page.link') return 'ajio.com';
  if (h.endsWith('.onelink.me')) return 'ajio.com';

  // Shopsy sometimes has subdomains
  if (h.endsWith('.shopsy.in')) return 'shopsy.in';

  // Earnko short domain stays as earnko.com (storeResolver should ignore it by using resolved final URL)
  return h;
}

function normalizeUrlToStoreHost(url) {
  const host = normalizeHost(url);
  return normalizeStoreHost(host);
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

// ==================== ULTRA-FAST FINAL URL RESOLVER =====================

async function resolveFinalUrl(inputUrl, { timeoutMs = 2000 } = {}) {
  if (!isHttpUrl(inputUrl)) return inputUrl;

  let host = '';
  try { host = new URL(inputUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch {}

  // Direct merchant/product url: return instantly
  if (!isShortenerHost(host)) return toMerchantSafeUrl(inputUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; EarnkoBot/1.0; +https://earnko.com)'
  };

  try {
    try {
      const res = await fetchFn(inputUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers
      });
      return res?.url ? toMerchantSafeUrl(res.url) : toMerchantSafeUrl(inputUrl);
    } catch {
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

async function resolveFinalUrlDeep(inputUrl, { timeoutMs = 2000, maxHops = 3 } = {}) {
  let current = toMerchantSafeUrl(toCanonicalUrl(sanitizePastedUrl(inputUrl)));
  for (let i = 0; i < maxHops; i += 1) {
    const next = await resolveFinalUrl(current, { timeoutMs });
    if (!next || next === current) return next || current;

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

  // ✅ NEW exports (used by storeResolver)
  normalizeStoreHost,
  normalizeUrlToStoreHost,

  normalizeMyntraUrl,
  makeProviderSafeUrl,
  resolveFinalUrl,
  resolveFinalUrlDeep,

  // for custom logic/testing
  toMerchantSafeUrl,
  cleanupTrailingUrlJunk,
  isShortenerHost
};