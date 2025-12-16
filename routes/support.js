const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const SupportTicket = require('../models/SupportTicket');

const router = express.Router();

/**
 * POST /api/support/tickets
 * body: { subject, message }
 */
router.post('/tickets', auth, async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message required' });
    const ticket = await SupportTicket.create({ user: req.user._id, subject, message });
    res.status(201).json({ success: true, data: { ticket } });
  } catch (err) {
    console.error('create ticket error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/support/tickets/me
 * List current user's tickets
 */
router.get('/tickets/me', auth, async (req, res) => {
  try {
    const items = await SupportTicket.find({ user: req.user._id })
      .sort('-updatedAt')
      .lean();
    res.json({ success: true, data: { items } });
  } catch (err) {
    console.error('list my tickets error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/support/tickets/:id
 * Get a single ticket thread for current user
 */
router.get('/tickets/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const ticket = await SupportTicket.findById(id).lean();
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    if (String(ticket.user) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'Forbidden' });
    res.json({ success: true, data: { ticket } });
  } catch (err) {
    console.error('get ticket error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/support/tickets/:id/reply
 * body: { message }
 */
router.post('/tickets/:id/reply', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });
    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    if (String(ticket.user) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'Forbidden' });

    ticket.replies.push({ by: 'user', message, createdAt: new Date() });
    ticket.updatedAt = new Date();
    await ticket.save();
    res.status(201).json({ success: true, data: { ticket } });
  } catch (err) {
    console.error('user reply error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PATCH /api/support/tickets/:id/close
 * Close the ticket by user
 */
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
    res.json({ success: true, data: { ticket } });
  } catch (err) {
    console.error('close ticket error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;