// server/src/socket/handlers/board.handler.js
const {
  getDoc,
  applyUpdate,
  getFullState,
  saveSnapshot,
  insertAIShapes,
  restoreSnapshot,
  releaseDoc,
} = require("../../services/crdt.service")
const { generateDiagram } = require("../../services/ai.service")
const Operation = require("../../models/Operation")
const Board     = require("../../models/Board")

// ── Track active users per board: boardId → Map<socketId, userInfo> ──
const boardUsers = new Map()

// ── Auto-save interval: save Yjs state every 30s for each active board ──
const saveIntervals = new Map()

/* ─── Helper: get or init user map for a board ─────────────────── */
function getBoardUsers(boardId) {
  if (!boardUsers.has(boardId)) boardUsers.set(boardId, new Map())
  return boardUsers.get(boardId)
}

/* ─── Helper: broadcast presence to everyone in a board room ────── */
function broadcastPresence(io, boardId) {
  const users = Array.from(getBoardUsers(boardId).values())
  io.to(boardId).emit("presence:update", { users })
}

/* ─── Helper: start auto-save for a board if not already running ── */
function startAutoSave(boardId) {
  if (saveIntervals.has(boardId)) return
  const interval = setInterval(async () => {
    try {
      await saveSnapshot(boardId, "Auto-save")
    } catch (err) {
      console.error(`Auto-save failed for board ${boardId}:`, err.message)
    }
  }, 30_000)
  saveIntervals.set(boardId, interval)
}

