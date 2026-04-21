// server/src/services/ai.service.js
// ARCHITECTURE: LLM provides only node labels + connections (no coordinates).
// Server computes all pixel positions with deterministic math.
// This eliminates coordinate hallucination and arrow misalignment forever.
const nanoid = async (size = 10) => {
  const { nanoid } = await import("nanoid")
  return nanoid(size)
}
require("dotenv").config()

const Groq = require("groq-sdk")
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const LOGIC_PROMPT = `You are a diagram data extractor. Output ONLY valid JSON. No markdown, no backticks, no explanation.

Given a diagram description, return exactly this JSON structure:
{
  "diagramType": "flowchart" | "erd" | "architecture",
  "nodes": [
    { "id": 0, "label": "node name", "shape": "rect" | "ellipse" | "diamond", "color": "purple" | "teal" | "red" | "blue" | "yellow" }
  ],
  "edges": [
    { "from": 0, "to": 1, "label": "" }
  ]
}

RULES:
- node id = its 0-based index in nodes array (0, 1, 2, ...)
- edges "from" and "to" reference node ids
- For flowcharts: Start/End=ellipse, decisions=diamond, steps=rect
- For ERDs: all nodes=rect
- Max 10 nodes total
- Always include at least one edge

EXAMPLE for "user login flowchart":
{"diagramType":"flowchart","nodes":[{"id":0,"label":"Start","shape":"ellipse","color":"teal"},{"id":1,"label":"Enter Credentials","shape":"rect","color":"purple"},{"id":2,"label":"Validate","shape":"diamond","color":"blue"},{"id":3,"label":"Dashboard","shape":"rect","color":"teal"},{"id":4,"label":"Show Error","shape":"rect","color":"red"},{"id":5,"label":"End","shape":"ellipse","color":"red"}],"edges":[{"from":0,"to":1,"label":""},{"from":1,"to":2,"label":""},{"from":2,"to":3,"label":"Yes"},{"from":2,"to":4,"label":"No"},{"from":3,"to":5,"label":""},{"from":4,"to":1,"label":"Retry"}]}`

const COLORS = {
  purple: { fill: "#1a1535", stroke: "#6c63ff" },
  teal:   { fill: "#0a2520", stroke: "#22d3a0" },
  red:    { fill: "#2a0f0f", stroke: "#f87171" },
  blue:   { fill: "#0a1a30", stroke: "#3b82f6" },
  yellow: { fill: "#2a1a00", stroke: "#fbbf24" },
  orange: { fill: "#2a1500", stroke: "#fb923c" },
}

function nodeDims(shape) {
  if (shape === "ellipse")  return { w: 140, h: 50 }
  if (shape === "diamond")  return { w: 160, h: 70 }
  return { w: 160, h: 55 }
}

// ── Deterministic flowchart layout: traverse main path top-to-bottom ──
function layoutFlowchart(nodes, edges) {
  const out = {}
  edges.forEach(e => {
    if (!out[e.from]) out[e.from] = []
    out[e.from].push(e)
  })

  const positions = {}
  const placed    = new Set()

  // Walk main column: always pick the "Yes" edge or first edge at each step
  let y   = 60
  let cur = 0
  const mainPath = []

  while (cur !== undefined && !placed.has(cur) && cur < nodes.length) {
    placed.add(cur)
    mainPath.push(cur)
    const d = nodeDims(nodes[cur].shape)
    positions[cur] = { x: 80, y, w: d.w, h: d.h }
    y += d.h + 90

    const outs = out[cur] || []
    if (outs.length === 0) break
    if (nodes[cur].shape === "diamond" && outs.length > 1) {
      // Yes branch = main column, No branch = side column
      const yes = outs.find(e => /yes/i.test(e.label)) || outs[0]
      const no  = outs.find(e => e !== yes)
      if (no && !placed.has(no.to) && no.to < nodes.length) {
        const dp  = positions[cur]
        const nd  = nodeDims(nodes[no.to].shape)
        positions[no.to] = {
          x: dp.x + dp.w + 70,
          y: dp.y + (dp.h - nd.h) / 2,
          w: nd.w,
          h: nd.h,
        }
        placed.add(no.to)
      }
      cur = yes.to
    } else {
      cur = outs[0].to
    }
  }

  // Place any remaining unplaced nodes below the main column
  nodes.forEach((n, i) => {
    if (!placed.has(i)) {
      const d = nodeDims(n.shape)
      positions[i] = { x: 80, y, w: d.w, h: d.h }
      y += d.h + 90
    }
  })

  return positions
}

function layoutERD(nodes) {
  const positions = {}
  nodes.forEach((n, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    positions[i] = { x: 80 + col * 220, y: 80 + row * 140, w: 160, h: 60 }
  })
  return positions
}

