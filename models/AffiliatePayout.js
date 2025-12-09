const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  commissions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Commission' }],
  amount: { type: Number, required: true }, // sum of commissions (after any fees)
  method: { type: String, enum: ['bank','upi','wallet','manual'], default: 'manual' },
  methodDetails: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['pending','approved','processed','rejected'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  processedAt: Date,
  adminNotes: String,
  transactionReference: String // external payment provider ID
}, {
  timestamps: true
});

payoutSchema.index({ affiliate: 1, status: 1, requestedAt: -1 });

module.exports = mongoose.model('AffiliatePayout', payoutSchema);