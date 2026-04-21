// Allowed Discord user IDs — loaded from ALLOWED_DISCORD_IDS env var (comma-separated)
// Example: ALLOWED_DISCORD_IDS=123456789012345678,987654321098765432
const ALLOWED_DISCORD_IDS = (process.env.ALLOWED_DISCORD_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);

if (ALLOWED_DISCORD_IDS.length === 0) {
  console.warn('⚠️  WARNING: ALLOWED_DISCORD_IDS is not set — no users will be able to log in!');
}

/**
 * Middleware: ensures the user is authenticated.
 * For page requests → redirects to login.
 * For API requests → returns 401 JSON.
 */
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  // API routes get JSON response
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Page requests redirect to login
  return res.redirect('/');
}

/**
 * Check if a Discord ID is in the whitelist.
 */
function isAllowed(discordId) {
  return ALLOWED_DISCORD_IDS.includes(discordId);
}

module.exports = { ensureAuth, isAllowed, ALLOWED_DISCORD_IDS };
