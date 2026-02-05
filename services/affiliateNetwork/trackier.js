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

function cleanUrlString(s) {
  if (s == null) return '';
  let out = String(s).trim();
  out = out.replace(/[\r\n\t]+/g, '');
  out = out.replace(/\s+/g, '');
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
 * STRICTLY encode url= param for vcommission click links.
 * We do NOT rely on URLSearchParams encoding here; we force encodeURIComponent
 * because the destination may contain reserved characters like '&' in path/query.
 */
function repairVcommissionClickUrl(maybeClickUrl) {
  const s = cleanUrlString(maybeClickUrl);

  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const isVcom = host === 'track.vcommission.com' || host.endsWith('vcommission.com');

    if (!isVcom) return toCanonicalUrl(s);

    const rawDest = u.searchParams.get('url');
    if (!rawDest) return toCanonicalUrl(s);

    // Canonicalize the destination first
    const destCanonical = toCanonicalUrl(cleanUrlString(rawDest));

    // Now rebuild query string manually with strict encoding for url=
    const params = new URLSearchParams(u.search);
    params.delete('url');
    // Force strict encode
    const encodedDest = encodeURIComponent(destCanonical);
    // URLSearchParams will encode again if we set encoded string, so we append manually.
    // Build final query:
    const baseQs = params.toString();
    const finalQs = baseQs ? `${baseQs}&url=${encodedDest}` : `url=${encodedDest}`;

    // Keep same origin + pathname
    const out = `${u.origin}${u.pathname}?${finalQs}`;
    return out;
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

  const outUrl = repairVcommissionClickUrl(outUrlRaw);
  return { url: outUrl, raw: json };
}

module.exports = { buildDeeplink };