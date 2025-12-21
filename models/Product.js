const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  images: [{ type: String }],
  price: { type: Number, default: 0 },

  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },

  // Destination product URL (merchant page)
  deeplink: { type: String, required: true },

  // Optional mapping for commission rules
  categoryKey: { type: String, default: '' },

  isActive: { type: Boolean, default: true, index: true },

  // Commission override at product-level (takes precedence over store/category rules)
  commissionOverride: {
    rate: { type: Number, default: null },
    type: { type: String, enum: ['percentage','fixed', null], default: null },
    maxCap: { type: Number, default: null }
  },

  // Cuelinks-specific integration fields for admin convenience
  cuelinksChannelId: { type: String, default: '' },   // optional channel id
  cuelinksCampaignId: { type: String, default: '' },  // optional campaign id (for reference)
  cuelinksCountryId: { type: String, default: '' },   // optional override; if blank, backend defaults to account country

  // Cached validation info
  merchantHost: { type: String, default: '' },
  cuelinksApprovalRequired: { type: Boolean, default: false },
  lastCuelinksValidatedAt: { type: Date, default: null },
  lastCuelinksError: { type: String, default: '' },

  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

productSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);