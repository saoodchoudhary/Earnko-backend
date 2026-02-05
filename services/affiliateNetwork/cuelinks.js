const crypto = require('crypto');
const { buildDeeplink } = require('../cuelinks');

async function buildAffiliateLink({ originalUrl, subid = null }) {
  try {
    if (!originalUrl) return { success: false, error: 'originalUrl required' };

    const effectiveSubid = subid || `gen-${crypto.randomBytes(4).toString('hex')}`;
    const link = await buildDeeplink({ url: originalUrl, subid: effectiveSubid });

    return { success: true, link, raw: { subid: effectiveSubid } };
  } catch (err) {
    const msg = String(err?.message || 'Cuelinks error');
    return { success: false, error: msg, raw: err?.body || null };
  }
}

module.exports = { buildAffiliateLink };