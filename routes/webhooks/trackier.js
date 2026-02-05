const express = require('express');

const WebhookEvent = require('../../models/WebhookEvent');
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const Click = require('../../models/Click');

const router = express.Router();

function parseNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();

  // Trackier conversion_status common values may vary by setup.
  // Keep mapping safe:
  if (['approved', 'confirmed', 'valid', 'paid', 'success'].includes(s)) return 'confirmed';
  if (['cancelled', 'canceled', 'rejected', 'invalid', 'void', 'failed'].includes(s)) return 'cancelled';

  // if Trackier is configured to fire only on Approved, this will be confirmed anyway.
  return 'pending';
}

function normalizePayload(req) {
  // Trackier can send query params; keep body too (just in case)
  const payload = {
    ...(req.query || {}),
    ...(typeof req.body === 'object' && req.body ? req.body : {})
  };

  // Best: click_id macro
  const clickId =
    payload.click_id ||
    payload.clickid ||
    payload.cid ||
    payload.click ||
    null;

  // Transaction id macro
  const txnId =
    payload.txn_id ||
    payload.txnid ||
    payload.transaction_id ||
    payload.order_id ||
    payload.orderid ||
    payload.oid ||
    null;

  // Amounts
  const saleAmount = parseNumber(
    payload.sale_amount ?? payload.conv_revenue ?? payload.amount ?? payload.original_sale_amount ?? 0,
    0
  );

  const payout = parseNumber(
    payload.payout ?? payload.commission ?? payload.earnings ?? 0,
    0
  );

  const currency = String(payload.currency || payload.conv_rp_currency || payload.original_sale_currency || 'INR');

  const status = normStatus(payload.conversion_status || payload.status);

  const campaignId = payload.campaign_id || payload.camp_id || null;

  // Optional: p1 if you pass it in deeplink generation
  const p1 = payload.p1 || null;

  return { payload, clickId: clickId ? String(clickId) : null, txnId: txnId ? String(txnId) : null, saleAmount, payout, currency, status, campaignId, p1 };
}

/**
 * Trackier (VCommission) Postback Handler
 * Endpoint:
 *   /api/webhooks/trackier
 *
 * Recommended Trackier postback URL:
 *   https://YOUR_DOMAIN.com/api/webhooks/trackier?click_id={click_id}&txn_id={txn_id}&sale_amount={sale_amount}&payout={payout}&currency={currency}&conversion_status={conversion_status}&campaign_id={campaign_id}&p1={p1}
 */
