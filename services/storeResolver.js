const Store = require('../models/Store');

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeAnyUrlToHost(v) {
  if (!v) return '';
  let raw = String(v).trim();
  if (!raw) return '';
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) raw = `https://${raw}`;
  return normalizeHost(raw);
}

function hostMatches(urlHost, storeHost) {
  if (!urlHost || !storeHost) return false;
  return urlHost === storeHost || urlHost.endsWith(`.${storeHost}`);
}

/**
 * ✅ NEW: known Flipkart short domains (user-provided)
 * NOTE: tinyurl.com is generic (not always Flipkart) — mapping it to Flipkart can create wrong detection.
 * If you want strict correctness, remove tinyurl.com from this list.
 */
function isKnownFlipkartShortHost(host) {
  const h = String(host || '').toLowerCase();
  return (
    h === 'fkrt.cc' || h.endsWith('.fkrt.cc') ||
    h === 'fktr.in' || h.endsWith('.fktr.in') ||
    h === 'fkrt.to' || h.endsWith('.fkrt.to') ||
    h === 'fpkrt.cc' || h.endsWith('.fpkrt.cc') ||
    h === 'zngy.in' || h.endsWith('.zngy.in') ||
    h === 'extp.in' || h.endsWith('.extp.in') ||
    h === 'hyyzo.com' || h.endsWith('.hyyzo.com') ||
    h === 'fkrt.cc' ||
    // generic shortener (risky)
    h === 'tinyurl.com' || h.endsWith('.tinyurl.com')
  );
}

async function resolveFlipkartStore(stores) {
  // find an active store which maps to flipkart.com
  for (const s of stores) {
    const baseHost = normalizeAnyUrlToHost(s.baseUrl);
    const trackHost = normalizeAnyUrlToHost(s.trackingUrl);

    if (
      baseHost === 'flipkart.com' || baseHost.endsWith('.flipkart.com') ||
      trackHost === 'flipkart.com' || trackHost.endsWith('.flipkart.com') ||
      baseHost === 'dl.flipkart.com' || trackHost === 'dl.flipkart.com' ||
      baseHost === 'fkrt.it' || trackHost === 'fkrt.it'
    ) {
      return s;
    }
  }
  return null;
}

async function resolveStoreByUrl(url) {
  const host = normalizeHost(url);
  if (!host) return null;

  const stores = await Store.find({ isActive: true }).select('_id name baseUrl trackingUrl affiliateNetwork').lean();

  // ✅ shortcut: if URL is from known Flipkart short host, return Flipkart store directly
  if (isKnownFlipkartShortHost(host)) {
    const fk = await resolveFlipkartStore(stores);
    if (fk) return fk;
    // if flipkart store not configured in DB, fall through to normal matching
  }

  for (const s of stores) {
    const baseHost = normalizeAnyUrlToHost(s.baseUrl);
    const trackHost = normalizeAnyUrlToHost(s.trackingUrl);

    if (hostMatches(host, baseHost) || hostMatches(host, trackHost)) {
      return s;
    }
  }

  return null;
}

module.exports = { resolveStoreByUrl };