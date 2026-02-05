// Cuelinks link generator used by universal linkifyService.
// Use the same v2 API as services/cuelinks.js (links.json) instead of /link/convert (which can 404).

const crypto = require('crypto');
const { buildDeeplink } = require('../cuelinks');

async function buildAffiliateLink({ originalUrl }) {
  try {
    if (!originalUrl) return { success: false, error: 'originalUrl required' };

    // Optional: attach a random subid for tracking on Cuelinks side
    const subid = `gen-${crypto.randomBytes(4).toString('hex')}`;

    const link = await buildDeeplink({ url: originalUrl, subid });
    return { success: true, link, raw: { subid } };
  } catch (err) {
    const msg = String(err?.message || 'Cuelinks error');
    return { success: false, error: msg, raw: err?.body || null };
  }
}

module.exports = { buildAffiliateLink };