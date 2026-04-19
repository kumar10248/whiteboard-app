// server/src/server.js — entry point
require("dotenv").config()
const http     = require("http")
const mongoose = require("mongoose")
const app      = require("./src/app")
const initSocket = require("./src/socket")
const { initRedis, closeRedis } = require("./src/config/redis")
const { initGridFS } = require("./src/services/snapshot.service")

const PORT = process.env.PORT || 8000

async function start() {
  // 1. Connect MongoDB
  await mongoose.connect(process.env.MONGO_URI)
  console.log("[MongoDB] Connected")

  // 2. Init GridFS bucket (needs live DB connection)
  initGridFS()

  // 3. Init Redis (optional — won't crash if unavailable)
  await initRedis()

  // 4. Create HTTP server from Express app
  const httpServer = http.createServer(app)

  // 5. Attach Socket.io to the HTTP server (not the express app)
  initSocket(httpServer)

  // 6. Start listening
  httpServer.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`)
  })
}

// ── Graceful shutdown ──────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully`)
  await closeRedis()
  await mongoose.disconnect()
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))
process.on("unhandledRejection", (err) => {
  console.error("[Server] Unhandled rejection:", err)
})

start().catch(err => {
  console.error("[Server] Startup failed:", err)
  process.exit(1)
})