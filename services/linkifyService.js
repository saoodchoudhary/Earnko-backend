const shortid = require('shortid');
const cuelinks = require('./affiliateNetwork/cuelinks');
const trackier = require('./affiliateNetwork/trackier');
const extrape = require('./affiliateNetwork/extrape');
const Click = require('../models/Click');
const ShortUrl = require('../models/ShortUrl');
const { normalizeAffiliateInputUrl, toCanonicalUrl, resolveFinalUrl, makeProviderSafeUrl } = require('./urlTools');

function normalizeHost(inputUrl) {
  try {
    const u = new URL(inputUrl);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isFlipkartHost(host) {
  return (
    host === 'flipkart.com' ||
    host.endsWith('.flipkart.com') ||
    host === 'dl.flipkart.com' ||
    host === 'fkrt.it'
  );
}

function isMyntraHost(host) {
  return host === 'myntra.com' || host.endsWith('.myntra.com') || host === 'myntr.it';
}

function isAjioAppHost(host) {
  return host === 'ajioapps.onelink.me' || host === 'ajio.page.link';
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

// NEW: Dot & Key host
function isDotAndKeyHost(host) {
  return host === 'dotandkey.com' || host.endsWith('.dotandkey.com');
}

function pickProvider(url) {
  const host = normalizeHost(url);

  if (isFlipkartHost(host)) return 'extrape';
  if (isMyntraHost(host)) return 'trackier';
  if (isAjioHost(host)) return 'trackier';
  if (isTiraHost(host)) return 'trackier';

  // NEW: Dot & Key -> trackier/vcommission
  if (isDotAndKeyHost(host)) return 'trackier';

  return 'cuelinks';
}

function getTrackierCampaignId(url) {
  const host = normalizeHost(url);

  if (isMyntraHost(host)) {
    return process.env.TRACKIER_MYNTRA_CAMPAIGN_ID || process.env.TRACKIER_MYNTTRA_CAMPAIGN_ID || '';
  }
  if (isAjioHost(host)) return process.env.TRACKIER_AJIO_CAMPAIGN_ID || '';
  if (isTiraHost(host)) return process.env.TRACKIER_TIRABEAUTY_CAMPAIGN_ID || '';

  // NEW: Dot & Key campaign
  if (isDotAndKeyHost(host)) return process.env.TRACKIER_DOTANDKEY_CAMPAIGN_ID || '';

  return '';
}

function publicSiteBase() {
  // This should be your WEBSITE domain (earnko.com)
  // Set PUBLIC_SITE_URL=https://earnko.com in backend env.
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

  const provider = pickProvider(providerSafeUrl || resolvedUrl || cleaned);
  const slug = shortid.generate();
  const clickId = shortid.generate();

  await Click.create({
    clickId,
    user: user._id,
    store: storeId || null,
    ipAddress: null,
    userAgent: null,
    referrer: null,
    customSlug: slug,
    affiliateLink: null,
    metadata: { source: 'link-from-url', provider, originalUrl: cleaned, resolvedUrl, providerSafeUrl }
  });

  if (provider === 'extrape') {
    const affid = process.env.EXTRAPE_AFFID || 'adminnxtify';
    const affExtParam1 = process.env.EXTRAPE_AFF_EXT_PARAM1 || 'EPTG2738645';

    const { url: deeplink } = extrape.buildAffiliateLink({
      originalUrl: providerSafeUrl,
      affid,
      affExtParam1,
      subid: clickId
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: storeId || null,
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
    const campaignId = getTrackierCampaignId(providerSafeUrl);

    const adnParams = { p1: clickId, p2: slug };

    const { url: deeplink, raw } = await trackier.buildDeeplink({
      url: providerSafeUrl,
      campaignId,
      adnParams,
      encodeURL: false
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: storeId || null,
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

  const cuelinksResp = await cuelinks.buildAffiliateLink({ originalUrl: providerSafeUrl, subid: clickId });
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
    store: storeId || null,
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