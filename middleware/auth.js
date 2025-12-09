const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

async function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) return res.status(401).json({ success:false, message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ success:false, message: 'Invalid token' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ success:false, message: 'Unauthorized' });
  }
}

module.exports = { auth };