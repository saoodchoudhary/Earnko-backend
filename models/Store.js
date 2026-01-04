const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  affiliateNetwork: { type: String, enum: ['amazon','flipkart','cuelinks','manual','custom'], default: 'manual' },
  commissionRate: { type: Number, default: 0 },
  commissionType: { type: String, enum: ['percentage','fixed'], default: 'percentage' },
  maxCommission: { type: Number, default: null },
  trackingUrl: String,
  baseUrl: String,
  // New: optional logo path (served via /uploads)
  logo: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  cookieDuration: { type: Number, default: 30 }, // days
  description: { type: String, default: '' },
  stats: {
    totalClicks: { type: Number, default: 0 },
    totalConversions: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);