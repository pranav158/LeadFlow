const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:   { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Note', noteSchema);
