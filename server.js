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
app.use('/api/affiliate', require('./routes/affiliate'));
app.use('/api/webhooks', require('./routes/webhook'));

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