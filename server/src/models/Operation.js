// server/src/models/Operation.js
const mongoose = require("mongoose")

// Operation is the audit log — every action that mutates the canvas.
// This is NOT used for real-time sync (Yjs handles that).
// It's used for: analytics, debugging, undo history reference.
const operationSchema = new mongoose.Schema({
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Board",
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: ["draw", "move", "resize", "delete", "text", "ai_generate", "snapshot"],
    required: true,
  },
  // Human-readable summary of what changed
  payload: {
    shapeId:   { type: String },             // nanoid of the shape affected
    shapeType: { type: String },             // rect | ellipse | path | text | arrow
    before:    { type: mongoose.Schema.Types.Mixed }, // shape state before (for undo reference)
    after:     { type: mongoose.Schema.Types.Mixed }, // shape state after
    aiPrompt:  { type: String },             // only set when type === "ai_generate"
  },
  // Raw Yjs binary delta for this operation — can be used to replay
  yjsUpdate: {
    type: Buffer,
    default: null,
  },
}, {
  timestamps: true,
  // Operations are append-only — disable versioning overhead
  versionKey: false,
})

// Compound index: fetch all ops for a board in order
operationSchema.index({ boardId: 1, createdAt: 1 })

// TTL: auto-delete ops older than 30 days to keep collection lean
operationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

module.exports = mongoose.model("Operation", operationSchema)