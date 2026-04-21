const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Log = require('../models/Log');
const { isAllowed } = require('../middleware/auth');

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * GET /auth/discord
 * Redirects user to Discord OAuth2 authorization page.
 * Generates a cryptographic state token to prevent OAuth CSRF.
 */
router.get('/discord', (req, res) => {
  // Generate random state and store in session
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  req.session.save((err) => {
    if (err) {
      console.error('Failed to save OAuth state:', err);
      return res.redirect('/?error=session_error');
    }

    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: process.env.CALLBACK_URL,
      response_type: 'code',
      scope: 'identify',
      state
    });
    res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
  });
});

/**
 * GET /auth/discord/callback
 * Handles the OAuth2 callback from Discord.
 * Verifies the state token to prevent CSRF/login confusion.
 */
router.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  // Verify OAuth state to prevent CSRF
  const expectedState = req.session.oauthState;
  delete req.session.oauthState; // consume it (one-time use)

  if (!state || !expectedState || state !== expectedState) {
    console.warn('⛔ OAuth state mismatch — possible CSRF');
    return res.redirect('/?error=invalid_state');
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.CALLBACK_URL
      })
    });

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', await tokenRes.text());
      return res.redirect('/?error=token_failed');
    }

    const tokenData = await tokenRes.json();

    // Fetch user info from Discord
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userRes.ok) {
      console.error('User fetch failed:', await userRes.text());
      return res.redirect('/?error=user_fetch_failed');
    }

    const discordUser = await userRes.json();

    // Check whitelist
    if (!isAllowed(discordUser.id)) {
      console.warn(`⛔ Unauthorized login attempt: ${discordUser.username} (${discordUser.id})`);

      // Log the unauthorized attempt
      try {
        await Log.create({
          action: 'unauthorized_login',
          performedBy: null,
          details: {
            discordId: discordUser.id,
            username: discordUser.username,
            avatar: discordUser.avatar
              ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
              : null,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
          }
        });
      } catch (logErr) {
        console.error('Failed to log unauthorized attempt:', logErr);
      }

      return res.redirect('/unauthorized.html');
    }

    // Upsert user in database
    const user = await User.findOneAndUpdate(
      { discordId: discordUser.id },
      {
        discordId: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator || '0') % 5}.png`
      },
      { upsert: true, new: true }
    );

    // Regenerate session to prevent session fixation attacks
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.redirect('/?error=session_error');
      }

      // Set session
      req.session.user = {
        _id: user._id,
        discordId: user.discordId,
        username: user.username,
        avatar: user.avatar
      };

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/?error=session_error');
        }
        res.redirect('/dashboard.html');
      });
    });

  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=server_error');
  }
});

/**
 * GET /auth/me
 * Returns the currently logged-in user.
 */
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    // Only expose safe fields — never leak internal _id
    return res.json({
      user: {
        username: req.session.user.username,
        avatar: req.session.user.avatar,
        discordId: req.session.user.discordId
      }
    });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

/**
 * POST /auth/logout
 * Destroys session and returns JSON (called via fetch from frontend).
 * POST prevents CSRF logout via <img src> or link prefetch.
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('_lf_sid');
    res.json({ success: true });
  });
});

module.exports = router;
