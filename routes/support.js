const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const { getIO } = require('../socket/io');
const SupportTicket = require('../models/SupportTicket');

const router = express.Router();

router.post('/tickets', auth, async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message required' });
    const ticket = await SupportTicket.create({ user: req.user._id, subject, message });
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