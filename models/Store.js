const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: { type: String, required: true },

  // Updated: added extrape + trackier
  affiliateNetwork: {
    type: String,
    enum: [ 'cuelinks', 'extrape', 'trackier', 'manual', 'custom'],
    default: 'manual'
  },

  commissionRate: { type: Number, default: 0 },
  commissionType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  maxCommission: { type: Number, default: null },

  trackingUrl: String,
  baseUrl: String,

  // optional logo path served from /uploads
  logo: { type: String, default: null },

  isActive: { type: Boolean, default: true },
  cookieDuration: { type: Number, default: 30 }, // days
  description: { type: String, default: '' },

  // optional for future store-specific config
  metadata: mongoose.Schema.Types.Mixed,

  stats: {
    totalClicks: { type: Number, default: 0 },
    totalConversions: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);