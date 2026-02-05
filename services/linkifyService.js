const shortid = require('shortid');
const cuelinks = require('./affiliateNetwork/cuelinks');
const trackier = require('./affiliateNetwork/trackier');
const extrape = require('./affiliateNetwork/extrape');
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

  const provider = pickProvider(resolvedUrl);
  const slug = shortid.generate();

  if (provider === 'extrape') {
    const affid = process.env.EXTRAPE_AFFID || 'adminnxtify';
    const affExtParam1 = process.env.EXTRAPE_AFF_EXT_PARAM1 || 'EPTG2738645';
    const subid = `u${user._id.toString()}-${shortid.generate().slice(0, 8)}`;

    const { url: deeplink } = extrape.buildAffiliateLink({
      originalUrl: resolvedUrl,
      affid,
      affExtParam1,
      subid
    });

    user.affiliateInfo.isAffiliate = true;
    user.affiliateInfo.uniqueLinks.push({
      store: storeId || null,
      customSlug: slug,
      clicks: 0,
      conversions: 0,
      metadata: { provider: 'extrape', originalUrl: cleaned, resolvedUrl, generatedLink: deeplink }
    });
    await user.save();

    return { link: deeplink, method: 'extrape', slug, subid };
  }

  if (provider === 'trackier') {
    const campaignId = getTrackierCampaignId(resolvedUrl);

    // CRITICAL: safe Myntra URL built from productId to avoid '&' in slug path
    const providerSafeUrl = makeProviderSafeUrl(resolvedUrl);

    const adnParams = { p1: `u${user._id.toString()}`, p2: slug };

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
        originalUrl: cleaned,
        resolvedUrl,
        providerSafeUrl,
        generatedLink: deeplink,
        campaignId: String(campaignId),
        raw
      }
    });
    await user.save();

    return { link: deeplink, method: 'trackier', slug };
  }

  const cuelinksResp = await cuelinks.buildAffiliateLink({ originalUrl: resolvedUrl });
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
    metadata: { provider: 'cuelinks', originalUrl: cleaned, resolvedUrl, generatedLink: cuelinksResp.link }
  });
  await user.save();

  return { link: cuelinksResp.link, method: 'cuelinks', slug };
}

module.exports = { createAffiliateLinkStrict };