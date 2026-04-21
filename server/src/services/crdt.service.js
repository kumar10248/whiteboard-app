// server/src/services/crdt.service.js
const Y     = require("yjs")
const Board = require("../models/Board")

// In-memory map: boardId → Y.Doc
const docs = new Map()

// Export so board.handler.js can read shapes directly without
// going through an async helper on every shape:upsert event
const getDocs = () => docs

/* ── Get (or load) a Y.Doc for a board ── */
const getDoc = async (boardId) => {
  if (docs.has(boardId)) return docs.get(boardId)

  const ydoc = new Y.Doc()
  const board = await Board.findById(boardId).select("ydocState")
  if (board?.ydocState?.length) {
    try { Y.applyUpdate(ydoc, board.ydocState) }
    catch (e) { console.warn(`[crdt] load failed board=${boardId}:`, e.message) }
  }
  docs.set(boardId, ydoc)
  return ydoc
}

/* ── Save Yjs state to MongoDB ──
   SIZE FIX: max 3 snapshots, each update independent to avoid 16 MB limit. */
const saveSnapshot = async (boardId, label = "Auto-save") => {
  const ydoc = docs.get(boardId)
  if (!ydoc) return

  const buf    = Buffer.from(Y.encodeStateAsUpdate(ydoc))
  const sizeMB = buf.length / (1024 * 1024)

  try {
    // Always update the main ydocState field
    await Board.findByIdAndUpdate(boardId, {
      $set: { ydocState: buf, updatedAt: new Date() },
    })

    // Only keep a snapshot entry if state is small enough (<2 MB)
    if (sizeMB < 2) {
      const board = await Board.findById(boardId).select("snapshots")
      if (board) {
        // Remove oldest if we already have 3
        if (board.snapshots.length >= 3) {
          await Board.findByIdAndUpdate(boardId, {
            $pull: { snapshots: { _id: board.snapshots[0]._id } },
          })
        }
        await Board.findByIdAndUpdate(boardId, {
          $push: { snapshots: { ydocState: buf, savedAt: new Date(), label } },
        })
      }
    }
  } catch (e) {
    console.error(`[crdt] saveSnapshot board=${boardId}:`, e.message)
  }
}

/* ── Restore a snapshot and replace the live doc ── */
const restoreSnapshot = async (boardId, snapshotIndex) => {
  const board = await Board.findById(boardId).select("snapshots")
  const snap  = board?.snapshots?.[snapshotIndex]
  if (!snap) throw new Error(`Snapshot ${snapshotIndex} not found`)

  const freshDoc = new Y.Doc()
  Y.applyUpdate(freshDoc, snap.ydocState)
  docs.set(boardId, freshDoc)   // replace live doc
}

/* ── Clean up when last user leaves ── */
const releaseDoc = async (boardId) => {
  await saveSnapshot(boardId, "Auto-save on disconnect")
  docs.delete(boardId)
}

module.exports = { getDocs, getDoc, saveSnapshot, restoreSnapshot, releaseDoc }