// app/(app)/board/[id]/KonvaBoard.tsx
// FIXES:
// 1. Arrow draws freely in any direction (not constrained) — user controls the angle
// 2. Text is editable via double-click — opens a native textarea overlay
// 3. AI shapes render their label inside each shape (Konva Group: Rect + Text)
// 4. Version restore: yjs:full_state event rebuilds the shapes map correctly
"use client"

import { useRef, useCallback, useEffect, useState } from "react"
import {
  Stage, Layer,
  Rect, Ellipse, Text, Arrow, Line, Group,
} from "react-konva"
import type { Shape } from "./page"

type Tool = "select" | "rect" | "ellipse" | "text" | "pen" | "arrow"

interface Cursor {
  socketId: string; userId: string
  name: string; color: string; x: number; y: number
}

interface Props {
  stageRef:        React.MutableRefObject<any>
  shapes:          Shape[]
  cursors:         Cursor[]
  tool:            Tool
  color:           string
  selected:        string | null
  setSelected:     (id: string | null) => void
  upsertShape:     (s: Shape) => void
  deleteShape:     (id: string) => void
  broadcastCursor: (x: number, y: number) => void
  boardId:         string
}

/* ── Inline text editor overlay ── */
interface TextEditorState {
  id:     string
  x:      number; y:     number
  width:  number; height: number
  value:  string
  fontSize: number
  color:  string
}

