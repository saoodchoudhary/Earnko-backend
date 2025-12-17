const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function extractToken(handshake) {
  const h = handshake || {};
  const authHeader = h.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  if (h.auth?.token) return h.auth.token;
  if (h.query?.token) return h.query.token;
  return null;
}

async function authenticateSocket(socket) {
  const token = extractToken(socket.handshake);
  if (!token) throw new Error('No token');
  const decoded = jwt.verify(token, JWT_SECRET);
  const user = await User.findById(decoded.userId);
  if (!user) throw new Error('Invalid user');
  socket.user = user;
  return user;
}

async function canAccessTicket(user, ticketId) {
  if (!mongoose.isValidObjectId(ticketId)) return false;
  if (user.role === 'admin') return true;
  const t = await SupportTicket.findById(ticketId).select('user').lean();
  if (!t) return false;
  return String(t.user) === String(user._id);
}

function initSupportSockets(io) {
  io.on('connection', async (socket) => {
    try {
      await authenticateSocket(socket);
      console.log('[socket] connected', socket.user.email);
    } catch (e) {
      console.warn('[socket] auth failed', e.message);
      socket.emit('support:error', { message: 'Unauthorized' });
      return socket.disconnect(true);
    }

    socket.on('support:join', async (payload = {}, cb) => {
      try {
        const { ticketId } = payload;
        if (!ticketId) return cb?.({ ok: false, error: 'ticketId required' });
        const ok = await canAccessTicket(socket.user, ticketId);
        if (!ok) return cb?.({ ok: false, error: 'Forbidden' });
        const room = `ticket:${ticketId}`;
        socket.join(room);
        console.log('[socket] join', room, 'by', socket.user.email);
        cb?.({ ok: true, room });
      } catch (err) {
        cb?.({ ok: false, error: err.message || 'Server error' });
      }
    });

    socket.on('support:message', async (payload = {}, cb) => {
      try {
        const { ticketId, message } = payload;
        if (!ticketId || !message) return cb?.({ ok: false, error: 'ticketId and message required' });
        const ok = await canAccessTicket(socket.user, ticketId);
        if (!ok) return cb?.({ ok: false, error: 'Forbidden' });

        const t = await SupportTicket.findById(ticketId);
        if (!t) return cb?.({ ok: false, error: 'Not found' });

        const reply = { by: socket.user.role === 'admin' ? 'admin' : 'user', message, createdAt: new Date() };
        t.replies.push(reply);
        t.updatedAt = new Date();
        await t.save();

        io.to(`ticket:${ticketId}`).emit('support:message', { ticketId, reply });
        cb?.({ ok: true, data: { ticketId, reply } });
      } catch (err) {
        cb?.({ ok: false, error: err.message || 'Server error' });
      }
    });

    socket.on('support:status', async (payload = {}, cb) => {
      try {
        const { ticketId, status } = payload;
        if (!ticketId || !status) return cb?.({ ok: false, error: 'ticketId and status required' });
        if (socket.user.role !== 'admin') return cb?.({ ok: false, error: 'Forbidden' });

        const allowed = ['open','in_progress','resolved','closed'];
        if (!allowed.includes(status)) return cb?.({ ok: false, error: 'Invalid status' });

        const t = await SupportTicket.findByIdAndUpdate(ticketId, { status, updatedAt: new Date() }, { new: true });
        if (!t) return cb?.({ ok: false, error: 'Not found' });

        io.to(`ticket:${ticketId}`).emit('support:status', { ticketId, status, updatedAt: t.updatedAt });
        cb?.({ ok: true, data: { ticketId, status } });
      } catch (err) {
        cb?.({ ok: false, error: err.message || 'Server error' });
      }
    });
  });
}

module.exports = { initSupportSockets };