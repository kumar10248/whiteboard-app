// server/src/middleware/auth.middleware.js
const jwt  = require("jsonwebtoken")
const User = require("../models/User")

/* ── verifyJWT — protects REST routes ───────────────────────────────
   Usage: router.get("/me", verifyJWT, getMe)
   Attaches req.user = { id, email } on success.              */
const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.get("Authorization")

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ msg: "Unauthorized — no token provided" })
    }

    const token = authHeader.split(" ")[1]

    let decoded
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: "whiteboard-app",
      })
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ msg: "Token expired" })
      }
      return res.status(401).json({ msg: "Invalid token" })
    }

    if (!decoded?.id) {
      return res.status(401).json({ msg: "Invalid token payload" })
    }

    const user = await User.findById(decoded.id)
      .select("-password")
      .lean()

    if (!user) {
      return res.status(401).json({ msg: "User no longer exists" })
    }

    // Block tokens issued before a password change
    if (user.passwordChangedAt) {
      const tokenIssuedAt    = decoded.iat * 1000
      const passwordChanged  = new Date(user.passwordChangedAt).getTime()
      if (passwordChanged > tokenIssuedAt) {
        return res.status(401).json({ msg: "Password was changed. Please log in again." })
      }
    }

    req.user = { id: user._id.toString(), email: user.email }
    next()

  } catch (err) {
    console.error("verifyJWT error:", err)
    return res.status(401).json({ msg: "Authentication failed" })
  }
}

/* ── optionalAuth — for public routes that behave differently when logged in ──
   Example: GET /boards/:id — public boards work for anyone,
   but logged-in users also see edit controls.
   Attaches req.user if token is valid, sets req.user = null if not. */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      req.user = null
      return next()
    }

    const token = authHeader.split(" ")[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "whiteboard-app",
    })

    const user = await User.findById(decoded.id).select("-password").lean()
    req.user = user ? { id: user._id.toString(), email: user.email } : null

  } catch {
    // Invalid token — treat as unauthenticated, don't block the request
    req.user = null
  }

  next()
}

module.exports = { verifyJWT, optionalAuth }