function layoutArchitecture(nodes, edges) {
  const inDeg  = new Array(nodes.length).fill(0)
  edges.forEach(e => { if (e.to < nodes.length) inDeg[e.to]++ })

  const layerOf = new Array(nodes.length).fill(0)
  const queue   = nodes.map((_, i) => i).filter(i => inDeg[i] === 0)
  const visited = new Set(queue)

  while (queue.length) {
    const cur = queue.shift()
    ;(edges.filter(e => e.from === cur) || []).forEach(e => {
      if (e.to < nodes.length) {
        layerOf[e.to] = Math.max(layerOf[e.to], layerOf[cur] + 1)
        if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to) }
      }
    })
  }

  const layers = {}
  layerOf.forEach((l, i) => { (layers[l] = layers[l] || []).push(i) })

  const positions = {}
  Object.entries(layers).forEach(([l, ids]) => {
    const y = 80 + Number(l) * 160
    ids.forEach((nid, idx) => {
      positions[nid] = {
        x: 80 + idx * 210,
        y, w: 160, h: 55,
      }
    })
  })
  return positions
}

function arrowColor(label) {
  if (/yes/i.test(label))  return "#22d3a0"
  if (/no/i.test(label))   return "#f87171"
  return "#6c63ff"
}

function edgeEndpoints(src, tgt) {
  const srcCx = src.x + src.w / 2, srcCy = src.y + src.h / 2
  const tgtCx = tgt.x + tgt.w / 2, tgtCy = tgt.y + tgt.h / 2
  const dx = tgtCx - srcCx, dy = tgtCy - srcCy

  let x1, y1, x2, y2
  if (Math.abs(dx) >= Math.abs(dy)) {
    x1 = dx > 0 ? src.x + src.w : src.x;  y1 = srcCy
    x2 = dx > 0 ? tgt.x         : tgt.x + tgt.w; y2 = tgtCy
  } else {
    y1 = dy > 0 ? src.y + src.h : src.y;  x1 = srcCx
    y2 = dy > 0 ? tgt.y         : tgt.y + tgt.h; x2 = tgtCx
  }
  return { x1, y1, x2, y2 }
}

function parseJSON(raw) {
  let s = raw.replace(/```json/g, "").replace(/```/g, "").trim()
  const si = s.indexOf("{"), ei = s.lastIndexOf("}")
  if (si !== -1 && ei !== -1) s = s.slice(si, ei + 1)
  return JSON.parse(s)
}

const generateDiagram = async (prompt, userId = "system") => {
  if (!prompt || prompt.trim().length < 3) throw new Error("Prompt too short.")

  const resp = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.1,
    max_tokens:  600,
    messages: [
      { role: "system", content: LOGIC_PROMPT },
      { role: "user",   content: prompt.trim() },
    ],
  })

  const raw = resp.choices[0]?.message?.content || "{}"
  let graph
  try { graph = parseJSON(raw) }
  catch { throw new Error("AI returned invalid JSON. Try a simpler prompt.") }

  const { nodes = [], edges = [], diagramType = "flowchart" } = graph
  if (nodes.length === 0) throw new Error("AI returned no nodes.")

  // Compute positions
  let positions
  if (diagramType === "erd")          positions = layoutERD(nodes)
  else if (diagramType === "architecture") positions = layoutArchitecture(nodes, edges)
  else                                     positions = layoutFlowchart(nodes, edges)

  // Build node shapes
  const nodeShapes = []
  for (let i = 0; i < nodes.length; i++) {
    const n   = nodes[i]
    const pos = positions[i] || { x: 80 + (i % 3) * 210, y: 80 + Math.floor(i / 3) * 140, w: 160, h: 55 }
    const c   = COLORS[n.color] || COLORS.purple
    nodeShapes.push({
      id:          await nanoid(),
      type:        n.shape === "diamond" ? "diamond" : (n.shape || "rect"),
      x:           pos.x,
      y:           pos.y,
      width:       pos.w,
      height:      pos.h,
      fill:        c.fill,
      stroke:      c.stroke,
      strokeWidth: 2,
      label:       n.label || `Node ${i}`,
      fontSize:    13,
      opacity:     1,
      rotation:    0,
      createdBy:   userId,
      createdAt:   Date.now(),
    })
  }

  // Build arrow shapes
  const arrowShapes = []
  for (const e of edges) {
    if (e.from >= nodeShapes.length || e.to >= nodeShapes.length) continue
    const src = positions[e.from]
    const tgt = positions[e.to]
    if (!src || !tgt) continue

    const { x1, y1, x2, y2 } = edgeEndpoints(src, tgt)
    const color = arrowColor(e.label || "")

    arrowShapes.push({
      id:          await nanoid(),
      type:        "arrow",
      x:           x1, y: y1,
      width:       0,  height: 0,
      points:      [x1, y1, x2, y2],
      fill:        color,
      stroke:      color,
      strokeWidth: 1.5,
      label:       e.label || "",
      fontSize:    11,
      opacity:     1,
      rotation:    0,
      createdBy:   userId,
      createdAt:   Date.now(),
    })
  }

  return [...nodeShapes, ...arrowShapes]
}

module.exports = { generateDiagram }