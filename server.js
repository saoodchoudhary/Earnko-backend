const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { Server } = require('socket.io');
const { setIO } = require('./socket/io');
const { initSupportSockets } = require('./socket/support');

const config = {
  port: process.env.PORT || 8080,
  mongoUri: process.env.MONGODB_URI
};

const app = express();
const server = http.createServer(app);

// CORS
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Core routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/products', require('./routes/products'));
app.use('/api/links', require('./routes/links'));

// Tracking redirect (ensure this points to redirect handler, not webhook)
app.use('/api/tracking', require('./routes/tracking'));

// Conversions and wallet
app.use('/api/conversions', require('./routes/conversions'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/webhooks', require('./routes/webhook'));

// Admin
app.use('/api/admin/products', require('./routes/admin/products'));
app.use('/api/admin/payouts', require('./routes/admin/payouts'));
app.use('/api/admin/transactions', require('./routes/admin/transactions'));
app.use('/api/admin/users', require('./routes/admin/users'));
app.use('/api/admin/commissions', require('./routes/admin/commissions'));
app.use('/api/admin/stores', require('./routes/admin/stores'));
app.use('/api/admin/clicks', require('./routes/admin/clicks'));
app.use('/api/admin/webhooks', require('./routes/admin/webhooks'));
app.use('/api/admin/settings', require('./routes/admin/settings'));
app.use('/api/admin/support', require('./routes/admin/support'));

// Public offers (CategoryCommission)
app.use('/api/public/offers', require('./routes/public/offers'));




// User-scoped routes for dashboard
app.use('/api/user/profile', require('./routes/user/profile'));
app.use('/api/user/clicks', require('./routes/user/clicks'));
app.use('/api/user/referrals', require('./routes/user/referrals')); // ensure this file exists (added above)
app.use('/api/support', require('./routes/support'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/user/analytics', require('./routes/user/analytics'));

app.use('/api/user/links', require('./routes/user/links')); // NEW

// Cuelinks integration
app.use('/api/affiliate/cuelinks', require('./routes/affiliate/cuelinks'));
app.use('/api/webhooks/cuelinks', require('./routes/webhooks/cuelinks'));

app.use('/api/admin/category-commissions', require('./routes/admin/category-commissions'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Socket.io
const io = new Server(server, { cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true } });
setIO(io);
initSupportSockets(io);

async function start() {
  try {
    await mongoose.connect(config.mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('MongoDB connected');
    server.listen(config.port, () => console.log(`Server started on port ${config.port}`));
  } catch (err) {
    console.error('Failed to start', err);
    process.exit(1);
  }
}
start();

module.exports = app;