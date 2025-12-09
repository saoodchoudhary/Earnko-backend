const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  orderId: { type: String, required: true, index: true },
  orderDate: Date,
  productAmount: Number,
  commissionRate: Number,
  commissionAmount: Number,
  status: { type: String, enum: ['pending','confirmed','cancelled','under_review'], default: 'pending' },
  trackingData: mongoose.Schema.Types.Mixed,
  affiliateData: mongoose.Schema.Types.Mixed,
  clickId: String,
  fraudFlags: mongoose.Schema.Types.Mixed,
  notes: String
}, { timestamps: true });

transactionSchema.index({ orderId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('Transaction', transactionSchema);