export default function KonvaBoard({
  stageRef, shapes, cursors,
  tool, color, selected, setSelected,
  upsertShape, deleteShape, broadcastCursor,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  /* track container size */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight })
    )
    obs.observe(el)
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => obs.disconnect()
  }, [])

  /* ── Drawing state ── */
  const isDrawing  = useRef(false)
  const drawId     = useRef<string | null>(null)
  const drawStart  = useRef({ x: 0, y: 0 })
  const penPoints  = useRef<number[]>([])

  /* ── Text editor overlay state ── */
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textEditor && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [textEditor?.id])

  const makeId = () => `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`

  const getPos = (e: any) => {
    const stage = stageRef.current
    return stage?.getPointerPosition() ?? null
  }

  /* ─────────────────────────────────────────────────────────────
     MOUSE DOWN
  ───────────────────────────────────────────────────────────── */
  const handleMouseDown = useCallback((e: any) => {
    if (tool === "select") return

    const pos = getPos(e)
    if (!pos) return

    const id = makeId()
    drawId.current    = id
    drawStart.current = { x: pos.x, y: pos.y }
    penPoints.current = [pos.x, pos.y]
    isDrawing.current = true

    /* TEXT — place immediately, open editor */
    if (tool === "text") {
      const newShape: Shape = {
        id, type: "text",
        x: pos.x, y: pos.y,
        width: 180, height: 30,
        fill: color, stroke: "transparent", strokeWidth: 0,
        label: "Type here…", fontSize: 16,
        opacity: 1, rotation: 0,
      }
      upsertShape(newShape)
      setSelected(id)
      isDrawing.current = false
      drawId.current    = null
      // Open editor immediately
      setTextEditor({
        id, x: pos.x, y: pos.y,
        width: 200, height: 40,
        value: "", fontSize: 16, color,
      })
      return
    }

    /* PEN */
    if (tool === "pen") {
      upsertShape({
        id, type: "pen",
        x: pos.x, y: pos.y,
        width: 0, height: 0,
        fill: "transparent", stroke: color, strokeWidth: 2.5,
        points: [0, 0],
        opacity: 1, rotation: 0,
      })
      return
    }

    /* ARROW — stores actual endpoint, not width/height */
    if (tool === "arrow") {
      upsertShape({
        id, type: "arrow",
        x: pos.x, y: pos.y,
        width: 0, height: 0,
        fill: color, stroke: color, strokeWidth: 2,
        /* points: [startX, startY, endX, endY] in absolute coords */
        points: [pos.x, pos.y, pos.x, pos.y],
        opacity: 1, rotation: 0,
      })
      return
    }

    /* RECT | ELLIPSE */
    upsertShape({
      id, type: tool,
      x: pos.x, y: pos.y,
      width: 2, height: 2,
      fill: color + "30", stroke: color, strokeWidth: 2,
      opacity: 1, rotation: 0,
    })
  }, [tool, color, upsertShape, setSelected])

  /* ─────────────────────────────────────────────────────────────
     MOUSE MOVE
  ───────────────────────────────────────────────────────────── */
  const handleMouseMove = useCallback((e: any) => {
    const pos = getPos(e)
    if (!pos) return

    broadcastCursor(pos.x, pos.y)

    if (!isDrawing.current || !drawId.current) return
    const id = drawId.current

    /* PEN — append point relative to shape origin */
    if (tool === "pen") {
      const dx = pos.x - drawStart.current.x
      const dy = pos.y - drawStart.current.y
      penPoints.current = [...penPoints.current, dx, dy]
      const s = shapes.find(sh => sh.id === id)
      if (s) upsertShape({ ...s, points: penPoints.current })
      return
    }

    /* ARROW — update endpoint in absolute coords */
    if (tool === "arrow") {
      const s = shapes.find(sh => sh.id === id)
      if (s) {
        upsertShape({
          ...s,
          // Keep start point fixed, move end point freely
          points: [drawStart.current.x, drawStart.current.y, pos.x, pos.y],
        })
      }
      return
    }

    /* RECT | ELLIPSE */
    const s = shapes.find(sh => sh.id === id)
    if (!s) return
    const rawW = pos.x - drawStart.current.x
    const rawH = pos.y - drawStart.current.y
    upsertShape({
      ...s,
      x:      rawW >= 0 ? drawStart.current.x : pos.x,
      y:      rawH >= 0 ? drawStart.current.y : pos.y,
      width:  Math.max(2, Math.abs(rawW)),
      height: Math.max(2, Math.abs(rawH)),
    })
  }, [tool, shapes, upsertShape, broadcastCursor])

  /* ─────────────────────────────────────────────────────────────
     MOUSE UP
  ───────────────────────────────────────────────────────────── */
  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current || !drawId.current) return
    const id = drawId.current
    const s  = shapes.find(sh => sh.id === id)

    // Remove accidental tiny shapes
    if (s && s.type !== "pen" && s.type !== "arrow") {
      if (s.width < 5 && s.height < 5) deleteShape(id)
    }
    if (s && s.type === "arrow") {
      const pts = s.points || []
      const len = Math.hypot((pts[2] ?? 0) - (pts[0] ?? 0), (pts[3] ?? 0) - (pts[1] ?? 0))
      if (len < 8) deleteShape(id)
    }

    isDrawing.current = false
    drawId.current    = null
    penPoints.current = []
  }, [shapes, deleteShape])

  /* ─────────────────────────────────────────────────────────────
     TEXT EDITOR — commit on Enter or blur
  ───────────────────────────────────────────────────────────── */
  const commitText = useCallback((value: string) => {
    if (!textEditor) return
    const s = shapes.find(sh => sh.id === textEditor.id)
    if (s) {
      upsertShape({
        ...s,
        label:  value.trim() || "Text",
        width:  Math.max(s.width, value.length * 9),
      })
    }
    setTextEditor(null)
  }, [textEditor, shapes, upsertShape])

  /* Open text editor on double-click of a text shape */
  const handleTextDblClick = useCallback((s: Shape, nodePos: { x: number; y: number }) => {
    setTextEditor({
      id:    s.id,
      x:     nodePos.x,
      y:     nodePos.y,
      width: Math.max(s.width, 180),
      height: Math.max(s.height + 8, 36),
      value: s.label || "",
      fontSize: s.fontSize || 16,
      color: s.fill || color,
    })
  }, [color])

  /* ─────────────────────────────────────────────────────────────
     Helpers for shape rendering
  ───────────────────────────────────────────────────────────── */
  const isSelected = (id: string) => selected === id
  const selGlow    = (s: Shape) => isSelected(s.id)
    ? { shadowColor: s.stroke, shadowBlur: 10, shadowOpacity: 0.8 }
    : {}

  /* Render a label (Text) centred inside a shape */
  const centredLabel = (s: Shape) => {
    if (!s.label) return null
    return (
      <Text
        text={s.label}
        fontSize={s.fontSize || 13}
        fill="#eaeaf4"
        width={s.width}
        height={s.height}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "#131318",
        cursor: tool === "select" ? "default" : "crosshair",
      }}
    >
      {/* dot grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle, rgba(108,99,255,.13) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }} />

      {/* context hint */}
      {!selected && (
        <div style={{
          position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: "rgba(12,12,16,.85)", border: "1px solid #2e2e3e",
          borderRadius: 20, padding: "5px 14px",
          fontFamily: "DM Mono, monospace", fontSize: 11, color: "#58587a",
          pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap",
        }}>
          {tool === "select"  && "click a shape to select · drag to move"}
          {tool === "rect"    && "click and drag to draw a rectangle"}
          {tool === "ellipse" && "click and drag to draw an ellipse"}
          {tool === "text"    && "click to place · double-click to edit text"}
          {tool === "pen"     && "click and drag to draw freehand"}
          {tool === "arrow"   && "click and drag to draw an arrow in any direction"}
        </div>
      )}
      {selected && (
        <div style={{
          position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: "rgba(12,12,16,.85)", border: "1px solid #2e2e3e",
          borderRadius: 20, padding: "5px 14px",
          fontFamily: "DM Mono, monospace", fontSize: 11, color: "#58587a",
          pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap",
        }}>
          drag to move · Delete to remove · double-click text to edit · Esc to deselect
        </div>
      )}

      {/* ── KONVA STAGE ── */}
      {size.w > 0 && size.h > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={(e: any) => {
            if (e.target === e.target.getStage()) setSelected(null)
          }}
          onMouseLeave={() => {
            isDrawing.current = false; drawId.current = null
          }}
        >
          <Layer>
            {shapes.map(s => {

              /* ── RECT ── */
              if (s.type === "rect") return (
                <Group
                  key={s.id}
                  x={s.x} y={s.y}
                  draggable={tool === "select"}
                  onClick={() => setSelected(s.id)}
                  onDragEnd={e => upsertShape({ ...s, x: e.target.x(), y: e.target.y() })}
                >
                  <Rect
                    width={s.width} height={s.height}
                    fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                    opacity={s.opacity} cornerRadius={6}
                    {...selGlow(s)}
                  />
                  {centredLabel(s)}
                </Group>
              )

              /* ── ELLIPSE ── */
              if (s.type === "ellipse") return (
                <Group
                  key={s.id}
                  x={s.x} y={s.y}
                  draggable={tool === "select"}
                  onClick={() => setSelected(s.id)}
                  onDragEnd={e => upsertShape({ ...s, x: e.target.x(), y: e.target.y() })}
                >
                  <Ellipse
                    x={s.width / 2} y={s.height / 2}
                    radiusX={Math.max(1, s.width / 2)}
                    radiusY={Math.max(1, s.height / 2)}
                    fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                    opacity={s.opacity}
                    {...selGlow(s)}
                  />
                  {s.label && (
                    <Text
                      text={s.label}
                      fontSize={s.fontSize || 13}
                      fill="#eaeaf4"
                      width={s.width}
                      height={s.height}
                      align="center"
                      verticalAlign="middle"
                      listening={false}
                    />
                  )}
                </Group>
              )

              /* ── TEXT ── */
              if (s.type === "text") return (
                <Text
                  key={s.id}
                  x={s.x} y={s.y}
                  text={s.label || "Text"}
                  fontSize={s.fontSize || 16}
                  fill={s.fill || "#eaeaf4"}
                  opacity={s.opacity}
                  draggable={tool === "select"}
                  onClick={() => setSelected(s.id)}
                  onDblClick={e => {
                    const stage = stageRef.current
                    const node  = e.target
                    const pos   = node.absolutePosition()
                    handleTextDblClick(s, pos)
                  }}
                  onDragEnd={e => upsertShape({ ...s, x: e.target.x(), y: e.target.y() })}
                />
              )

              /* ── PEN ── */
              if (s.type === "pen" && s.points) return (
                <Line
                  key={s.id}
                  x={s.x} y={s.y}
                  points={s.points}
                  stroke={s.stroke} strokeWidth={s.strokeWidth}
                  tension={0.5} lineCap="round" lineJoin="round"
                  opacity={s.opacity}
                  onClick={() => setSelected(s.id)}
                />
              )

              /* ── ARROW ──
                 points[] stores [x1,y1, x2,y2] in absolute canvas coords.
                 Arrow x/y is set to x1,y1 and points become [0,0, dx,dy]
                 so dragging the group moves the whole arrow correctly.   */
              if (s.type === "arrow") {
                const pts = s.points && s.points.length >= 4 ? s.points : [s.x, s.y, s.x + (s.width || 80), s.y + (s.height || 0)]
                const x1 = pts[0], y1 = pts[1], x2 = pts[2], y2 = pts[3]
                return (
                  <Arrow
                    key={s.id}
                    x={x1} y={y1}
                    points={[0, 0, x2 - x1, y2 - y1]}
                    fill={s.stroke} stroke={s.stroke}
                    strokeWidth={s.strokeWidth}
                    pointerLength={10} pointerWidth={8}
                    opacity={s.opacity}
                    {...selGlow(s)}
                    draggable={tool === "select"}
                    onClick={() => setSelected(s.id)}
                    onDragEnd={e => {
                      const dx = e.target.x() - x1
                      const dy = e.target.y() - y1
                      upsertShape({
                        ...s,
                        x: x1 + dx, y: y1 + dy,
                        points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy],
                      })
                    }}
                  />
                )
              }

              return null
            })}
          </Layer>
        </Stage>
      )}

      {/* ── TEXT EDITOR OVERLAY ── */}
      {textEditor && (
        <textarea
          ref={textareaRef}
          defaultValue={textEditor.value}
          style={{
            position:    "absolute",
            left:        textEditor.x,
            top:         textEditor.y,
            minWidth:    Math.max(textEditor.width, 160),
            minHeight:   textEditor.height,
            fontSize:    textEditor.fontSize,
            fontFamily:  "DM Mono, monospace",
            color:       textEditor.color,
            background:  "rgba(12,12,16,.92)",
            border:      "1.5px solid rgba(108,99,255,.7)",
            borderRadius: 6,
            outline:     "none",
            padding:     "6px 10px",
            resize:      "none",
            zIndex:      50,
            lineHeight:  1.4,
            boxShadow:   "0 0 0 3px rgba(108,99,255,.15)",
            caretColor:  "#6c63ff",
          }}
          onKeyDown={e => {
            if (e.key === "Escape") {
              commitText((e.target as HTMLTextAreaElement).value)
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              commitText((e.target as HTMLTextAreaElement).value)
            }
          }}
          onBlur={e => commitText(e.target.value)}
          autoFocus
          placeholder="Type and press Enter…"
        />
      )}

      {/* ── PEER CURSORS ── */}
      {cursors.map(c => (
        <div
          key={c.socketId}
          style={{
            position: "absolute",
            left: c.x, top: c.y,
            pointerEvents: "none",
            zIndex: 20,
            transform: "translate(-2px, -2px)",
            transition: "left .04s linear, top .04s linear",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 2L14 8L8 9L6 14L2 2Z" fill={c.color} stroke="rgba(255,255,255,.7)" strokeWidth=".8"/>
          </svg>
          <span style={{
            position: "absolute", top: 13, left: 13,
            background: c.color, borderRadius: 4,
            padding: "2px 7px", fontSize: 10,
            fontFamily: "DM Mono, monospace",
            color: "#fff", fontWeight: 500, whiteSpace: "nowrap",
          }}>
            {c.name}
          </span>
        </div>
      ))}
    </div>
  )
}