// server/src/socket/handlers/ai.handler.js
// Handles all AI diagram generation socket events.
// Separated from board.handler to keep concerns clean.
// Works alongside board.handler — both are registered per connection.

const { generateDiagram } = require("../../services/ai.service")
const { insertAIShapes, saveSnapshot } = require("../../services/crdt.service")
const Operation = require("../../models/Operation")

// ── Rate limit: max 5 AI requests per user per minute ─────────────
// Simple in-memory map — fine for single server instance
// For multi-server: move this to Redis (see redis.js)
const aiRateLimit = new Map()   // userId → { count, resetAt }

function checkRateLimit(userId) {
  const now  = Date.now()
  const data = aiRateLimit.get(userId)

  if (!data || now > data.resetAt) {
    aiRateLimit.set(userId, { count: 1, resetAt: now + 60_000 })
    return { allowed: true, remaining: 4 }
  }

  if (data.count >= 5) {
    const retryIn = Math.ceil((data.resetAt - now) / 1000)
    return { allowed: false, retryIn }
  }

  data.count++
  return { allowed: true, remaining: 5 - data.count }
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  aiRateLimit.forEach((data, userId) => {
    if (now > data.resetAt) aiRateLimit.delete(userId)
  })
}, 5 * 60_000)

/* ═══════════════════════════════════════════════════════════════════
   Main handler
═══════════════════════════════════════════════════════════════════ */
module.exports = function registerAIHandlers(io, socket) {
  const userId = socket.user?.id?.toString()
  const name   = socket.user?.name || "Anonymous"

  // Track in-progress generation for this socket (prevent double-submit)
  let isGenerating = false

  /* ── ai:generate ─────────────────────────────────────────────────
     Client sends a text prompt.
     Flow: rate check → notify room → call OpenAI → send preview to requester */
  socket.on("ai:generate", async ({ boardId, prompt }) => {
    // Prevent double-submit from same socket
    if (isGenerating) {
      return socket.emit("ai:error", { msg: "A diagram is already being generated. Please wait." })
    }

    // Validate inputs
    if (!boardId || !prompt?.trim()) {
      return socket.emit("ai:error", { msg: "Board ID and prompt are required." })
    }
    if (prompt.trim().length > 300) {
      return socket.emit("ai:error", { msg: "Prompt is too long. Keep it under 300 characters." })
    }

    // Check rate limit
    const limit = checkRateLimit(userId)
    if (!limit.allowed) {
      return socket.emit("ai:error", {
        msg: `Rate limit reached. Try again in ${limit.retryIn} seconds.`,
        retryIn: limit.retryIn,
      })
    }

    isGenerating = true

    try {
      // Tell the whole room that AI generation started
      // Other users see a "generating diagram..." indicator
      io.to(boardId).emit("ai:thinking", {
        prompt: prompt.trim(),
        userId,
        userName: name,
      })

      // Call OpenAI — this is the slow part (2–8 seconds)
      const shapes = await generateDiagram(prompt.trim(), userId)

      // Send result ONLY to the requesting socket for preview
      // The user sees a preview modal — nothing on the canvas yet
      socket.emit("ai:result", {
        shapes,
        prompt:    prompt.trim(),
        remaining: limit.remaining,
      })

      // Tell room that AI is done thinking
      io.to(boardId).emit("ai:thinking_done", { userId })

    } catch (err) {
      console.error(`[ai:generate] error user=${name}:`, err.message)

      // Tell room to hide the generating indicator
      io.to(boardId).emit("ai:thinking_done", { userId })

      socket.emit("ai:error", {
        msg: err.message || "AI generation failed. Try a different prompt.",
      })
    } finally {
      isGenerating = false
    }
  })

  /* ── ai:place ────────────────────────────────────────────────────
     User confirmed the preview — place shapes onto the canvas.
     Inserts into Yjs doc and broadcasts to all room members. */
  socket.on("ai:place", async ({ boardId, shapes, prompt }) => {
    if (!boardId || !Array.isArray(shapes) || shapes.length === 0) {
      return socket.emit("ai:error", { msg: "No shapes to place." })
    }

    // Max 20 shapes at once — prevents canvas spam
    if (shapes.length > 20) {
      return socket.emit("ai:error", { msg: "Too many shapes. Max 20 per generation." })
    }

    try {
      // Insert shapes into Yjs doc — returns new binary delta
      const delta  = await insertAIShapes(boardId, shapes)
      const base64 = Buffer.from(delta).toString("base64")

      // Broadcast Yjs update to ALL clients in the room
      // Every client merges this delta into their local Yjs doc
      io.to(boardId).emit("yjs:update", {
        update: base64,
        userId,
        source: "ai",   // optional: client can animate AI-placed shapes differently
      })

      // Save a labeled snapshot before the diagram changes
      // "Before AI" snapshot so users can rewind if they don't like it
      await saveSnapshot(boardId, `AI: "${(prompt || "diagram").slice(0, 40)}"`)

      // Log to operation history
      await Operation.create({
        boardId,
        userId,
        type: "ai_generate",
        payload: {
          aiPrompt:  prompt || "",
          shapeType: "multiple",
          after:     shapes,
        },
      })

      // Confirm placement to requester
      socket.emit("ai:placed", {
        count:  shapes.length,
        prompt: prompt || "",
      })

    } catch (err) {
      console.error(`[ai:place] error:`, err.message)
      socket.emit("ai:error", { msg: "Failed to place shapes on canvas." })
    }
  })

  /* ── ai:cancel ───────────────────────────────────────────────────
     User dismissed the preview without placing.
     Nothing to do on server — just clear the thinking indicator. */
  socket.on("ai:cancel", ({ boardId }) => {
    io.to(boardId).emit("ai:thinking_done", { userId })
  })

  /* ── ai:regenerate ───────────────────────────────────────────────
     User didn't like the preview and wants a new generation.
     Same as ai:generate but automatically cancels previous result. */
  socket.on("ai:regenerate", async ({ boardId, prompt }) => {
    // Clear generating lock so ai:generate can run again
    isGenerating = false
    // Re-emit as a fresh generate
    socket.emit("ai:generate", { boardId, prompt })
  })
}