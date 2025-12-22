const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  images: [{ type: String }],
  price: { type: Number, default: 0 },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },

  // Merchant product page URL
  deeplink: { type: String, required: true },

  categoryKey: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },

  commissionOverride: {
    rate: { type: Number, default: null },
    type: { type: String, enum: ['percentage','fixed', null], default: null },
    maxCap: { type: Number, default: null }
  },

  // Cuelinks convenience fields for admin
  cuelinksChannelId: { type: String, default: '' },
  cuelinksCampaignId: { type: String, default: '' },
  cuelinksCountryId: { type: String, default: '' },

  merchantHost: { type: String, default: '' },
  cuelinksApprovalRequired: { type: Boolean, default: false },
  lastCuelinksValidatedAt: { type: Date, default: null },
  lastCuelinksError: { type: String, default: '' },

  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

productSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);