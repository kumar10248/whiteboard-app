// server/src/models/User.js
const mongoose = require("mongoose")

const userSchema = new mongoose.Schema({
  name: {
    type:     String,
    required: true,
    trim:     true,
  },
  email: {
    type:      String,
    required:  true,
    unique:    true,
    lowercase: true,
    trim:      true,
    index:     true,
  },
  password: {
    type:     String,
    required: true,
    select:   false,   // never returned in queries unless explicitly .select("+password")
  },
  refreshToken: {
    type:    String,
    default: null,
    select:  false,
  },
  passwordChangedAt: {
    type:    Date,
    default: null,
  },
  // Boards this user owns or is a member of — for dashboard listing
  // The source of truth is the Board.members array;
  // this is a denormalized cache for fast "my boards" queries
  boardIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref:  "Board",
  }],
}, { timestamps: true })


module.exports = mongoose.model("User", userSchema)