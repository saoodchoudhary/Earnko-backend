const mongoose = require('mongoose');

const categoryCommissionSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
  categoryKey: { type: String, required: true, index: true },
  label: { type: String },
  commissionRate: { type: Number, required: true, default: 0 },
  commissionType: { type: String, enum: ['percentage','fixed'], default: 'percentage' },
  maxCap: { type: Number, default: null },
  isActive: { type: Boolean, default: true },
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

categoryCommissionSchema.index({ store: 1, categoryKey: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('CategoryCommission', categoryCommissionSchema);