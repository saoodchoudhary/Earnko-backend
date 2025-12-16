const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  group: { type: String, default: 'general', index: true },
  description: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Setting', settingSchema);