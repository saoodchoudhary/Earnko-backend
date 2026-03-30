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
 * Resolve store by URL in a deterministic way:
 * - Collect all matching stores (baseUrl host or trackingUrl host)
 * - Pick the most specific match (longest matched host)
 * This prevents wrong provider selection when multiple stores partially match.
 */
async function resolveStoreByUrl(url) {
  const host = normalizeHost(url);
  if (!host) return null;

  const stores = await Store.find({ isActive: true })
    .select('_id name baseUrl trackingUrl affiliateNetwork')
    .lean();

  const candidates = [];

  for (const s of stores) {
    const baseHost = normalizeAnyUrlToHost(s.baseUrl);
    const trackHost = normalizeAnyUrlToHost(s.trackingUrl);

    let matchedHost = '';

    if (hostMatches(host, baseHost)) matchedHost = baseHost;
    if (hostMatches(host, trackHost) && trackHost.length > matchedHost.length) matchedHost = trackHost;

    if (matchedHost) candidates.push({ store: s, matchedHost });
  }

  if (candidates.length === 0) return null;

  // longest host wins (most specific)
  candidates.sort((a, b) => {
    const d = (b.matchedHost || '').length - (a.matchedHost || '').length;
    if (d !== 0) return d;
    // stable fallback
    return String(a.store?.name || '').localeCompare(String(b.store?.name || ''));
  });

  return candidates[0].store;
}

module.exports = { resolveStoreByUrl };