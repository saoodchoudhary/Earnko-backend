const mongoose = require('mongoose');

const homepageBannerSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },

  // image stored in /uploads and saved as "/uploads/<file>"
  imageUrl: { type: String, required: true },

  linkUrl: { type: String, default: '' },
  buttonText: { type: String, default: 'Shop Now' },
  platform: { type: String, default: '' },

  sortOrder: { type: Number, default: 0, index: true },
  isActive: { type: Boolean, default: true, index: true },

  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null }
}, { timestamps: true });

homepageBannerSchema.index({ isActive: 1, sortOrder: 1, updatedAt: -1 });

module.exports = mongoose.model('HomepageBanner', homepageBannerSchema);