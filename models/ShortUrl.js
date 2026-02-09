const mongoose = require('mongoose');

const shortUrlSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },

  // NEW: map to our internal slug so tracking pipeline stays intact
  slug: { type: String, required: true, index: true },

  // keep old fields optional for backward compat
  url: { type: String, default: '' }, // optional legacy
  clickId: { type: String, default: '', index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  provider: { type: String, default: '' }
}, { timestamps: true });

shortUrlSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShortUrl', shortUrlSchema);