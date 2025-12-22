// Robust Cuelinks client with header fallbacks and better errors.
// Uses global fetch (Node 18+) or undici.fetch (npm i undici)

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('undici').fetch; } catch { throw new Error('No fetch available. Install undici or use Node 18+'); }
}

const API_BASE = process.env.CUELINKS_API_BASE || 'https://www.cuelinks.com/api/v2';
const API_KEY = process.env.CUELINKS_API_KEY;
const DEBUG = String(process.env.CUELINKS_DEBUG || '').toLowerCase() === 'true';
const CUELINKS_COUNTRY_ID = process.env.CUELINKS_COUNTRY_ID || '';

function assertKey() { if (!API_KEY) throw new Error('Missing CUELINKS_API_KEY'); }
function headerVariants() {
  assertKey();
  const base = { Accept: 'application/json' };
  return [
    { ...base, token: API_KEY }, // per docs
    { ...base, Authorization: `Token token=${API_KEY}` }, // alt style
    { ...base, Authorization: `Bearer ${API_KEY}` }, // last resort
  ];
}
async function fetchWithVariants(url, options = {}) {
  const variants = headerVariants();
  let lastErr = null;
  for (let i = 0; i < variants.length; i++) {
    const hdrs = { ...(options.headers || {}), ...variants[i] };
    const res = await fetchFn(url, { ...options, headers: hdrs });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    if (DEBUG) console.log('[CUELINKS]', res.status, url, 'v=', i, 'resp=', text?.slice(0, 400));
    if (res.ok) return { res, json };
    if (res.status === 401 || res.status === 403) { lastErr = new Error(json?.message || json?.error || `Unauthorized (${res.status})`); lastErr.status = res.status; lastErr.body = json || text; continue; }
    const err = new Error(json?.message || json?.error || `Cuelinks error (${res.status})`); err.status = res.status; err.body = json || text; throw err;
  }
  if (lastErr) throw lastErr;
  throw new Error('Cuelinks request failed (no header variant worked)');
}

/**
 * GET /links.json: build affiliate/short URL for a destination
 * Params: url (required), shorten=true, subid[, subid2..subid5] optional, channel_id optional
 */
async function buildDeeplink({ url, subid, channel_id, subid2, subid3, subid4, subid5 }) {
  assertKey();
  if (!url) throw new Error('url required');

  const params = new URLSearchParams();
  params.set('url', url);
  params.set('shorten', 'true');
  if (subid) params.set('subid', subid);
  if (subid2) params.set('subid2', subid2);
  if (subid3) params.set('subid3', subid3);
  if (subid4) params.set('subid4', subid4);
  if (subid5) params.set('subid5', subid5);
  if (channel_id) params.set('channel_id', channel_id);

  const endpoint = `${API_BASE}/links.json?${params.toString()}`;
  const { json } = await fetchWithVariants(endpoint, { method: 'GET' });

  const short =
    json?.short_url ||
    json?.shortened_url ||
    json?.link?.short_url ||
    json?.link?.shortened_url ||
    json?.data?.short_url ||
    json?.data?.shortened_url ||
    null;

  const affiliate =
    json?.affiliate_url ||
    json?.link?.affiliate_url ||
    json?.data?.affiliate_url ||
    null;

  if (short) return short;
  if (affiliate) return affiliate;

  const err = new Error('Cuelinks: no short_url in response');
  err.body = json;
  throw err;
}

/**
 * GET /campaigns.json: fetch campaign list (India by default via env)
 */
async function getCampaigns({ search_term = '', page = 1, per_page = 30, country_id, categories } = {}) {
  assertKey();
  const params = new URLSearchParams();
  if (search_term) params.set('search_term', search_term);
  params.set('page', String(page));
  params.set('per_page', String(per_page));
  const cid = country_id || CUELINKS_COUNTRY_ID;
  if (cid) params.set('country_id', String(cid));
  if (categories) params.set('categories', String(categories));
  const endpoint = `${API_BASE}/campaigns.json?${params.toString()}`;
  const { json } = await fetchWithVariants(endpoint, { method: 'GET' });
  return json;
}

module.exports = { buildDeeplink, getCampaigns };