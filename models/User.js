const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  discordId: { type: String, unique: true, required: true },
  username:  { type: String, required: true },
  avatar:    { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
