let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Install undici or use Node 18+'); }
}

const API_BASE = process.env.TRACKIER_API_BASE || 'https://api.trackier.com';
const API_KEY = process.env.TRACKIER_API_KEY || '';
const DEBUG = String(process.env.TRACKIER_DEBUG || '').toLowerCase() === 'true';

function assertKey() {
  if (!API_KEY) {
    const err = new Error('Missing TRACKIER_API_KEY');
    err.code = 'missing_trackier_key';
    throw err;
  }
}

async function postJson(url, body) {
  assertKey();
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (DEBUG) {
    console.log('[TRACKIER]', res.status, url);
    console.log('[TRACKIER] req=', JSON.stringify(body)?.slice(0, 800));
    console.log('[TRACKIER] resp=', (text || '').slice(0, 800));
  }

  if (!res.ok) {
    const err = new Error(json?.message || `Trackier error (${res.status})`);
    err.status = res.status;
    err.body = json || text;

    // normalize auth/permission errors
    if (res.status === 401) err.code = 'trackier_invalid_key';
    else if (res.status === 403) err.code = 'trackier_forbidden';
    else err.code = 'trackier_error';

    throw err;
  }

  return json;
}

/**
 * Generate deeplink using bulk endpoint (single item)
 * Throws on failure (strict)
 */
async function buildDeeplink({ url, campaignId, adnParams = null, encodeURL = false }) {
  if (!url) {
    const err = new Error('url required');
    err.code = 'bad_request';
    throw err;
  }
  if (!campaignId) {
    const err = new Error('Missing Trackier campaignId for this domain');
    err.code = 'missing_campaign_id';
    throw err;
  }

  const endpoint = `${API_BASE}/v2/publishers/bulk-deeplink`;
  const payload = {
    deeplinks: [{ url, campaignIds: [String(campaignId)] }],
    encodeURL: Boolean(encodeURL)
  };
  if (adnParams && typeof adnParams === 'object') payload.adnParams = adnParams;

  const json = await postJson(endpoint, payload);

  const outUrl = json?.deeplinks?.[0]?.url || null;
  if (!outUrl) {
    const err = new Error('Trackier did not return a deeplink');
    err.code = 'trackier_no_deeplink';
    err.body = json;
    throw err;
  }

  return { url: outUrl, raw: json };
}

module.exports = { buildDeeplink };