/**
 * URL helper utilities for constructing absolute asset URLs.
 */

const backendBase = (process.env.BACKEND_URL || 'https://api.earnko.com').replace(/\/+$/, '');

/**
 * Convert a relative path (e.g. "/uploads/foo.png") to a full absolute URL.
 * URLs that already start with http/https are returned unchanged.
 * @param {string|null|undefined} url
 * @returns {string|null|undefined}
 */
function toAbsoluteUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${backendBase}${url}`;
}

module.exports = { toAbsoluteUrl };
