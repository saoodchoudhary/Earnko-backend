const mongoose = require('mongoose');

const clickSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  clickId: { type: String, required: true, unique: true },
  ipAddress: String,
  userAgent: String,
  referrer: String,
  customSlug: { type: String, index: true },
  affiliateLink: String,
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

clickSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Click', clickSchema);