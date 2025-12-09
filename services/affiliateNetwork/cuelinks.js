const axios = require('axios');
const BASE = process.env.CUELINKS_BASE_URL || process.env.CUELINKS_BASE_URL || 'https://api.cuelinks.com';
const API_KEY = process.env.CUELINKS_API_KEY || '';

async function buildAffiliateLink({ originalUrl }) {
  try {
    // Example — adjust endpoint and request format per your Cuelinks docs
    const resp = await axios.post(`${BASE}/link/convert`, { url: originalUrl }, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    if (resp.data && resp.data.data) {
      return { success: true, link: resp.data.data.affiliate_link || resp.data.data.track_link || resp.data.data.url, raw: resp.data.data };
    }
    return { success: false, error: 'Unexpected response', raw: resp.data };
  } catch (err) {
    console.error('Cuelinks error', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  buildAffiliateLink
};