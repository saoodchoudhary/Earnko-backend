const shortid = require('shortid');

const cuelinks = require('./affiliateNetwork/cuelinks');
const trackier = require('./affiliateNetwork/trackier');
const extrape = require('./affiliateNetwork/extrape');

const Click = require('../models/Click');
const ShortUrl = require('../models/ShortUrl');
const Store = require('../models/Store');

const { resolveStoreByUrl } = require('./storeResolver');
const { normalizeAffiliateInputUrl, toCanonicalUrl, resolveFinalUrl, makeProviderSafeUrl } = require('./urlTools');

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isAjioAppHost(host) {
  return host === 'ajioapps.onelink.me' || host === 'ajio.page.link';
}

// Trackier campaign mapping (kept)
function isMyntraHost(host) {
  return host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it';
}
function isAjioHost(host) {
  return (
    host === 'ajio.com' ||
    host.endsWith('.ajio.com') ||
    host === 'ajioapps.onelink.me' ||
    host.endsWith('.onelink.me') ||
    host === 'ajio.page.link'
  );
}
function isTiraHost(host) {
  return host === 'tirabeauty.com' || host.endsWith('.tirabeauty.com');
}
function isDotAndKeyHost(host) {
  return host === 'dotandkey.com' || host.endsWith('.dotandkey.com');
}

function getTrackierCampaignId(url) {
  const host = normalizeHost(url);

  if (isMyntraHost(host)) {
    return process.env.TRACKIER_MYNTRA_CAMPAIGN_ID || process.env.TRACKIER_MYNTTRA_CAMPAIGN_ID || '';
  }
  if (isAjioHost(host)) return process.env.TRACKIER_AJIO_CAMPAIGN_ID || '';
  if (isTiraHost(host)) return process.env.TRACKIER_TIRABEAUTY_CAMPAIGN_ID || '';
  if (isDotAndKeyHost(host)) return process.env.TRACKIER_DOTANDKEY_CAMPAIGN_ID || '';
  return '';
}

function publicSiteBase() {
  return (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'https://earnko.com').replace(/\/+$/, '');
}
function buildPublicShortUrl(code) {
  return `${publicSiteBase()}/${code}`;
}

async function createShortCodeForSlug({ slug, userId, provider, destinationUrl, clickId }) {
  let code = shortid.generate().replace(/_/g, '').replace(/-/g, '').slice(0, 8);

  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await ShortUrl.findOne({ code }).lean();
    if (!exists) break;
    code = shortid.generate().replace(/_/g, '').replace(/-/g, '').slice(0, 8);
  }

  await ShortUrl.create({
    code,
    url: destinationUrl,
    clickId: clickId || '',
    user: userId || null,
    provider: provider || '',
    slug
  });

  return { code, shortUrl: buildPublicShortUrl(code) };
}

function backendBase() {
  return (process.env.BACKEND_URL || 'https://api.earnko.com').replace(/\/+$/, '');
}

async function buildShareUrl({ slug, userId, provider, destinationUrl, clickId }) {
  const { shortUrl } = await createShortCodeForSlug({
    slug,
    userId,
    provider,
    destinationUrl,
    clickId
  });
  return shortUrl;
}

// ===== RealCash wrapper =====
function isRealCashTrackingHost(host) {
  return host === 'track.realcash.in' || host.endsWith('.realcash.in');
}

function isFlipkartHost(host) {
  return (
    host === 'flipkart.com' ||
    host.endsWith('.flipkart.com') ||
    host === 'dl.flipkart.com' ||
    host === 'fkrt.it'
  );
}

/**
 * ✅ ADDED: Shopsy host matcher
 * Shopsy commonly uses shopsy.in
 */
function isShopsyHost(host) {
  return host === 'shopsy.in' || host.endsWith('.shopsy.in');
}

