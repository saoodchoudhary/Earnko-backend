const express = require('express');
const mongoose = require('mongoose');
let adminAuth, auth
try { ({ adminAuth, auth } = require('../../middleware/auth')) } catch {}
const SupportTicket = require('../../models/SupportTicket');
const User = require('../../models/User');

const ensureAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' })
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' })
  next()
}
const adminMiddleware = adminAuth ? [adminAuth] : (auth ? [auth, ensureAdmin] : [ensureAdmin])

const router = express.Router();

/**
 * GET /api/admin/support/tickets
 * Query: page, limit, status, q
 */
router.get('/tickets', ...adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = '', q = '' } = req.query
    const pageNum = Math.max(parseInt(page, 10) || 1, 1)
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)

    const filter = {}
    if (status) filter.status = status
    if (q) {
      const re = new RegExp(q, 'i')
      const users = await User.find({ $or: [{ email: re }, { name: re }] }, { _id: 1 }).lean()
      const userIds = users.map(u => u._id)
      filter.$or = [{ subject: re }]
      if (userIds.length) filter.$or.push({ user: { $in: userIds } })
    }

    const [items, total] = await Promise.all([
      SupportTicket.find(filter).populate('user', 'name email').sort('-updatedAt').skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SupportTicket.countDocuments(filter)
    ])

    res.json({ success: true, data: { items, total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum } })
  } catch (err) {
    console.error('admin tickets list error', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

/**
 * GET /api/admin/support/tickets/:id
 */
router.get('/tickets/:id', ...adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' })
    const ticket = await SupportTicket.findById(req.params.id).populate('user', 'name email').lean()
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, data: { ticket } })
  } catch (err) {
    console.error('admin ticket get error', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

/**
 * POST /api/admin/support/tickets/:id/reply
 * body: { message }
 */
router.post('/tickets/:id/reply', ...adminMiddleware, async (req, res) => {
  try {
    const { message } = req.body || {}
    if (!message) return res.status(400).json({ success: false, message: 'Message required' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' })

    const ticket = await SupportTicket.findById(req.params.id)
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' })

    ticket.replies.push({ by: 'admin', message, createdAt: new Date() })
    ticket.updatedAt = new Date()
    await ticket.save()

    res.status(201).json({ success: true, data: { ticket } })
  } catch (err) {
    console.error('admin ticket reply error', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

/**
 * PATCH /api/admin/support/tickets/:id/status
 * body: { status: 'open'|'in_progress'|'resolved'|'closed' }
 */
router.patch('/tickets/:id/status', ...adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body || {}
    const allowed = ['open', 'in_progress', 'resolved', 'closed']
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' })

    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status, updatedAt: new Date() }, { new: true })
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, data: { ticket } })
  } catch (err) {
    console.error('admin ticket status error', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

module.exports = router