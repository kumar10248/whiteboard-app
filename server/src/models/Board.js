// server/src/models/Board.js
// PERFORMANCE: Removed ydocState (large binary) — shapes now in BoardShapes collection.
// Added indexes for the exact queries board.handler.js runs.
const mongoose = require("mongoose")

const boardSchema = new mongoose.Schema({
  ownerId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      "User",
    required: true,
  },
  title: {
    type:    String,
    required: true,
    trim:    true,
    default: "Untitled board",
  },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  isPublic:  { type: Boolean, default: false },
  thumbnail: { type: String,  default: null },
}, { timestamps: true })

// ── Indexes for fast board:join access check ──
boardSchema.index({ ownerId: 1 })
boardSchema.index({ members: 1 })           // makes $or: [{ members: userId }] fast
boardSchema.index({ ownerId: 1, _id: 1 })   // covered index for dashboard list
boardSchema.index({ isPublic: 1 })

module.exports = mongoose.models.Board || mongoose.model("Board", boardSchema)