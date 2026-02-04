// Trackier (VCommission) client for deeplink generation
// Docs: POST https://api.trackier.com/v2/publishers/bulk-deeplink
// Auth header: X-Api-Key: <API_KEY>

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Install undici or use Node 18+'); }
}

const API_BASE = process.env.TRACKIER_API_BASE || 'https://api.trackier.com';
const API_KEY = process.env.TRACKIER_API_KEY || '';
const DEBUG = String(process.env.TRACKIER_DEBUG || '').toLowerCase() === 'true';

function assertKey() {
  if (!API_KEY) throw new Error('Missing TRACKIER_API_KEY');
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
    console.log('[TRACKIER]', res.status, url, 'body=', JSON.stringify(body)?.slice(0, 800));
    console.log('[TRACKIER]', 'resp=', (text || '').slice(0, 800));
  }

  if (!res.ok) {
    const err = new Error(json?.message || `Trackier error (${res.status})`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

/**
 * Generate single deeplink using bulk endpoint
 * @param {string} originalUrl
 * @param {string|number} campaignId
 * @param {object} adnParams optional {p1..p15}
 * @returns {string} deeplink url
 */
async function buildAffiliateLink({ originalUrl, campaignId, adnParams = null, encodeURL = false }) {
  if (!originalUrl) return { success: false, error: 'originalUrl required' };
  if (!campaignId) return { success: false, error: 'campaignId required' };

  try {
    const endpoint = `${API_BASE}/v2/publishers/bulk-deeplink`;
    const payload = {
      deeplinks: [{ url: originalUrl, campaignIds: [String(campaignId)] }],
      encodeURL: Boolean(encodeURL)
    };
    if (adnParams && typeof adnParams === 'object') payload.adnParams = adnParams;

    const json = await postJson(endpoint, payload);

    const link = json?.deeplinks?.[0]?.url || null;
    if (!link) return { success: false, error: 'No deeplink returned', raw: json };

    return { success: true, link, raw: json };
  } catch (err) {
    return { success: false, error: err.message || 'Trackier error', raw: err.body || null };
  }
}

module.exports = { buildAffiliateLink };