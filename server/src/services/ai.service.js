// server/src/services/ai.service.js
const OpenAI = require("openai")
const nanoid = async (size = 12) => {
  const { nanoid } = await import('nanoid')
  return nanoid(size)
}
require("dotenv").config()

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/* ─── System prompt ─────────────────────────────────────────────────
   Tells the model to return ONLY a JSON array of shape objects.
   The frontend renders these directly onto the Konva canvas.     */
const SYSTEM_PROMPT = `You are a diagram layout engine for a collaborative whiteboard.
Your ONLY job is to convert a user's description into a JSON array of canvas shapes.

STRICT OUTPUT RULES:
- Return ONLY a valid JSON array. No markdown, no explanation, no backticks.
- The response must be directly parseable with JSON.parse().
- Start with [ and end with ].

SHAPE SCHEMA — every shape must have these exact fields:
{
  "type":        "rect" | "ellipse" | "text" | "arrow" | "path",
  "x":           number,   // top-left x position in pixels
  "y":           number,   // top-left y position in pixels
  "width":       number,   // in pixels (min 80)
  "height":      number,   // in pixels (min 40)
  "fill":        string,   // hex color e.g. "#1a1a2e"
  "stroke":      string,   // hex color e.g. "#7f77dd"
  "strokeWidth": number,   // 1 or 2
  "label":       string,   // text to display inside the shape (can be empty "")
  "fontSize":    number,   // 12–16
  "fromId":      string | null,  // for arrows: id of source shape
  "toId":        string | null   // for arrows: id of target shape
}

LAYOUT RULES:
- Canvas starts at x=50, y=50
- Space nodes at least 40px apart
- Max canvas width: 900px, max height: 700px
- For ERDs: tables are rects (width=160, height=auto), attributes as text inside
- For flowcharts: decisions are ellipses, steps are rects
- For system diagrams: services are rects, databases are ellipses
- Arrows connect shapes using fromId/toId referencing other shapes' positions
- Use a cohesive dark color palette: dark fills (#1a1a2e, #16213e, #0f3460) with bright strokes (#7f77dd, #00ff9d, #3b82f6, #f87171)
- Keep diagrams clean — max 12 shapes

ARROW RULE:
For arrows, set x/y to the midpoint between source and target.
Set fromId and toId to "SHAPE_INDEX_0", "SHAPE_INDEX_1" etc. — 
the server will replace these with actual nanoids after parsing.

EXAMPLES of valid prompts and what to generate:
- "ERD for a blog" → User, Post, Comment, Tag tables with arrows
- "microservices for e-commerce" → API Gateway, Auth Service, Product Service, Order Service, DB nodes
- "flowchart for user login" → Start → Enter credentials → Validate → Success/Fail branches
- "system architecture for a chat app" → Client, Load Balancer, WS Server, Redis, MongoDB`

/* ─── Parse AI response safely ──────────────────────────────────── */
function parseShapes(raw) {
  const cleaned = raw
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim()

  let shapes
  try {
    shapes = JSON.parse(cleaned)
  } catch {
    throw new Error("AI returned invalid JSON. Try a simpler prompt.")
  }

  if (!Array.isArray(shapes)) {
    throw new Error("AI returned unexpected format — expected an array.")
  }

  return shapes
}

/* ─── Assign real nanoids and resolve arrow references ──────────── */
async function resolveShapes(rawShapes, userId) {
  const idMap = {}

  // First pass — assign IDs
  const shapes = await Promise.all(
    rawShapes.map(async (s, idx) => {
      const id = await nanoid(12)

      idMap[`SHAPE_INDEX_${idx}`] = id

      return {
        id,
        type:        s.type        || "rect",
        x:           s.x           ?? 100 + idx * 20,
        y:           s.y           ?? 100,
        width:       s.width       ?? 160,
        height:      s.height      ?? 60,
        fill:        s.fill        || "#1a1a2e",
        stroke:      s.stroke      || "#7f77dd",
        strokeWidth: s.strokeWidth ?? 1.5,
        label:       s.label       || "",
        fontSize:    s.fontSize    ?? 13,
        opacity:     1,
        rotation:    0,
        fromId:      s.fromId      || null,
        toId:        s.toId        || null,
        createdBy:   userId,
        createdAt:   Date.now(),
      }
    })
  )

  // Second pass — resolve arrows
  shapes.forEach(shape => {
    if (shape.fromId && idMap[shape.fromId]) shape.fromId = idMap[shape.fromId]
    if (shape.toId && idMap[shape.toId]) shape.toId = idMap[shape.toId]
  })

  return shapes
}

/* ─── Validate shapes — remove anything malformed ───────────────── */
function validateShapes(shapes) {
  const VALID_TYPES = new Set(["rect", "ellipse", "text", "arrow", "path"])
  return shapes.filter(s => {
    if (!VALID_TYPES.has(s.type)) return false
    if (typeof s.x !== "number" || typeof s.y !== "number") return false
    if (s.x < 0 || s.y < 0) return false
    return true
  })
}

/* ─── Main export — called from ai.handler.js ───────────────────── */
const generateDiagram = async (prompt, userId = "system") => {
  if (!prompt || prompt.trim().length < 3) {
    throw new Error("Prompt is too short.")
  }

  const response = await openai.chat.completions.create({
    model:           "gpt-4o",
    max_tokens:      2000,
    temperature:     0.4,     // low temp = more predictable layouts
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: `Generate a diagram for: ${prompt.trim()}` },
    ],
  })

  const raw = response.choices[0]?.message?.content || "[]"

  // Handle case where model wraps array in an object { "shapes": [...] }
  let parsed
  try {
    const obj = JSON.parse(raw)
    parsed = Array.isArray(obj)
      ? obj
      : obj.shapes || obj.nodes || obj.elements || Object.values(obj)[0] || []
  } catch {
    parsed = parseShapes(raw)
  }

  const resolved = await resolveShapes(parsed, userId)
  const validated = validateShapes(resolved)

  if (validated.length === 0) {
    throw new Error("AI generated no valid shapes. Please try a different prompt.")
  }

  return validated
}

module.exports = {  parseShapes, resolveShapes, validateShapes,generateDiagram }