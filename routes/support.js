const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const { getIO } = require('../socket/io');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');

const { sendMail, formatTicketHtml, formatTicketText } = require('../services/mailer');

const router = express.Router();

function supportInbox() {
  return process.env.SUPPORT_INBOX_EMAIL || 'contact@earnko.com';
}

async function emailSupportInbox({ ticket, user, actorLabel }) {
  try {
    const to = supportInbox();
    const subject = `[Support] ${ticket?.subject || 'New Ticket'} (${String(ticket?._id || '').slice(0, 8)})`;
    const html = formatTicketHtml({ ticket, user, actorLabel });
    const text = formatTicketText({ ticket, user });
    await sendMail({ to, subject, html, text, replyTo: user?.email || undefined });
  } catch (err) {
    // Don’t fail API if email fails
    console.warn('[support-email] failed:', err?.message || err);
  }
}

router.post('/tickets', auth, async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message required' });

    const ticket = await SupportTicket.create({ user: req.user._id, subject, message });

    // email to Zoho inbox
    const user = await User.findById(req.user._id).select('name email').lean();
    await emailSupportInbox({ ticket, user, actorLabel: 'New ticket created by user' });

    res.status(201).json({ success: true, data: { ticket } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/tickets/me', auth, async (req, res) => {
  try {
    const items = await SupportTicket.find({ user: req.user._id }).sort('-updatedAt').lean();
    res.json({ success: true, data: { items } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/tickets/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const ticket = await SupportTicket.findById(id).lean();
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    if (String(ticket.user) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'Forbidden' });
    res.json({ success: true, data: { ticket } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/tickets/:id/reply', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    if (String(ticket.user) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'Forbidden' });

    const reply = { by: 'user', message, createdAt: new Date() };
    ticket.replies.push(reply);
    ticket.updatedAt = new Date();
    await ticket.save();

    try { getIO().to(`ticket:${id}`).emit('support:message', { ticketId: id, reply }); } catch {}

    // email to Zoho inbox on every user message
    const user = await User.findById(req.user._id).select('name email').lean();
    await emailSupportInbox({ ticket, user, actorLabel: 'User replied to ticket' });

    res.status(201).json({ success: true, data: { ticket } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/tickets/:id/close', auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    if (String(ticket.user) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'Forbidden' });

    ticket.status = 'closed';
    ticket.updatedAt = new Date();
    await ticket.save();

    try { getIO().to(`ticket:${id}`).emit('support:status', { ticketId: id, status: 'closed', updatedAt: ticket.updatedAt }); } catch {}

    res.json({ success: true, data: { ticket } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;