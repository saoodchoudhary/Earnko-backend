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
 * Maps known URL-shortener / affiliate-tracking hosts to the canonical merchant
 * host that a store's baseUrl is likely configured with.  This lets the resolver
 * find the correct store even when the raw input URL has not yet been expanded
 * (e.g. when resolveFinalUrl times out or the short URL is passed directly).
 */
const SHORTENER_CANONICAL_MAP = {
  // Flipkart short-link domains
  'fkrt.it':        'flipkart.com',
  'fkrt.cc':        'flipkart.com',
  'fktr.in':        'flipkart.com',
  'fkrt.to':        'flipkart.com',
  'fpkrt.cc':       'flipkart.com',
  'zngy.in':        'flipkart.com',
  'hyyzo.com':      'flipkart.com',
  'extp.in':        'flipkart.com',
  'dl.flipkart.com': 'flipkart.com',
  // Myntra short-link domain
  'myntr.it':       'myntra.com',
};

/**
 * Resolve store by URL in a deterministic way:
 * - Collect all matching stores (baseUrl host or trackingUrl host)
 * - Also check the canonical merchant domain when the input host is a known
 *   shortener alias (e.g. fktr.in → flipkart.com)
 * - Pick the most specific match (longest matched host)
 * This prevents wrong provider selection when multiple stores partially match.
 */
async function resolveStoreByUrl(url) {
  const host = normalizeHost(url);
  if (!host) return null;

  // Build the set of hosts to match against store baseUrl / trackingUrl.
  // Include the canonical merchant domain for known shortener hosts so that a
  // Flipkart store configured with baseUrl=flipkart.com is found even when the
  // caller passes a fktr.in URL (e.g. if redirect resolution timed out).
  const hostsToCheck = new Set([host]);
  const canonicalHost = SHORTENER_CANONICAL_MAP[host];
  if (canonicalHost) hostsToCheck.add(canonicalHost);

  const stores = await Store.find({ isActive: true })
    .select('_id name baseUrl trackingUrl affiliateNetwork')
    .lean();

  const candidates = [];

  for (const s of stores) {
    const baseHost = normalizeAnyUrlToHost(s.baseUrl);
    const trackHost = normalizeAnyUrlToHost(s.trackingUrl);

    let matchedHost = '';

    for (const checkHost of hostsToCheck) {
      if (hostMatches(checkHost, baseHost) && baseHost.length > matchedHost.length) {
        matchedHost = baseHost;
      }
      if (hostMatches(checkHost, trackHost) && trackHost.length > matchedHost.length) {
        matchedHost = trackHost;
      }
    }

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

module.exports = { resolveStoreByUrl, SHORTENER_CANONICAL_MAP };