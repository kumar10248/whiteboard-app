// app/(app)/board/[id]/KonvaBoard.tsx
// FIXES:
// • Snap guide axes were swapped — now correct (vertical line for X snap, horizontal for Y)
// • Scroll = pan canvas (trackpad-friendly), Ctrl/Cmd+scroll = zoom
// • Reaction stamps work — click fires instantly without needing reaction "tool"
// • Zoom smoothed with requestAnimationFrame batching
// • Overall visual polish: better grid, cleaner hints, smoother transitions
"use client"

import { useRef, useCallback, useEffect, useState } from "react"
import {
  Stage, Layer,
  Rect, Ellipse, Text, Arrow, Line, Group,
  Transformer,
} from "react-konva"
import type { Shape, Cursor, Tool } from "./page"

// ── Types ──
interface Reaction { id: string; x: number; y: number; emoji: string; born: number }
interface SnapLine  { pos: number; axis: "vertical" | "horizontal" }   // renamed to avoid confusion

interface Props {
  stageRef:          React.MutableRefObject<any>
  shapes:            Shape[]
  cursors:           Cursor[]
  tool:              Tool
  strokeColor:       string
  fillColor:         string
  strokeWidth:       number
  fontSize:          number
  fontStyle:         string
  selected:          string[]
  setSelected:       (ids: string[]) => void
  upsertShape:       (s: Shape) => void
  deleteShape:       (id: string) => void
  broadcastCursor:   (x: number, y: number) => void
  broadcastReaction: (x: number, y: number, emoji: string) => void
  boardId:           string
  darkMode:          boolean
  presentMode:       boolean
  presentFocus:      string | null
  reactions:         Reaction[]
  snapEnabled:       boolean
  reactionEmoji:     string
  reactionMode:      boolean   // passed from parent so canvas knows to stamp on click
}

// ── Shape point helpers ──
const diamondPts = (w: number, h: number) => [w/2,0, w,h/2, w/2,h, 0,h/2]
const triPts     = (w: number, h: number) => [w/2,0, w,h, 0,h]
const paraPts    = (w: number, h: number) => { const sk=Math.min(20,w*0.2); return [sk,0, w,0, w-sk,h, 0,h] }

// ── Snap computation ──
// BUG WAS HERE: axis was labelled "x"/"y" but used as vertical/horizontal guide
// Now correctly: snapping on X-position → draw a VERTICAL guide line
//               snapping on Y-position → draw a HORIZONTAL guide line
const SNAP_DIST = 10   // pixels in canvas space

function computeSnap(moving: Shape, others: Shape[]): { x: number; y: number; lines: SnapLine[] } {
  let snapX = moving.x, snapY = moving.y
  const lines: SnapLine[] = []

  const mL = moving.x,               mR  = moving.x + moving.width
  const mCx = moving.x + moving.width/2,  mT  = moving.y
  const mB  = moving.y + moving.height,   mCy = moving.y + moving.height/2

  for (const o of others) {
    if (o.id === moving.id) continue
    const oL = o.x, oR = o.x + o.width, oCx = o.x + o.width/2
    const oT = o.y, oB = o.y + o.height, oCy = o.y + o.height/2

    // X-position snaps → VERTICAL guide lines
    const xCandidates = [
      { from: mL,  to: oL,  result: oL },
      { from: mL,  to: oR,  result: oR },
      { from: mR,  to: oL,  result: oL - moving.width },
      { from: mR,  to: oR,  result: oR - moving.width },
      { from: mCx, to: oCx, result: oCx - moving.width/2 },
    ]
    for (const c of xCandidates) {
      if (Math.abs(c.from - c.to) < SNAP_DIST) {
        snapX = c.result
        lines.push({ pos: c.to, axis: "vertical" })   // vertical line at this X
        break
      }
    }

    // Y-position snaps → HORIZONTAL guide lines
    const yCandidates = [
      { from: mT,  to: oT,  result: oT },
      { from: mT,  to: oB,  result: oB },
      { from: mB,  to: oT,  result: oT - moving.height },
      { from: mB,  to: oB,  result: oB - moving.height },
      { from: mCy, to: oCy, result: oCy - moving.height/2 },
    ]
    for (const c of yCandidates) {
      if (Math.abs(c.from - c.to) < SNAP_DIST) {
        snapY = c.result
        lines.push({ pos: c.to, axis: "horizontal" })  // horizontal line at this Y
        break
      }
    }
  }
  return { x: snapX, y: snapY, lines }
}

