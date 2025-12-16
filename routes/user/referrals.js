const express = require('express');
const { auth } = require('../../middleware/auth');

const router = express.Router();

/**
 * GET /api/user/referrals
 * Returns simple stats placeholder (can integrate real counts later)
 */
router.get('/', auth, async (req, res) => {
  try {
    // Placeholder counts; integrate with your referral program if available
    res.json({ success: true, data: { totalReferrals: 0, activeReferrals: 0, referralEarnings: 0, clicks: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;