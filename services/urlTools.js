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

/**
 * Myntra app/share links sometimes contain '&' in the PATH slug.
 * That breaks vcommission's click wrapper.
 *
 * Fix strategy: extract productId and rebuild a safe Myntra URL that always works.
 */
function normalizeMyntraUrl(inputUrl) {
  try {
    const u = new URL(inputUrl);
    const host = normalizeHost(inputUrl);
    if (!(host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it')) return inputUrl;

    const path = u.pathname || '';
    // Myntra PDP usually contains "/<productId>/" somewhere
    const m = path.match(/\/(\d{6,12})(\/|$)/);
    const productId = m?.[1] || null;

    if (!productId) return inputUrl;

    // safest short canonical PDP: /<productId>
    // keep utm params optional (not needed for tracking; trackier will wrap anyway)
    return `https://www.myntra.com/${productId}`;
  } catch {
    return inputUrl;
  }
}

/**
 * Make URL safe to send to Trackier/VCommission:
 * - sanitize/canonicalize
 * - for Myntra, rebuild using productId to avoid '&' in path
 */
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

async function resolveFinalUrl(inputUrl, { maxHops = 8, timeoutMs = 8000 } = {}) {
  if (!isHttpUrl(inputUrl)) return inputUrl;

  let current = inputUrl;
  for (let i = 0; i < maxHops; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      let res = await fetchFn(current, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        continue;
      }

      if (res.status === 405 || res.status === 403 || res.status === 400) {
        res = await fetchFn(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          current = new URL(res.headers.get('location'), current).toString();
          continue;
        }
      }

      return current;
    } catch {
      return current;
    } finally {
      clearTimeout(t);
    }
  }

  return current;
}

module.exports = {
  sanitizePastedUrl,
  toCanonicalUrl,
  normalizeAffiliateInputUrl,
  normalizeMyntraUrl,
  makeProviderSafeUrl,
  resolveFinalUrl
};