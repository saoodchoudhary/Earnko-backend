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

function pickProvider(url) {
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

async function createAffiliateLinkStrict({ user, url, storeId = null }) {
  const cleaned = normalizeAffiliateInputUrl(url);
  if (!cleaned) {
    const err = new Error('url required');
    err.code = 'bad_request';
    throw err;
  }

  const resolvedRaw = await resolveFinalUrl(cleaned);
  const resolvedUrl = toCanonicalUrl(resolvedRaw);
  const providerSafeUrl = makeProviderSafeUrl(resolvedUrl);

  const provider = pickProvider(resolvedUrl);
  const slug = shortid.generate();

  // Create clickId now so direct provider link is still attributable
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
    return { link: deeplink, method: 'extrape', slug, clickId };
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
    return { link: deeplink, method: 'trackier', slug, clickId };
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
  return { link: cuelinksResp.link, method: 'cuelinks', slug, clickId };
}

module.exports = { createAffiliateLinkStrict };