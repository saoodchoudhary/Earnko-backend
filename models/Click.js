const mongoose = require('mongoose');

const clickSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  clickId: { type: String, required: true, unique: true },
  ipAddress: String,
  userAgent: String,
  referrer: String,
  customSlug: String,
  affiliateLink: String,
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

module.exports = mongoose.model('Click', clickSchema);