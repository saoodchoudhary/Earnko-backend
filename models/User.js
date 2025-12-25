const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['user','admin','affiliate'], default: 'user' },

  // Social login
  provider: { type: String, enum: ['local','google'], default: 'local' },
  providerId: { type: String, default: '' },

  phone: { type: String, default: '' },

  payout: {
    upiId: { type: String, default: '' },
    bank: {
      holderName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifsc: { type: String, default: '' },
      bankName: { type: String, default: '' }
    }
  },

  // Referral tracking
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  affiliateInfo: {
    isAffiliate: { type: Boolean, default: false },
    affiliateSince: Date,
    uniqueLinks: [{
      store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
      customSlug: String,
      clicks: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      metadata: mongoose.Schema.Types.Mixed,
      createdAt: { type: Date, default: Date.now }
    }],
    totalCommissions: { type: Number, default: 0 },
    pendingCommissions: { type: Number, default: 0 },
    paidCommissions: { type: Number, default: 0 }
  },

  wallet: {
    totalEarnings: { type: Number, default: 0 },
    pendingCashback: { type: Number, default: 0 },
    confirmedCashback: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 }
  }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidate) {
  return await bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);