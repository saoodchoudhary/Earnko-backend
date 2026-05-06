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

/**
 * Normalize a store object so its logo is an absolute URL.
 * @param {object|null|undefined} store
 * @returns {object|null|undefined}
 */
function normalizeStore(store) {
  if (!store) return store;
  return { ...store, logo: toAbsoluteUrl(store.logo) };
}

/**
 * Normalize a product object so its images array contains absolute URLs.
 * @param {object|null|undefined} product
 * @returns {object|null|undefined}
 */
function normalizeProduct(product) {
  if (!product) return product;
  return { ...product, images: (product.images || []).map(toAbsoluteUrl) };
}

module.exports = { toAbsoluteUrl, normalizeStore, normalizeProduct };
