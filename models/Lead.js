const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true },
  email:       { type: String, required: true, trim: true },
  website:     { type: String, default: '', trim: true },
  address:     { type: String, default: '', trim: true },
  country:     { type: String, default: '', trim: true },
  status:      { type: String, enum: ['active', 'blacklisted', 'accepted'], default: 'active' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});

leadSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

leadSchema.pre('findOneAndUpdate', function () {
  this.set({ updatedAt: Date.now() });
});

module.exports = mongoose.model('Lead', leadSchema);
