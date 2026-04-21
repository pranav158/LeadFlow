const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const { ensureAuth } = require('../middleware/auth');

router.use(ensureAuth);

/**
 * GET /api/logs
 * Query params: ?page=1&limit=50
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      Log.find()
        .populate('performedBy', 'username avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Log.countDocuments()
    ]);

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Get logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
