const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const Lead = require('../models/Lead');
const Log = require('../models/Log');
const { ensureAuth } = require('../middleware/auth');

router.use(ensureAuth);

/**
 * GET /api/notes/:leadId
 */
router.get('/:leadId', async (req, res) => {
  try {
    const notes = await Note.find({ leadId: req.params.leadId })
      .populate('userId', 'username avatar')
      .sort({ createdAt: -1 });

    res.json(notes);
  } catch (err) {
    console.error('Get notes error:', err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

/**
 * POST /api/notes
 * Body: { leadId, content }
 */
router.post('/', async (req, res) => {
  try {
    const { leadId, content } = req.body;

    if (!leadId || !content) {
      return res.status(400).json({ error: 'Lead ID and content are required' });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const note = await Note.create({
      leadId,
      userId: req.session.user._id,
      content
    });

    // Audit log
    await Log.create({
      action: 'note_added',
      performedBy: req.session.user._id,
      targetLead: leadId,
      details: { content, leadCompany: lead.companyName }
    });

    const populated = await note.populate('userId', 'username avatar');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Create note error:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

module.exports = router;
