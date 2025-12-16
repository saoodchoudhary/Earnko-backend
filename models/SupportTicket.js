const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['open','in_progress','resolved','closed'], default: 'open', index: true },
  replies: [{
    by: { type: String, enum: ['user','admin'], default: 'user' },
    message: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);