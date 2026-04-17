const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Click = require('../models/Click');
const { createAffiliateLinkStrict } = require('../services/linkifyService');
const { SHORTENER_CANONICAL_MAP } = require('../services/storeResolver');
const shortid = require('shortid');

const trackier = require('../services/affiliateNetwork/trackier');
const extrape = require('../services/affiliateNetwork/extrape');
const { buildDeeplink: buildCuelinksDeeplink } = require('../services/cuelinks');

const router = express.Router();

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ===== RealCash redirect-time wrapper =====
function isRealCashTrackingHost(host) {
  return host === 'track.realcash.in' || host.endsWith('.realcash.in');
}

function isFlipkartHost(host) {
  if (
    host === 'flipkart.com' ||
    host.endsWith('.flipkart.com') ||
    host === 'dl.flipkart.com'
  ) return true;
  return SHORTENER_CANONICAL_MAP[host] === 'flipkart.com';
}

function isShopsyHost(host) {
  if (host === 'shopsy.in' || host.endsWith('.shopsy.in')) return true;
  return SHORTENER_CANONICAL_MAP[host] === 'shopsy.in';
}

function getRealCashBaseForHost(host, _visited = new Set()) {
  if (host === 'ajio.com' || host.endsWith('.ajio.com')) return process.env.REALCASH_AJIO_BASE || '';
  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') return process.env.REALCASH_MYNTRA_BASE || '';

  // ✅ Flipkart RealCash
  if (isFlipkartHost(host)) return process.env.REALCASH_FLIPKART_BASE || '';

  // ✅ Shopsy RealCash
  if (isShopsyHost(host)) return process.env.REALCASH_SHOPSY_BASE || '';

  if (host === 'dotandkey.com' || host.endsWith('.dotandkey.com')) return process.env.REALCASH_DOTANDKEY_BASE || '';
  if (host === 'croma.com' || host.endsWith('.croma.com')) return process.env.REALCASH_CROMA_BASE || '';
  if (host === 'mcaffeine.com' || host.endsWith('.mcaffeine.com')) return process.env.REALCASH_MCAFFEINE_BASE || '';
  if (host === 'firstcry.com' || host.endsWith('.firstcry.com')) return process.env.REALCASH_FIRSTCRY_BASE || '';
  if (host === 'pepperfry.com' || host.endsWith('.pepperfry.com')) return process.env.REALCASH_PEPPERFRY_BASE || '';
  if (
    host === 'plumgoodness.com' ||
    host.endsWith('.plumgoodness.com') ||
    host === 'plumgoodness.in' ||
    host.endsWith('.plumgoodness.in')
  ) {
    return process.env.REALCASH_PLUMGOODNESS_BASE || '';
  }
  if (
    host === 'boat-lifestyle.com' ||
    host.endsWith('.boat-lifestyle.com') ||
    host === 'boatlifestyle.com' ||
    host.endsWith('.boatlifestyle.com')
  ) {
    return process.env.REALCASH_BOAT_BASE || '';
  }

  // For any shortener/alias domain not matched above, resolve to its canonical merchant
  // host via SHORTENER_CANONICAL_MAP and retry.  Adding a new shortener to the map
  // automatically propagates to all provider base-link lookups here.
  const canonical = SHORTENER_CANONICAL_MAP[host];
  if (canonical && canonical !== host && !_visited.has(canonical)) {
    _visited.add(host);
    return getRealCashBaseForHost(canonical, _visited);
  }

  return '';
}

/**
 * Redirect-time builder:
 * - Uses env param names (REALCASH_LP_PARAM / SUBID params)
 * - Adds subid2 = slug
 * - If base missing -> fallbackUrl (originalUrl) or destinationUrl
 */
function buildRealCashRedirectLink({ destinationUrl, clickId, slug = null, fallbackUrl = null }) {
  // canonicalize best-effort
  let dest = destinationUrl;
  try {
    dest = new URL(destinationUrl).toString();
  } catch {
    // keep as-is
  }

  const host = normalizeHost(dest);
  if (isRealCashTrackingHost(host)) return dest;

  const base = getRealCashBaseForHost(host);
  if (!base) return fallbackUrl || dest;

  const u = new URL(base);

  const lpParam = process.env.REALCASH_LP_PARAM || 'url';
  const subidParam = process.env.REALCASH_SUBID_PARAM || 'subid';
  const subid1Param = process.env.REALCASH_SUBID1_PARAM || 'subid1';
  const subid2Param = process.env.REALCASH_SUBID2_PARAM || 'subid2';

  u.searchParams.set(lpParam, fallbackUrl || dest);
  u.searchParams.set(subidParam, String(clickId));
  u.searchParams.set(subid1Param, String(clickId));
  if (slug) u.searchParams.set(subid2Param, String(slug));

  return u.toString();
}

