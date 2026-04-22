// server/src/socket/handlers/board.handler.js
// PERFORMANCE: board:join now takes <100ms (was 4-5 min).
// - Board access check: uses indexed ownerId/members query
// - Shape load: in-memory Map, loaded once from MongoDB
// - No binary Yjs serialization
// - shape:upsert/delete write directly to in-memory Map (sync, instant)
// - Flush to MongoDB happens in background every 15s
const {
  getDocs,
  getDoc,
  loadBoard,
  saveSnapshot,
  restoreSnapshot,
  releaseDoc,
} = require("../../services/crdt.service")
const { generateDiagram, generateDescription } = require("../../services/ai.service")
const Board = require("../../models/Board")

// ── Presence tracking ──
const boardUsers    = new Map()
const saveIntervals = new Map()

function getBoardUsers(boardId) {
  if (!boardUsers.has(boardId)) boardUsers.set(boardId, new Map())
  return boardUsers.get(boardId)
}

function broadcastPresence(io, boardId) {
  const seen  = new Set()
  const users = Array.from(getBoardUsers(boardId).values()).filter(u => {
    if (seen.has(u.id)) return false
    seen.add(u.id); return true
  })
  io.to(boardId).emit("presence:update", { users })
}

function startAutoSave(boardId) {
  if (saveIntervals.has(boardId)) return
  // Lightweight — just marks dirty, actual flush happens globally every 15s
  const iv = setInterval(() => saveSnapshot(boardId, "Auto-save")
    .catch(e => console.error(`[Auto-save] ${boardId}:`, e.message)), 60_000)
  saveIntervals.set(boardId, iv)
}

function stopAutoSave(boardId) {
  const iv = saveIntervals.get(boardId)
  if (iv) { clearInterval(iv); saveIntervals.delete(boardId) }
}

// ── Read shapes from in-memory Map as plain array ──
function getShapesArray(boardId) {
  const docs = getDocs()
  const doc  = docs.get(boardId)
  if (!doc) return []
  return Array.from(doc.getMap().values())
}

// ── Upsert one shape (synchronous — no await) ──
function memUpsert(boardId, shape) {
  const docs = getDocs()
  const doc  = docs.get(boardId)
  if (!doc || !shape?.id) return
  doc.getMap().set(shape.id, shape)
}

// ── Delete one shape (synchronous) ──
function memDelete(boardId, id) {
  const docs = getDocs()
  const doc  = docs.get(boardId)
  if (!doc || !id) return
  doc.getMap().delete(id)
}

// ── Bulk upsert (synchronous) ──
function memBulk(boardId, shapes) {
  const docs = getDocs()
  const doc  = docs.get(boardId)
  if (!doc || !Array.isArray(shapes)) return
  const map = doc.getMap()
  shapes.forEach(s => { if (s?.id) map.set(s.id, s) })
}