router.all('/', async (req, res) => {
  const { payload, clickId, txnId, saleAmount, payout, currency, status, campaignId, p1 } = normalizePayload(req);

  const event = await WebhookEvent.create({
    source: 'trackier',
    eventType: 'conversion',
    headers: req.headers,
    payload,
    status: 'received'
  });

  try {
    // We need clickId and txnId to be safe & idempotent
    if (!clickId || !txnId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Missing click_id or txn_id' });
      return res.status(400).json({ success: false, message: 'Missing click_id or txn_id' });
    }

    // Map clickId -> Click -> user/store
    // NOTE: This will work only if you store Click with clickId = click_id used in links.
    const click = await Click.findOne({ clickId }).lean();

    // Fallback: if click not found but p1 carries user reference like u<userId>, you can map it.
    // Here we keep it strict: if no click, 404.
    if (!click || !click.user) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Unknown click_id (click not found)' });
      return res.status(404).json({ success: false, message: 'Unknown click_id' });
    }

    const userId = click.user;
    const storeId = click.store || null;

    // Idempotency by orderId (we store txnId in orderId)
    let tx = await Transaction.findOne({ orderId: txnId }).exec();

    if (!tx) {
      tx = await Transaction.create({
        user: userId,
        store: storeId,
        orderId: txnId,
        orderDate: new Date(),
        productAmount: saleAmount,
        commissionAmount: payout,
        status, // pending|confirmed|cancelled
        clickId,
        trackingData: {
          source: 'trackier',
          currency,
          campaignId: campaignId ? String(campaignId) : null,
          p1: p1 ? String(p1) : null
        },
        affiliateData: {
          provider: 'trackier',
          click_id: clickId,
          txn_id: txnId
        },
        notes: 'Created via Trackier postback'
      });

      // Wallet credit logic
      if (payout > 0) {
        if (tx.status === 'pending') {
          await User.updateOne(
            { _id: userId },
            {
              $inc: {
                'wallet.pendingCashback': payout,
                'wallet.totalEarnings': payout,
                'affiliateInfo.pendingCommissions': payout,
                'affiliateInfo.totalCommissions': payout
              }
            }
          );
        } else if (tx.status === 'confirmed') {
          await User.updateOne(
            { _id: userId },
            {
              $inc: {
                'wallet.confirmedCashback': payout,
                'wallet.availableBalance': payout,
                'wallet.totalEarnings': payout,
                'affiliateInfo.totalCommissions': payout
              }
            }
          );
        }
      }
    } else {
      // Update existing transaction + wallet transitions
      const prevStatus = String(tx.status || 'pending');
      const prevPayout = parseNumber(tx.commissionAmount, 0);

      tx.productAmount = saleAmount || tx.productAmount;
      tx.commissionAmount = payout || tx.commissionAmount;
      tx.status = status;
      tx.clickId = tx.clickId || clickId;

      tx.trackingData = {
        ...(tx.trackingData || {}),
        source: 'trackier',
        currency,
        campaignId: campaignId ? String(campaignId) : (tx.trackingData?.campaignId || null),
        p1: p1 ? String(p1) : (tx.trackingData?.p1 || null)
      };

      tx.affiliateData = { ...(tx.affiliateData || {}), provider: 'trackier', click_id: clickId, txn_id: txnId };
      await tx.save();

      const newPayout = parseNumber(tx.commissionAmount, 0);

      // If payout changes while still pending->pending, adjust pending by delta
      if (prevStatus === 'pending' && tx.status === 'pending' && newPayout !== prevPayout) {
        const delta = newPayout - prevPayout;
        await User.updateOne(
          { _id: userId },
          {
            $inc: {
              'wallet.pendingCashback': delta,
              'wallet.totalEarnings': delta,
              'affiliateInfo.pendingCommissions': delta,
              'affiliateInfo.totalCommissions': delta
            }
          }
        );
      }

      // Status transitions
      if (prevStatus !== tx.status) {
        const amt = Math.abs(newPayout);

        // pending -> confirmed
        if (prevStatus === 'pending' && tx.status === 'confirmed' && amt > 0) {
          await User.updateOne(
            { _id: userId },
            {
              $inc: {
                'wallet.pendingCashback': -amt,
                'wallet.confirmedCashback': amt,
                'wallet.availableBalance': amt,
                'affiliateInfo.pendingCommissions': -amt
              }
            }
          );
        }

        // pending -> cancelled
        if (prevStatus === 'pending' && tx.status === 'cancelled' && amt > 0) {
          await User.updateOne(
            { _id: userId },
            {
              $inc: {
                'wallet.pendingCashback': -amt,
                'affiliateInfo.pendingCommissions': -amt
              }
            }
          );
        }

        // confirmed -> cancelled (reversal)
        if (prevStatus === 'confirmed' && tx.status === 'cancelled' && amt > 0) {
          await User.updateOne(
            { _id: userId },
            {
              $inc: {
                'wallet.confirmedCashback': -amt,
                'wallet.availableBalance': -amt
              }
            }
          );
        }
      }
    }

    await WebhookEvent.findByIdAndUpdate(event._id, {
      status: 'processed',
      processedAt: new Date(),
      transaction: tx._id
    });

    return res.json({ success: true, data: { clickId, txnId, status, transactionId: tx._id } });
  } catch (err) {
    console.error('Trackier webhook error:', err);
    await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: err.message || 'Server error' });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;