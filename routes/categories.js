const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const Lead = require('../models/Lead');
const Log = require('../models/Log');
const { ensureAuth } = require('../middleware/auth');

router.use(ensureAuth);

/**
 * GET /api/categories
 * Returns all categories sorted by sortOrder
 */
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, createdAt: 1 });
    res.json(categories);
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * POST /api/categories
 * Body: { name, color? }
 */
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'Category name too long' });
    }

    // Get max sortOrder to append at end
    const last = await Category.findOne().sort({ sortOrder: -1 });
    const sortOrder = last ? last.sortOrder + 1 : 0;

    const category = await Category.create({
      name: name.trim(),
      color: color || '#6366f1',
      sortOrder,
      createdBy: req.session.user._id
    });

    await Log.create({
      action: 'category_created',
      performedBy: req.session.user._id,
      details: { categoryName: category.name }
    });

    res.status(201).json(category);
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

/**
 * PUT /api/categories/:id
 * Body: { name?, color? }
 */
router.put('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const { name, color } = req.body;
    const changes = [];

    if (name !== undefined && name.trim() !== category.name) {
      if (name.trim().length > 100) {
        return res.status(400).json({ error: 'Category name too long' });
      }
      changes.push({ field: 'name', oldValue: category.name, newValue: name.trim() });
      category.name = name.trim();
    }

    if (color !== undefined && color !== category.color) {
      changes.push({ field: 'color', oldValue: category.color, newValue: color });
      category.color = color;
    }

    if (changes.length === 0) {
      return res.json(category);
    }

    await category.save();

    await Log.create({
      action: 'category_edited',
      performedBy: req.session.user._id,
      details: { categoryName: category.name, changes }
    });

    res.json(category);
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

/**
 * DELETE /api/categories/:id
 * Query: ?deleteLeads=true  (to delete leads instead of moving to uncategorized)
 */
router.delete('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const deleteLeads = req.query.deleteLeads === 'true';
    const leadCount = await Lead.countDocuments({ category: category._id });

    if (deleteLeads && leadCount > 0) {
      // Delete all leads in this category
      await Lead.deleteMany({ category: category._id });

      await Log.create({
        action: 'category_deleted',
        performedBy: req.session.user._id,
        details: {
          categoryName: category.name,
          leadsDeleted: leadCount
        }
      });
    } else {
      // Move leads to uncategorized
      await Lead.updateMany({ category: category._id }, { category: null });

      await Log.create({
        action: 'category_deleted',
        performedBy: req.session.user._id,
        details: {
          categoryName: category.name,
          leadsMovedToUncategorized: leadCount
        }
      });
    }

    await Category.findByIdAndDelete(category._id);

    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
