const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  images: [{ type: String }],
  price: { type: Number, default: 0 },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  deeplink: { type: String, required: true }, // destination product URL
  categoryKey: { type: String, default: '' }, // optional product category mapping for CategoryCommission rules
  isActive: { type: Boolean, default: true, index: true },
  commissionOverride: {
    rate: { type: Number, default: null },
    type: { type: String, enum: ['percentage','fixed', null], default: null },
    maxCap: { type: Number, default: null }
  },
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

productSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);