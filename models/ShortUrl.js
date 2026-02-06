const mongoose = require('mongoose');

const shortUrlSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  url: { type: String, required: true }, // destination provider link

  clickId: { type: String, default: '', index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  provider: { type: String, default: '' }
}, { timestamps: true });

shortUrlSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShortUrl', shortUrlSchema);