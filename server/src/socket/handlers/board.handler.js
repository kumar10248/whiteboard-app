// server/src/socket/handlers/board.handler.js
// SYNC ARCHITECTURE: plain JSON shape objects over socket — no Yjs binary on client.
// Server stores shapes in Yjs (persistence) but broadcasts plain JSON to clients.
const {
  getDoc,
  saveSnapshot,
  restoreSnapshot,
  releaseDoc,
} = require("../../services/crdt.service")
const { generateDiagram } = require("../../services/ai.service")
const Operation = require("../../models/Operation")
const Board     = require("../../models/Board")

// ── In-memory presence tracking ──
const boardUsers    = new Map()   // boardId → Map<socketId, userInfo>
const saveIntervals = new Map()   // boardId → setInterval handle

function getBoardUsers(boardId) {
  if (!boardUsers.has(boardId)) boardUsers.set(boardId, new Map())
  return boardUsers.get(boardId)
}

function broadcastPresence(io, boardId) {
  const allSockets = Array.from(getBoardUsers(boardId).values())
  // One entry per userId — if user has 2 tabs, show once
  const seen  = new Set()
  const users = allSockets.filter(u => {
    if (seen.has(u.id)) return false
    seen.add(u.id); return true
  })
  io.to(boardId).emit("presence:update", { users })
}

function startAutoSave(boardId) {
  if (saveIntervals.has(boardId)) return
  const iv = setInterval(async () => {
    try { await saveSnapshot(boardId, "Auto-save") }
    catch (e) { console.error(`[Auto-save] board=${boardId}:`, e.message) }
  }, 30_000)
  saveIntervals.set(boardId, iv)
}

function stopAutoSave(boardId) {
  const iv = saveIntervals.get(boardId)
  if (iv) { clearInterval(iv); saveIntervals.delete(boardId) }
}

// ── Read all shapes from server Yjs doc as plain JSON ──
function getAllShapesJSON(boardId) {
  const docs = require("../../services/crdt.service").getDocs()
  const doc  = docs.get(boardId)
  if (!doc) return []
  return Array.from(doc.getMap("shapes").values())
}

// ── Upsert one shape into server Yjs doc ──
function serverUpsert(boardId, shape) {
  const docs = require("../../services/crdt.service").getDocs()
  const doc  = docs.get(boardId)
  if (!doc || !shape?.id) return
  doc.transact(() => doc.getMap("shapes").set(shape.id, shape))
}

// ── Delete one shape from server Yjs doc ──
function serverDelete(boardId, id) {
  const docs = require("../../services/crdt.service").getDocs()
  const doc  = docs.get(boardId)
  if (!doc || !id) return
  doc.transact(() => doc.getMap("shapes").delete(id))
}

// ── Bulk upsert shapes into server Yjs doc ──
function serverBulk(boardId, shapes) {
  const docs = require("../../services/crdt.service").getDocs()
  const doc  = docs.get(boardId)
  if (!doc || !Array.isArray(shapes)) return
  doc.transact(() => {
    shapes.forEach(s => { if (s?.id) doc.getMap("shapes").set(s.id, s) })
  })
}

