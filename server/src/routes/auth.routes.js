// server/src/routes/auth.routes.js
const express = require("express")
const rateLimit = require("express-rate-limit")
const {
  register,
  login,
  refreshAccessToken,
  logout,
  getMe,
  changePassword,
} = require("../controllers/auth.controller")
const { verifyJWT } = require("../middlewares/auth.middleware")
const router = express.Router()

// ── Rate limiter for auth endpoints ──────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,

  handler: (req, res) => {
    res.status(429).json({ msg: "Too many attempts. Please wait 15 minutes." })
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Public routes
router.post("/register", authLimiter, register)
router.post("/login",    authLimiter, login)
router.post("/refresh",  refreshAccessToken)   // uses httpOnly cookie — no limiter needed
router.post("/logout",   logout)

// Protected routes
router.get("/me",              verifyJWT, getMe)
router.patch("/password",      verifyJWT, changePassword)

module.exports = router