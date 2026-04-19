// server/src/socket/handlers/cursor.handler.js
// Handles real-time cursor positions and user presence awareness.
// Nothing here touches the database — all ephemeral.

// ── Per-board cursor state: boardId → Map<socketId, cursorData> ──
// Kept here (not in board.handler) so cursor state is self-contained
const boardCursors = new Map()

/* ── Throttle helper: limits how often a fn fires per socket ─────── */
function makeThrottle(ms) {
  const lastCall = new Map()
  return function throttled(socketId, fn) {
    const now = Date.now()
    if (!lastCall.has(socketId) || now - lastCall.get(socketId) >= ms) {
      lastCall.set(socketId, now)
      fn()
    }
  }
}

// Cursor moves throttled to max 20 broadcasts/sec (50ms)
const throttle = makeThrottle(50)

/* ═══════════════════════════════════════════════════════════════════
   Main handler — called from socket/index.js per connection
═══════════════════════════════════════════════════════════════════ */
module.exports = function registerCursorHandlers(io, socket) {
  const userId    = socket.user?.id?.toString()
  const userName  = socket.user?.name || "Anonymous"

  // Deterministic color from userId so color stays consistent
  // across reconnects and page refreshes for the same user
  const hue       = Array.from(userId || "0").reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  const userColor = `hsl(${hue}, 70%, 60%)`

  /* ── cursor:move ─────────────────────────────────────────────────
     Client emits this on every mousemove (already throttled client-side).
     Server throttles again as a safety net, then broadcasts to peers. */
  socket.on("cursor:move", ({ boardId, x, y }) => {
    if (!boardId || x == null || y == null) return

    throttle(socket.id, () => {
      // Update stored cursor state
      if (!boardCursors.has(boardId)) boardCursors.set(boardId, new Map())
      boardCursors.get(boardId).set(socket.id, {
        socketId: socket.id,
        userId,
        name:  userName,
        color: userColor,
        x:     Math.round(x),
        y:     Math.round(y),
        updatedAt: Date.now(),
      })

      // Broadcast cursor to everyone in room EXCEPT sender
      socket.to(boardId).emit("cursor:update", {
        socketId: socket.id,
        userId,
        name:  userName,
        color: userColor,
        x:     Math.round(x),
        y:     Math.round(y),
      })
    })
  })

  /* ── cursor:stop ─────────────────────────────────────────────────
     Client emits this on mouseleave (left the canvas area).
     Hides cursor for this user on all peers' screens. */
  socket.on("cursor:stop", ({ boardId }) => {
    if (!boardId) return
    boardCursors.get(boardId)?.delete(socket.id)
    socket.to(boardId).emit("cursor:remove", { socketId: socket.id, userId })
  })

  /* ── cursor:typing ───────────────────────────────────────────────
     Shows a typing indicator when a user is editing a text shape.
     Peers see a blinking "..." near that user's cursor. */
  socket.on("cursor:typing", ({ boardId, shapeId, isTyping }) => {
    if (!boardId) return
    socket.to(boardId).emit("cursor:typing_update", {
      socketId: socket.id,
      userId,
      name: userName,
      shapeId,
      isTyping,
    })
  })

  /* ── presence:ping ───────────────────────────────────────────────
     Client pings every 10s to confirm they're still active.
     Server responds with current board presence list.
     Helps detect zombie connections that didn't fire disconnect. */
  socket.on("presence:ping", ({ boardId }) => {
    if (!boardId) return

    const cursors = boardCursors.get(boardId)
    if (!cursors) return

    // Clean up stale cursors (no update in > 15 seconds)
    const cutoff = Date.now() - 15_000
    cursors.forEach((cursor, sid) => {
      if (cursor.updatedAt < cutoff) {
        cursors.delete(sid)
        socket.to(boardId).emit("cursor:remove", { socketId: sid })
      }
    })

    // Respond with active cursors (minus the requester)
    const activeCursors = Array.from(cursors.values())
      .filter(c => c.socketId !== socket.id)

    socket.emit("presence:pong", { cursors: activeCursors })
  })

  /* ── cleanup on disconnect ───────────────────────────────────────
     Remove this socket's cursor from all boards it was in. */
  socket.on("disconnect", () => {
    boardCursors.forEach((cursors, boardId) => {
      if (cursors.has(socket.id)) {
        cursors.delete(socket.id)
        // Tell everyone in that board this cursor is gone
        socket.to(boardId).emit("cursor:remove", {
          socketId: socket.id,
          userId,
        })
        // Clean up empty maps
        if (cursors.size === 0) boardCursors.delete(boardId)
      }
    })
  })
}

/* ── Export helper for board.handler.js to query cursors ─────────── */
module.exports.getBoardCursors = function (boardId) {
  return Array.from(boardCursors.get(boardId)?.values() || [])
}