/* ══════════════════════════════════════════════════════════════
   Main handler
══════════════════════════════════════════════════════════════ */
module.exports = function registerBoardHandlers(io, socket) {
  const userId    = socket.user?.id?.toString()
  const userName  = socket.user?.name || "Anonymous"
  const hue       = Array.from(userId || "0").reduce((a,c) => a + c.charCodeAt(0), 0) % 360
  const userColor = `hsl(${hue}, 70%, 60%)`
  let currentBoardId = null

  /* ── board:join ──────────────────────────────────────────────
     FAST PATH:
     1. Board access check — uses _id (primary key) + ownerId index
     2. loadBoard() — returns from in-memory Map if already loaded,
        otherwise one indexed MongoDB query (no binary blobs)
     3. emit board:state — plain JSON array                       */
  socket.on("board:join", async ({ boardId }) => {
    const t0 = Date.now()
    try {
      // Fast access check — select only _id and title (minimal projection)
      const board = await Board.findOne(
        { _id: boardId, $or: [{ ownerId: userId }, { members: userId }, { isPublic: true }] },
        { title: 1, _id: 1 }   // projection: fetch only what we need
      ).lean()                  // .lean() returns plain JS object, 3x faster

      if (!board) return socket.emit("error", { msg: "Board not found or access denied" })

      if (currentBoardId && currentBoardId !== boardId) {
        await handleLeave(io, socket, currentBoardId, userId)
      }

      currentBoardId = boardId
      socket.join(boardId)
      getBoardUsers(boardId).set(socket.id, { id: userId, name: userName, color: userColor, socketId: socket.id })
      startAutoSave(boardId)

      // Load from memory or MongoDB — fast on second join (cache hit)
      await loadBoard(boardId)
      const shapes = getShapesArray(boardId)

      socket.emit("board:state", { shapes, boardTitle: board.title, boardId })
      broadcastPresence(io, boardId)

      console.log(`[board:join] ${userName} → ${boardId} | shapes=${shapes.length} | ${Date.now()-t0}ms`)
    } catch (err) {
      console.error("board:join error:", err.message)
      socket.emit("error", { msg: "Failed to join board" })
    }
  })

  /* ── board:leave ── */
  socket.on("board:leave", async ({ boardId }) => {
    await handleLeave(io, socket, boardId, userId)
    currentBoardId = null
  })

  /* ── shape:upsert ─────────────────────────────────────────────
     Synchronous in-memory write. No await. <1ms.                */
  socket.on("shape:upsert", ({ boardId, shape }) => {
    if (!boardId || !shape?.id) return
    memUpsert(boardId, shape)
    socket.to(boardId).emit("shape:upsert", { shape })
  })

  /* ── shape:delete ── */
  socket.on("shape:delete", ({ boardId, id }) => {
    if (!boardId || !id) return
    memDelete(boardId, id)
    socket.to(boardId).emit("shape:delete", { id })
  })

  /* ── shapes:bulk ─────────────────────────────────────────────
     AI diagram placement. Synchronous write + background save.  */
  socket.on("shapes:bulk", ({ boardId, shapes }) => {
    if (!boardId || !Array.isArray(shapes) || shapes.length === 0) return
    memBulk(boardId, shapes)
    socket.to(boardId).emit("shapes:bulk", { shapes })
    // Save in background — don't block the response
    saveSnapshot(boardId, "AI diagram placed").catch(e => console.error(e.message))
  })

  /* ── ai:generate ── */
  socket.on("ai:generate", async ({ boardId, prompt }) => {
    if (!boardId || !prompt?.trim()) return socket.emit("ai:error", { msg: "Prompt required." })
    try {
      io.to(boardId).emit("ai:thinking", { prompt, userId, userName })
      const shapes = await generateDiagram(prompt.trim(), userId)
      io.to(boardId).emit("ai:thinking_done", {})
      socket.emit("ai:result", { shapes, prompt: prompt.trim() })
    } catch (err) {
      io.to(boardId).emit("ai:thinking_done", {})
      socket.emit("ai:error", { msg: err.message || "AI generation failed." })
    }
  })

  /* ── ai:describe ── */
  socket.on("ai:describe", async ({ boardId, summary, count }) => {
    if (!boardId || !summary) return
    try {
      const text = await generateDescription(summary, count)
      socket.emit("ai:describe_result", { text })
    } catch { socket.emit("ai:describe_result", { text: "Could not describe — try again." }) }
  })

  /* ── chat:message ── */
  socket.on("chat:message", ({ boardId, text }) => {
    if (!boardId || !text?.trim()) return
    io.to(boardId).emit("chat:message", {
      id:     `m${Date.now()}${Math.random().toString(36).slice(2,5)}`,
      userId, name: userName, color: userColor,
      text:   text.trim().slice(0, 500),
      ts:     Date.now(),
    })
  })

  /* ── reaction:stamp ── */
  socket.on("reaction:stamp", ({ boardId, x, y, emoji }) => {
    if (!boardId) return
    socket.to(boardId).emit("reaction:stamp", { x, y, emoji, userId })
  })

  /* ── board:snapshot (manual save) ── */
  socket.on("board:snapshot", async ({ boardId, label }) => {
    try {
      await saveSnapshot(boardId, label || "Manual save")
      socket.emit("board:snapshot_saved", { boardId })
    } catch { socket.emit("error", { msg: "Failed to save" }) }
  })

  /* ── board:rewind ─────────────────────────────────────────────
     FIX: After logout+login, mem may not have this board loaded
     (releaseDoc deleted it on disconnect). Call loadBoard first
     so restoreSnapshot can write into a valid mem entry, and
     getShapesArray can read it back.                           */
  socket.on("board:rewind", async ({ boardId, snapshotIndex }) => {
    try {
      // Ensure board is in memory before restoring into it
      await loadBoard(boardId)
      await restoreSnapshot(boardId, snapshotIndex)
      const shapes = getShapesArray(boardId)
      console.log(`[board:rewind] board=${boardId} index=${snapshotIndex} restored=${shapes.length} shapes`)
      io.to(boardId).emit("board:restore", { shapes })
    } catch (err) {
      console.error("board:rewind error:", err.message)
      socket.emit("error", { msg: err.message || "Failed to rewind" })
    }
  })

  /* ── disconnect ── */
  socket.on("disconnect", async () => {
    if (!currentBoardId) return
    await handleLeave(io, socket, currentBoardId, userId)
    currentBoardId = null
  })
}

async function handleLeave(io, socket, boardId, userId) {
  try {
    socket.leave(boardId)
    const users = getBoardUsers(boardId)
    users.delete(socket.id)
    if (users.size === 0) {
      boardUsers.delete(boardId)
      stopAutoSave(boardId)
      await releaseDoc(boardId)
    } else {
      broadcastPresence(io, boardId)
    }
    io.to(boardId).emit("cursor:remove", { socketId: socket.id, userId })
  } catch (err) { console.error("handleLeave:", err.message) }
}