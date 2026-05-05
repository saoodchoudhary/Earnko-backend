const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const Click = require('../../models/Click');
const WebhookEvent = require('../../models/WebhookEvent');
const { creditOnApprovedTransaction, reverseOnRejection } = require('../../services/referralService');
const { makeWebhookAuth } = require('../../middleware/webhookAuth');

const router = express.Router();

const MAX_COMMISSION = 50000; // ₹50,000 sanity cap

/**
 * Cuelinks Postback/Webhook
 * Keys: subid, order_id, sale_amount, commission, status
 */
router.all('/', makeWebhookAuth('CUELINKS_WEBHOOK_SECRET'), async (req, res) => {
    const payload = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };

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

        // Validate commission amount: reject negative values and unreasonably large amounts.
        // Zero is intentionally allowed — providers legitimately send commission=0 for
        // pending/tracking-only callbacks before the actual payout is calculated.
        if (commission < 0 || commission > MAX_COMMISSION) {
            await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Commission amount out of allowed range' });
            return res.status(400).json({ success: false, message: 'Commission amount out of allowed range' });
        }

        // Map status from Cuelinks:
        let status = 'pending';
        if (['confirmed', 'approved', 'valid', 'paid'].includes(statusRaw)) status = 'confirmed'; // was: 'approved'
        else if (['cancelled', 'rejected', 'invalid', 'void'].includes(statusRaw)) status = 'cancelled'; // was: 'rejected'

        // Find click by clickId (subid) => user + store
        const click = await Click.findOne({ clickId: subid }).lean();
        const userId = click?.user || null;
        const storeId = click?.store || null;

        // NOTE: intentionally no userId fallback from subid pattern — such a fallback
        // would allow anyone knowing a user ObjectId to inject wallet credits.

        // Upsert transaction by orderId
        let tx = await Transaction.findOne({ orderId });
        const isNew = !tx;
        let prevStatus = null;

        if (!tx) {
            // On create:
            tx = await Transaction.create({
                user: userId || null,
                orderId,
                productAmount: saleAmount,            // was: amount
                commissionAmount: commission,
                store: storeId || null,
                status,
                clickId: subid,
                trackingData: { network: 'cuelinks' }
            });

        } else {
            prevStatus = tx.status;
            // On update:
            tx.productAmount = saleAmount || tx.productAmount || 0;  // was: tx.amount
            tx.commissionAmount = commission || tx.commissionAmount || 0;
            tx.status = status;
            if (!tx.store && storeId) tx.store = storeId;
            if (!tx.clickId) tx.clickId = subid;
            await tx.save();

            // Wallet diffs if user present and status changed
            if (userId && prevStatus !== status) {
                if (prevStatus !== 'confirmed' && status === 'confirmed') {
                    await User.updateOne({ _id: userId }, {
                        $inc: {
                            'wallet.pendingCashback': -Math.abs(tx.commissionAmount || 0),
                            'wallet.confirmedCashback': Math.abs(tx.commissionAmount || 0),
                            'wallet.availableBalance': Math.abs(tx.commissionAmount || 0)
                        }
                    });
                } else if (prevStatus !== 'cancelled' && status === 'cancelled') {
                    await User.updateOne({ _id: userId }, { $inc: { 'wallet.pendingCashback': -Math.abs(tx.commissionAmount || 0) } });
                }
            }
        }

        // Wallet adjust for new tx
        if (isNew && userId) {
            if (status === 'pending') {
                await User.updateOne({ _id: userId }, { $inc: { 'wallet.pendingCashback': Math.abs(commission) } });
            } else if (status === 'confirmed') {
                await User.updateOne({ _id: userId }, {
                    $inc: {
                        'wallet.confirmedCashback': Math.abs(commission),
                        'wallet.availableBalance': Math.abs(commission)
                    }
                });
            }
        }

        // Referral: credit on approved; reverse if previously approved -> now rejected
        if (status === 'confirmed') {
            try { await creditOnApprovedTransaction(tx._id); } catch (e) { console.warn('referral credit error', e?.message); }
        } else if (prevStatus === 'confirmed' && status === 'cancelled') {
            try { await reverseOnRejection(tx._id); } catch (e) { console.warn('referral reverse error', e?.message); }
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