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

/**
 * Fix common pasted URL issues that break merchant deeplinks:
 * - trailing '?' or '&'
 * - trailing '#'
 * - accidental whitespace already removed in sanitizePastedUrl
 */
function cleanupTrailingUrlJunk(inputUrl) {
  if (!inputUrl) return '';
  let s = String(inputUrl).trim();

  // remove trailing fragments-only markers (rare)
  while (s.endsWith('#')) s = s.slice(0, -1);

  // remove trailing ? or & (AJIO/others sometimes redirect home if URL malformed)
  while (s.endsWith('?') || s.endsWith('&')) s = s.slice(0, -1);

  return s;
}

/**
 * Canonicalize in a "merchant-safe" way:
 * - Use URL parser when possible
 * - Remove trailing '?'/'&'
 * - Keep querystring (do not remove tracking params)
 */
function toMerchantSafeUrl(inputUrl) {
  const cleaned = cleanupTrailingUrlJunk(inputUrl);
  if (!cleaned) return '';

  try {
    const u = new URL(cleaned);

    // Some URLs can end up like "...?"; URL() may keep it as empty search anyway
    // Normalize it:
    if (u.search === '?') u.search = '';

    // Also strip trailing junk again post-normalization
    return cleanupTrailingUrlJunk(u.toString());
  } catch {
    // If URL() fails, still return best-effort cleaned
    return cleanupTrailingUrlJunk(cleaned);
  }
}

function normalizeAffiliateInputUrl(input) {
  const cleaned = sanitizePastedUrl(input);
  if (!cleaned) return '';

  // IMPORTANT: use merchant-safe canonicalization
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

/**
 * Myntra app/share links sometimes contain '&' in the PATH slug.
 * That breaks vcommission's click wrapper.
 *
 * Fix strategy: extract productId and rebuild a safe Myntra URL that always works.
 */
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

/**
 * Make URL safe to send to Trackier/VCommission (and also as merchant landing):
 * - sanitize/canonicalize
 * - for Myntra, rebuild using productId to avoid '&' in path
 * - cleanup trailing '?'/'&'
 */
function makeProviderSafeUrl(inputUrl) {
  const base = toMerchantSafeUrl(toCanonicalUrl(sanitizePastedUrl(inputUrl)));
  const host = normalizeHost(base);

  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') {
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

// Private/internal IP ranges that must not be fetched (SSRF prevention)
const PRIVATE_IP_RE = /^(127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1$|fc|fd|fe80)/i;

function isSsrfSafeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (PRIVATE_IP_RE.test(host)) return false;
    // Reject bare IPs that might resolve internally
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && PRIVATE_IP_RE.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve final URL for short/app links (Ajio OneLink, fkrt.it, etc).
 * Try GET first, then fallback to HEAD if GET fails.
 * Each attempt uses its own AbortController so a GET timeout does not
 * poison the subsequent HEAD attempt.
 */
async function resolveFinalUrl(inputUrl, { timeoutMs = 5000 } = {}) {
  if (!isHttpUrl(inputUrl)) return inputUrl;
  if (!isSsrfSafeUrl(inputUrl)) return inputUrl;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; EarnkoBot/1.0; +https://earnko.com)'
  };

  // 1) GET (best for providers that only redirect on GET)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(inputUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers
      });
      const resolved = res?.url ? toMerchantSafeUrl(res.url) : toMerchantSafeUrl(inputUrl);
      // Validate resolved URL is also safe before returning
      return isSsrfSafeUrl(resolved) ? resolved : toMerchantSafeUrl(inputUrl);
    } finally {
      clearTimeout(t);
    }
  } catch {
    // 2) HEAD fallback (some providers block GET) — fresh AbortController
    try {
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), timeoutMs);
      try {
        const res2 = await fetchFn(inputUrl, {
          method: 'HEAD',
          redirect: 'follow',
          signal: ctrl2.signal,
          headers
        });
        const resolved2 = res2?.url ? toMerchantSafeUrl(res2.url) : toMerchantSafeUrl(inputUrl);
        return isSsrfSafeUrl(resolved2) ? resolved2 : toMerchantSafeUrl(inputUrl);
      } finally {
        clearTimeout(t2);
      }
    } catch {
      return toMerchantSafeUrl(inputUrl);
    }
  }
}

module.exports = {
  sanitizePastedUrl,
  toCanonicalUrl,
  normalizeAffiliateInputUrl,
  normalizeMyntraUrl,
  makeProviderSafeUrl,
  resolveFinalUrl,

  // exported for reuse/testing if needed
  toMerchantSafeUrl,
  cleanupTrailingUrlJunk
};