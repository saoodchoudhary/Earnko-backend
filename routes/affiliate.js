const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Click = require('../models/Click');
const { createAffiliateLinkStrict } = require('../services/linkifyService');
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
    host === 'extp.in'
  );
}

function isShopsyHost(host) {
  return host === 'shopsy.in' || host.endsWith('.shopsy.in');
}

function getRealCashBaseForHost(host) {
  if (host === 'ajio.com' || host.endsWith('.ajio.com')) return process.env.REALCASH_AJIO_BASE || '';
  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') return process.env.REALCASH_MYNTRA_BASE || '';

  if (isFlipkartHost(host)) return process.env.REALCASH_FLIPKART_BASE || '';
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
  return '';
}

function isLikelyHomeOrLanding(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';

    if (path === '' || path === '/') return true;

    if ((host === 'ajio.com' || host.endsWith('.ajio.com')) && path.split('/').filter(Boolean).length <= 1) return true;
    if ((host === 'flipkart.com' || host.endsWith('.flipkart.com')) && path.split('/').filter(Boolean).length <= 1) return true;
    if ((host === 'shopsy.in' || host.endsWith('.shopsy.in')) && path.split('/').filter(Boolean).length <= 1) return true;

    return false;
  } catch {
    return false;
  }
}

function buildRealCashRedirectLink({ destinationUrl, clickId, fallbackUrl = null }) {
  let dest = destinationUrl;
  try {
    dest = new URL(destinationUrl).toString();
  } catch {
    // keep as-is
  }

  // If destination looks like homepage/landing, fallback to originalUrl (product url)
  const host0 = normalizeHost(dest);
  const sensitive =
    isFlipkartHost(host0) ||
    isShopsyHost(host0) ||
    host0 === 'ajio.com' ||
    host0.endsWith('.ajio.com');

  if (sensitive && isLikelyHomeOrLanding(dest) && fallbackUrl) {
    dest = fallbackUrl;
  }

  const host = normalizeHost(dest);
  if (isRealCashTrackingHost(host)) return dest;

  const base = getRealCashBaseForHost(host);
  if (!base) return dest;

  const u = new URL(base);
  u.searchParams.set('url', dest);
  u.searchParams.set('subid', String(clickId));
  u.searchParams.set('subid1', String(clickId));
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
      finalUrl = buildRealCashRedirectLink({ destinationUrl, clickId, fallbackUrl: originalUrl });
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