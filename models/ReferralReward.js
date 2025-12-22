const mongoose = require('mongoose');

const referralRewardSchema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referred: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
  amount: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['pending','credited','reversed'], default: 'credited' },
  notes: { type: String, default: '' }
}, { timestamps: true });

// prevent duplicate rewards for the same transaction/referrer
referralRewardSchema.index({ transaction: 1, referrer: 1 }, { unique: true });

module.exports = mongoose.model('ReferralReward', referralRewardSchema);