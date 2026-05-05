const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

async function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) return res.status(401).json({ success:false, message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ success:false, message: 'Invalid token' });
    if (user.accountStatus === 'blocked') return res.status(401).json({ success:false, message: 'Account blocked' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ success:false, message: 'Unauthorized' });
  }
}

// Admin-only guard
function adminAuth(req, res, next) {
  return auth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success:false, message:'Forbidden' });
    }
    next();
  });
}

module.exports = { auth, adminAuth };