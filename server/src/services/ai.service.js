// server/src/services/ai.service.js
const nanoid = async (size = 12) => {
  const { nanoid } = await import("nanoid")
  return nanoid(size)
}
require("dotenv").config()

const Groq = require("groq-sdk")
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// ── System prompt: forces proper diagram layout with arrows connecting shapes ──
const SYSTEM_PROMPT = `You are a diagram layout engine. Output ONLY a valid JSON array. No text, no markdown, no backticks, no explanation.

CRITICAL RULES:
1. Every non-arrow shape MUST have a non-empty "label"
2. Arrows MUST use "fromIndex" and "toIndex" integers (0-based index into this array, counting only non-arrow shapes)
3. Use "ellipse" for Start/End nodes in flowcharts
4. Shapes must be spaced so they don't overlap — minimum 40px gap between shapes
5. Output starts with [ and ends with ]

SHAPE SCHEMA (all fields required):
{
  "type":        "rect" | "ellipse" | "diamond" | "text",
  "x":           number,
  "y":           number,
  "width":       number (min 120 for rect, 100 for ellipse),
  "height":      number (min 50),
  "fill":        string (hex, use dark fills),
  "stroke":      string (hex, bright),
  "strokeWidth": 2,
  "label":       string (REQUIRED for non-arrows, describe the node),
  "fontSize":    14
}

ARROW SCHEMA (separate entries, placed AFTER all shapes):
{
  "type":       "arrow",
  "fromIndex":  number (index of source shape in this array),
  "toIndex":    number (index of target shape in this array),
  "label":      "",
  "stroke":     "#6c63ff",
  "fill":       "#6c63ff",
  "strokeWidth": 1.5
}

LAYOUT RULES (STRICT):

FLOWCHARTS — always top-to-bottom vertical layout:
- x=80 for all shapes (single column down the left)
- y starts at 60, each next shape y += height + 100
- Start/End = ellipse (width=140, height=50)
- Process steps = rect (width=160, height=55)
- Decisions = diamond (width=160, height=70), branch goes to x=300 same y
- Arrows go straight down (fromIndex n → toIndex n+1), branch arrows go sideways

ERDs — grid layout:
- 3 columns: x=60, x=280, x=500
- Rows spaced 140px apart, y starts at 60
- All tables = rect (width=160, height=60)

SYSTEM ARCHITECTURE — layered top-to-bottom:
- Row 1 (clients): y=60
- Row 2 (API/gateway): y=200
- Row 3 (services): y=340, spaced 200px apart horizontally
- Row 4 (databases): y=480

COLOR RULES:
- Purple nodes:  fill="#1a1535" stroke="#6c63ff"
- Teal nodes:    fill="#0a2520" stroke="#22d3a0"
- Red nodes:     fill="#2a0f0f" stroke="#f87171"
- Blue nodes:    fill="#0a1a30" stroke="#3b82f6"
- Yellow nodes:  fill="#2a1a00" stroke="#fbbf24"
- Orange nodes:  fill="#2a1500" stroke="#fb923c"
- Arrows:        stroke="#6c63ff" fill="#6c63ff"

EXAMPLE — "ATM withdrawal flowchart" — follow this EXACT coordinate pattern:
[
  {"type":"ellipse","x":80,"y":60,"width":140,"height":50,"fill":"#0a2520","stroke":"#22d3a0","strokeWidth":2,"label":"Start","fontSize":14},
  {"type":"rect","x":80,"y":170,"width":160,"height":55,"fill":"#1a1535","stroke":"#6c63ff","strokeWidth":2,"label":"Insert Card","fontSize":14},
  {"type":"rect","x":80,"y":285,"width":160,"height":55,"fill":"#1a1535","stroke":"#6c63ff","strokeWidth":2,"label":"Enter PIN","fontSize":14},
  {"type":"diamond","x":80,"y":400,"width":160,"height":70,"fill":"#0a1a30","stroke":"#3b82f6","strokeWidth":2,"label":"PIN Valid?","fontSize":14},
  {"type":"rect","x":300,"y":415,"width":150,"height":55,"fill":"#2a0f0f","stroke":"#f87171","strokeWidth":2,"label":"Invalid PIN","fontSize":14},
  {"type":"rect","x":80,"y":530,"width":160,"height":55,"fill":"#1a1535","stroke":"#6c63ff","strokeWidth":2,"label":"Enter Amount","fontSize":14},
  {"type":"ellipse","x":80,"y":645,"width":140,"height":50,"fill":"#2a0f0f","stroke":"#f87171","strokeWidth":2,"label":"End","fontSize":14},
  {"type":"arrow","fromIndex":0,"toIndex":1,"label":"","stroke":"#22d3a0","fill":"#22d3a0","strokeWidth":1.5},
  {"type":"arrow","fromIndex":1,"toIndex":2,"label":"","stroke":"#6c63ff","fill":"#6c63ff","strokeWidth":1.5},
  {"type":"arrow","fromIndex":2,"toIndex":3,"label":"","stroke":"#6c63ff","fill":"#6c63ff","strokeWidth":1.5},
  {"type":"arrow","fromIndex":3,"toIndex":4,"label":"No","stroke":"#f87171","fill":"#f87171","strokeWidth":1.5},
  {"type":"arrow","fromIndex":3,"toIndex":5,"label":"Yes","stroke":"#22d3a0","fill":"#22d3a0","strokeWidth":1.5},
  {"type":"arrow","fromIndex":5,"toIndex":6,"label":"","stroke":"#6c63ff","fill":"#6c63ff","strokeWidth":1.5}
]`

