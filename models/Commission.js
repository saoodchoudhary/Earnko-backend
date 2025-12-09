const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true },
  amount: { type: Number, required: true },
  rate: { type: Number },
  type: { type: String, enum: ['percentage','fixed'], default: 'percentage' },
  status: { type: String, enum: ['pending','approved','paid','reversed','rejected','under_review'], default: 'pending' },
  reason: String,
  metadata: mongoose.Schema.Types.Mixed,
  approvedAt: Date,
  paidAt: Date,
  reversedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Commission', commissionSchema);