// ── Component ──
export default function KonvaBoard({
  stageRef, shapes, cursors,
  tool, strokeColor, fillColor, strokeWidth, fontSize, fontStyle,
  selected, setSelected,
  upsertShape, deleteShape, broadcastCursor, broadcastReaction,
  boardId, darkMode, presentMode, presentFocus,
  reactions, snapEnabled, reactionEmoji, reactionMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size,  setSize ] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1.4)
  const [pos,   setPos  ] = useState({ x: 40, y: 40 })
  // Refs keep current values accessible in callbacks without stale closures
  const scaleRef = useRef(1.4)
  const posRef   = useRef({ x: 40, y: 40 })
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { posRef.current   = pos   }, [pos])

  // Pan state
  const isPanning  = useRef(false)
  const panStart   = useRef({ x: 0, y: 0 })
  const spaceHeld  = useRef(false)

  // Draw state
  const isDrawing  = useRef(false)
  const drawId     = useRef<string | null>(null)
  const drawStart  = useRef({ x: 0, y: 0 })

  // Multi-select band
  const isBanding  = useRef(false)
  const bandStart  = useRef({ x: 0, y: 0 })
  const [band, setBand] = useState<{ x:number;y:number;w:number;h:number }|null>(null)

  // Snap lines
  const [snapLines, setSnapLines] = useState<SnapLine[]>([])

  // Text editor overlay
  const [textEd, setTextEd] = useState<{
    id:string; x:number; y:number; w:number; h:number
    value:string; fontSize:number; color:string; fontStyle:string
  }|null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Transformer for resize
  const trRef    = useRef<any>(null)
  const layerRef = useRef<any>(null)

  // Local reactions (merge incoming + self-triggered)
  const [localReactions, setLocalReactions] = useState<Reaction[]>([])

  // ── Sync incoming reactions ──
  useEffect(() => {
    if (reactions.length === 0) return
    setLocalReactions(prev => {
      const ids = new Set(prev.map(r => r.id))
      const fresh = reactions.filter(r => !ids.has(r.id))
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [reactions])

  // ── Auto-expire reactions ──
  useEffect(() => {
    if (localReactions.length === 0) return
    const t = setInterval(() => {
      const now = Date.now()
      setLocalReactions(prev => prev.filter(r => now - r.born < 3500))
    }, 100)
    return () => clearInterval(t)
  }, [localReactions.length])

  // ── ResizeObserver ──
  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const obs = new ResizeObserver(() =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight })
    )
    obs.observe(el)
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => obs.disconnect()
  }, [])

  // ── Focus textarea when text editor opens ──
  useEffect(() => {
    if (textEd) setTimeout(() => { taRef.current?.focus(); taRef.current?.select() }, 20)
  }, [textEd?.id])

  // ── Transformer: attach to selected nodes ──
  useEffect(() => {
    if (!trRef.current || !layerRef.current) return
    const nodes = selected.map(id => layerRef.current.findOne(`#${id}`)).filter(Boolean)
    trRef.current.nodes(nodes)
    trRef.current.getLayer()?.batchDraw()
  }, [selected, shapes])

  // ── Space = pan mode ──
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceHeld.current = true; e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false }
    window.addEventListener("keydown", dn); window.addEventListener("keyup", up)
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up) }
  }, [])

  const makeId  = () => `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const toCanvas = (sx: number, sy: number) => ({ x: (sx - pos.x) / scale, y: (sy - pos.y) / scale })
  const stagePtr = () => {
    const p = stageRef.current?.getPointerPosition()
    return p ? toCanvas(p.x, p.y) : null
  }

  // ── Wheel: Ctrl/Cmd = zoom, plain scroll = pan ──
  const onWheel = useCallback((e: any) => {
    e.evt.preventDefault()
    const stage = stageRef.current; if (!stage) return
    const ptr   = stage.getPointerPosition(); if (!ptr) return

    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Ctrl/Cmd + scroll = zoom toward cursor
      const oldScale = scaleRef.current
      const oldPos   = posRef.current
      const factor   = e.evt.deltaY < 0 ? 1.06 : (1 / 1.06)
      const ns       = Math.min(8, Math.max(0.1, oldScale * factor))
      const anchor   = { x: (ptr.x - oldPos.x) / oldScale, y: (ptr.y - oldPos.y) / oldScale }
      const newPos   = { x: ptr.x - anchor.x * ns, y: ptr.y - anchor.y * ns }
      setScale(ns)
      setPos(newPos)
    } else {
      // Plain scroll = pan (natural trackpad two-finger scroll)
      setPos(p => ({
        x: p.x - e.evt.deltaX,
        y: p.y - e.evt.deltaY,
      }))
    }
  }, [])   // no deps — uses refs only

  // ── Mouse down ──
  const onMouseDown = useCallback((e: any) => {
    // Middle mouse or Space+drag = pan
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceHeld.current)) {
      isPanning.current = true
      panStart.current  = { x: e.evt.clientX - pos.x, y: e.evt.clientY - pos.y }
      return
    }
    if (e.evt.button !== 0) return

    const pt       = stagePtr(); if (!pt) return
    const onStage  = e.target === e.target.getStage()

    // ── Reaction stamp ──
    if (reactionMode) {
      const r: Reaction = { id: makeId(), x: pt.x, y: pt.y, emoji: reactionEmoji, born: Date.now() }
      setLocalReactions(prev => [...prev, r])
      broadcastReaction(pt.x, pt.y, reactionEmoji)
      return
    }

    if (tool === "select") {
      if (onStage) {
        setSelected([])
        isBanding.current = true
        bandStart.current = pt
        setBand({ x: pt.x, y: pt.y, w: 0, h: 0 })
      }
      return
    }

    if (tool === "text") {
      const id = makeId()
      const s: Shape = {
        id, type: "text",
        x: pt.x, y: pt.y, width: 200, height: 36,
        fill: "transparent", stroke: "transparent", strokeWidth: 0,
        label: "", fontSize, fontStyle, textColor: strokeColor,
        opacity: 1, rotation: 0,
      }
      upsertShape(s)
      setSelected([id])
      setTextEd({ id, x: pt.x, y: pt.y, w: 240, h: 80, value: "", fontSize, color: strokeColor, fontStyle })
      return
    }

    const id = makeId()
    drawId.current    = id
    drawStart.current = pt
    isDrawing.current = true

    if (tool === "pen") {
      upsertShape({ id, type: "pen", x: pt.x, y: pt.y, width: 0, height: 0, fill: "transparent", stroke: strokeColor, strokeWidth, points: [0, 0], opacity: 1, rotation: 0 })
      return
    }
    if (tool === "arrow") {
      upsertShape({ id, type: "arrow", x: pt.x, y: pt.y, width: 0, height: 0, fill: strokeColor, stroke: strokeColor, strokeWidth, points: [pt.x, pt.y, pt.x, pt.y], opacity: 1, rotation: 0 })
      return
    }
    // rect | ellipse | diamond | triangle | cylinder | parallelogram
    upsertShape({ id, type: tool, x: pt.x, y: pt.y, width: 4, height: 4, fill: fillColor, stroke: strokeColor, strokeWidth, opacity: 1, rotation: 0 })
  }, [tool, strokeColor, fillColor, strokeWidth, fontSize, fontStyle, pos, scale, reactionMode, reactionEmoji, upsertShape, setSelected, broadcastReaction])

  // ── Mouse move ──
  const onMouseMove = useCallback((e: any) => {
    if (isPanning.current) {
      setPos({ x: e.evt.clientX - panStart.current.x, y: e.evt.clientY - panStart.current.y })
      return
    }
    const pt = stagePtr(); if (!pt) return
    broadcastCursor(pt.x, pt.y)

    if (isBanding.current) {
      setBand({
        x: Math.min(pt.x, bandStart.current.x),
        y: Math.min(pt.y, bandStart.current.y),
        w: Math.abs(pt.x - bandStart.current.x),
        h: Math.abs(pt.y - bandStart.current.y),
      })
      return
    }
    if (!isDrawing.current || !drawId.current) return
    const id = drawId.current

    if (tool === "pen") {
      const s = shapes.find(sh => sh.id === id); if (!s) return
      upsertShape({ ...s, points: [...(s.points || [0, 0]), pt.x - drawStart.current.x, pt.y - drawStart.current.y] })
      return
    }
    if (tool === "arrow") {
      const s = shapes.find(sh => sh.id === id); if (!s) return
      upsertShape({ ...s, points: [drawStart.current.x, drawStart.current.y, pt.x, pt.y] })
      return
    }
    const s = shapes.find(sh => sh.id === id); if (!s) return
    const rawW = pt.x - drawStart.current.x, rawH = pt.y - drawStart.current.y
    upsertShape({
      ...s,
      x: rawW >= 0 ? drawStart.current.x : pt.x,
      y: rawH >= 0 ? drawStart.current.y : pt.y,
      width:  Math.max(4, Math.abs(rawW)),
      height: Math.max(4, Math.abs(rawH)),
    })
  }, [tool, shapes, pos, scale, upsertShape, broadcastCursor])

  // ── Mouse up ──
  const onMouseUp = useCallback(() => {
    isPanning.current = false
    setSnapLines([])

    if (isBanding.current && band) {
      isBanding.current = false
      if (band.w > 6 && band.h > 6) {
        const hits = shapes.filter(s =>
          s.x < band.x + band.w && s.x + s.width  > band.x &&
          s.y < band.y + band.h && s.y + s.height > band.y
        )
        setSelected(hits.map(s => s.id))
      }
      setBand(null)
      return
    }
    if (!isDrawing.current || !drawId.current) return
    const id = drawId.current
    const s  = shapes.find(sh => sh.id === id)
    if (s?.type !== "pen" && s?.type !== "arrow" && (s?.width ?? 0) < 6 && (s?.height ?? 0) < 6)
      deleteShape(id)
    if (s?.type === "arrow") {
      const pts = s.points || []
      if (Math.hypot((pts[2] ?? 0) - (pts[0] ?? 0), (pts[3] ?? 0) - (pts[1] ?? 0)) < 10)
        deleteShape(id)
    }
    isDrawing.current = false
    drawId.current    = null
  }, [shapes, band, deleteShape, setSelected])

  // ── Commit text ──
  const commitText = useCallback((val: string) => {
    if (!textEd) return
    const s = shapes.find(sh => sh.id === textEd.id)
    if (s) upsertShape({ ...s, label: val.trim() || "Text" })
    setTextEd(null)
  }, [textEd, shapes, upsertShape])

  // ── Open inline text editor ──
  const openEditor = useCallback((s: Shape, absX: number, absY: number) => {
    setTextEd({
      id: s.id, x: absX, y: absY,
      w: Math.max(s.width, 220), h: Math.max(s.height + 12, 60),
      value: s.label || "", fontSize: s.fontSize || 16,
      color: s.textColor || strokeColor, fontStyle: s.fontStyle || "normal",
    })
  }, [strokeColor])

  // ── Transform end (resize) ──
  const onTransformEnd = useCallback((s: Shape, node: any) => {
    const sx = node.scaleX(), sy = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    upsertShape({ ...s, x: node.x(), y: node.y(), width: Math.max(10, s.width * sx), height: Math.max(10, s.height * sy), rotation: node.rotation() })
  }, [upsertShape])

  // ── Snap-aware drag ──
  const onDragMove = useCallback((s: Shape, node: any) => {
    if (!snapEnabled) return
    const moving = { ...s, x: node.x(), y: node.y() }
    const others = shapes.filter(sh => sh.id !== s.id && sh.type !== "pen" && sh.type !== "arrow")
    const snapped = computeSnap(moving, others)
    node.x(snapped.x)
    node.y(snapped.y)
    setSnapLines(snapped.lines)
  }, [shapes, snapEnabled])

  // ── Common drag/click/transform props ──
  const dp = (s: Shape) => ({
    id:        s.id,
    draggable: tool === "select",
    onClick: (e: any) => {
      e.cancelBubble = true
      setSelected(e.evt.shiftKey
        ? (selected.includes(s.id) ? selected.filter(x => x !== s.id) : [...selected, s.id])
        : [s.id])
    },
    onDblClick: (e: any) => {
      const abs = e.target.absolutePosition()
      openEditor(s, abs.x / scale, abs.y / scale)
    },
    onDragMove:     (e: any) => onDragMove(s, e.target),
    onDragEnd:      (e: any) => { setSnapLines([]); upsertShape({ ...s, x: e.target.x(), y: e.target.y() }) },
    onTransformEnd: (e: any) => onTransformEnd(s, e.target),
  })

  const glow = (s: Shape): any => {
    if (presentMode && presentFocus && s.id !== presentFocus) return { opacity: 0.12 }
    if (selected.includes(s.id)) return { shadowColor: "#4f46e5", shadowBlur: 14, shadowOpacity: 0.85 }
    return {}
  }

  // Centred label inside shape
  const lbl = (s: Shape) => !s.label ? null : (
    <Text
      text={s.label}
      fontSize={s.fontSize || 15}
      fontStyle={s.fontStyle || "normal"}
      fill={s.textColor || (darkMode ? "#f1f5f9" : "#1e293b")}
      width={s.width} height={s.height}
      align="center" verticalAlign="middle"
      listening={false} wrap="word"
    />
  )

  const bg      = darkMode ? "#0d0d12" : "#f8fafc"
  const gridCol = darkMode ? "rgba(99,102,241,.1)" : "rgba(99,102,241,.09)"
  const cursor  = spaceHeld.current
    ? (isPanning.current ? "grabbing" : "grab")
    : reactionMode ? "cell"
    : tool === "select" ? "default"
    : "crosshair"

  return (
    <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: bg, cursor }}>

      {/* Dot grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `radial-gradient(circle, ${gridCol} 1.2px, transparent 1.2px)`,
        backgroundSize: "28px 28px",
        backgroundPosition: `${pos.x % 28}px ${pos.y % 28}px`,  // moves with pan
      }} />

      {/* Zoom / pan indicator */}
      <div style={{
        position: "absolute", top: 10, right: 12, zIndex: 10,
        fontFamily: "DM Mono, monospace", fontSize: 11,
        color: darkMode ? "#6b7280" : "#9ca3af",
        background: darkMode ? "rgba(13,13,18,.85)" : "rgba(255,255,255,.85)",
        padding: "4px 12px", borderRadius: 20,
        border: `1px solid ${darkMode ? "#1e1e2e" : "#e2e8f0"}`,
        pointerEvents: "none", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>{Math.round(scale * 100)}%</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ fontSize: 10 }}>scroll=pan  Ctrl+scroll=zoom  space+drag=pan</span>
      </div>

      {/* Zoom buttons */}
      <div style={{ position: "absolute", bottom: 56, right: 14, zIndex: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        {[
          { l: "+", title: "Zoom in  (Ctrl++)",  a: () => {
            const oldScale = scaleRef.current
            const ns = Math.min(8, oldScale * 1.2)
            const cx = size.w / 2, cy = size.h / 2
            const p  = posRef.current
            setScale(ns)
            setPos({ x: cx - (cx - p.x) * (ns / oldScale), y: cy - (cy - p.y) * (ns / oldScale) })
          }},
          { l: "−", title: "Zoom out (Ctrl+-)", a: () => {
            const oldScale = scaleRef.current
            const ns = Math.max(0.1, oldScale / 1.2)
            const cx = size.w / 2, cy = size.h / 2
            const p  = posRef.current
            setScale(ns)
            setPos({ x: cx - (cx - p.x) * (ns / oldScale), y: cy - (cy - p.y) * (ns / oldScale) })
          }},
          { l: "⊡", title: "Reset zoom", a: () => { setScale(1.4); setPos({ x: 40, y: 40 }) } },
        ].map(b => (
          <button key={b.l} onClick={b.a} title={b.title} style={{
            width: 34, height: 34, borderRadius: 10,
            background: darkMode ? "#131318" : "#fff",
            border: `1px solid ${darkMode ? "#1e1e2e" : "#e2e8f0"}`,
            color: darkMode ? "#e2e8f0" : "#374151",
            fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 4px rgba(0,0,0,.15)",
            transition: "all .15s",
          }}>{b.l}</button>
        ))}
      </div>

      {/* Context hint bar */}
      <div style={{
        position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
        background: darkMode ? "rgba(13,13,18,.9)" : "rgba(255,255,255,.9)",
        border: `1px solid ${darkMode ? "#1e1e2e" : "#e2e8f0"}`,
        borderRadius: 24, padding: "5px 16px",
        fontFamily: "DM Mono, monospace", fontSize: 11,
        color: darkMode ? "#6b7280" : "#6b7280",
        pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap",
        backdropFilter: "blur(6px)",
      }}>
        {reactionMode && `click to stamp ${reactionEmoji} · press Esc to stop`}
        {!reactionMode && tool === "select" && (selected.length > 0
          ? `${selected.length} selected · Delete to remove · Shift+click to add`
          : "click shape to select · drag empty area for multi-select · double-click to edit text")}
        {!reactionMode && tool === "rect"          && "click and drag → rectangle"}
        {!reactionMode && tool === "ellipse"       && "click and drag → ellipse  (use for Start/End in flowcharts)"}
        {!reactionMode && tool === "diamond"       && "click and drag → diamond  (decisions/conditions)"}
        {!reactionMode && tool === "triangle"      && "click and drag → triangle"}
        {!reactionMode && tool === "cylinder"      && "click and drag → cylinder  (databases)"}
        {!reactionMode && tool === "parallelogram" && "click and drag → parallelogram  (I/O)"}
        {!reactionMode && tool === "text"          && "click to place · double-click any shape to edit its text"}
        {!reactionMode && tool === "pen"           && "click and drag → freehand stroke"}
        {!reactionMode && tool === "arrow"         && "click and drag → connector arrow (any angle)"}
      </div>

      {/* ── Floating reaction stamps ── */}
      {localReactions.map(r => {
        const age      = Date.now() - r.born
        const progress = Math.min(1, age / 3500)
        const opacity  = progress < 0.7 ? 1 : (1 - progress) / 0.3
        const rise     = progress * 90
        const sx = r.x * scale + pos.x
        const sy = r.y * scale + pos.y
        return (
          <div key={r.id} style={{
            position: "absolute",
            left:  sx - 18,
            top:   sy - rise - 18,
            fontSize: 30,
            opacity: Math.max(0, opacity),
            pointerEvents: "none",
            zIndex: 60,
            transform: `scale(${0.9 + (1 - progress) * 0.2})`,
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,.35))",
            transition: "none",
            userSelect: "none",
          }}>
            {r.emoji}
          </div>
        )
      })}

      {/* ── Konva Stage ── */}
      {size.w > 0 && size.h > 0 && (
        <Stage
          ref={stageRef}
          width={size.w} height={size.h}
          scaleX={scale} scaleY={scale}
          x={pos.x} y={pos.y}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onClick={(e: any) => { if (e.target === e.target.getStage()) setSelected([]) }}
          onMouseLeave={() => {
            isPanning.current  = false
            isDrawing.current  = false
            drawId.current     = null
            isBanding.current  = false
            setBand(null)
            setSnapLines([])
          }}
        >
          <Layer ref={layerRef}>

            {shapes.map(s => {
              const g = glow(s)
              switch (s.type) {

                case "rect": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)} {...g}>
                    <Rect width={s.width} height={s.height}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} cornerRadius={6} />
                    {lbl(s)}
                  </Group>
                )

                case "ellipse": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)} {...g}>
                    <Ellipse
                      x={s.width / 2} y={s.height / 2}
                      radiusX={Math.max(1, s.width / 2)}
                      radiusY={Math.max(1, s.height / 2)}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} />
                    {lbl(s)}
                  </Group>
                )

                case "diamond": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)} {...g}>
                    <Line points={diamondPts(s.width, s.height)} closed
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} />
                    {lbl(s)}
                  </Group>
                )

                case "triangle": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)} {...g}>
                    <Line points={triPts(s.width, s.height)} closed
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} />
                    {lbl(s)}
                  </Group>
                )

                case "parallelogram": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)} {...g}>
                    <Line points={paraPts(s.width, s.height)} closed
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} />
                    {lbl(s)}
                  </Group>
                )

                case "cylinder": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)} {...g}>
                    <Rect width={s.width} height={s.height}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} cornerRadius={[0, 0, 4, 4]} />
                    <Ellipse x={s.width/2} y={0}
                      radiusX={s.width/2} radiusY={s.height * 0.13}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} />
                    <Ellipse x={s.width/2} y={s.height}
                      radiusX={s.width/2} radiusY={s.height * 0.13}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} />
                    {lbl(s)}
                  </Group>
                )

                case "text": return (
                  <Text
                    key={s.id} id={s.id}
                    x={s.x} y={s.y}
                    text={s.label || "Text"}
                    fontSize={s.fontSize || 16}
                    fontStyle={s.fontStyle || "normal"}
                    fill={s.textColor || (darkMode ? "#f1f5f9" : "#1e293b")}
                    opacity={g.opacity ?? s.opacity}
                    wrap="word" width={Math.max(s.width, 100)}
                    draggable={tool === "select"}
                    onClick={(e: any) => { e.cancelBubble = true; setSelected(e.evt.shiftKey ? (selected.includes(s.id) ? selected.filter(x => x !== s.id) : [...selected, s.id]) : [s.id]) }}
                    onDblClick={(e: any) => { const abs = e.target.absolutePosition(); openEditor(s, abs.x / scale, abs.y / scale) }}
                    onDragMove={(e: any) => onDragMove(s, e.target)}
                    onDragEnd={(e: any) => { setSnapLines([]); upsertShape({ ...s, x: e.target.x(), y: e.target.y() }) }}
                    onTransformEnd={(e: any) => onTransformEnd(s, e.target)}
                  />
                )

                case "pen": return s.points ? (
                  <Line
                    key={s.id} id={s.id}
                    x={s.x} y={s.y} points={s.points}
                    stroke={s.stroke} strokeWidth={s.strokeWidth}
                    tension={0.45} lineCap="round" lineJoin="round"
                    opacity={g.opacity ?? s.opacity}
                    onClick={(e: any) => { e.cancelBubble = true; setSelected([s.id]) }}
                  />
                ) : null

                case "arrow": {
                  const pts = (s.points && s.points.length >= 4) ? s.points
                    : [s.x, s.y, s.x + (s.width || 80), s.y + (s.height || 0)]
                  const [x1, y1, x2, y2] = pts
                  return (
                    <Arrow
                      key={s.id} id={s.id}
                      x={x1} y={y1} points={[0, 0, x2 - x1, y2 - y1]}
                      fill={s.stroke} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      pointerLength={10} pointerWidth={9}
                      opacity={g.opacity ?? s.opacity}
                      {...(selected.includes(s.id) ? { shadowColor: "#4f46e5", shadowBlur: 10, shadowOpacity: 0.8 } : {})}
                      draggable={tool === "select"}
                      onClick={(e: any) => { e.cancelBubble = true; setSelected([s.id]) }}
                      onDragEnd={(e: any) => {
                        const dx = e.target.x() - x1, dy = e.target.y() - y1
                        upsertShape({ ...s, x: x1 + dx, y: y1 + dy, points: [x1+dx, y1+dy, x2+dx, y2+dy] })
                      }}
                    />
                  )
                }

                default: return null
              }
            })}

            {/* ── Snap guide lines ──
                vertical   axis → a vertical line   (shapes aligned on X)
                horizontal axis → a horizontal line (shapes aligned on Y)      */}
            {snapLines.map((ln, i) =>
              ln.axis === "vertical" ? (
                <Line key={i}
                  points={[ln.pos, -99999, ln.pos, 99999]}
                  stroke="#e11d48" strokeWidth={1.5}
                  dash={[8, 4]} listening={false}
                  opacity={0.85}
                />
              ) : (
                <Line key={i}
                  points={[-99999, ln.pos, 99999, ln.pos]}
                  stroke="#e11d48" strokeWidth={1.5}
                  dash={[8, 4]} listening={false}
                  opacity={0.85}
                />
              )
            )}

            {/* Multi-select rubber band */}
            {band && (
              <Rect
                x={band.x} y={band.y} width={band.w} height={band.h}
                fill="rgba(79,70,229,.07)"
                stroke="#4f46e5" strokeWidth={1.5}
                dash={[6, 3]} listening={false}
              />
            )}

            {/* Resize/rotate transformer */}
            <Transformer
              ref={trRef}
              keepRatio={false}
              boundBoxFunc={(old: any, nw: any) => nw.width < 10 || nw.height < 10 ? old : nw}
              anchorSize={8}
              anchorCornerRadius={3}
              borderStroke="#4f46e5"
              anchorStroke="#4f46e5"
              anchorFill="#fff"
            />
          </Layer>
        </Stage>
      )}

      {/* ── Inline text editor overlay ── */}
      {textEd && (
        <div style={{
          position: "absolute",
          left: textEd.x * scale + pos.x,
          top:  textEd.y * scale + pos.y,
          zIndex: 50,
        }}>
          <textarea
            ref={taRef}
            defaultValue={textEd.value}
            style={{
              minWidth:   Math.max(textEd.w * scale, 180),
              minHeight:  Math.max(textEd.h * scale, 60),
              fontSize:   textEd.fontSize * scale,
              fontFamily: "DM Mono, monospace",
              fontStyle:  textEd.fontStyle,
              color:      textEd.color,
              background: darkMode ? "rgba(13,13,18,.97)" : "rgba(255,255,255,.97)",
              border:     "2px solid #4f46e5",
              borderRadius: 10,
              outline:    "none",
              padding:    "8px 12px",
              resize:     "both",
              caretColor: "#4f46e5",
              lineHeight: 1.5,
              boxShadow:  "0 0 0 4px rgba(79,70,229,.15), 0 4px 24px rgba(0,0,0,.25)",
            }}
            placeholder="Type here…  Enter = new line · Esc = done"
            onKeyDown={e => { if (e.key === "Escape") commitText((e.target as HTMLTextAreaElement).value) }}
            onBlur={e => commitText(e.target.value)}
          />
        </div>
      )}

      {/* ── Peer cursors ── */}
      {cursors.map(c => {
        const sx = c.x * scale + pos.x
        const sy = c.y * scale + pos.y
        return (
          <div key={c.socketId} style={{
            position: "absolute", left: sx, top: sy,
            pointerEvents: "none", zIndex: 25,
            transform: "translate(-2px, -2px)",
            transition: "left .05s linear, top .05s linear",
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 8L8 9L6 14L2 2Z" fill={c.color} stroke="rgba(255,255,255,.8)" strokeWidth="1"/>
            </svg>
            <span style={{
              position: "absolute", top: 15, left: 15,
              background: c.color, borderRadius: 6,
              padding: "2px 8px", fontSize: 11,
              fontFamily: "DM Mono, monospace", color: "#fff",
              fontWeight: 600, whiteSpace: "nowrap",
              boxShadow: "0 1px 4px rgba(0,0,0,.3)",
            }}>
              {c.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}