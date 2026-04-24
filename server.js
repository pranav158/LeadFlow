require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const connectDB = require('./config/db');
const { ensureAuth } = require('./middleware/auth');
const { runBackup, startBackupScheduler } = require('./utils/backup');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Trust proxy (behind nginx reverse proxy) ───────────────
app.set('trust proxy', 1);

// ─── Session Secret Validation ───────────────────────────────
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change_this_to_a_random_string_64_chars_lol') {
  console.error('❌ FATAL: SESSION_SECRET must be set to a strong random value in .env');
  process.exit(1);
}

// ─── Security Headers (Helmet) ───────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https://cdn.discordapp.com", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false, // allow Discord avatar images
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ─── Rate Limiting ───────────────────────────────────────────
// Global: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down' }
});
app.use(globalLimiter);

// Auth routes: strict 5 requests per minute (anti-brute-force)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' }
});

// API write operations: 30 per minute
const apiWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down' }
});

// ─── Body Parsing (with size limits) ─────────────────────────
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));



// ─── Session with MongoDB store ──────────────────────────────
app.use(session({
  name: '_lf_sid', // Custom cookie name (not default 'connect.sid')
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions',
    ttl: 3 * 24 * 60 * 60, // 3 days (reduced from 7)
    crypto: {
      secret: process.env.SESSION_SECRET
    }
  }),
  cookie: {
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
    httpOnly: true,               // JS cannot read the cookie
    secure: IS_PROD,              // HTTPS only in production
    sameSite: 'lax',              // 'lax' allows OAuth2 redirect flow; still blocks cross-site POST/iframe
    path: '/'
  }
}));

// ─── Static Files ─────────────────────────────────────────────
// Public pages (login, unauthorized) — served without auth
app.use('/css', express.static(path.join(__dirname, 'public', 'css'), { maxAge: '1d' }));
app.use('/js', express.static(path.join(__dirname, 'public', 'js'), { maxAge: '1h' }));
app.use('/unauthorized.html', express.static(path.join(__dirname, 'public', 'unauthorized.html')));
app.use('/favicon.svg', express.static(path.join(__dirname, 'public', 'favicon.svg'), { maxAge: '7d' }));

// Login page at root
app.get('/', (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session && req.session.user) {
    return res.redirect('/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Auth Routes (rate limited) ──────────────────────────────
app.use('/auth', authLimiter, require('./routes/auth'));

// ─── Protected Dashboard ─────────────────────────────────────
app.get('/dashboard.html', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ─── CSRF: Origin Validation for state-changing requests ─────
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin || (referer ? (() => { try { return new URL(referer).origin; } catch { return null; } })() : null);
  if (!source) return res.status(403).json({ error: 'Forbidden' });
  const allowed = new Set([`http://localhost:${PORT}`]);
  if (process.env.CALLBACK_URL) try { allowed.add(new URL(process.env.CALLBACK_URL).origin); } catch {}
  if (allowed.has(source)) return next();
  return res.status(403).json({ error: 'Invalid origin' });
});

// ─── API Routes (all protected, write-limited) ───────────────
app.use('/api/leads', (req, res, next) => {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) return apiWriteLimiter(req, res, next);
  next();
}, require('./routes/leads'));
app.use('/api/notes', (req, res, next) => {
  if (req.method === 'POST') return apiWriteLimiter(req, res, next);
  next();
}, require('./routes/notes'));
app.use('/api/categories', (req, res, next) => {
  if (['POST','PUT','DELETE'].includes(req.method)) return apiWriteLimiter(req, res, next);
  next();
}, require('./routes/categories'));
app.use('/api/logs', require('./routes/logs'));

// Manual backup trigger (rate limited to 2/min)
const backupLimiter = rateLimit({ windowMs: 60 * 1000, max: 2 });
app.post('/api/backup', ensureAuth, backupLimiter, async (req, res) => {
  try {
    await runBackup();
    res.json({ success: true, message: 'Backup completed' });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed' });
  }
});

// ─── Block everything else ────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Error Handler (no stack traces leaked) ───────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────
async function start() {
  await connectDB();
  startBackupScheduler();

  app.listen(PORT, () => {
    console.log(`\n🚀 LeadFlow by Mystic running at http://localhost:${PORT}\n`);
  });
}

// ─── Anti-Crash: Keep the process alive ───────────────────────
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught Exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled Rejection:', reason);
});

start();
