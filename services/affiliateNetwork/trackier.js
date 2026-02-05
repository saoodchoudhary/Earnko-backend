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

/**
 * Safe cleanup:
 * - trim
 * - remove newlines/tabs (paste artifacts)
 * - decode &amp;
 * NOTE: We do NOT remove all spaces blindly here.
 */
function cleanUrlString(s) {
  if (s == null) return '';
  let out = String(s).trim();
  out = out.replace(/[\r\n\t]+/g, '');
  out = out.replace(/&amp;/gi, '&');
  return out;
}

function toCanonicalUrl(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.toString();
  } catch {
    return inputUrl;
  }
}

/**
 * Keep only known vcommission click params to avoid garbage params created by broken destination slugs.
 * Add more keys if needed later.
 */
const VCOM_ALLOWLIST = new Set([
  'campaign_id',
  'pub_id',
  'click_id',
  'clickid',
  'cid',
  'txn_id',
  'txnid',
  'transaction_id',
  'order_id',
  'orderid',
  'sale_amount',
  'amount',
  'payout',
  'currency',
  'conversion_status',
  'status',
  'campaignId',
  'p1',
  'p2',
  'p3',
  'p4',
  'p5'
]);

/**
 * STRICTLY encode url= param for vcommission click links.
 * Also drops garbage query keys which sometimes appear when Trackier returns broken url values.
 */
function repairVcommissionClickUrl(maybeClickUrl) {
  const s = cleanUrlString(maybeClickUrl);

  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const isVcom = host === 'track.vcommission.com' || host.endsWith('vcommission.com');
    if (!isVcom) return toCanonicalUrl(s);

    // destination URL might already be truncated if provider returned broken query.
    const rawDest = u.searchParams.get('url');
    if (!rawDest) return toCanonicalUrl(s);

    const destCanonical = toCanonicalUrl(cleanUrlString(rawDest));
    const encodedDest = encodeURIComponent(destCanonical);

    // rebuild query using allowlist (prevents "&-iron-oxides...=..." garbage keys)
    const original = new URLSearchParams(u.search);
    const kept = [];
    for (const [k, v] of original.entries()) {
      if (k === 'url') continue;
      if (VCOM_ALLOWLIST.has(k)) kept.push([k, v]);
    }

    const keptQs = new URLSearchParams(kept).toString();
    const finalQs = keptQs ? `${keptQs}&url=${encodedDest}` : `url=${encodedDest}`;

    return `${u.origin}${u.pathname}?${finalQs}`;
  } catch {
    return toCanonicalUrl(s);
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

    if (res.status === 401) err.code = 'trackier_invalid_key';
    else if (res.status === 403) err.code = 'trackier_forbidden';
    else err.code = 'trackier_error';

    throw err;
  }

  return json;
}

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

  const normalizedInput = toCanonicalUrl(cleanUrlString(url));

  const endpoint = `${API_BASE}/v2/publishers/bulk-deeplink`;
  const payload = {
    deeplinks: [{ url: normalizedInput, campaignIds: [String(campaignId)] }],
    encodeURL: Boolean(encodeURL)
  };
  if (adnParams && typeof adnParams === 'object') payload.adnParams = adnParams;

  const json = await postJson(endpoint, payload);

  const outUrlRaw = json?.deeplinks?.[0]?.url || null;
  if (!outUrlRaw) {
    const err = new Error('Trackier did not return a deeplink');
    err.code = 'trackier_no_deeplink';
    err.body = json;
    throw err;
  }

  // Normalize provider output
  const outUrl = repairVcommissionClickUrl(outUrlRaw);
  return { url: outUrl, raw: json };
}

module.exports = { buildDeeplink };