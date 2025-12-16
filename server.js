const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const config = {
  port: process.env.PORT || 8080,
  mongoUri: process.env.MONGODB_URI
};

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/affiliate', require('./routes/affiliate')); // existing
app.use('/api/webhooks', require('./routes/webhook'));    // existing
app.use('/api/stores', require('./routes/stores'));
app.use('/api/offers', require('./routes/offers'));
app.use('/api/links', require('./routes/links'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/conversions', require('./routes/conversions'));
app.use('/api/wallet', require('./routes/wallet'));
//  Admin transactions (NEW)
app.use('/api/admin/transactions', require('./routes/admin/transactions'));
app.use('/api/admin/users', require('./routes/admin/users')); // NEW
app.use('/api/admin/payouts', require('./routes/admin/payouts'));
app.use('/api/admin/category-commissions', require('./routes/admin/category-commissions')); // NEW
app.use("/api/admin/stores", require("./routes/admin/stores")); // NEW
app.use('/api/admin/clicks', require('./routes/admin/clicks'));        // NEW
app.use('/api/admin/webhooks', require('./routes/admin/webhooks'));    // NEW
app.use('/api/admin/settings', require('./routes/admin/settings'));    // NEW
app.use("/api/admin/commissions", require("./routes/admin/commissions")); // NEW


// User-scoped routes for dashboard
app.use('/api/user/profile', require('./routes/user/profile'));
app.use('/api/user/clicks', require('./routes/user/clicks'));
app.use('/api/user/referrals', require('./routes/user/referrals'));
app.use('/api/support', require('./routes/support'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin/support', require('./routes/admin/support'));







// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Start
async function start() {
  try {
    await mongoose.connect(config.mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('MongoDB connected');
    server.listen(config.port, () => {
      console.log(`Server started on port ${config.port}`);
    });
  } catch (err) {
    console.error('Failed to start', err);
    process.exit(1);
  }
}
start();

module.exports = app;