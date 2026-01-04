

const express = require('express');
const { auth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/change-password
 * body: { currentPassword, newPassword }
 */
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'currentPassword and newPassword required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = req.user; // populated by auth middleware
    const ok = await user.comparePassword(currentPassword);
    if (!ok) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

    user.password = newPassword; // will be hashed by userSchema.pre('save')
    await user.save();

    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('change-password error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;