const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['lead_created', 'lead_edited', 'lead_deleted', 'lead_status_changed', 'note_added', 'unauthorized_login', 'category_created', 'category_edited', 'category_deleted'],
    required: true
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetLead:  { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  details:     { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt:   { type: Date, default: Date.now }
});

logSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Log', logSchema);
