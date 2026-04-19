// server/src/controllers/auth.controller.js
const User    = require("../models/User")
const bcrypt  = require("bcrypt")
const jwt     = require("jsonwebtoken")
require("dotenv").config()

/* ── Token generators ────────────────────────────────────────────── */
function generateAccessToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "15m", issuer: "whiteboard-app" }
  )
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d", issuer: "whiteboard-app" }
  )
}

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/

/* ── POST /api/auth/register ─────────────────────────────────────── */
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ msg: "All fields are required" })
    }

    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        msg: "Password must be 8+ characters and include a letter, number, and special character"
      })
    }

    const emailNorm = email.toLowerCase().trim()

    const exists = await User.findOne({ email: emailNorm })
    if (exists) {
      return res.status(409).json({ msg: "User already exists" })
    }

    const hashed = await bcrypt.hash(password, 10)
    await User.create({ name: name.trim(), email: emailNorm, password: hashed })

    res.status(201).json({ msg: "Registered successfully" })

  } catch (err) {
    console.error("register error:", err)
    res.status(500).json({ msg: "Something went wrong" })
  }
}

/* ── POST /api/auth/login ────────────────────────────────────────── */
const login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ msg: "All fields are required" })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (!user) {
      return res.status(401).json({ msg: "Invalid credentials" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ msg: "Invalid credentials" })
    }

    const token        = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user)

    user.refreshToken = refreshToken
    await user.save()

    // Refresh token in httpOnly cookie — not accessible by JS
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 days in ms
    })

    res.status(200).json({ token, msg: "Login successful" })

  } catch (err) {
    console.error("login error:", err)
    res.status(500).json({ msg: "Internal server error" })
  }
}

/* ── POST /api/auth/refresh ──────────────────────────────────────── */
const refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (!refreshToken) {
      return res.status(401).json({ msg: "No refresh token" })
    }

    let decoded
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
        issuer: "whiteboard-app",
      })
    } catch {
      return res.status(401).json({ msg: "Invalid or expired refresh token" })
    }

    const user = await User.findById(decoded.id)
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ msg: "Refresh token mismatch" })
    }

    const newAccessToken = generateAccessToken(user)
    res.status(200).json({ token: newAccessToken })

  } catch (err) {
    console.error("refreshAccessToken error:", err)
    res.status(500).json({ msg: "Internal server error" })
  }
}

/* ── POST /api/auth/logout ───────────────────────────────────────── */
const logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (refreshToken) {
      // Nullify refresh token in DB so it can't be reused
      await User.findOneAndUpdate(
        { refreshToken },
        { $set: { refreshToken: null } }
      )
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "strict",
    })

    res.status(200).json({ msg: "Logged out successfully" })

  } catch (err) {
    console.error("logout error:", err)
    res.status(500).json({ msg: "Internal server error" })
  }
}

/* ── GET /api/auth/me ────────────────────────────────────────────── */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password -refreshToken")
      .lean()

    if (!user) {
      return res.status(404).json({ msg: "User not found" })
    }

    res.status(200).json({ success: true, user })

  } catch (err) {
    console.error("getMe error:", err)
    res.status(500).json({ msg: "Internal server error" })
  }
}

/* ── PATCH /api/auth/password ────────────────────────────────────── */
const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body

    if (!oldPassword?.trim() || !newPassword?.trim()) {
      return res.status(400).json({ msg: "oldPassword and newPassword are required" })
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        msg: "New password must be 8+ characters with a letter, number, and special character"
      })
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ msg: "New password must be different from old password" })
    }

    // Explicitly select password — it's excluded by default
    const user = await User.findById(req.user.id).select("+password")
    if (!user) {
      return res.status(404).json({ msg: "User not found" })
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password)
    if (!isMatch) {
      return res.status(401).json({ msg: "Old password is incorrect" })
    }

    user.password          = await bcrypt.hash(newPassword, 10)
    user.passwordChangedAt = new Date()
    // Invalidate all existing refresh tokens by clearing it
    user.refreshToken      = null
    await user.save()

    // Clear refresh token cookie — force re-login on all devices
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "strict",
    })

    res.status(200).json({ msg: "Password updated. Please log in again." })

  } catch (err) {
    console.error("changePassword error:", err)
    res.status(500).json({ msg: "Internal server error" })
  }
}

module.exports = { register, login, refreshAccessToken, logout, getMe, changePassword }