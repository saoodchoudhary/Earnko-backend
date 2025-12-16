const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  type: { type: String, default: 'general' },
  message: { type: String, required: true },
  read: { type: Boolean, default: false, index: true }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);