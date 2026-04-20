// server/src/services/ai.service.js
// FIXES:
// 1. Prompt forces every shape to have a label — no empty labels allowed
// 2. Prompt gives concrete coordinate examples so shapes form a real diagram
// 3. Arrow positions use SHAPE_INDEX references which resolveShapes() converts
// 4. Strict JSON-only extraction
const nanoid = async (size = 12) => {
  const { nanoid } = await import("nanoid")
  return nanoid(size)
}
require("dotenv").config()

const Groq = require("groq-sdk")
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

/* ─── System prompt ────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are a diagram layout engine. Output ONLY a valid JSON array. No text, no markdown, no explanation.

SHAPE SCHEMA (every field required):
{
  "type":        "rect" | "ellipse" | "text" | "arrow",
  "x":           number,
  "y":           number,
  "width":       number,
  "height":      number,
  "fill":        string,
  "stroke":      string,
  "strokeWidth": 1.5,
  "label":       string,   ← REQUIRED, NEVER empty. Always put the node name here.
  "fontSize":    13,
  "fromId":      null,
  "toId":        null
}

ARROW SCHEMA:
For arrows, use type "arrow" and set:
  "fromIndex": number   ← index of source shape in this array (0-based)
  "toIndex":   number   ← index of target shape in this array (0-based)
The server replaces these with real IDs.

COLOR PALETTE (use these exact hex values):
- Purple nodes: fill="#1a1535", stroke="#6c63ff"
- Teal nodes:   fill="#0a2520", stroke="#22d3a0"
- Red nodes:    fill="#2a0f0f", stroke="#f87171"
- Blue nodes:   fill="#0a1a30", stroke="#3b82f6"
- Yellow nodes: fill="#2a1f00", stroke="#fbbf24"
- Arrow:        fill="#6c63ff", stroke="#6c63ff"

LAYOUT RULES:
- Start at x=80, y=80
- Each row: space shapes 200px apart horizontally
- Each level: space 140px apart vertically
- Keep all shapes within x=0..800, y=0..600
- Arrows go AFTER all the shapes they connect

EXAMPLE — "ERD for a blog" produces:
[
  {"type":"rect","x":80,"y":80,"width":160,"height":60,"fill":"#1a1535","stroke":"#6c63ff","strokeWidth":1.5,"label":"User","fontSize":13,"fromId":null,"toId":null},
  {"type":"rect","x":320,"y":80,"width":160,"height":60,"fill":"#0a2520","stroke":"#22d3a0","strokeWidth":1.5,"label":"Post","fontSize":13,"fromId":null,"toId":null},
  {"type":"rect","x":560,"y":80,"width":160,"height":60,"fill":"#2a0f0f","stroke":"#f87171","strokeWidth":1.5,"label":"Comment","fontSize":13,"fromId":null,"toId":null},
  {"type":"rect","x":320,"y":240,"width":160,"height":60,"fill":"#0a1a30","stroke":"#3b82f6","strokeWidth":1.5,"label":"Tag","fontSize":13,"fromId":null,"toId":null},
  {"type":"arrow","x":240,"y":110,"width":80,"height":0,"fill":"#6c63ff","stroke":"#6c63ff","strokeWidth":1.5,"label":"","fontSize":13,"fromId":null,"toId":null,"fromIndex":0,"toIndex":1},
  {"type":"arrow","x":480,"y":110,"width":80,"height":0,"fill":"#22d3a0","stroke":"#22d3a0","strokeWidth":1.5,"label":"","fontSize":13,"fromId":null,"toId":null,"fromIndex":1,"toIndex":2},
  {"type":"arrow","x":400,"y":140,"width":0,"height":100,"fill":"#3b82f6","stroke":"#3b82f6","strokeWidth":1.5,"label":"","fontSize":13,"fromId":null,"toId":null,"fromIndex":1,"toIndex":3}
]

RULES:
- ALWAYS include a meaningful label on every rect and ellipse — never ""
- Labels must match the concept: "User", "Auth Service", "POST /api/login", etc.
- Arrows can have empty label ""
- Max 12 shapes total (including arrows)
- Output ONLY the JSON array, starting with [ and ending with ]`

/* ─── Extract JSON array from raw text ─────────────────────────── */
function extractArray(text) {
  const start = text.indexOf("[")
  const end   = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

/* ─── Parse and clean AI output ────────────────────────────────── */
function parseShapes(raw) {
  let cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim()
  const extracted = extractArray(cleaned)
  if (extracted) cleaned = extracted
  try {
    return JSON.parse(cleaned)
  } catch {
    console.error("❌ Cannot parse AI output:\n", raw.slice(0, 300))
    throw new Error("AI returned invalid JSON. Try a simpler prompt.")
  }
}

/* ─── Resolve SHAPE_INDEX references and assign nanoids ─────────── */
async function resolveShapes(rawShapes, userId) {
  // Separate nodes from arrows (process nodes first)
  const nodes  = rawShapes.filter(s => s.type !== "arrow")
  const arrows = rawShapes.filter(s => s.type === "arrow")

  // Assign IDs to nodes
  const nodeIds = []
  const nodeShapes = await Promise.all(
    nodes.map(async (s, idx) => {
      const id = await nanoid(10)
      nodeIds.push(id)
      return {
        id,
        type:        s.type        || "rect",
        x:           Number(s.x)   || 80 + idx * 200,
        y:           Number(s.y)   || 80,
        width:       Number(s.width)  || 160,
        height:      Number(s.height) || 60,
        fill:        s.fill        || "#1a1535",
        stroke:      s.stroke      || "#6c63ff",
        strokeWidth: Number(s.strokeWidth) || 1.5,
        label:       s.label       || `Node ${idx + 1}`,   // fallback label if AI forgot
        fontSize:    Number(s.fontSize) || 13,
        opacity:     1,
        rotation:    0,
        fromId:      null,
        toId:        null,
        createdBy:   userId,
        createdAt:   Date.now(),
      }
    })
  )

  // Build arrows using fromIndex/toIndex to look up nodeIds
  const arrowShapes = await Promise.all(
    arrows.map(async (s) => {
      const id = await nanoid(10)
      const fi = Number(s.fromIndex ?? s.fromId) || 0
      const ti = Number(s.toIndex  ?? s.toId)   || 0

      const sourceNode = nodeShapes[fi]
      const targetNode = nodeShapes[ti]

      // Compute actual pixel positions: center-right of source → center-left of target
      let x1, y1, x2, y2
      if (sourceNode && targetNode) {
        x1 = sourceNode.x + sourceNode.width         // right edge of source
        y1 = sourceNode.y + sourceNode.height / 2    // vertical center
        x2 = targetNode.x                            // left edge of target
        y2 = targetNode.y + targetNode.height / 2    // vertical center
      } else {
        // Fallback: use the x/y/width/height the AI gave
        x1 = Number(s.x) || 100
        y1 = Number(s.y) || 100
        x2 = x1 + (Number(s.width) || 80)
        y2 = y1 + (Number(s.height) || 0)
      }

      return {
        id,
        type:        "arrow",
        x:           x1,
        y:           y1,
        width:       0,
        height:      0,
        // points[] is how Konva Arrow renders — [startX,startY, endX,endY] in absolute coords
        points:      [x1, y1, x2, y2],
        fill:        s.stroke  || "#6c63ff",
        stroke:      s.stroke  || "#6c63ff",
        strokeWidth: Number(s.strokeWidth) || 1.5,
        label:       "",
        fontSize:    13,
        opacity:     1,
        rotation:    0,
        fromId:      nodeIds[fi] || null,
        toId:        nodeIds[ti] || null,
        createdBy:   userId,
        createdAt:   Date.now(),
      }
    })
  )

  return [...nodeShapes, ...arrowShapes]
}

/* ─── Validate ──────────────────────────────────────────────────── */
function validateShapes(shapes) {
  const VALID = new Set(["rect", "ellipse", "text", "arrow"])
  return shapes.filter(s => {
    if (!VALID.has(s.type))         return false
    if (typeof s.x !== "number")    return false
    if (typeof s.y !== "number")    return false
    if (s.x < 0 || s.y < 0)        return false
    return true
  })
}

/* ─── Main export ───────────────────────────────────────────────── */
const generateDiagram = async (prompt, userId = "system") => {
  if (!prompt || prompt.trim().length < 3) {
    throw new Error("Prompt is too short.")
  }

  const response = await groq.chat.completions.create({
    model:       "llama-3.3-70b-versatile",
    temperature: 0.3,           // lower = more predictable layout
    max_tokens:  1200,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: `Create a diagram for: ${prompt.trim()}` },
    ],
  })

  const raw = response.choices[0]?.message?.content || "[]"
  let parsed = []

  try {
    const obj = JSON.parse(raw)
    parsed = Array.isArray(obj) ? obj
      : obj?.shapes || obj?.nodes || obj?.elements || Object.values(obj || {})[0] || []
  } catch {
    try   { parsed = parseShapes(raw) }
    catch { console.error("❌ All parse attempts failed"); parsed = [] }
  }

  if (!Array.isArray(parsed)) parsed = []

  const resolved  = await resolveShapes(parsed, userId)
  const validated = validateShapes(resolved)

  if (validated.length === 0) {
    throw new Error("AI generated no valid shapes. Try a different prompt.")
  }

  return validated
}

module.exports = { generateDiagram, parseShapes, resolveShapes, validateShapes }