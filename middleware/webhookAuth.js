const crypto = require('crypto');

/**
 * Returns an Express middleware that verifies the X-Webhook-Secret header
 * against the value stored in process.env[secretEnvVar].
 *
 * Behaviour:
 *  - If the env var is NOT set: blocks the request with 503. An unconfigured secret
 *    must never silently allow unauthenticated access to transaction-creating endpoints.
 *  - If the env var IS set and the header is missing or wrong: responds 401.
 *  - Uses crypto.timingSafeEqual to prevent timing-based secret leakage.
 */
function makeWebhookAuth(secretEnvVar) {
  return function webhookAuth(req, res, next) {
    const secret = process.env[secretEnvVar];

    if (!secret) {
      console.error(`[webhookAuth] ERROR: ${secretEnvVar} is not set — refusing request to prevent unauthorized access`);
      return res.status(503).json({ success: false, message: 'Webhook not configured' });
    }

    const provided = req.headers['x-webhook-secret'];
    let valid = false;

    if (provided) {
      try {
        const a = Buffer.from(provided);
        const b = Buffer.from(secret);
        valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        valid = false;
      }
    }

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    return next();
  };
}

module.exports = { makeWebhookAuth };
