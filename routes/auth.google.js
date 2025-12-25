const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

const router = express.Router();

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
  FRONTEND_URL,
  JWT_SECRET = 'dev_secret',
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
  console.warn('[Google OAuth] Missing env. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL.');
}

// Strategy: no session, we issue JWT in callback
passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID || 'missing',
      clientSecret: GOOGLE_CLIENT_SECRET || 'missing',
      callbackURL: GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        // We don’t create user here; we’ll do it in callback route to access state.
        return done(null, { profile });
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Kick off Google OAuth
// Accept optional ?ref=<userId> (for referrals) and ?redirect=<url> (fallback)
router.get('/google', (req, res, next) => {
  const state = Buffer.from(
    JSON.stringify({
      ref: req.query.ref || null,
      redirect: req.query.redirect || `${FRONTEND_URL || 'http://localhost:3000'}/oauth/callback`,
      mode: req.query.mode || 'login',
    })
  ).toString('base64');

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state,
  })(req, res, next);
});

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: (process.env.FRONTEND_URL || 'http://localhost:3000') + '/login?google=fail' }),
  async (req, res) => {
    try {
      const stateRaw = req.query.state ? Buffer.from(req.query.state, 'base64').toString('utf8') : '{}';
      let state = {};
      try { state = JSON.parse(stateRaw || '{}'); } catch { state = {}; }

      const redirectTo = state.redirect || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/oauth/callback`;
      const profile = req.user?.profile || {};
      const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || '';
      const name = profile.displayName || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ') || 'User';
      const googleId = profile.id;

      if (!email) {
        // Cannot proceed without email
        return res.redirect(`${redirectTo}?error=missing_email`);
      }

      // Find or create user
      let user = await User.findOne({ email });
      if (!user) {
        // referral
        let referredBy = null;
        if (state.ref && mongoose.Types.ObjectId.isValid(state.ref)) {
          referredBy = state.ref;
        }

        // random password to satisfy schema; they will login with Google anyway
        const randomPassword = crypto.randomBytes(16).toString('hex');

        user = await User.create({
          name,
          email,
          password: randomPassword,
          referredBy: referredBy || null,
          provider: 'google',
          providerId: googleId || '',
        });
      } else {
        // If existing local account, just allow login via Google based on email
        // Optionally update provider info once
        if (!user.provider) {
          user.provider = 'google';
          user.providerId = googleId || '';
          await user.save();
        }
      }

      const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
      // Redirect to frontend oauth callback with token
      const url = new URL(redirectTo);
      url.searchParams.set('token', token);
      return res.redirect(url.toString());
    } catch (err) {
      console.error('Google callback error', err);
      const fallback = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?google=fail`;
      return res.redirect(fallback);
    }
  }
);

module.exports = router;