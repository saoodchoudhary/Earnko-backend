const shortid = require('shortid');
const User = require('../models/User');
const Store = require('../models/Store');
const cuelinks = require('./affiliateNetwork/cuelinks');

function detectStoreFromUrl(inputUrl) {
  try {
    const u = new URL(inputUrl);
    const host = u.hostname.toLowerCase();
    if (host.includes('amazon.')) return 'amazon';
    if (host.includes('flipkart.')) return 'flipkart';
    return null;
  } catch (e) {
    return null;
  }
}

async function createAffiliateLink({ user, url, storeId = null }) {
  // try Cuelinks first
  const cuelinksResp = await cuelinks.buildAffiliateLink({ originalUrl: url });
  if (cuelinksResp.success && cuelinksResp.link) {
    const slug = shortid.generate();
    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: storeId || null,
      customSlug: slug,
      metadata: { provider: 'cuelinks', originalUrl: url, raw: cuelinksResp.raw, generatedLink: cuelinksResp.link }
    });
    await user.save();
    return { link: cuelinksResp.link, method: 'cuelinks', productId: cuelinksResp.raw?.product_id || null };
  }

  // fallback: create internal redirect
  const slug = shortid.generate();
  user.affiliateInfo.isAffiliate = true;
  user.affiliateInfo.uniqueLinks.push({
    store: storeId || null,
    customSlug: slug,
    metadata: { type: 'internal', originalUrl: url }
  });
  await user.save();
  const internalLink = `${process.env.FRONTEND_URL}/redirect/${slug}`;
  return { link: internalLink, method: 'internal', slug };
}

module.exports = { createAffiliateLink, detectStoreFromUrl };