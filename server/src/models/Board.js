// server/src/models/Board.js
const mongoose = require("mongoose")

const boardSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    default: "Untitled board",
  },
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }
  ],
  // Binary Yjs document state — the full serialized canvas
  // Updated every 30s and on last user disconnect
  ydocState: {
    type: Buffer,
    default: null,
  },
  // Snapshot history — last 10 saves for version rewind
  snapshots: [
    {
      ydocState: { type: Buffer, required: true },
      savedAt:   { type: Date,   default: Date.now },
      label:     { type: String, default: "" },   // e.g. "Auto-save" or "Before AI diagram"
    }
  ],
  // PNG thumbnail stored as base64 — generated on export
  thumbnail: {
    type: String,
    default: null,
  },
  isPublic: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true })

// Index for fast member lookup
boardSchema.index({ ownerId: 1 })
boardSchema.index({ members: 1 })

// Keep only last 10 snapshots automatically
boardSchema.pre("save", function () {
  if (this.snapshots && this.snapshots.length > 10) {
    this.snapshots = this.snapshots.slice(-10)
  }
})

module.exports = mongoose.model("Board", boardSchema)