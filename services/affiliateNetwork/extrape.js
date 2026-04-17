// Simple Extrape Flipkart/Shopsy affiliate builder: appends required query params.
// Example template received:
// https://www.flipkart.com/?affid=adminnxtify&affExtParam1=EPTG2738645&affExtParam2={subid}

const { SHORTENER_CANONICAL_MAP } = require('../storeResolver');

/**
 * Returns true if the host is a domain that Extrape supports as an affiliate partner
 * (Flipkart, Shopsy, and any known shortener that resolves to one of them).
 */
function isExtrapeCompatibleHost(host) {
  if (
    host === 'flipkart.com' ||
    host.endsWith('.flipkart.com') ||
    host === 'dl.flipkart.com'
  ) return true;

  if (host === 'shopsy.in' || host.endsWith('.shopsy.in')) return true;

  // Accept known shortener/alias domains that redirect to Flipkart or Shopsy.
  // This covers cases where URL resolution timed out and the shortener host is
  // passed directly to the builder.
  const canonical = SHORTENER_CANONICAL_MAP[host];
  return canonical === 'flipkart.com' || canonical === 'shopsy.in';
}

function buildAffiliateLink({ originalUrl, affid, affExtParam1, subid }) {
  if (!originalUrl) throw Object.assign(new Error('originalUrl required'), { code: 'bad_request' });
  if (!affid) throw Object.assign(new Error('Missing EXTRAPE_AFFID'), { code: 'missing_extrape_affid' });
  if (!subid) throw Object.assign(new Error('subid required'), { code: 'missing_subid' });

  let u;
  try {
    u = new URL(originalUrl);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { code: 'bad_request' });
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (!isExtrapeCompatibleHost(host)) {
    throw Object.assign(
      new Error(`Extrape builder only supports Flipkart/Shopsy URLs (got: ${host})`),
      { code: 'unsupported_domain' }
    );
  }

  // Append or override required params
  u.searchParams.set('affid', affid);
  if (affExtParam1) u.searchParams.set('affExtParam1', affExtParam1);
  u.searchParams.set('affExtParam2', subid);

  return { url: u.toString() };
}

module.exports = { buildAffiliateLink };