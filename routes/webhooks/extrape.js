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
  if (['approved', 'confirmed', 'valid', 'paid', 'success', 'successful'].includes(s)) return 'confirmed';
  if (['cancelled', 'canceled', 'rejected', 'invalid', 'void', 'failed', 'fraud'].includes(s)) return 'cancelled';
  return 'pending';
}

function normalizePayload(req) {
  const payload = {
    ...(req.query || {}),
    ...(typeof req.body === 'object' && req.body ? req.body : {})
  };

  const subid =
    payload.subid ||
    payload.sub_id ||
    payload.sid ||
    payload.click_id ||
    payload.clickid ||
    payload.affExtParam2 ||
    null;

  const orderId =
    payload.order_id ||
    payload.orderid ||
    payload.oid ||
    payload.transaction_id ||
    payload.txn_id ||
    payload.txnid ||
    payload.sale_id ||
    null;

  const saleAmount = parseNumber(
    payload.sale_amount ?? payload.amount ?? payload.order_amount ?? payload.total ?? 0,
    0
  );

  const commission = parseNumber(
    payload.commission ?? payload.payout ?? payload.earnings ?? payload.reward ?? 0,
    0
  );

  const status = normStatus(payload.status || payload.conversion_status || payload.state);
  const currency = String(payload.currency || payload.curr || 'INR');

  return {
    payload,
    subid: subid ? String(subid) : null,
    orderId: orderId ? String(orderId) : null,
    saleAmount,
    commission,
    status,
    currency
  };
}

/**
 * Extrape Postback Handler (NO SECURITY)
 * Endpoint: /api/webhooks/extrape
 *
 * Recommended params:
 *  - subid (affExtParam2)
 *  - order_id
 *  - sale_amount
 *  - commission
 *  - status (approved/cancelled/pending)
 */
router.all('/', async (req, res) => {
  const { payload, subid, orderId, saleAmount, commission, status, currency } = normalizePayload(req);

  const event = await WebhookEvent.create({
    source: 'extrape',
    eventType: 'conversion',
    headers: req.headers,
    payload,
    status: 'received'
  });

  try {
    if (!subid || !orderId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Missing subid or order_id' });
      return res.status(400).json({ success: false, message: 'Missing subid or order_id' });
    }

    // Map subid -> Click -> user/store
    const click = await Click.findOne({ clickId: subid }).lean();
    if (!click || !click.user) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Unknown subid (click not found)' });
      return res.status(404).json({ success: false, message: 'Unknown subid' });
    }

    const userId = click.user;
    const storeId = click.store || null;

    // IMPORTANT: avoid collisions across providers by using provider + orderId
    const provider = 'extrape';
    const providerOrderId = `${provider}:${orderId}`;

    let tx = await Transaction.findOne({ orderId: providerOrderId }).exec();

    if (!tx) {
      tx = await Transaction.create({
        user: userId,
        store: storeId,
        orderId: providerOrderId,
        orderDate: new Date(),
        productAmount: saleAmount,
        commissionAmount: commission,
        status,
        clickId: subid,
        trackingData: { source: 'extrape', currency, rawOrderId: orderId },
        affiliateData: { provider: 'extrape', subid },
        notes: 'Created via Extrape postback'
      });

      // Credit on create
      if (commission > 0 && tx.status === 'pending') {
        await User.updateOne(
          { _id: userId },
          {
            $inc: {
              'wallet.pendingCashback': commission,
              'wallet.totalEarnings': commission,
              'affiliateInfo.pendingCommissions': commission,
              'affiliateInfo.totalCommissions': commission
            }
          }
        );
      }

      if (commission > 0 && tx.status === 'confirmed') {
        await User.updateOne(
          { _id: userId },
          {
            $inc: {
              'wallet.confirmedCashback': commission,
              'wallet.availableBalance': commission,
              'wallet.totalEarnings': commission,
              'affiliateInfo.totalCommissions': commission
            }
          }
        );
      }
    } else {
      const prevStatus = String(tx.status || 'pending');
      const prevCommission = parseNumber(tx.commissionAmount, 0);

      // FIX: allow 0 values; don't use "commission || old"
      if (saleAmount !== undefined && saleAmount !== null) tx.productAmount = saleAmount;
      if (commission !== undefined && commission !== null) tx.commissionAmount = commission;

      tx.clickId = tx.clickId || subid;
      tx.status = status;
      tx.trackingData = { ...(tx.trackingData || {}), source: 'extrape', currency, rawOrderId: orderId };
      tx.affiliateData = { ...(tx.affiliateData || {}), provider: 'extrape', subid };
      await tx.save();

      const newCommission = parseNumber(tx.commissionAmount, 0);

      // pending -> pending commission change
      if (prevStatus === 'pending' && tx.status === 'pending' && newCommission !== prevCommission) {
        const delta = newCommission - prevCommission;
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

      if (prevStatus !== tx.status) {
        const amt = Math.abs(newCommission);

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

    return res.json({
      success: true,
      data: { orderId, status, transactionId: tx._id }
    });
  } catch (err) {
    console.error('Extrape webhook error:', err);
    await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: err.message || 'Server error' });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;