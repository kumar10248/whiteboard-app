// server/src/socket/index.js  — UPDATED
// Registers all three handlers + optional Redis Socket.io adapter

const { Server }              = require("socket.io")
const { createAdapter }       = require("@socket.io/redis-adapter")
const jwt                     = require("jsonwebtoken")
const User                    = require("../models/User")
const { getPublisher, getSubscriber } = require("../config/redis")
const registerBoardHandlers   = require("./handlers/board.handler")
const registerCursorHandlers  = require("./handlers/cursor.handler")
const registerAIHandlers      = require("./handlers/ai.handler")

module.exports = function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin:      process.env.CLIENT_URL || "http://localhost:3000",
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 5 * 1024 * 1024,   // 5MB — for Yjs binary updates
  })

  // ── Attach Redis adapter if Redis is available ──
  // Makes socket rooms work across multiple server instances.
  // Falls back to in-memory if Redis isn't connected.
  const pub = getPublisher()
  const sub = getSubscriber()
  if (pub && sub) {
    io.adapter(createAdapter(pub, sub))
    console.log("[Socket.io] Redis adapter attached — multi-server ready")
  } else {
    console.log("[Socket.io] Using in-memory adapter — single server mode")
  }

  // ── JWT auth middleware — runs before every connection ──
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
        || socket.handshake.headers?.authorization?.split(" ")[1]

      if (!token) return next(new Error("Authentication required"))

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: "whiteboard-app",
      })

      const user = await User.findById(decoded.id)
        .select("name email")
        .lean()

      if (!user) return next(new Error("User not found"))

      socket.user = {
        id:    user._id.toString(),
        name:  user.name,
        email: user.email,
      }
      next()

    } catch (err) {
      next(new Error(err.name === "TokenExpiredError" ? "Token expired" : "Invalid token"))
    }
  })

  // ── Register all handlers per connection ──
  io.on("connection", (socket) => {
    console.log(`[socket] + ${socket.user?.name} (${socket.id})`)

    registerBoardHandlers(io, socket)    // join/leave/yjs sync/snapshot/rewind
    registerCursorHandlers(io, socket)   // cursor:move/stop/typing + presence:ping
    registerAIHandlers(io, socket)       // ai:generate/place/cancel/regenerate

    socket.on("disconnect", (reason) => {
      console.log(`[socket] - ${socket.user?.name} (${socket.id}) reason=${reason}`)
    })
  })

  return io
}