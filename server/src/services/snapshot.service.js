// server/src/services/snapshot.service.js
// Saves canvas PNG thumbnails to MongoDB GridFS.
// GridFS stores binary files (images) in MongoDB without size limits.
// Used for: board thumbnail previews on the dashboard.
// NOTE: Yjs state snapshots are stored directly in Board.ydocState (Buffer)
//       — that's handled in crdt.service.js, NOT here.
//       This file ONLY handles PNG image snapshots.

const mongoose = require("mongoose")
const { GridFSBucket } = require("mongodb")
const { Readable } = require("stream")

let bucket = null

/* ── Initialize GridFS bucket — call this after mongoose connects ── */
function initGridFS() {
  if (!mongoose.connection.db) {
    throw new Error("MongoDB not connected. Call initGridFS after mongoose.connect().")
  }
  bucket = new GridFSBucket(mongoose.connection.db, {
    bucketName: "thumbnails",   // stored as thumbnails.files + thumbnails.chunks
  })
  console.log("[GridFS] Thumbnail bucket initialized")
  return bucket
}

function getBucket() {
  if (!bucket) throw new Error("GridFS not initialized. Call initGridFS() first.")
  return bucket
}

/* ── Save a PNG buffer as a board thumbnail ──────────────────────── */
// pngBuffer: Buffer from canvas.toBuffer() or base64 decoded from client
// boardId:   string — used as the filename in GridFS
// Returns the GridFS file _id (ObjectId)
async function saveThumbnail(boardId, pngBuffer) {
  const b = getBucket()

  // Delete existing thumbnail for this board before saving new one
  await deleteThumbnail(boardId)

  return new Promise((resolve, reject) => {
    const filename    = `board-${boardId}.png`
    const uploadStream = b.openUploadStream(filename, {
      metadata: {
        boardId,
        createdAt: new Date(),
        contentType: "image/png",
      },
      contentType: "image/png",
    })

    // Convert Buffer → Readable stream → GridFS
    const readable = Readable.from(pngBuffer)
    readable.pipe(uploadStream)

    uploadStream.on("finish", () => {
      console.log(`[GridFS] Thumbnail saved: boardId=${boardId} fileId=${uploadStream.id}`)
      resolve(uploadStream.id.toString())
    })

    uploadStream.on("error", (err) => {
      console.error(`[GridFS] Save failed: boardId=${boardId}`, err.message)
      reject(new Error(`Failed to save thumbnail: ${err.message}`))
    })
  })
}

/* ── Stream a thumbnail back as a Buffer ─────────────────────────── */
// Used by the REST route: GET /api/boards/:id/thumbnail
async function getThumbnail(boardId) {
  const b        = getBucket()
  const filename = `board-${boardId}.png`

  // Find the file first — throws if not found
  const files = await b.find({ filename }).toArray()
  if (files.length === 0) {
    throw new Error(`No thumbnail found for board ${boardId}`)
  }

  return new Promise((resolve, reject) => {
    const chunks  = []
    const stream  = b.openDownloadStreamByName(filename)

    stream.on("data",  chunk => chunks.push(chunk))
    stream.on("end",   ()    => resolve(Buffer.concat(chunks)))
    stream.on("error", err   => reject(new Error(`Failed to retrieve thumbnail: ${err.message}`)))
  })
}

/* ── Delete a board's thumbnail (called before saving new one) ────── */
async function deleteThumbnail(boardId) {
  const b        = getBucket()
  const filename = `board-${boardId}.png`

  try {
    const files = await b.find({ filename }).toArray()
    if (files.length === 0) return   // nothing to delete

    await Promise.all(files.map(f => b.delete(f._id)))
    console.log(`[GridFS] Deleted old thumbnail: boardId=${boardId}`)
  } catch (err) {
    // Non-fatal — log and continue
    console.warn(`[GridFS] Could not delete old thumbnail: ${err.message}`)
  }
}

/* ── Save thumbnail from base64 string (sent by client) ──────────── */
// Client sends: socket.emit("board:thumbnail", { boardId, image: "data:image/png;base64,..." })
async function saveThumbnailFromBase64(boardId, base64String) {
  // Strip the data:image/png;base64, prefix if present
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "")
  const buffer     = Buffer.from(base64Data, "base64")

  if (buffer.length === 0) throw new Error("Empty image buffer")
  if (buffer.length > 5 * 1024 * 1024) throw new Error("Thumbnail exceeds 5MB limit")

  return saveThumbnail(boardId, buffer)
}

/* ── Pipe thumbnail directly to HTTP response ─────────────────────── */
// More efficient than loading into memory first
// Usage in route: await streamThumbnailToResponse(boardId, res)
async function streamThumbnailToResponse(boardId, res) {
  const b        = getBucket()
  const filename = `board-${boardId}.png`

  const files = await b.find({ filename }).toArray()
  if (files.length === 0) {
    res.status(404).json({ msg: "Thumbnail not found" })
    return
  }

  res.setHeader("Content-Type",  "image/png")
  res.setHeader("Cache-Control", "public, max-age=60")   // cache for 60s

  const stream = b.openDownloadStreamByName(filename)
  stream.pipe(res)

  stream.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ msg: "Failed to stream thumbnail" })
    }
  })
}

module.exports = {
  initGridFS,
  saveThumbnail,
  saveThumbnailFromBase64,
  getThumbnail,
  deleteThumbnail,
  streamThumbnailToResponse,
}