// server/src/app.js
const express      = require("express")
const cors         = require("cors")
const cookieParser = require("cookie-parser")
const rateLimit    = require("express-rate-limit")
const authRoutes   = require("./routes/auth.routes")
const boardRoutes  = require("./routes/board.routes")

const app = express()

// ── CORS — allow frontend + cookies ──────────────────────────────
app.use(cors({
  origin:      process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,   // required for cookies (refreshToken)
}))

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// ── Global rate limit (safety net) ───────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => res.status(429).json({ msg: "Too many requests" }),
}))

// ── Health check ──────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", ts: Date.now() }))

// ── Routes ───────────────────────────────────────────────────────
app.use("/api/v1/auth",   authRoutes)
app.use("/api/v1/boards", boardRoutes)

// ── 404 handler ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ msg: `Route ${req.method} ${req.path} not found` })
})

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Express error]", err.message)
  res.status(500).json({ msg: "Internal server error" })
})

module.exports = app