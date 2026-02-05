const shortid = require('shortid');
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

/**
 * Strict generator that returns a SHARE URL (Earnko redirect).
 * The redirect endpoint generates provider deeplink with clickId embedded.
 */
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

  const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
  const shareUrl = `${base}/api/affiliate/redirect/${slug}`;

  const campaignId = provider === 'trackier' ? String(getTrackierCampaignId(resolvedUrl) || '') : '';

  user.affiliateInfo.isAffiliate = true;
  user.affiliateInfo.uniqueLinks.push({
    store: storeId || null,
    customSlug: slug,
    clicks: 0,
    conversions: 0,
    metadata: {
      provider,
      originalUrl: cleaned,
      resolvedUrl,
      providerSafeUrl,
      campaignId
    }
  });

  await user.save();

  return { link: shareUrl, shareUrl, method: provider, slug };
}

module.exports = { createAffiliateLinkStrict };