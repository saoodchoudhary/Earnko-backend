
const express = require('express');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/roles');
const AffiliatePayout = require('../../models/AffiliatePayout');
const User = require('../../models/User');

const router = express.Router();

// List payouts
router.get('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const payouts = await AffiliatePayout.find(query).sort({ createdAt: -1 }).populate('user');
    res.json({ success:true, data: { payouts } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Update payout status
router.put('/:id/status', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status, reference } = req.body; // 'processing' | 'paid' | 'rejected'
    if (!['processing','paid','rejected'].includes(status)) return res.status(400).json({ success:false, message:'Invalid status' });

    const payout = await AffiliatePayout.findById(req.params.id);
    if (!payout) return res.status(404).json({ success:false, message:'Not found' });

    payout.status = status;
    payout.reference = reference || payout.reference;
    await payout.save();

    if (status === 'paid') {
      await User.updateOne(
        { _id: payout.user },
        { $inc: { 'wallet.totalWithdrawn': payout.amount } }
      );
    } else if (status === 'rejected') {
      // Return amount back to available balance
      await User.updateOne(
        { _id: payout.user },
        { $inc: { 'wallet.availableBalance': payout.amount } }
      );
    }

    res.json({ success:true, data: { payout } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;


// const express = require('express');
// const { adminAuth } = require('../../middleware/auth');
// const AffiliatePayout = require('../../models/AffiliatePayout');
// const Commission = require('../../models/Commission');
// const commissionService = require('../../services/commissionService');
// const User = require('../../models/User');
// const { body, validationResult } = require('express-validator');

// const router = express.Router();

// /**
//  * GET /api/admin/payouts
//  * List payouts with filters
//  */
// router.get('/', adminAuth, async (req, res) => {
//   try {
//     const { page = 1, limit = 20, status } = req.query;
//     const filter = {};
//     if (status && status !== 'all') filter.status = status;

//     const payouts = await AffiliatePayout.find(filter)
//       .populate('affiliate', 'name email')
//       .populate('commissions')
//       .sort({ requestedAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit)
//       .lean();

//     const total = await AffiliatePayout.countDocuments(filter);

//     res.json({
//       success: true,
//       data: { payouts, totalPages: Math.ceil(total / limit), currentPage: parseInt(page), total }
//     });
//   } catch (err) {
//     console.error('Admin get payouts error:', err);
//     res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// });

// /**
//  * POST /api/admin/payouts
//  * Create manual payout (admin groups commissions into payout)
//  * body: { affiliateId, commissionIds: [], method, methodDetails }
//  */
// router.post('/', adminAuth, [
//   body('affiliateId').notEmpty(),
//   body('commissionIds').isArray({ min: 1 }),
//   body('method').isIn(['bank','upi','wallet','manual'])
// ], async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

//     const { affiliateId, commissionIds, method, methodDetails } = req.body;

//     // Fetch commissions and total
//     const commissions = await Commission.find({ _id: { $in: commissionIds }, affiliate: affiliateId, status: 'approved' });
//     if (!commissions || commissions.length === 0) return res.status(400).json({ success: false, message: 'No approved commissions found' });

//     const amount = commissions.reduce((s, c) => s + c.amount, 0);

//     const payout = await AffiliatePayout.create({
//       affiliate: affiliateId,
//       commissions: commissions.map(c => c._id),
//       amount,
//       method,
//       methodDetails,
//       status: 'approved', // admin created and approves
//       processedAt: new Date()
//     });

//     // Mark commissions paid via service
//     await commissionService.markCommissionsPaid(commissions.map(c => c._id), `admin_payout_${payout._id}`);

//     // Update affiliate wallet totals handled by commissionService.markCommissionsPaid

//     res.status(201).json({ success: true, message: 'Payout created and commissions marked as paid', data: payout });
//   } catch (err) {
//     console.error('Create payout error:', err);
//     res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// });

// /**
//  * PATCH /api/admin/payouts/:id/status
//  * Update payout status (approve/process/reject)
//  * body: { status, adminNotes, transactionReference }
//  */
// router.patch('/:id/status', adminAuth, [
//   body('status').isIn(['pending','approved','processed','rejected'])
// ], async (req, res) => {
//   try {
//     const payout = await AffiliatePayout.findById(req.params.id).populate('affiliate');
//     if (!payout) return res.status(404).json({ success: false, message: 'Payout not found' });

//     const oldStatus = payout.status;
//     payout.status = req.body.status;
//     if (req.body.adminNotes) payout.adminNotes = req.body.adminNotes;
//     if (req.body.transactionReference) payout.transactionReference = req.body.transactionReference;
//     if (req.body.status === 'processed') payout.processedAt = new Date();

//     await payout.save();

//     // If processed now, mark commissions paid (if any remain)
//     if (oldStatus !== 'processed' && payout.status === 'processed') {
//       await commissionService.markCommissionsPaid(payout.commissions, payout.transactionReference || `payout_${payout._id}`);
//     }

//     res.json({ success: true, message: 'Payout updated', data: payout });
//   } catch (err) {
//     console.error('Update payout status error:', err);
//     res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// });

// module.exports = router;