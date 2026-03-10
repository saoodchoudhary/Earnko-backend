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

async function resolveStoreByUrl(url) {
  const host = normalizeHost(url);
  if (!host) return null;

  const stores = await Store.find({ isActive: true }).select('_id name baseUrl trackingUrl affiliateNetwork').lean();

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