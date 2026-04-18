// server/src/services/crdt.service.js
// This IS where shapes live. The Y.Doc is the shape store.
const Y    = require("yjs")
const Board = require("../models/Board")

// In-memory map of boardId → Y.Doc
// Lives as long as the server process is running
const docs = new Map()

/* ── Get or create a Y.Doc for a board ── */
const getDoc = async (boardId) => {
  if (docs.has(boardId)) return docs.get(boardId)

  const ydoc = new Y.Doc()

  // Load persisted state from MongoDB if it exists
  const board = await Board.findById(boardId).select("ydocState")
  if (board?.ydocState) {
    Y.applyUpdate(ydoc, board.ydocState)
  }

  docs.set(boardId, ydoc)
  return ydoc
}

/* ── Apply a delta from a client and return the update to broadcast ── */
const applyUpdate = async (boardId, update) => {
  const ydoc = await getDoc(boardId)
  // update is a Uint8Array binary delta from the client
  Y.applyUpdate(ydoc, update)
  return update  // broadcast this same delta to all other clients
}

/* ── Get the full current state — sent to new joiners ── */
const getFullState = async (boardId) => {
  const ydoc = await getDoc(boardId)
  return Y.encodeStateAsUpdate(ydoc)
}

/* ── Save current Yjs state to MongoDB (called every 30s + on last disconnect) ── */
const saveSnapshot = async (boardId, label = "Auto-save") => {
  const ydoc = docs.get(boardId)
  if (!ydoc) return   // no active doc = nothing to save

  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc))

  await Board.findByIdAndUpdate(boardId, {
    ydocState: state,
    $push: {
      snapshots: {
        $each: [{ ydocState: state, label, savedAt: new Date() }],
        $slice: -10,   // keep last 10 only
      }
    }
  })
}

/* ── Insert AI-generated shapes into the Yjs doc ── */
const insertAIShapes = async (boardId, shapes) => {
  const ydoc  = await getDoc(boardId)
  const ymap  = ydoc.getMap("shapes")   // Y.Map keyed by shape id
  const order = ydoc.getArray("order")  // Y.Array for z-index order

  ydoc.transact(() => {
    shapes.forEach(shape => {
      ymap.set(shape.id, shape)
      order.push([shape.id])
    })
  })

  // Return the delta so it can be broadcast to all clients
  return Y.encodeStateAsUpdate(ydoc)
}

/* ── Restore a snapshot (version rewind) ── */
const restoreSnapshot = async (boardId, snapshotIndex) => {
  const board = await Board.findById(boardId).select("snapshots")
  const snap  = board?.snapshots[snapshotIndex]
  if (!snap) throw new Error("Snapshot not found")

  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, snap.ydocState)
  docs.set(boardId, ydoc)   // replace live doc with restored one

  return Y.encodeStateAsUpdate(ydoc)
}

/* ── Clean up when board has no more active users ── */
const releaseDoc = async (boardId) => {
  await saveSnapshot(boardId, "Auto-save on disconnect")
  docs.delete(boardId)
}

module.exports = { getDoc, applyUpdate, getFullState, saveSnapshot, insertAIShapes, restoreSnapshot, releaseDoc }