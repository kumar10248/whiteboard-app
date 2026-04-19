// server/src/routes/board.routes.js
// Simple REST routes for board CRUD.
// No controller file needed — logic is simple enough inline here.
const express  = require("express")
const Board    = require("../models/Board")
const User     = require("../models/User")
const { verifyJWT, optionalAuth } = require("../middlewares/auth.middleware")
const { streamThumbnailToResponse, saveThumbnailFromBase64 } = require("../services/snapshot.service")

const router = express.Router()

/* ── POST /api/v1/boards — create a board ──────────────────────── */
router.post("/", verifyJWT, async (req, res) => {
  try {
    const { title, isPublic } = req.body

    const board = await Board.create({
      ownerId:  req.user.id,
      title:    title?.trim() || "Untitled board",
      members:  [req.user.id],
      isPublic: !!isPublic,
    })

    // Add to user's boardIds cache
    await User.findByIdAndUpdate(req.user.id, {
      $addToSet: { boardIds: board._id }
    })

    res.status(201).json({ board })
  } catch (err) {
    console.error("create board error:", err)
    res.status(500).json({ msg: "Failed to create board" })
  }
})

/* ── GET /api/v1/boards — list user's boards ───────────────────── */
router.get("/", verifyJWT, async (req, res) => {
  try {
    const boards = await Board.find({
      $or: [
        { ownerId: req.user.id },
        { members: req.user.id },
      ],
    })
      .select("title ownerId members isPublic createdAt updatedAt thumbnail")
      .sort({ updatedAt: -1 })
      .lean()

    res.json({ boards })
  } catch (err) {
    console.error("list boards error:", err)
    res.status(500).json({ msg: "Failed to fetch boards" })
  }
})

/* ── GET /api/v1/boards/:id — get single board ─────────────────── */
// Uses optionalAuth — public boards work without login
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const query = req.user
      ? {
          _id: req.params.id,
          $or: [
            { ownerId:  req.user.id },
            { members:  req.user.id },
            { isPublic: true },
          ],
        }
      : { _id: req.params.id, isPublic: true }

    const board = await Board.findOne(query)
      .select("-ydocState -snapshots")   // don't send binary data over REST
      .lean()

    if (!board) return res.status(404).json({ msg: "Board not found" })

    res.json({ board })
  } catch (err) {
    console.error("get board error:", err)
    res.status(500).json({ msg: "Failed to fetch board" })
  }
})

/* ── PATCH /api/v1/boards/:id — update title or visibility ────── */
router.patch("/:id", verifyJWT, async (req, res) => {
  try {
    const { title, isPublic } = req.body

    const board = await Board.findOne({
      _id:     req.params.id,
      ownerId: req.user.id,   // only owner can update
    })

    if (!board) return res.status(404).json({ msg: "Board not found" })

    if (title    !== undefined) board.title    = title.trim()
    if (isPublic !== undefined) board.isPublic = !!isPublic
    await board.save()

    res.json({ board })
  } catch (err) {
    console.error("update board error:", err)
    res.status(500).json({ msg: "Failed to update board" })
  }
})

/* ── DELETE /api/v1/boards/:id — delete board ──────────────────── */
router.delete("/:id", verifyJWT, async (req, res) => {
  try {
    const board = await Board.findOne({
      _id:     req.params.id,
      ownerId: req.user.id,   // only owner can delete
    })

    if (!board) return res.status(404).json({ msg: "Board not found" })

    await board.deleteOne()

    // Remove from all members' boardIds caches
    await User.updateMany(
      { boardIds: board._id },
      { $pull: { boardIds: board._id } }
    )

    res.json({ msg: "Board deleted" })
  } catch (err) {
    console.error("delete board error:", err)
    res.status(500).json({ msg: "Failed to delete board" })
  }
})

/* ── POST /api/v1/boards/:id/members — invite member ──────────── */
router.post("/:id/members", verifyJWT, async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ msg: "Email is required" })

    const board = await Board.findOne({
      _id:     req.params.id,
      ownerId: req.user.id,
    })
    if (!board) return res.status(404).json({ msg: "Board not found" })

    const invitee = await User.findOne({ email: email.toLowerCase().trim() })
    if (!invitee) return res.status(404).json({ msg: "User not found" })

    const alreadyMember = board.members.some(
      m => m.toString() === invitee._id.toString()
    )
    if (alreadyMember) return res.status(409).json({ msg: "User is already a member" })

    board.members.push(invitee._id)
    await board.save()

    await User.findByIdAndUpdate(invitee._id, {
      $addToSet: { boardIds: board._id }
    })

    res.json({ msg: `${invitee.name} added to board` })
  } catch (err) {
    console.error("add member error:", err)
    res.status(500).json({ msg: "Failed to add member" })
  }
})

/* ── GET /api/v1/boards/:id/snapshots — list version history ───── */
router.get("/:id/snapshots", verifyJWT, async (req, res) => {
  try {
    const board = await Board.findOne({
      _id:     req.params.id,
      $or: [{ ownerId: req.user.id }, { members: req.user.id }],
    }).select("snapshots")

    if (!board) return res.status(404).json({ msg: "Board not found" })

    // Send metadata only — never send the binary ydocState over REST
    const snapshots = board.snapshots.map((s, i) => ({
      index:   i,
      label:   s.label,
      savedAt: s.savedAt,
    }))

    res.json({ snapshots })
  } catch (err) {
    console.error("list snapshots error:", err)
    res.status(500).json({ msg: "Failed to fetch snapshots" })
  }
})

/* ── POST /api/v1/boards/:id/thumbnail — save PNG thumbnail ────── */
router.post("/:id/thumbnail", verifyJWT, async (req, res) => {
  try {
    const { image } = req.body   // base64 PNG from client
    if (!image) return res.status(400).json({ msg: "Image is required" })

    const board = await Board.findOne({
      _id:     req.params.id,
      $or: [{ ownerId: req.user.id }, { members: req.user.id }],
    })
    if (!board) return res.status(404).json({ msg: "Board not found" })

    const fileId = await saveThumbnailFromBase64(req.params.id, image)

    board.thumbnail = fileId
    await board.save()

    res.json({ msg: "Thumbnail saved", fileId })
  } catch (err) {
    console.error("save thumbnail error:", err)
    res.status(500).json({ msg: "Failed to save thumbnail" })
  }
})

/* ── GET /api/v1/boards/:id/thumbnail — stream PNG thumbnail ───── */
router.get("/:id/thumbnail", optionalAuth, async (req, res) => {
  try {
    // Check access
    const query = req.user
      ? { _id: req.params.id, $or: [{ ownerId: req.user.id }, { members: req.user.id }, { isPublic: true }] }
      : { _id: req.params.id, isPublic: true }

    const board = await Board.findOne(query).select("_id")
    if (!board) return res.status(404).json({ msg: "Board not found" })

    await streamThumbnailToResponse(req.params.id, res)
  } catch (err) {
    if (!res.headersSent) {
      res.status(404).json({ msg: "Thumbnail not found" })
    }
  }
})

module.exports = router