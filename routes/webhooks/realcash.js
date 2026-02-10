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

  const clickId =
    payload.click_id ||
    payload.clickid ||
    payload.subid ||
    payload.sub_id ||
    payload.subid1 ||
    payload.subid2 ||
    null;

  const orderId =
    payload.order_id ||
    payload.orderid ||
    payload.transaction_id ||
    payload.txn_id ||
    payload.txnid ||
    null;

  const saleAmount = parseNumber(payload.order_amount ?? payload.sale_amount ?? payload.amount ?? 0, 0);
  const commission = parseNumber(payload.payout ?? payload.commission ?? payload.earnings ?? 0, 0);

  const status = normStatus(payload.status || payload.conversion_status || payload.state);
  const currency = String(payload.order_currency || payload.currency || 'INR');

  return {
    payload,
    clickId: clickId ? String(clickId) : null,
    orderId: orderId ? String(orderId) : null,
    saleAmount,
    commission,
    status,
    currency
  };
}

router.all('/', async (req, res) => {
  const { payload, clickId, orderId, saleAmount, commission, status, currency } = normalizePayload(req);

  const event = await WebhookEvent.create({
    source: 'realcash',
    eventType: 'conversion',
    headers: req.headers,
    payload,
    status: 'received'
  });

  try {
    if (!clickId || !orderId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Missing click_id/subid or order_id/transaction_id' });
      return res.status(400).json({ success: false, message: 'Missing click_id and order_id' });
    }

    const click = await Click.findOne({ clickId }).lean();
    if (!click || !click.user) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Unknown click_id (click not found)' });
      return res.status(404).json({ success: false, message: 'Unknown click_id' });
    }

    const userId = click.user;
    const storeId = click.store || null;

    const providerOrderId = `realcash:${orderId}`;
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
        clickId,
        trackingData: { source: 'realcash', currency, rawOrderId: orderId },
        affiliateData: { provider: 'realcash', clickId },
        notes: 'Created via RealCash postback'
      });

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

      if (saleAmount !== undefined && saleAmount !== null) tx.productAmount = saleAmount;
      if (commission !== undefined && commission !== null) tx.commissionAmount = commission;

      tx.status = status;
      tx.clickId = tx.clickId || clickId;
      tx.trackingData = { ...(tx.trackingData || {}), source: 'realcash', currency, rawOrderId: orderId };
      tx.affiliateData = { ...(tx.affiliateData || {}), provider: 'realcash', clickId };
      await tx.save();

      const newCommission = parseNumber(tx.commissionAmount, 0);

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

    return res.json({ success: true, data: { orderId, status, transactionId: tx._id } });
  } catch (err) {
    console.error('RealCash webhook error:', err);
    await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: err.message || 'Server error' });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;