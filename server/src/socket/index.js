// server/src/socket/index.js
const { Server }    = require("socket.io")
const jwt           = require("jsonwebtoken")
const User          = require("../models/User")
const registerBoardHandlers = require("./handlers/board.handler")

module.exports = function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin:      process.env.CLIENT_URL || "http://localhost:3000",
      credentials: true,
    },
    // Send binary Yjs updates as binary — more efficient than base64
    // But we encode as base64 in handlers for compatibility with JSON events
    transports: ["websocket", "polling"],
  })

  /* ── JWT auth middleware — runs before every connection ── */
  io.use(async (socket, next) => {
    try {
      // Client sends token in handshake auth: socket({ auth: { token } })
      const token = socket.handshake.auth?.token
        || socket.handshake.headers?.authorization?.split(" ")[1]

      if (!token) {
        return next(new Error("Authentication required"))
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: "ai-review-app",
      })

      const user = await User.findById(decoded.id)
        .select("name email")
        .lean()

      if (!user) return next(new Error("User not found"))

      // Attach user to socket — available in all handlers
      socket.user = { id: user._id.toString(), name: user.name, email: user.email }

      next()
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return next(new Error("Token expired"))
      }
      next(new Error("Invalid token"))
    }
  })

  /* ── Register handlers on connection ── */
  io.on("connection", (socket) => {
    console.log(`[socket] connected — user=${socket.user?.name} id=${socket.id}`)

    // Register all board-related event handlers
    registerBoardHandlers(io, socket)

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected — user=${socket.user?.name} reason=${reason}`)
    })
  })

  return io
}