/* ─── Helper: stop auto-save when board is empty ─────────────────── */
function stopAutoSave(boardId) {
  const interval = saveIntervals.get(boardId)
  if (interval) {
    clearInterval(interval)
    saveIntervals.delete(boardId)
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Main handler — called once per socket connection
═══════════════════════════════════════════════════════════════════ */
module.exports = function registerBoardHandlers(io, socket) {
  const userId   = socket.user?.id?.toString()
  const userName = socket.user?.name || "Anonymous"
  // Assign a consistent cursor color per user
  const userColor = `hsl(${(parseInt(userId, 16) % 360) || Math.floor(Math.random() * 360)}, 70%, 60%)`

  // Track which board this socket is currently in
  let currentBoardId = null

  /* ── board:join ─────────────────────────────────────────────────
     Client joins a board room. Server sends back full Yjs state
     + current member list so the new joiner is fully caught up. */
  socket.on("board:join", async ({ boardId }) => {
    try {
      // Verify user has access
      const board = await Board.findOne({
        _id: boardId,
        $or: [
          { ownerId: userId },
          { members: userId },
          { isPublic: true },
        ],
      })
      if (!board) {
        return socket.emit("error", { msg: "Board not found or access denied" })
      }

      // Leave previous board if switching
      if (currentBoardId && currentBoardId !== boardId) {
        await handleLeave(io, socket, currentBoardId, userId)
      }

      currentBoardId = boardId
      socket.join(boardId)

      // Register user presence
      const users = getBoardUsers(boardId)
      users.set(socket.id, { id: userId, name: userName, color: userColor, socketId: socket.id })

      // Start auto-save if this is the first user joining
      startAutoSave(boardId)

      // Send full Yjs state to the joining client
      const fullState = await getFullState(boardId)
      socket.emit("yjs:full_state", {
        update:    Buffer.from(fullState).toString("base64"),
        boardId,
        boardTitle: board.title,
      })

      // Tell everyone (including new joiner) who's in the room
      broadcastPresence(io, boardId)

      console.log(`[board:join] user=${userName} board=${boardId} users=${users.size}`)

    } catch (err) {
      console.error("board:join error:", err)
      socket.emit("error", { msg: "Failed to join board" })
    }
  })

  /* ── board:leave ────────────────────────────────────────────────
     Client explicitly leaves a board. */
  socket.on("board:leave", async ({ boardId }) => {
    await handleLeave(io, socket, boardId, userId)
    currentBoardId = null
  })

  /* ── yjs:update ─────────────────────────────────────────────────
     Client sends a Yjs binary delta (Uint8Array encoded as base64).
     Server applies it to the server-side Y.Doc and broadcasts
     to ALL other clients in the room. */
  socket.on("yjs:update", async ({ boardId, update, opMeta }) => {
    try {
      // Decode base64 → Uint8Array
      const uint8 = new Uint8Array(Buffer.from(update, "base64"))

      // Apply to server Yjs doc — this is the source of truth
      await applyUpdate(boardId, uint8)

      // Broadcast to all OTHER clients in the room
      socket.to(boardId).emit("yjs:update", {
        update: update,   // re-send as base64
        userId,
      })

      // Log operation to MongoDB audit trail (fire and forget)
      if (opMeta?.type) {
        Operation.create({
          boardId,
          userId,
          type:      opMeta.type,
          payload:   opMeta.payload || {},
          yjsUpdate: Buffer.from(uint8),
        }).catch(err => console.error("Operation log failed:", err.message))
      }

    } catch (err) {
      console.error("yjs:update error:", err)
      socket.emit("error", { msg: "Failed to sync canvas update" })
    }
  })

  /* ── cursor:move ─────────────────────────────────────────────────
     Client sends their cursor position (throttled on client side).
     Server broadcasts to all other room members.
     No database write — ephemeral. */
  socket.on("cursor:move", ({ boardId, x, y }) => {
    // Broadcast cursor to everyone EXCEPT the sender
    socket.to(boardId).emit("cursor:update", {
      socketId: socket.id,
      userId,
      name:  userName,
      color: userColor,
      x,
      y,
    })
  })

  /* ── ai:generate ─────────────────────────────────────────────────
     Client sends a text prompt. Server calls OpenAI and returns
     a preview of shapes — client must confirm with ai:place. */
  socket.on("ai:generate", async ({ boardId, prompt }) => {
    try {
      // Notify room that AI generation is in progress
      io.to(boardId).emit("ai:thinking", { prompt, userId })

      const shapes = await generateDiagram(prompt)

      // Send result ONLY to the requesting client for preview
      socket.emit("ai:result", { shapes, prompt })

    } catch (err) {
      console.error("ai:generate error:", err)
      socket.emit("ai:error", { msg: err.message || "AI generation failed" })
    }
  })

  /* ── ai:place ────────────────────────────────────────────────────
     Client confirmed the AI shape preview. Insert shapes into
     Yjs doc and broadcast the resulting delta to the entire room. */
  socket.on("ai:place", async ({ boardId, shapes }) => {
    try {
      // Insert shapes into Yjs — returns new Yjs delta
      const delta = await insertAIShapes(boardId, shapes)
      const base64 = Buffer.from(delta).toString("base64")

      // Broadcast update to ALL clients in the room (including sender)
      io.to(boardId).emit("yjs:update", { update: base64, userId })

      // Log AI placement as an operation
      Operation.create({
        boardId,
        userId,
        type: "ai_generate",
        payload: {
          aiPrompt:  shapes[0]?.prompt || "",
          shapeType: "multiple",
          after:     shapes,
        },
      }).catch(() => {})

      // Save a labeled snapshot before and after AI diagrams
      await saveSnapshot(boardId, `AI: "${shapes[0]?.prompt || "diagram"}"`)

    } catch (err) {
      console.error("ai:place error:", err)
      socket.emit("error", { msg: "Failed to place AI shapes" })
    }
  })

  /* ── board:snapshot ──────────────────────────────────────────────
     Manual save — client triggers this (e.g. Ctrl+S or toolbar button). */
  socket.on("board:snapshot", async ({ boardId, label }) => {
    try {
      await saveSnapshot(boardId, label || "Manual save")
      socket.emit("board:snapshot_saved", { msg: "Board saved", boardId })
    } catch (err) {
      console.error("board:snapshot error:", err)
      socket.emit("error", { msg: "Failed to save board" })
    }
  })

  /* ── board:rewind ────────────────────────────────────────────────
     Restore the board to a previous snapshot.
     The restored Yjs state is broadcast to all users in the room. */
  socket.on("board:rewind", async ({ boardId, snapshotIndex }) => {
    try {
      const state   = await restoreSnapshot(boardId, snapshotIndex)
      const base64  = Buffer.from(state).toString("base64")

      // Send full restored state to everyone — they'll apply it as a full update
      io.to(boardId).emit("yjs:full_state", {
        update: base64,
        boardId,
        restoredFrom: snapshotIndex,
      })

    } catch (err) {
      console.error("board:rewind error:", err)
      socket.emit("error", { msg: err.message || "Failed to rewind board" })
    }
  })

  /* ── board:get_snapshots ─────────────────────────────────────────
     Return list of available snapshots (without the binary data). */
  socket.on("board:get_snapshots", async ({ boardId }) => {
    try {
      const board = await Board.findById(boardId).select("snapshots")
      const list  = board?.snapshots.map((s, i) => ({
        index:   i,
        label:   s.label,
        savedAt: s.savedAt,
      })) || []

      socket.emit("board:snapshots_list", { snapshots: list })
    } catch (err) {
      socket.emit("error", { msg: "Failed to fetch snapshots" })
    }
  })

  /* ── disconnect ──────────────────────────────────────────────────
     Socket disconnected (tab closed, network lost).
     Remove from presence, save if last user. */
  socket.on("disconnect", async () => {
    if (!currentBoardId) return
    await handleLeave(io, socket, currentBoardId, userId)
    currentBoardId = null
  })
}

/* ═══════════════════════════════════════════════════════════════════
   Shared leave logic — used by board:leave AND disconnect
═══════════════════════════════════════════════════════════════════ */
async function handleLeave(io, socket, boardId, userId) {
  try {
    socket.leave(boardId)

    const users = getBoardUsers(boardId)
    users.delete(socket.id)

    if (users.size === 0) {
      // Last user left — save and clean up
      boardUsers.delete(boardId)
      stopAutoSave(boardId)
      await releaseDoc(boardId)   // saves snapshot + removes from memory
      console.log(`[board:leave] Last user left board=${boardId}, doc released`)
    } else {
      // Others are still here — just update presence
      broadcastPresence(io, boardId)
    }

    // Tell everyone this cursor is gone
    io.to(boardId).emit("cursor:remove", { socketId: socket.id, userId })

  } catch (err) {
    console.error("handleLeave error:", err.message)
  }
}