function extractArray(text) {
  const start = text.indexOf("[")
  const end   = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function parseShapes(raw) {
  let cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim()
  const extracted = extractArray(cleaned)
  if (extracted) cleaned = extracted
  try {
    return JSON.parse(cleaned)
  } catch {
    console.error("❌ AI parse failed. Raw:\n", raw.slice(0, 400))
    throw new Error("AI returned invalid JSON. Try a simpler prompt.")
  }
}

// ── Build final shape list with real IDs and computed arrow positions ──
// CRITICAL: Use sequential loop (not Promise.all) so nodeMap index order is guaranteed.
async function resolveShapes(rawShapes, userId) {
  const nonArrows = rawShapes.filter(s => s.type !== "arrow")
  const arrows    = rawShapes.filter(s => s.type === "arrow")

  // Assign IDs to all non-arrow shapes SEQUENTIALLY so nodeMap[i] = shape[i] always
  const nodeMap = []  // index → { id, shape }
  const nodes   = []

  for (let idx = 0; idx < nonArrows.length; idx++) {
    const s  = nonArrows[idx]
    const id = await nanoid(10)
    const shape = {
      id,
      type:        s.type || "rect",
      x:           Number(s.x) || (80 + (idx % 3) * 220),
      y:           Number(s.y) || (80 + Math.floor(idx / 3) * 150),
      width:       Number(s.width)  || 150,
      height:      Number(s.height) || 60,
      fill:        s.fill   || "#1a1535",
      stroke:      s.stroke || "#6c63ff",
      strokeWidth: Number(s.strokeWidth) || 2,
      label:       s.label  || `Node ${idx + 1}`,
      fontSize:    Number(s.fontSize) || 14,
      opacity:     1,
      rotation:    0,
      createdBy:   userId,
      createdAt:   Date.now(),
    }
    nodeMap[idx] = { id, shape }  // explicit index assignment — never out of order
    nodes.push(shape)
  }

  // Build arrows using fromIndex/toIndex → compute real pixel endpoints (sequential)
  const arrowShapes = []
  for (const s of arrows) {
      const id = await nanoid(10)
      const fi = Number(s.fromIndex ?? s.from ?? 0)
      const ti = Number(s.toIndex   ?? s.to   ?? 1)

      const src = nodeMap[fi]?.shape
      const tgt = nodeMap[ti]?.shape

      // Compute edge-to-edge arrow endpoints.
      // src.x/y is TOP-LEFT corner. Centers are (x + w/2, y + h/2).
      let x1, y1, x2, y2
      if (src && tgt) {
        const srcCx = src.x + src.width  / 2
        const srcCy = src.y + src.height / 2
        const tgtCx = tgt.x + tgt.width  / 2
        const tgtCy = tgt.y + tgt.height / 2

        const dx = tgtCx - srcCx
        const dy = tgtCy - srcCy

        // Choose the dominant direction (horizontal vs vertical)
        // to pick the best edge to exit/enter from
        if (Math.abs(dx) >= Math.abs(dy)) {
          // Horizontal dominant: exit right/left edge
          if (dx >= 0) {
            x1 = src.x + src.width   // exit right edge of source
            x2 = tgt.x               // enter left edge of target
          } else {
            x1 = src.x               // exit left edge of source
            x2 = tgt.x + tgt.width   // enter right edge of target
          }
          y1 = srcCy
          y2 = tgtCy
        } else {
          // Vertical dominant: exit bottom/top edge
          if (dy >= 0) {
            y1 = src.y + src.height  // exit bottom edge of source
            y2 = tgt.y               // enter top edge of target
          } else {
            y1 = src.y               // exit top edge of source
            y2 = tgt.y + tgt.height  // enter bottom edge of target
          }
          x1 = srcCx
          x2 = tgtCx
        }
      } else {
        x1 = 100; y1 = 100; x2 = 200; y2 = 100
      }

      arrowShapes.push({
        id,
        type:        "arrow",
        x:           x1,
        y:           y1,
        width:       0,
        height:      0,
        points:      [x1, y1, x2, y2],
        fill:        s.stroke || "#6c63ff",
        stroke:      s.stroke || "#6c63ff",
        strokeWidth: Number(s.strokeWidth) || 1.5,
        label:       s.label || "",
        fontSize:    13,
        opacity:     1,
        rotation:    0,
        fromId:      nodeMap[fi]?.id || null,
        toId:        nodeMap[ti]?.id || null,
        createdBy:   userId,
        createdAt:   Date.now(),
      })
  }

  return [...nodes, ...arrowShapes]
}

function validateShapes(shapes) {
  const VALID = new Set(["rect", "ellipse", "text", "arrow", "diamond"])
  return shapes.filter(s =>
    VALID.has(s.type) &&
    typeof s.x === "number" &&
    typeof s.y === "number"
  )
}

const generateDiagram = async (prompt, userId = "system") => {
  if (!prompt || prompt.trim().length < 3) throw new Error("Prompt is too short.")

  const response = await groq.chat.completions.create({
    model:       "llama-3.3-70b-versatile",
    temperature: 0.2,
    max_tokens:  1400,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: `Create a diagram: ${prompt.trim()}` },
    ],
  })

  const raw = response.choices[0]?.message?.content || "[]"
  let parsed = []

  try {
    const obj = JSON.parse(raw)
    parsed = Array.isArray(obj) ? obj
      : obj?.shapes || obj?.nodes || Object.values(obj || {})[0] || []
  } catch {
    try { parsed = parseShapes(raw) } catch { parsed = [] }
  }

  if (!Array.isArray(parsed)) parsed = []

  const resolved  = await resolveShapes(parsed, userId)
  const validated = validateShapes(resolved)

  if (validated.length === 0) throw new Error("AI generated no valid shapes. Try a different prompt.")
  return validated
}

module.exports = { generateDiagram, parseShapes, resolveShapes, validateShapes }