function getRealCashBaseForHost(host) {
  if (host === 'ajio.com' || host.endsWith('.ajio.com')) return process.env.REALCASH_AJIO_BASE || '';
  if (host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it') return process.env.REALCASH_MYNTRA_BASE || '';

  // ✅ existing
  if (isFlipkartHost(host)) return process.env.REALCASH_FLIPKART_BASE || '';

  // ✅ NEW: Shopsy
  if (isShopsyHost(host)) return process.env.REALCASH_SHOPSY_BASE || '';

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

function buildRealCashDeeplink({ destinationUrl, clickId, slug }) {
  const dest = toCanonicalUrl(destinationUrl);
  const host = normalizeHost(dest);

  if (isRealCashTrackingHost(host)) return dest;

  const base = getRealCashBaseForHost(host);
  if (!base) {
    const err = new Error('RealCash base link not configured for this store');
    err.code = 'realcash_missing_base';
    throw err;
  }

  const u = new URL(base);
  u.searchParams.set('url', dest);
  u.searchParams.set('subid', String(clickId));
  u.searchParams.set('subid1', String(clickId));
  if (slug) u.searchParams.set('subid2', String(slug));
  return u.toString();
}

function normalizeNetwork(net) {
  const v = String(net || '').trim().toLowerCase();
  if (v === 'vcommission') return 'trackier';
  return v;
}

async function resolveProviderStrict({ storeId, providerSafeUrl, resolvedUrl, cleaned }) {
  // 1) storeId => always take store's affiliateNetwork
  if (storeId) {
    const store = await Store.findById(storeId).select('affiliateNetwork').lean();
    const net = normalizeNetwork(store?.affiliateNetwork);
    if (!net) {
      const err = new Error('Store affiliate network not configured');
      err.code = 'store_network_missing';
      throw err;
    }
    return { provider: net, resolvedStoreId: storeId };
  }

  // 2) No storeId => infer store from URL => must exist in strict mode
  const inferred = await resolveStoreByUrl(providerSafeUrl || resolvedUrl || cleaned);
  if (!inferred?._id) {
    const err = new Error('Store not found for this URL. Please check store baseUrl/trackingUrl mapping.');
    err.code = 'store_not_found_for_url';
    throw err;
  }

  const net = normalizeNetwork(inferred.affiliateNetwork);
  if (!net) {
    const err = new Error('Store affiliate network not configured');
    err.code = 'store_network_missing';
    throw err;
  }

  return { provider: net, resolvedStoreId: inferred._id };
}

async function createAffiliateLinkStrict({ user, url, storeId = null }) {
  const cleaned = normalizeAffiliateInputUrl(url);
  if (!cleaned) {
    const err = new Error('url required');
    err.code = 'bad_request';
    throw err;
  }

  const inputHost = normalizeHost(cleaned);
  if (isAjioAppHost(inputHost)) {
    const err = new Error('AJIO app links are not supported. Please paste AJIO website product link (ajio.com/...)');
    err.code = 'ajio_app_link_not_supported';
    throw err;
  }

  const resolvedRaw = await resolveFinalUrl(cleaned);
  const resolvedUrl = toCanonicalUrl(resolvedRaw);
  const providerSafeUrl = makeProviderSafeUrl(resolvedUrl);

  const { provider, resolvedStoreId } = await resolveProviderStrict({
    storeId,
    providerSafeUrl,
    resolvedUrl,
    cleaned
  });

  const effectiveStoreId = storeId || resolvedStoreId || null;

  const slug = shortid.generate();
  const clickId = shortid.generate();

  await Click.create({
    clickId,
    user: user._id,
    store: effectiveStoreId,
    ipAddress: null,
    userAgent: null,
    referrer: null,
    customSlug: slug,
    affiliateLink: null,
    metadata: {
      source: 'link-from-url',
      provider,
      originalUrl: cleaned,
      resolvedUrl,
      providerSafeUrl
    }
  });

  if (provider === 'realcash') {
    const deeplink = buildRealCashDeeplink({
      destinationUrl: providerSafeUrl || resolvedUrl || cleaned,
      clickId,
      slug
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: effectiveStoreId,
      customSlug: slug,
      clicks: 0,
      conversions: 0,
      metadata: { provider: 'realcash', clickId, originalUrl: cleaned, resolvedUrl, providerSafeUrl, generatedLink: deeplink }
    });
    await user.save();

    await Click.updateOne({ clickId }, { $set: { affiliateLink: deeplink } });

    const shareUrl = await buildShareUrl({
      slug,
      userId: user._id,
      provider: 'realcash',
      destinationUrl: `${backendBase()}/api/affiliate/redirect/${slug}`,
      clickId
    });

    return { link: deeplink, providerLink: deeplink, shareUrl, method: 'realcash', slug, clickId };
  }

  if (provider === 'extrape') {
    const affid = process.env.EXTRAPE_AFFID || 'adminnxtify';
    const affExtParam1 = process.env.EXTRAPE_AFF_EXT_PARAM1 || 'EPTG2738645';

    const { url: deeplink } = extrape.buildAffiliateLink({
      originalUrl: providerSafeUrl || resolvedUrl || cleaned,
      affid,
      affExtParam1,
      subid: clickId
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: effectiveStoreId,
      customSlug: slug,
      clicks: 0,
      conversions: 0,
      metadata: { provider: 'extrape', clickId, originalUrl: cleaned, resolvedUrl, providerSafeUrl, generatedLink: deeplink }
    });
    await user.save();

    await Click.updateOne({ clickId }, { $set: { affiliateLink: deeplink } });

    const shareUrl = await buildShareUrl({
      slug,
      userId: user._id,
      provider: 'extrape',
      destinationUrl: `${backendBase()}/api/affiliate/redirect/${slug}`,
      clickId
    });

    return { link: deeplink, providerLink: deeplink, shareUrl, method: 'extrape', slug, clickId };
  }

  if (provider === 'trackier') {
    const campaignId = getTrackierCampaignId(providerSafeUrl || resolvedUrl || cleaned);
    const adnParams = { p1: clickId, p2: slug };

    const { url: deeplink, raw } = await trackier.buildDeeplink({
      url: providerSafeUrl || resolvedUrl || cleaned,
      campaignId,
      adnParams,
      encodeURL: false
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: effectiveStoreId,
      customSlug: slug,
      clicks: 0,
      conversions: 0,
      metadata: {
        provider: 'trackier',
        clickId,
        originalUrl: cleaned,
        resolvedUrl,
        providerSafeUrl,
        generatedLink: deeplink,
        campaignId: String(campaignId || ''),
        raw
      }
    });
    await user.save();

    await Click.updateOne({ clickId }, { $set: { affiliateLink: deeplink } });

    const shareUrl = await buildShareUrl({
      slug,
      userId: user._id,
      provider: 'trackier',
      destinationUrl: `${backendBase()}/api/affiliate/redirect/${slug}`,
      clickId
    });

    return { link: deeplink, providerLink: deeplink, shareUrl, method: 'trackier', slug, clickId };
  }

  // CUELINKS
  const cuelinksResp = await cuelinks.buildAffiliateLink({
    originalUrl: providerSafeUrl || resolvedUrl || cleaned,
    subid: clickId
  });

  const msg = String(cuelinksResp?.error || '').toLowerCase();
  if (!cuelinksResp.success) {
    if (msg.includes('campaign') && msg.includes('approval')) {
      const err = new Error('Campaign approval required for this domain');
      err.code = 'campaign_approval_required';
      throw err;
    }
    const err = new Error(cuelinksResp.error || 'Failed to generate affiliate link');
    err.code = 'provider_failed';
    throw err;
  }

  if (!cuelinksResp.link) {
    const err = new Error('Cuelinks did not return a link');
    err.code = 'provider_failed';
    throw err;
  }

  user.affiliateInfo.isAffiliate = true;
  user.affiliateInfo.uniqueLinks.push({
    store: effectiveStoreId,
    customSlug: slug,
    clicks: 0,
    conversions: 0,
    metadata: { provider: 'cuelinks', clickId, originalUrl: cleaned, resolvedUrl, providerSafeUrl, generatedLink: cuelinksResp.link }
  });
  await user.save();

  await Click.updateOne({ clickId }, { $set: { affiliateLink: cuelinksResp.link } });

  const shareUrl = await buildShareUrl({
    slug,
    userId: user._id,
    provider: 'cuelinks',
    destinationUrl: `${backendBase()}/api/affiliate/redirect/${slug}`,
    clickId
  });

  return { link: cuelinksResp.link, providerLink: cuelinksResp.link, shareUrl, method: 'cuelinks', slug, clickId };
}

module.exports = { createAffiliateLinkStrict };