/* ═══════════════════════════════════════════════════════════════
   Main handler — registered once per socket connection
═══════════════════════════════════════════════════════════════ */
module.exports = function registerBoardHandlers(io, socket) {
  const userId    = socket.user?.id?.toString()
  const userName  = socket.user?.name || "Anonymous"
  const hue       = Array.from(userId || "0").reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  const userColor = `hsl(${hue}, 70%, 60%)`
  let currentBoardId = null

  /* ── board:join ──────────────────────────────────────────────
     Client joins a board room.
     Server sends back the full shapes list as plain JSON.       */
  socket.on("board:join", async ({ boardId }) => {
    try {
      const board = await Board.findOne({
        _id: boardId,
        $or: [{ ownerId: userId }, { members: userId }, { isPublic: true }],
      })
      if (!board) return socket.emit("error", { msg: "Board not found or access denied" })

      if (currentBoardId && currentBoardId !== boardId) {
        await handleLeave(io, socket, currentBoardId, userId)
      }

      currentBoardId = boardId
      socket.join(boardId)
      getBoardUsers(boardId).set(socket.id, {
        id: userId, name: userName, color: userColor, socketId: socket.id,
      })
      startAutoSave(boardId)

      // Load shapes — getDoc initialises from MongoDB if needed
      await getDoc(boardId)
      const shapes = getAllShapesJSON(boardId)

      socket.emit("board:state", { shapes, boardTitle: board.title, boardId })
      broadcastPresence(io, boardId)

      console.log(`[board:join] user=${userName} board=${boardId} shapes=${shapes.length}`)
    } catch (err) {
      console.error("board:join error:", err)
      socket.emit("error", { msg: "Failed to join board" })
    }
  })

  /* ── board:leave ── */
  socket.on("board:leave", async ({ boardId }) => {
    await handleLeave(io, socket, boardId, userId)
    currentBoardId = null
  })

  /* ── shape:upsert ────────────────────────────────────────────
     One shape insert or update (called on every mouse-move
     while drawing, and on drag-end).
     Server persists + broadcasts to every OTHER client.         */
  socket.on("shape:upsert", ({ boardId, shape }) => {
    if (!boardId || !shape?.id) return
    try {
      serverUpsert(boardId, shape)
      socket.to(boardId).emit("shape:upsert", { shape })
    } catch (e) { console.error("shape:upsert:", e.message) }
  })

  /* ── shape:delete ── */
  socket.on("shape:delete", ({ boardId, id }) => {
    if (!boardId || !id) return
    try {
      serverDelete(boardId, id)
      socket.to(boardId).emit("shape:delete", { id })
    } catch (e) { console.error("shape:delete:", e.message) }
  })

  /* ── shapes:bulk ─────────────────────────────────────────────
     Multiple shapes at once — used for AI diagram placement.
     Broadcast to OTHER clients (sender already updated locally). */
  socket.on("shapes:bulk", async ({ boardId, shapes }) => {
    if (!boardId || !Array.isArray(shapes) || shapes.length === 0) return
    try {
      serverBulk(boardId, shapes)
      socket.to(boardId).emit("shapes:bulk", { shapes })
      await saveSnapshot(boardId, "AI diagram placed")
    } catch (e) { console.error("shapes:bulk:", e.message) }
  })

  /* ── ai:generate ─────────────────────────────────────────────
     Ask the AI to generate a diagram.
     Result is sent only to the requesting socket for preview.   */
  socket.on("ai:generate", async ({ boardId, prompt }) => {
    if (!boardId || !prompt?.trim()) {
      return socket.emit("ai:error", { msg: "Prompt required." })
    }
    try {
      io.to(boardId).emit("ai:thinking", { prompt, userId, userName })
      const shapes = await generateDiagram(prompt.trim(), userId)
      io.to(boardId).emit("ai:thinking_done", {})
      // Send preview only to the requester
      socket.emit("ai:result", { shapes, prompt: prompt.trim() })
    } catch (err) {
      console.error("ai:generate:", err.message)
      io.to(boardId).emit("ai:thinking_done", {})
      socket.emit("ai:error", { msg: err.message || "AI generation failed." })
    }
  })

  /* ── board:snapshot — manual Ctrl+S ── */
  socket.on("board:snapshot", async ({ boardId, label }) => {
    try {
      await saveSnapshot(boardId, label || "Manual save")
      socket.emit("board:snapshot_saved", { boardId })
    } catch { socket.emit("error", { msg: "Failed to save" }) }
  })

  /* ── board:rewind — restore a version ───────────────────────
     After restoring, broadcast the new shapes list to ALL
     clients in the room so everyone sees the same canvas.       */
  socket.on("board:rewind", async ({ boardId, snapshotIndex }) => {
    try {
      await restoreSnapshot(boardId, snapshotIndex)
      const shapes = getAllShapesJSON(boardId)
      io.to(boardId).emit("board:restore", { shapes })
    } catch (err) {
      console.error("board:rewind:", err.message)
      socket.emit("error", { msg: err.message || "Failed to rewind" })
    }
  })


  /* ── chat:message ─────────────────────────────────────────────
     Live chat tied to the board. Message persisted in memory
     per board session; broadcast to all room members.          */
  socket.on("chat:message", ({ boardId, text }) => {
    if (!boardId || !text?.trim()) return
    const msg = {
      id:     `m${Date.now()}${Math.random().toString(36).slice(2,6)}`,
      userId,
      name:   userName,
      color:  userColor,
      text:   text.trim().slice(0, 500),
      ts:     Date.now(),
    }
    io.to(boardId).emit("chat:message", msg)
  })

  /* ── reaction:stamp ────────────────────────────────────────────
     Emoji reaction broadcast to all in the room.
     Client handles the floating animation.                     */
  socket.on("reaction:stamp", ({ boardId, x, y, emoji }) => {
    if (!boardId) return
    // Broadcast to others (sender already shows it locally)
    socket.to(boardId).emit("reaction:stamp", { x, y, emoji, userId })
  })

  /* ── ai:describe ───────────────────────────────────────────────
     AI explains selected shapes in plain English.              */
  socket.on("ai:describe", async ({ boardId, summary, count }) => {
    if (!boardId || !summary) return
    try {
      const { generateDescription } = require("../../services/ai.service")
      const text = await generateDescription(summary, count)
      socket.emit("ai:describe_result", { text })
    } catch (err) {
      socket.emit("ai:describe_result", { text: "Could not describe — try again." })
    }
  })

  /* ── disconnect ── */
  socket.on("disconnect", async () => {
    if (!currentBoardId) return
    await handleLeave(io, socket, currentBoardId, userId)
    currentBoardId = null
  })
}

/* ── Shared leave logic ── */
async function handleLeave(io, socket, boardId, userId) {
  try {
    socket.leave(boardId)
    const users = getBoardUsers(boardId)
    users.delete(socket.id)

    if (users.size === 0) {
      boardUsers.delete(boardId)
      stopAutoSave(boardId)
      await releaseDoc(boardId)
      console.log(`[board:leave] last user left board=${boardId}`)
    } else {
      broadcastPresence(io, boardId)
    }
    io.to(boardId).emit("cursor:remove", { socketId: socket.id, userId })
  } catch (err) {
    console.error("handleLeave:", err.message)
  }
}