// Simple Extrape Flipkart affiliate builder: appends required query params.
// Example template received:
// https://www.flipkart.com/?affid=adminnxtify&affExtParam1=EPTG2738645&affExtParam2={subid}

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
  const host = u.hostname.toLowerCase();
  if (!host.includes('flipkart.com')) {
    throw Object.assign(new Error('Extrape builder only supports flipkart.com'), { code: 'unsupported_domain' });
  }

  // Append or override required params
  u.searchParams.set('affid', affid);
  if (affExtParam1) u.searchParams.set('affExtParam1', affExtParam1);
  u.searchParams.set('affExtParam2', subid);

  return { url: u.toString() };
}

module.exports = { buildAffiliateLink };