const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true, maxlength: 100 },
  color:     { type: String, default: '#6366f1' },
  sortOrder: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

categorySchema.index({ sortOrder: 1 });

module.exports = mongoose.model('Category', categorySchema);
