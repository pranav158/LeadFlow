const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const Note = require('../models/Note');
const Log = require('../models/Log');
const { ensureAuth } = require('../middleware/auth');

// All routes require authentication
router.use(ensureAuth);

/**
 * GET /api/leads
 * Query params: ?status=active|blacklisted|accepted&search=query&page=1&limit=20&category=id|uncategorized
 */
router.get('/', async (req, res) => {
  try {
    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.search) {
      // Escape regex special chars to prevent NoSQL injection
      const search = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (search.length > 0 && search.length <= 100) {
        filter.$or = [
          { companyName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }
    }

    // Category filter
    if (req.query.category) {
      if (req.query.category === 'uncategorized') {
        filter.category = null;
      } else {
        filter.category = req.query.category;
      }
    }

    // Pagination
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('createdBy', 'username avatar discordId')
        .populate('category', 'name color')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Lead.countDocuments(filter)
    ]);

    res.json({
      leads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Get leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

/**
 * GET /api/leads/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('createdBy', 'username avatar discordId')
      .populate('category', 'name color');

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (err) {
    console.error('Get lead error:', err);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

/**
 * POST /api/leads
 * Body: { companyName, email, website, address, country, category }
 */
router.post('/', async (req, res) => {
  try {
    const { companyName, email, website, address, country, category } = req.body;

    if (!companyName || !email) {
      return res.status(400).json({ error: 'Company name and email are required' });
    }

    // Input length validation
    if (companyName.length > 200 || email.length > 200 || (website && website.length > 500) || (address && address.length > 2000) || (country && country.length > 100)) {
      return res.status(400).json({ error: 'Input too long' });
    }

    const lead = await Lead.create({
      companyName,
      email,
      website: website || '',
      address: address || '',
      country: country || '',
      category: category || null,
      createdBy: req.session.user._id
    });

    // Audit log
    await Log.create({
      action: 'lead_created',
      performedBy: req.session.user._id,
      targetLead: lead._id,
      details: { companyName, email, website, address, country, category: category || null }
    });

    const populated = await lead.populate([
      { path: 'createdBy', select: 'username avatar discordId' },
      { path: 'category', select: 'name color' }
    ]);
    res.status(201).json(populated);
  } catch (err) {
    console.error('Create lead error:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

/**
 * PUT /api/leads/:id
 * Body: { companyName, email, website, address, country, category }
 */
router.put('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { companyName, email, website, address, country, category } = req.body;
    const changes = [];

    // Track what changed
    if (companyName !== undefined && companyName !== lead.companyName) {
      changes.push({ field: 'companyName', oldValue: lead.companyName, newValue: companyName });
      lead.companyName = companyName;
    }
    if (email !== undefined && email !== lead.email) {
      changes.push({ field: 'email', oldValue: lead.email, newValue: email });
      lead.email = email;
    }
    if (website !== undefined && website !== lead.website) {
      changes.push({ field: 'website', oldValue: lead.website, newValue: website });
      lead.website = website;
    }
    if (address !== undefined && address !== lead.address) {
      changes.push({ field: 'address', oldValue: lead.address, newValue: address });
      lead.address = address;
    }
    if (country !== undefined && country !== lead.country) {
      changes.push({ field: 'country', oldValue: lead.country, newValue: country });
      lead.country = country;
    }
    if (category !== undefined) {
      const newCat = category || null;
      const oldCat = lead.category ? lead.category.toString() : null;
      if (newCat !== oldCat) {
        changes.push({ field: 'category', oldValue: oldCat, newValue: newCat });
        lead.category = newCat;
      }
    }

    if (changes.length === 0) {
      return res.json(lead);
    }

    await lead.save();

    // Audit log
    await Log.create({
      action: 'lead_edited',
      performedBy: req.session.user._id,
      targetLead: lead._id,
      details: { companyName: lead.companyName, changes }
    });

    const populated = await lead.populate([
      { path: 'createdBy', select: 'username avatar discordId' },
      { path: 'category', select: 'name color' }
    ]);
    res.json(populated);
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

/**
 * PATCH /api/leads/:id/status
 * Body: { status: 'active'|'blacklisted'|'accepted' }
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'blacklisted', 'accepted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const oldStatus = lead.status;

    if (oldStatus === status) {
      return res.json(lead);
    }

    lead.status = status;
    await lead.save();

    // Audit log
    await Log.create({
      action: 'lead_status_changed',
      performedBy: req.session.user._id,
      targetLead: lead._id,
      details: { companyName: lead.companyName, oldStatus, newStatus: status }
    });

    const populated = await lead.populate([
      { path: 'createdBy', select: 'username avatar discordId' },
      { path: 'category', select: 'name color' }
    ]);
    res.json(populated);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * PATCH /api/leads/:id/category
 * Body: { category: 'categoryId' | null }
 * Used for drag-and-drop category reassignment
 */
router.patch('/:id/category', async (req, res) => {
  try {
    const { category } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const oldCategory = lead.category ? lead.category.toString() : null;
    const newCategory = category || null;

    if (oldCategory === newCategory) {
      const populated = await lead.populate([
        { path: 'createdBy', select: 'username avatar discordId' },
        { path: 'category', select: 'name color' }
      ]);
      return res.json(populated);
    }

    lead.category = newCategory;
    await lead.save();

    // Audit log
    await Log.create({
      action: 'lead_edited',
      performedBy: req.session.user._id,
      targetLead: lead._id,
      details: {
        companyName: lead.companyName,
        changes: [{ field: 'category', oldValue: oldCategory, newValue: newCategory }]
      }
    });

    const populated = await lead.populate([
      { path: 'createdBy', select: 'username avatar discordId' },
      { path: 'category', select: 'name color' }
    ]);
    res.json(populated);
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

/**
 * DELETE /api/leads/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Snapshot before deletion
    const snapshot = {
      companyName: lead.companyName,
      email: lead.email,
      website: lead.website,
      address: lead.address,
      country: lead.country,
      category: lead.category,
      status: lead.status,
      createdAt: lead.createdAt
    };

    // Delete associated notes
    await Note.deleteMany({ leadId: lead._id });

    // Delete the lead
    await Lead.findByIdAndDelete(lead._id);

    // Audit log
    await Log.create({
      action: 'lead_deleted',
      performedBy: req.session.user._id,
      targetLead: null,
      details: snapshot
    });

    res.json({ success: true, message: 'Lead deleted' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

module.exports = router;