function statusFromCode(code) {
  if (code === 'campaign_approval_required') return 409;
  if (code === 'store_not_found_for_url') return 400;
  if (code === 'store_network_missing') return 400;
  if (code === 'realcash_missing_base') return 400;
  if (code === 'bad_request') return 400;
  return 500;
}

// Create affiliate link from URL (STRICT)
router.post('/link-from-url', auth, async (req, res) => {
  try {
    const { url, storeId } = req.body;
    if (!url) return res.status(400).json({ success: false, code: 'bad_request', message: 'URL required' });

    const user = await User.findById(req.user?._id);
    if (!user) return res.status(401).json({ success: false, code: 'unauthorized', message: 'Unauthorized' });

    const result = await createAffiliateLinkStrict({ user, url, storeId: storeId || null });
    return res.json({ success: true, data: result });
  } catch (err) {
    const code = err?.code || 'error';
    return res.status(statusFromCode(code)).json({
      success: false,
      code,
      message: err?.message || 'Server error'
    });
  }
});

// BULK
router.post('/link-from-url/bulk', auth, async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const storeId = req.body?.storeId || null;

    const MAX = 25;
    const slice = urls.slice(0, MAX);

    const user = await User.findById(req.user?._id);
    if (!user) return res.status(401).json({ success: false, code: 'unauthorized', message: 'Unauthorized' });

    const results = [];
    for (const inputUrl of slice) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await createAffiliateLinkStrict({ user, url: inputUrl, storeId });
        results.push({ inputUrl, success: true, data });
      } catch (err) {
        results.push({ inputUrl, success: false, code: err.code || 'error', message: err.message || 'Failed' });
      }
    }

    return res.json({ success: true, data: { results } });
  } catch {
    return res.status(500).json({ success: false, code: 'error', message: 'Server error' });
  }
});

// Redirect by slug
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug });
    if (!user) return res.redirect(process.env.FRONTEND_URL || '/');

    const linkInfo = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    if (!linkInfo) return res.redirect(process.env.FRONTEND_URL || '/');

    const provider = String(linkInfo.metadata?.provider || 'cuelinks').toLowerCase();
    const originalUrl = linkInfo.metadata?.originalUrl || null;

    const destinationUrl =
      linkInfo.metadata?.providerSafeUrl ||
      linkInfo.metadata?.resolvedUrl ||
      linkInfo.metadata?.originalUrl;

    if (!destinationUrl) return res.redirect(process.env.FRONTEND_URL || '/');

    const clickId = shortid.generate();

    await Click.create({
      clickId,
      user: user._id,
      store: linkInfo.store || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer') || null,
      customSlug: slug,
      affiliateLink: null,
      metadata: { source: 'redirect', provider, destinationUrl }
    });

    let finalUrl = destinationUrl;

    if (provider === 'realcash') {
      finalUrl = buildRealCashRedirectLink({ destinationUrl, clickId, slug, fallbackUrl: originalUrl });
    } else if (provider === 'extrape') {
      const affid = process.env.EXTRAPE_AFFID || 'adminnxtify';
      const affExtParam1 = process.env.EXTRAPE_AFF_EXT_PARAM1 || 'EPTG2738645';
      const { url } = extrape.buildAffiliateLink({
        originalUrl: destinationUrl,
        affid,
        affExtParam1,
        subid: clickId
      });
      finalUrl = url;
    } else if (provider === 'trackier') {
      const host = normalizeHost(destinationUrl);
      let campaignId = '';

      if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') {
        campaignId = process.env.TRACKIER_MYNTRA_CAMPAIGN_ID || process.env.TRACKIER_MYNTTRA_CAMPAIGN_ID || '';
      } else if (host === 'ajio.com' || host.endsWith('.ajio.com')) {
        campaignId = process.env.TRACKIER_AJIO_CAMPAIGN_ID || '';
      } else if (host === 'tirabeauty.com' || host.endsWith('.tirabeauty.com')) {
        campaignId = process.env.TRACKIER_TIRABEAUTY_CAMPAIGN_ID || '';
      } else if (host === 'dotandkey.com' || host.endsWith('.dotandkey.com')) {
        campaignId = process.env.TRACKIER_DOTANDKEY_CAMPAIGN_ID || '';
      }

      const adnParams = { p1: clickId };
      const { url } = await trackier.buildDeeplink({
        url: destinationUrl,
        campaignId,
        adnParams,
        encodeURL: false
      });
      finalUrl = url;
    } else {
      finalUrl = await buildCuelinksDeeplink({ url: destinationUrl, subid: clickId });
    }

    await Click.updateOne({ clickId }, { $set: { affiliateLink: finalUrl } });

    return res.redirect(finalUrl);
  } catch (err) {
    console.warn('redirect error', err);
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;