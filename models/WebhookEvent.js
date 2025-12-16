const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
  source: { type: String, default: 'generic', index: true }, // e.g., cuelinks, custom
  eventType: { type: String, default: '' },
  headers: mongoose.Schema.Types.Mixed,
  payload: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['received','processed','error'], default: 'received', index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  error: { type: String, default: null },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

webhookEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);