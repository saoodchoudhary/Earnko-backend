const shortid = require('shortid');

const cuelinks = require('./affiliateNetwork/cuelinks');
const trackier = require('./affiliateNetwork/trackier');
const extrape = require('./affiliateNetwork/extrape');

const Click = require('../models/Click');
const ShortUrl = require('../models/ShortUrl');
const Store = require('../models/Store');

const { resolveStoreByUrl } = require('./storeResolver');
const {
  normalizeAffiliateInputUrl,
  toCanonicalUrl,
  resolveFinalUrlDeep, // ✅ UPDATED
  makeProviderSafeUrl
} = require('./urlTools');

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
  return `${publicSiteBase()}/${String(code || '').replace(/^\/+/, '')}`;
}

async function createShortCodeForSlug({ slug, userId, provider, destinationUrl, clickId }) {
  const code = String(slug || '').trim();
  if (!code) throw new Error('slug required');

  await ShortUrl.create({
    code,
    user: userId,
    destinationUrl,
    provider: provider || 'cuelinks',
    clickId: clickId || null
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
  return host === 'flipkart.com' || host.endsWith('.flipkart.com') || host === 'dl.flipkart.com' || host === 'fkrt.it';
}

function isShopsyHost(host) {
  return host === 'shopsy.in' || host.endsWith('.shopsy.in');
}

function getRealCashBaseForHost(host) {
  const key = (host || '').toLowerCase();
  // configure as you already have (left as-is)
  if (isFlipkartHost(key)) return process.env.REALCASH_FLIPKART_BASE || '';
  if (isShopsyHost(key)) return process.env.REALCASH_SHOPSY_BASE || '';
  if (key === 'ajio.com' || key.endsWith('.ajio.com')) return process.env.REALCASH_AJIO_BASE || '';
  if (key === 'myntra.com' || key.endsWith('.myntra.com') || key === 'myntr.it') return process.env.REALCASH_MYNTRA_BASE || '';
  return '';
}

function looksLikeHome(url) {
  try {
    const u = new URL(url);
    const p = (u.pathname || '').replace(/\/+$/, '');
    return p === '' || p === '/' || p === '/home' || p === '/shop' || p === '/m' || p === '/mobile';
  } catch {
    return false;
  }
}

/**
 * Decide what to pass as landing page to RealCash.
 * If resolved/providerSafe becomes homepage-ish, use the original cleaned URL (usually product link).
 */
function pickRealCashDestination({ cleaned, resolvedUrl, providerSafeUrl }) {
  const candidate = providerSafeUrl || resolvedUrl || cleaned;
  if (!candidate) return cleaned;

  const host = normalizeHost(candidate);
  const sensitive = isFlipkartHost(host) || isShopsyHost(host) || host === 'ajio.com' || host.endsWith('.ajio.com');
  if (sensitive && looksLikeHome(candidate)) return cleaned;

  return candidate;
}

function buildRealCashDeeplink({ destinationUrl, clickId, slug = null, fallbackUrl = null }) {
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

async function resolveProviderStrict({ storeId, providerSafeUrl, resolvedUrl, cleaned }) {
  // If storeId is provided, trust it
  if (storeId) {
    const store = await Store.findById(storeId).lean();
    if (!store) {
      const err = new Error('Store not found');
      err.code = 'store_not_found_for_url';
      throw err;
    }
    const provider = store.network || store.provider || 'cuelinks';
    return { provider, resolvedStoreId: store._id };
  }

  // Otherwise resolve by url
  const store = await resolveStoreByUrl(providerSafeUrl || resolvedUrl || cleaned);
  if (!store) {
    const err = new Error('Store not found for URL');
    err.code = 'store_not_found_for_url';
    throw err;
  }

  const provider = store.network || store.provider || 'cuelinks';
  return { provider, resolvedStoreId: store._id };
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

  // ✅ IMPORTANT CHANGE:
  // Use deep resolver so earnko.com / bitly / tinyurl etc can be re-processed into final merchant URL.
  const resolvedRaw = await resolveFinalUrlDeep(cleaned, { timeoutMs: 2500, maxHops: 3 });
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

  // REALCASH
  if (provider === 'realcash') {
    const realcashDest = pickRealCashDestination({ cleaned, resolvedUrl, providerSafeUrl });

    const deeplink = buildRealCashDeeplink({
      destinationUrl: realcashDest,
      clickId,
      slug,
      fallbackUrl: cleaned
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: effectiveStoreId,
      customSlug: slug,
      clicks: 0,
      conversions: 0,
      metadata: {
        provider: 'realcash',
        clickId,
        originalUrl: cleaned,
        resolvedUrl,
        providerSafeUrl,
        destinationUrl: realcashDest,
        generatedLink: deeplink
      },
      createdAt: new Date()
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

  // EXTRAPE
  if (provider === 'extrape') {
    const resp = extrape.buildAffiliateLink({
      originalUrl: providerSafeUrl || resolvedUrl || cleaned,
      affid: process.env.EXTRAPE_AFFID,
      affExtParam1: process.env.EXTRAPE_AFFEXTPARAM1,
      subid: clickId
    });

    if (!resp?.url) {
      const err = new Error('Extrape: failed to build deeplink');
      err.code = 'extrape_failed';
      throw err;
    }

    const deeplink = resp.url;

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: effectiveStoreId,
      customSlug: slug,
      clicks: 0,
      conversions: 0,
      metadata: {
        provider: 'extrape',
        clickId,
        originalUrl: cleaned,
        resolvedUrl,
        providerSafeUrl,
        generatedLink: deeplink
      },
      createdAt: new Date()
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

  // TRACKIER
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
      },
      createdAt: new Date()
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

  // CUELINKS (default)
  const cuelinksResp = await cuelinks.buildAffiliateLink({
    originalUrl: providerSafeUrl || resolvedUrl || cleaned,
    subid: clickId
  });

  if (!cuelinksResp?.success || !cuelinksResp?.link) {
    const err = new Error(cuelinksResp?.error || 'Cuelinks error');
    err.code = 'cuelinks_error';
    throw err;
  }

  user.affiliateInfo.isAffiliate = true;
  user.affiliateInfo.uniqueLinks.push({
    store: effectiveStoreId,
    customSlug: slug,
    clicks: 0,
    conversions: 0,
    metadata: {
      provider: 'cuelinks',
      clickId,
      originalUrl: cleaned,
      resolvedUrl,
      providerSafeUrl,
      generatedLink: cuelinksResp.link
    },
    createdAt: new Date()
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

module.exports = {
  createAffiliateLinkStrict
};