const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Store = require('../models/Store');
const Click = require('../models/Click');

// Providers
const { buildDeeplink: buildCuelinksDeeplink } = require('../services/cuelinks'); // v2 links.json
const trackier = require('../services/affiliateNetwork/trackier'); // strict throws, returns {url}
const extrape = require('../services/affiliateNetwork/extrape');   // returns {url}

const router = express.Router();

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pickProviderByUrl(url) {
  const host = normalizeHost(url);

  if (host === 'flipkart.com' || host.endsWith('.flipkart.com')) return 'extrape';
  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') return 'trackier';
  if (host === 'ajio.com' || host.endsWith('.ajio.com')) return 'trackier';
  if (host === 'tirabeauty.com' || host.endsWith('.tirabeauty.com')) return 'trackier';

  return 'cuelinks';
}

function getTrackierCampaignId(url) {
  const host = normalizeHost(url);

  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') {
    return process.env.TRACKIER_MYNTRA_CAMPAIGN_ID || process.env.TRACKIER_MYNTTRA_CAMPAIGN_ID || '';
  }
  if (host === 'ajio.com' || host.endsWith('.ajio.com')) return process.env.TRACKIER_AJIO_CAMPAIGN_ID || '';
  if (host === 'tirabeauty.com' || host.endsWith('.tirabeauty.com')) return process.env.TRACKIER_TIRABEAUTY_CAMPAIGN_ID || '';
  return '';
}

async function buildUniversalAffiliateUrl({ destinationUrl, clickId }) {
  const provider = pickProviderByUrl(destinationUrl);

  if (provider === 'extrape') {
    const affid = process.env.EXTRAPE_AFFID || 'adminnxtify';
    const affExtParam1 = process.env.EXTRAPE_AFF_EXT_PARAM1 || 'EPTG2738645';
    const { url } = extrape.buildAffiliateLink({
      originalUrl: destinationUrl,
      affid,
      affExtParam1,
      subid: clickId
    });
    return url;
  }

  if (provider === 'trackier') {
    const campaignId = getTrackierCampaignId(destinationUrl);
    const adnParams = { p1: clickId }; // important: so postback can return click mapping
    const { url } = await trackier.buildDeeplink({
      url: destinationUrl,
      campaignId,
      adnParams,
      encodeURL: false
    });
    return url;
  }

  // default cuelinks
  // clickId passed as subid for postback mapping
  const url = await buildCuelinksDeeplink({ url: destinationUrl, subid: clickId });
  return url;
}

/**
 * Tracking redirect for a product.
 * This creates a Click entry and redirects to provider affiliate URL.
 *
 * GET /api/tracking/product/:productId
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }

    const product = await Product.findById(productId).lean();
    if (!product) return res.redirect(process.env.FRONTEND_URL || '/');

    const store = product.store ? await Store.findById(product.store).lean() : null;

    const destination = product.deeplink || store?.baseUrl || (process.env.FRONTEND_URL || 'http://localhost:3000');

    // Create click id (this is the "subid" / click_id used in postbacks)
    const rand = crypto.randomBytes(4).toString('hex');
    const clickId = `p${productId}-${rand}`;

    await Click.create({
      clickId,
      user: null, // product click can be anonymous unless you want to attach logged-in user
      store: store?._id || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer') || null,
      customSlug: null,
      affiliateLink: null,
      metadata: { productId }
    });

    // Build affiliate URL
    let affiliateUrl = destination;
    try {
      affiliateUrl = await buildUniversalAffiliateUrl({ destinationUrl: destination, clickId });
      await Click.updateOne({ clickId }, { $set: { affiliateLink: affiliateUrl } });
    } catch (e) {
      // strict behavior for user-generated links; for public product pages fallback is acceptable
      console.warn('Universal affiliate build failed, fallback to destination:', e?.message);
    }

    return res.redirect(affiliateUrl);
  } catch (err) {
    console.error('tracking redirect error', err);
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;