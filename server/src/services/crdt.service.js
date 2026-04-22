// server/src/services/crdt.service.js
// PERFORMANCE REWRITE:
// Previous approach stored shapes as Yjs binary (ydocState Buffer).
// Loading that binary blob, deserializing it, and re-serializing it
// on every join was the primary cause of 4-5 minute load times.
//
// New approach: shapes are stored as plain JSON in a separate
// BoardShapes collection. In-memory Map for active boards.
// Board join = one indexed query. No binary serialization.

const mongoose = require("mongoose")

// ── Separate shapes collection (fast indexed access) ──
const ShapeSchema = new mongoose.Schema({
  boardId: { type: String, required: true, index: true },
  shapes:  { type: mongoose.Schema.Types.Mixed, default: {} }, // { id: shapeObj }
}, { versionKey: false })

const BoardShapes = mongoose.models.BoardShape || mongoose.model("BoardShape", ShapeSchema)

// In-memory shape store: boardId → Map<shapeId, shape>
// This is the hot path — all reads/writes during a session go here.
// MongoDB is only written to on auto-save (every 30s) and disconnect.
const mem = new Map()    // boardId → Map<id, shape>
const dirty = new Set()  // boardIds that need saving

// ── Load board into memory (called once on first join) ──
const loadBoard = async (boardId) => {
  if (mem.has(boardId)) return mem.get(boardId)

  let shapes = new Map()
  try {
    const doc = await BoardShapes.findOne({ boardId }).lean()
    if (doc?.shapes && typeof doc.shapes === "object") {
      // Convert plain object back to Map
      shapes = new Map(Object.entries(doc.shapes))
    }
  } catch (e) {
    console.warn(`[crdt] load board ${boardId}:`, e.message)
  }
  mem.set(boardId, shapes)
  console.log(`[crdt] loaded board ${boardId} — ${shapes.size} shapes`)
  return shapes
}

// ── getDoc kept for backward compatibility (board.handler uses it) ──
const getDoc = async (boardId) => {
  await loadBoard(boardId)
  return { boardId }   // dummy — board.handler uses getDocs() to read shapes
}

// ── getDocs: board.handler reads shapes directly ──
// Returns a proxy that makes board.handler's getAllShapesJSON work
const getDocs = () => ({
  get: (boardId) => {
    if (!mem.has(boardId)) return null
    return {
      getMap: () => ({
        values: () => mem.get(boardId).values(),
        set:    (id, shape) => { mem.get(boardId)?.set(id, shape); dirty.add(boardId) },
        delete: (id) => { mem.get(boardId)?.delete(id); dirty.add(boardId) },
        size:   mem.get(boardId)?.size ?? 0,
      }),
      transact: (fn) => fn(),
    }
  },
  has: (boardId) => mem.has(boardId),
})

// ── Save dirty boards to MongoDB ──
const flushDirty = async () => {
  if (dirty.size === 0) return
  const toFlush = Array.from(dirty)
  dirty.clear()
  await Promise.all(toFlush.map(async (boardId) => {
    const shapes = mem.get(boardId)
    if (!shapes) return
    try {
      const obj = Object.fromEntries(shapes.entries())
      await BoardShapes.findOneAndUpdate(
        { boardId },
        { $set: { shapes: obj } },
        { upsert: true, new: true }
      )
    } catch (e) {
      console.error(`[crdt] flush ${boardId}:`, e.message)
      dirty.add(boardId)   // retry next cycle
    }
  }))
}

// ── Snapshot = save current shapes with a label ──
// Snapshots stored in a lightweight collection (no binary blobs)
const SnapshotSchema = new mongoose.Schema({
  boardId:   { type: String, required: true, index: true },
  label:     { type: String, default: "Auto-save" },
  savedAt:   { type: Date,   default: Date.now },
  shapes:    { type: mongoose.Schema.Types.Mixed, default: {} },
}, { versionKey: false })

const Snapshot = mongoose.models.BoardSnapshot || mongoose.model("BoardSnapshot", SnapshotSchema)

const saveSnapshot = async (boardId, label = "Auto-save") => {
  const shapes = mem.get(boardId)
  if (!shapes || shapes.size === 0) {
    // Nothing to snapshot yet
    return
  }
  try {
    // Snapshot reads from in-memory Map (always most current)
    const shapesObj = Object.fromEntries(shapes.entries())

    // Also flush to BoardShapes in parallel
    flushDirty().catch(() => {})

    // Keep max 10 snapshots per board — delete oldest if over limit
    const count = await Snapshot.countDocuments({ boardId })
    if (count >= 10) {
      const oldest = await Snapshot.findOne({ boardId }).sort({ savedAt: 1 }).lean()
      if (oldest) await Snapshot.deleteOne({ _id: oldest._id })
    }

    await Snapshot.create({
      boardId,
      label,
      savedAt: new Date(),
      shapes:  shapesObj,
    })
    console.log(`[crdt] snapshot saved: board=${boardId} label="${label}" shapes=${shapes.size}`)
  } catch (e) {
    console.error(`[crdt] saveSnapshot ${boardId}:`, e.message)
  }
}

const restoreSnapshot = async (boardId, snapshotIndex) => {
  // snapshotIndex 0 = newest (server returns sorted by savedAt desc)
  const snaps = await Snapshot.find({ boardId }).sort({ savedAt: -1 }).lean()
  console.log(`[crdt] restore: board=${boardId} index=${snapshotIndex} total=${snaps.length}`)
  const snap  = snaps[snapshotIndex]
  if (!snap) throw new Error(`Snapshot ${snapshotIndex} not found (only ${snaps.length} exist)`)

  const restored = new Map(Object.entries(snap.shapes || {}))
  mem.set(boardId, restored)
  dirty.add(boardId)
  // Flush immediately so next join reads the restored state from MongoDB
  await flushDirty()
  console.log(`[crdt] restored: board=${boardId} shapes=${restored.size}`)
}

const releaseDoc = async (boardId) => {
  dirty.add(boardId)
  await flushDirty()
  mem.delete(boardId)
  console.log(`[crdt] released board ${boardId}`)
}

// ── Start auto-flush every 15s (replaces per-board 30s intervals) ──
setInterval(flushDirty, 15_000)

module.exports = { getDocs, getDoc, loadBoard, saveSnapshot, restoreSnapshot, releaseDoc, BoardShapes, Snapshot }