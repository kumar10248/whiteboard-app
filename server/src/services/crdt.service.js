// server/src/services/crdt.service.js
// FIXES:
// 1. Snapshots use Y.encodeStateAsUpdate (diff from empty) not repeated full states
// 2. Only keep 3 snapshots max — each ~200KB not 1.5MB
// 3. Save ydocState separately from snapshots to stay under 16MB
// 4. insertAIShapes returns the delta correctly

const Y      = require("yjs")
const Board  = require("../models/Board")

// In-memory map of boardId → Y.Doc (lives as long as server process)
const docs = new Map()

/* ── Get or create a Y.Doc for a board ── */
const getDoc = async (boardId) => {
  if (docs.has(boardId)) return docs.get(boardId)

  const ydoc = new Y.Doc()

  // Load persisted state from MongoDB
  const board = await Board.findById(boardId).select("ydocState")
  if (board?.ydocState?.length) {
    try {
      Y.applyUpdate(ydoc, board.ydocState)
    } catch (err) {
      console.warn(`[crdt] Could not load ydocState for ${boardId}:`, err.message)
    }
  }

  docs.set(boardId, ydoc)
  return ydoc
}

/* ── Apply a delta from a client ── */
const applyUpdate = async (boardId, update) => {
  const ydoc = await getDoc(boardId)
  Y.applyUpdate(ydoc, update)
  return update
}

/* ── Get full current state for a new joiner ── */
const getFullState = async (boardId) => {
  const ydoc = await getDoc(boardId)
  return Y.encodeStateAsUpdate(ydoc)
}

/* ── Save snapshot to MongoDB ──
   CRITICAL SIZE FIX:
   - ydocState (main field): full binary state — updated every save
   - snapshots array: only 3 entries max, each stores a compact snapshot
   - We use $set for ydocState and a separate $push/$slice for snapshots
   - Each operation is its own update to avoid the 16MB document limit
*/
const saveSnapshot = async (boardId, label = "Auto-save") => {
  const ydoc = docs.get(boardId)
  if (!ydoc) return

  const stateBuffer = Buffer.from(Y.encodeStateAsUpdate(ydoc))

  // Check size — if over 12MB, skip snapshot (keep main ydocState update only)
  const sizeMB = stateBuffer.length / (1024 * 1024)

  try {
    // Always update the main ydocState field
    await Board.findByIdAndUpdate(boardId, {
      $set: {
        ydocState:  stateBuffer,
        updatedAt:  new Date(),
      }
    })

    // Only push a snapshot if under 2MB (so 3 snapshots ≤ 6MB, leaving room)
    if (sizeMB < 2) {
      // Use two separate operations to avoid document size limit during $push
      // First remove oldest if we already have 3
      const board = await Board.findById(boardId).select("snapshots")
      if (board && board.snapshots.length >= 3) {
        // Remove the oldest snapshot by _id
        const oldestId = board.snapshots[0]._id
        await Board.findByIdAndUpdate(boardId, {
          $pull: { snapshots: { _id: oldestId } }
        })
      }

      // Then push the new one
      await Board.findByIdAndUpdate(boardId, {
        $push: {
          snapshots: {
            ydocState: stateBuffer,
            savedAt:   new Date(),
            label,
          }
        }
      })
    } else {
      console.warn(`[crdt] Board ${boardId} state is ${sizeMB.toFixed(1)}MB — skipping snapshot entry (only updating ydocState)`)
    }

  } catch (err) {
    console.error(`[crdt] saveSnapshot failed for ${boardId}:`, err.message)
  }
}

/* ── Insert AI-generated shapes into Yjs doc ── */
const insertAIShapes = async (boardId, shapes) => {
  const ydoc  = await getDoc(boardId)
  const ymap  = ydoc.getMap("shapes")

  // Capture state BEFORE insert so we can compute a minimal delta
  const stateBefore = Y.encodeStateVector(ydoc)

  ydoc.transact(() => {
    shapes.forEach(shape => {
      if (shape && shape.id) {
        ymap.set(shape.id, shape)
      }
    })
  })

  // Return the delta (only the new changes, not the full state)
  const delta = Y.encodeStateAsUpdate(ydoc, stateBefore)
  return delta
}

/* ── Restore a snapshot ── */
const restoreSnapshot = async (boardId, snapshotIndex) => {
  const board = await Board.findById(boardId).select("snapshots")
  const snap  = board?.snapshots?.[snapshotIndex]
  if (!snap) throw new Error(`Snapshot ${snapshotIndex} not found`)

  // Apply snapshot to a fresh doc, then replace the live doc
  const freshDoc = new Y.Doc()
  Y.applyUpdate(freshDoc, snap.ydocState)

  // Replace the live doc
  docs.set(boardId, freshDoc)

  return Y.encodeStateAsUpdate(freshDoc)
}

/* ── Clean up when last user leaves ── */
const releaseDoc = async (boardId) => {
  await saveSnapshot(boardId, "Auto-save on disconnect")
  docs.delete(boardId)
}

module.exports = {
  getDoc,
  applyUpdate,
  getFullState,
  saveSnapshot,
  insertAIShapes,
  restoreSnapshot,
  releaseDoc,
}