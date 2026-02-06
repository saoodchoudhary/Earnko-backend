const shortid = require('shortid');
const cuelinks = require('./affiliateNetwork/cuelinks');
const trackier = require('./affiliateNetwork/trackier');
const extrape = require('./affiliateNetwork/extrape');
const Click = require('../models/Click');
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
    host.endsWith('.onelink.me') || // keep broad only if you are sure; else remove
    host === 'ajio.page.link'
  );
}

function isTiraHost(host) {
  return host === 'tirabeauty.com' || host.endsWith('.tirabeauty.com');
}

function pickProvider(url) {
  const host = normalizeHost(url);

  if (isFlipkartHost(host)) return 'extrape';
  if (isMyntraHost(host)) return 'trackier';
  if (isAjioHost(host)) return 'trackier';
  if (isTiraHost(host)) return 'trackier';

  return 'cuelinks';
}

function getTrackierCampaignId(url) {
  const host = normalizeHost(url);

  if (isMyntraHost(host)) {
    return process.env.TRACKIER_MYNTRA_CAMPAIGN_ID || process.env.TRACKIER_MYNTTRA_CAMPAIGN_ID || '';
  }
  if (isAjioHost(host)) return process.env.TRACKIER_AJIO_CAMPAIGN_ID || '';
  if (isTiraHost(host)) return process.env.TRACKIER_TIRABEAUTY_CAMPAIGN_ID || '';

  // fallback none
  return '';
}

function buildShareUrl(slug) {
  const base = (process.env.BACKEND_URL || 'https://api.earnko.com').replace(/\/+$/, '');
  return `${base}/api/affiliate/redirect/${slug}`;
}

async function createAffiliateLinkStrict({ user, url, storeId = null }) {
  const cleaned = normalizeAffiliateInputUrl(url);
  if (!cleaned) {
    const err = new Error('url required');
    err.code = 'bad_request';
    throw err;
  }

  // AJIO app links: tell user to paste website link
  const inputHost = normalizeHost(cleaned);
  if (isAjioAppHost(inputHost)) {
    const err = new Error('AJIO app links are not supported. Please paste AJIO website product link (ajio.com/...)');
    err.code = 'ajio_app_link_not_supported';
    throw err;
  }

  // try resolve short/app links -> final merchant URL (best effort)
  const resolvedRaw = await resolveFinalUrl(cleaned);
  const resolvedUrl = toCanonicalUrl(resolvedRaw);

  // make provider-safe (currently special handling for Myntra)
  const providerSafeUrl = makeProviderSafeUrl(resolvedUrl);

  const provider = pickProvider(providerSafeUrl || resolvedUrl || cleaned);
  const slug = shortid.generate();

  // click id for attribution
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

    return {
      link: deeplink,
      providerLink: deeplink,
      shareUrl: buildShareUrl(slug),
      method: 'extrape',
      slug,
      clickId
    };
  }

  if (provider === 'trackier') {
    const campaignId = getTrackierCampaignId(providerSafeUrl);

    // Put clickId in p1 so postback can map click_id={p1}
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

    return {
      link: deeplink,
      providerLink: deeplink,
      shareUrl: buildShareUrl(slug),
      method: 'trackier',
      slug,
      clickId
    };
  }

  // cuelinks
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

  return {
    link: cuelinksResp.link,
    providerLink: cuelinksResp.link,
    shareUrl: buildShareUrl(slug),
    method: 'cuelinks',
    slug,
    clickId
  };
}

module.exports = { createAffiliateLinkStrict };