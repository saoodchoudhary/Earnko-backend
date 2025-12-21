const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const Click = require('../../models/Click');
const WebhookEvent = require('../../models/WebhookEvent');

const router = express.Router();

/**
 * Cuelinks Postback/Webhook
 * Configure in Cuelinks your postback URL to this endpoint.
 * We support both query and JSON body params:
 * Expecting typical keys:
 * - subid (our clickId), order_id (or orderid), sale_amount (or amount), commission (or payout), status, merchant (optional)
 *
 * Example mapping:
 * status: 'pending' | 'confirmed' | 'cancelled' (map to pending/approved/rejected)
 */
router.all('/', async (req, res) => {
  const payload = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };

  // Save event first
  const event = await WebhookEvent.create({
    source: 'cuelinks',
    eventType: 'conversion',
    headers: req.headers,
    payload,
    status: 'received'
  });

  try {
    const subid = payload.subid || payload.sub_id || payload.sid || null;
    const orderId = payload.order_id || payload.orderid || payload.oid || null;
    const saleAmount = Number(payload.sale_amount ?? payload.amount ?? payload.order_amount ?? 0) || 0;
    const commission = Number(payload.commission ?? payload.payout ?? payload.earnings ?? 0) || 0;
    const statusRaw = String(payload.status || '').toLowerCase();

    if (!subid || !orderId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Missing subid or order_id' });
      return res.status(400).json({ success: false, message: 'Missing subid or order_id' });
    }

    // Map status
    let status = 'pending';
    if (['confirmed', 'approved', 'valid', 'paid'].includes(statusRaw)) status = 'approved';
    else if (['cancelled', 'rejected', 'invalid', 'void'].includes(statusRaw)) status = 'rejected';
    else status = 'pending';

    // Find click by clickId (subid) → user + store
    const click = await Click.findOne({ clickId: subid }).lean();
    const userId = click?.user;
    const storeId = click?.store || null;

    // Upsert transaction by orderId (per network)
    let tx = await Transaction.findOne({ orderId });
    const isNew = !tx;

    if (!tx) {
      tx = await Transaction.create({
        user: userId || null,
        orderId,
        amount: saleAmount,
        commissionAmount: commission,
        store: storeId,
        status,
        clickId: subid,
        trackingData: { network: 'cuelinks' }
      });
    } else {
      const prevStatus = tx.status;
      tx.amount = saleAmount || tx.amount || 0;
      tx.commissionAmount = commission || tx.commissionAmount || 0;
      tx.status = status;
      if (!tx.store && storeId) tx.store = storeId;
      if (!tx.clickId) tx.clickId = subid;
      await tx.save();

      // Wallet diffs if user present and status changed
      if (userId && prevStatus !== status) {
        if (prevStatus !== 'approved' && status === 'approved') {
          // Move from pending → available
          await User.updateOne(
            { _id: userId },
            {
              $inc: {
                'wallet.pendingCashback': -Math.abs(tx.commissionAmount || 0),
                'wallet.confirmedCashback': Math.abs(tx.commissionAmount || 0),
                'wallet.availableBalance': Math.abs(tx.commissionAmount || 0)
              }
            }
          );
        } else if (prevStatus !== 'rejected' && status === 'rejected') {
          // Remove from pending
          await User.updateOne(
            { _id: userId },
            { $inc: { 'wallet.pendingCashback': -Math.abs(tx.commissionAmount || 0) } }
          );
        } else if (isNew && status === 'pending') {
          // handled below for new, added here for completeness
        }
      }
    }

    // Wallet adjust for new tx
    if (isNew && userId) {
      if (status === 'pending') {
        await User.updateOne(
          { _id: userId },
          { $inc: { 'wallet.pendingCashback': Math.abs(commission) } }
        );
      } else if (status === 'approved') {
        await User.updateOne(
          { _id: userId },
          {
            $inc: {
              'wallet.confirmedCashback': Math.abs(commission),
              'wallet.availableBalance': Math.abs(commission)
            }
          }
        );
      }
    }

    await WebhookEvent.findByIdAndUpdate(event._id, {
      status: 'processed',
      processedAt: new Date(),
      transaction: tx._id
    });

    return res.json({ success: true, data: { transaction: tx } });
  } catch (err) {
    console.error('Cuelinks webhook error:', err);
    await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: err.message || 'Server error' });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;