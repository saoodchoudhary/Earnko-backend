const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Store = require('../models/Store');
const Click = require('../models/Click');

// Providers
const { buildDeeplink: buildCuelinksDeeplink } = require('../services/cuelinks');
const trackier = require('../services/affiliateNetwork/trackier');
const extrape = require('../services/affiliateNetwork/extrape');

const router = express.Router();

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeNetwork(net) {
  const v = String(net || '').trim().toLowerCase();
  if (v === 'vcommission') return 'trackier';
  return v;
}

// Trackier campaign mapping
function isMyntraHost(host) {
  return host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it';
}
function isAjioHost(host) {
  return host === 'ajio.com' || host.endsWith('.ajio.com');
}
function isTiraHost(host) {
  return host === 'tirabeauty.com' || host.endsWith('.tirabeauty.com');
}
function isDotAndKeyHost(host) {
  return host === 'dotandkey.com' || host.endsWith('.dotandkey.com');
}

function isFlipkartHost(host) {
  return (
    host === 'flipkart.com' ||
    host.endsWith('.flipkart.com') ||
    host === 'dl.flipkart.com' ||
    host === 'fkrt.it' ||
    host === 'fkrt.cc' ||
    host === 'fktr.in' ||
    host === 'fkrt.to' ||
    host === 'fpkrt.cc' ||
    host === 'zngy.in' ||
    host === 'hyyzo.com' ||
    host === 'extp.in' ||
    host === 'bitlii.com'
  );
}

function getTrackierCampaignId(url) {
  const host = normalizeHost(url);

  if (isMyntraHost(host)) return process.env.TRACKIER_MYNTRA_CAMPAIGN_ID || process.env.TRACKIER_MYNTTRA_CAMPAIGN_ID || '';
  if (isAjioHost(host)) return process.env.TRACKIER_AJIO_CAMPAIGN_ID || '';
  if (isTiraHost(host)) return process.env.TRACKIER_TIRABEAUTY_CAMPAIGN_ID || '';
  if (isDotAndKeyHost(host)) return process.env.TRACKIER_DOTANDKEY_CAMPAIGN_ID || '';
  return '';
}

// ===== RealCash wrapper =====
function isRealCashTrackingHost(host) {
  return host === 'track.realcash.in' || host.endsWith('.realcash.in');
}
function getRealCashBaseForHost(host) {
  if (host === 'ajio.com' || host.endsWith('.ajio.com')) return process.env.REALCASH_AJIO_BASE || '';
  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') return process.env.REALCASH_MYNTRA_BASE || '';
  if (isFlipkartHost(host)) return process.env.REALCASH_FLIPKART_BASE || ''; // ✅ ADDED
  if (host === 'dotandkey.com' || host.endsWith('.dotandkey.com')) return process.env.REALCASH_DOTANDKEY_BASE || '';
  if (host === 'croma.com' || host.endsWith('.croma.com')) return process.env.REALCASH_CROMA_BASE || '';
  if (host === 'mcaffeine.com' || host.endsWith('.mcaffeine.com')) return process.env.REALCASH_MCAFFEINE_BASE || '';
  if (host === 'firstcry.com' || host.endsWith('.firstcry.com')) return process.env.REALCASH_FIRSTCRY_BASE || '';
  if (host === 'pepperfry.com' || host.endsWith('.pepperfry.com')) return process.env.REALCASH_PEPPERFRY_BASE || '';
  if (host === 'plumgoodness.com' || host.endsWith('.plumgoodness.com') || host === 'plumgoodness.in' || host.endsWith('.plumgoodness.in')) {
    return process.env.REALCASH_PLUMGOODNESS_BASE || '';
  }
  if (host === 'boat-lifestyle.com' || host.endsWith('.boat-lifestyle.com') || host === 'boatlifestyle.com' || host.endsWith('.boatlifestyle.com')) {
    return process.env.REALCASH_BOAT_BASE || '';
  }
  return '';
}
function buildRealCashLinkStrict({ destinationUrl, clickId }) {
  const host = normalizeHost(destinationUrl);
  if (isRealCashTrackingHost(host)) return destinationUrl;

  const base = getRealCashBaseForHost(host);
  if (!base) {
    const err = new Error('RealCash base link not configured for this store');
    err.code = 'realcash_missing_base';
    throw err;
  }

  const u = new URL(base);
  u.searchParams.set('url', destinationUrl);
  u.searchParams.set('subid', String(clickId));
  u.searchParams.set('subid1', String(clickId));
  return u.toString();
}

async function buildAffiliateUrlForStoreStrict({ destinationUrl, clickId, storeId }) {
  const store = storeId ? await Store.findById(storeId).select('affiliateNetwork').lean() : null;
  const provider = normalizeNetwork(store?.affiliateNetwork) || 'cuelinks';

  if (provider === 'realcash') {
    return buildRealCashLinkStrict({ destinationUrl, clickId });
  }

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
    const adnParams = { p1: clickId };
    const { url } = await trackier.buildDeeplink({
      url: destinationUrl,
      campaignId,
      adnParams,
      encodeURL: false
    });
    return url;
  }

  // default cuelinks (strict error handling)
  try {
    return await buildCuelinksDeeplink({ url: destinationUrl, subid: clickId });
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('campaign') && (msg.includes('approval') || msg.includes('needs approval'))) {
      const err = new Error('Campaign approval required for this domain');
      err.code = 'campaign_approval_required';
      throw err;
    }
    const err = new Error(e?.message || 'Cuelinks failed');
    err.code = 'cuelinks_failed';
    throw err;
  }
}

function statusFromCode(code) {
  if (code === 'campaign_approval_required') return 409;
  if (code === 'realcash_missing_base') return 400;
  if (code === 'bad_request') return 400;
  if (code === 'missing_campaign_id') return 400;
  if (code === 'trackier_error') return 400;
  if (code === 'trackier_forbidden') return 403;
  if (code === 'trackier_invalid_key') return 401;
  return 500;
}

/**
 * STRICT Tracking redirect for a product.
 * GET /api/tracking/product/:productId
 *
 * If provider link cannot be built, returns JSON error (does NOT fallback redirect).
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ success: false, code: 'bad_request', message: 'Invalid productId' });
    }

    const product = await Product.findById(productId).lean();
    if (!product) return res.status(404).json({ success: false, code: 'not_found', message: 'Product not found' });

    const store = product.store ? await Store.findById(product.store).lean() : null;
    const storeId = store?._id || product.store || null;

    const destination = product.deeplink || store?.baseUrl;
    if (!destination) {
      return res.status(400).json({ success: false, code: 'bad_request', message: 'Product deeplink missing' });
    }

    const rand = crypto.randomBytes(4).toString('hex');
    const clickId = `p${productId}-${rand}`;

    await Click.create({
      clickId,
      user: null,
      store: storeId || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer') || null,
      customSlug: null,
      affiliateLink: null,
      metadata: { productId }
    });

    const affiliateUrl = await buildAffiliateUrlForStoreStrict({ destinationUrl: destination, clickId, storeId });

    await Click.updateOne({ clickId }, { $set: { affiliateLink: affiliateUrl } });

    return res.redirect(302, affiliateUrl);
  } catch (err) {
    const code = err?.code || 'error';
    const status = statusFromCode(code);
    return res.status(status).json({
      success: false,
      code,
      message: err?.message || 'Tracking failed'
    });
  }
});

module.exports = router;