// app/(app)/board/[id]/KonvaBoard.tsx
// All Konva imports MUST live in this ONE file (loaded via dynamic ssr:false)
// FIXES:
//   - Pen bug: points[] starts [0,0] and appends relative deltas only
//   - Zoom/pan: wheel=zoom, space+drag=pan, middle-mouse=pan
//   - Multi-select: drag on empty canvas to draw selection box
//   - Resize: 8 handles on selected shape
//   - Text editor: multiline textarea overlay, double-click to edit
//   - Double-click inside rect/ellipse → inline text edit
//   - All shapes: rect, ellipse, diamond, triangle, cylinder, parallelogram, pen, arrow, text
//   - Dark/light mode canvas background
"use client"

import { useRef, useCallback, useEffect, useState } from "react"
import {
  Stage, Layer,
  Rect, Ellipse, Text, Arrow, Line, Group, RegularPolygon,
  Transformer,
} from "react-konva"
import type { Shape, Cursor, Tool } from "./page"

interface Props {
  stageRef:        React.MutableRefObject<any>
  shapes:          Shape[]
  cursors:         Cursor[]
  tool:            Tool
  strokeColor:     string
  fillColor:       string
  strokeWidth:     number
  fontSize:        number
  fontStyle:       string
  selected:        string[]
  setSelected:     (ids: string[]) => void
  upsertShape:     (s: Shape) => void
  deleteShape:     (id: string) => void
  broadcastCursor: (x: number, y: number) => void
  boardId:         string
  darkMode:        boolean
}

interface TextEditor {
  id: string; x: number; y: number
  width: number; height: number
  value: string; fontSize: number; color: string; fontStyle: string
}

// ── Diamond points helper ──
function diamondPoints(w: number, h: number) {
  return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]
}
// ── Triangle points helper ──
function trianglePoints(w: number, h: number) {
  return [w / 2, 0, w, h, 0, h]
}
// ── Parallelogram points helper ──
function parallelogramPoints(w: number, h: number) {
  const skew = 20
  return [skew, 0, w, 0, w - skew, h, 0, h]
}

export default function KonvaBoard({
  stageRef, shapes, cursors,
  tool, strokeColor, fillColor, strokeWidth, fontSize, fontStyle,
  selected, setSelected,
  upsertShape, deleteShape, broadcastCursor,
  boardId, darkMode,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // ── Canvas transform (zoom + pan) ──
  const [stageScale, setStageScale] = useState(1)
  const [stagePos,   setStagePop]   = useState({ x: 0, y: 0 })
  const isPanning   = useRef(false)
  const panStart    = useRef({ x: 0, y: 0 })
  const spaceHeld   = useRef(false)

  // ── Drawing state ──
  const isDrawing   = useRef(false)
  const drawId      = useRef<string | null>(null)
  const drawStart   = useRef({ x: 0, y: 0 })

  // ── Multi-select drag box ──
  const isSelecting   = useRef(false)
  const selStart      = useRef({ x: 0, y: 0 })
  const [selBox, setSelBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // ── Text editor ──
  const [textEditor, setTextEditor] = useState<TextEditor | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Transformer ref ──
  const trRef   = useRef<any>(null)
  const layerRef = useRef<any>(null)

  // ── ResizeObserver ──
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

  // ── Focus textarea when editor opens ──
  useEffect(() => {
    if (textEditor && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [textEditor?.id])

  // ── Attach Transformer to selected nodes ──
  useEffect(() => {
    if (!trRef.current || !layerRef.current) return
    const layer = layerRef.current
    const nodes = selected
      .map(id => layer.findOne(`#${id}`))
      .filter(Boolean)
    trRef.current.nodes(nodes)
    trRef.current.getLayer()?.batchDraw()
  }, [selected, shapes])

  // ── Keyboard: space = pan mode ──
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceHeld.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup",   up)
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up) }
  }, [])

  const makeId = () => `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`

  // Convert screen coords → canvas coords (accounting for zoom/pan)
  const toCanvas = (sx: number, sy: number) => ({
    x: (sx - stagePos.x) / stageScale,
    y: (sy - stagePos.y) / stageScale,
  })

  const getStagePointerPos = () => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    return toCanvas(pos.x, pos.y)
  }

  // ── Wheel: zoom ──
  const handleWheel = useCallback((e: any) => {
    e.evt.preventDefault()
    const stage    = stageRef.current
    if (!stage) return
    const scaleBy  = 1.08
    const oldScale = stageScale
    const pointer  = stage.getPointerPosition()
    if (!pointer) return

    const newScale = e.evt.deltaY < 0
      ? Math.min(oldScale * scaleBy, 8)
      : Math.max(oldScale / scaleBy, 0.1)

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    }
    setStageScale(newScale)
    setStagePop({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }, [stageScale, stagePos])

  // ── Mouse Down ──
  const handleMouseDown = useCallback((e: any) => {
    const isStageClick = e.target === e.target.getStage()

    // Middle mouse or Space+drag = pan
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceHeld.current)) {
      isPanning.current = true
      panStart.current  = { x: e.evt.clientX - stagePos.x, y: e.evt.clientY - stagePos.y }
      return
    }

    if (e.evt.button !== 0) return
    const pos = getStagePointerPos()
    if (!pos) return

    // ── Select tool ──
    if (tool === "select") {
      if (isStageClick) {
        // Start drag-select box
        setSelected([])
        isSelecting.current = true
        selStart.current    = pos
        setSelBox({ x: pos.x, y: pos.y, w: 0, h: 0 })
      }
      return
    }

    // ── Text tool ──
    if (tool === "text") {
      const id = makeId()
      const newShape: Shape = {
        id, type: "text",
        x: pos.x, y: pos.y,
        width: 200, height: 30,
        fill: "transparent", stroke: "transparent", strokeWidth: 0,
        label: "", fontSize, fontStyle,
        textColor: strokeColor,
        opacity: 1, rotation: 0,
      }
      upsertShape(newShape)
      setSelected([id])
      setTextEditor({ id, x: pos.x, y: pos.y, width: 240, height: 80, value: "", fontSize, color: strokeColor, fontStyle })
      return
    }

    // ── All draw tools ──
    const id = makeId()
    drawId.current    = id
    drawStart.current = pos
    isDrawing.current = true

    if (tool === "pen") {
      // FIX: pen origin = drawStart, points starts as [0,0] (relative)
      upsertShape({
        id, type: "pen",
        x: pos.x, y: pos.y,      // origin
        width: 0, height: 0,
        fill: "transparent",
        stroke: strokeColor, strokeWidth,
        points: [0, 0],            // always start relative from origin
        opacity: 1, rotation: 0,
      })
      return
    }

    if (tool === "arrow") {
      upsertShape({
        id, type: "arrow",
        x: pos.x, y: pos.y,
        width: 0, height: 0,
        fill: strokeColor, stroke: strokeColor, strokeWidth,
        points: [pos.x, pos.y, pos.x, pos.y],
        opacity: 1, rotation: 0,
      })
      return
    }

    // rect | ellipse | diamond | triangle | cylinder | parallelogram
    upsertShape({
      id, type: tool,
      x: pos.x, y: pos.y,
      width: 2, height: 2,
      fill: fillColor, stroke: strokeColor, strokeWidth,
      opacity: 1, rotation: 0,
    })
  }, [tool, strokeColor, fillColor, strokeWidth, fontSize, fontStyle, stagePos, upsertShape, setSelected])

  // ── Mouse Move ──
  const handleMouseMove = useCallback((e: any) => {
    // Pan
    if (isPanning.current) {
      setStagePop({
        x: e.evt.clientX - panStart.current.x,
        y: e.evt.clientY - panStart.current.y,
      })
      return
    }

    const pos = getStagePointerPos()
    if (!pos) return

    broadcastCursor(pos.x, pos.y)

    // Drag-select box
    if (isSelecting.current) {
      const x = Math.min(pos.x, selStart.current.x)
      const y = Math.min(pos.y, selStart.current.y)
      const w = Math.abs(pos.x - selStart.current.x)
      const h = Math.abs(pos.y - selStart.current.y)
      setSelBox({ x, y, w, h })
      return
    }

    if (!isDrawing.current || !drawId.current) return
    const id = drawId.current

    // ── Pen: append relative point ──
    if (tool === "pen") {
      const s = shapes.find(sh => sh.id === id)
      if (!s) return
      const dx = pos.x - drawStart.current.x
      const dy = pos.y - drawStart.current.y
      const prev = s.points || [0, 0]
      upsertShape({ ...s, points: [...prev, dx, dy] })
      return
    }

    // ── Arrow: update endpoint ──
    if (tool === "arrow") {
      const s = shapes.find(sh => sh.id === id)
      if (s) upsertShape({ ...s, points: [drawStart.current.x, drawStart.current.y, pos.x, pos.y] })
      return
    }

    // ── Rect / Ellipse / Diamond / Triangle / Cylinder / Parallelogram ──
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
  }, [tool, shapes, stagePos, upsertShape, broadcastCursor])

  // ── Mouse Up ──
  const handleMouseUp = useCallback(() => {
    isPanning.current = false

    // Finish drag-select: find all shapes inside box
    if (isSelecting.current && selBox) {
      isSelecting.current = false
      if (selBox.w > 4 && selBox.h > 4) {
        const hits = shapes.filter(s => {
          const sx = s.x, sy = s.y, sw = s.width, sh = s.height
          return (
            sx < selBox.x + selBox.w && sx + sw > selBox.x &&
            sy < selBox.y + selBox.h && sy + sh > selBox.y
          )
        })
        setSelected(hits.map(s => s.id))
      }
      setSelBox(null)
      return
    }

    if (!isDrawing.current || !drawId.current) return
    const id = drawId.current
    const s  = shapes.find(sh => sh.id === id)

    // Remove accidental tiny shapes
    if (s && s.type !== "pen" && s.type !== "arrow" && s.width < 5 && s.height < 5) {
      deleteShape(id)
    }
    if (s?.type === "arrow") {
      const pts = s.points || []
      const len = Math.hypot((pts[2] ?? 0) - (pts[0] ?? 0), (pts[3] ?? 0) - (pts[1] ?? 0))
      if (len < 8) deleteShape(id)
    }

    isDrawing.current = false
    drawId.current    = null
  }, [shapes, selBox, deleteShape, setSelected])

  // ── Click on stage = deselect ──
  const handleStageClick = useCallback((e: any) => {
    if (e.target === e.target.getStage()) setSelected([])
  }, [setSelected])

  // ── Commit text editor ──
  const commitText = useCallback((value: string) => {
    if (!textEditor) return
    const s = shapes.find(sh => sh.id === textEditor.id)
    if (s) upsertShape({ ...s, label: value || "Text" })
    setTextEditor(null)
  }, [textEditor, shapes, upsertShape])

  // ── Open text editor on double-click of text shape or inside rect/ellipse ──
  const openTextEditor = useCallback((s: Shape, absX: number, absY: number) => {
    setTextEditor({
      id: s.id,
      x: absX, y: absY,
      width: Math.max(s.width, 200),
      height: Math.max(s.height + 12, 60),
      value: s.label || "",
      fontSize: s.fontSize || 14,
      color: s.textColor || s.fill || strokeColor,
      fontStyle: s.fontStyle || "normal",
    })
  }, [strokeColor])

  // ── Drag end on transformer: update shape in Yjs ──
  const handleTransformEnd = useCallback((s: Shape, node: any) => {
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    upsertShape({
      ...s,
      x:        node.x(),
      y:        node.y(),
      width:    Math.max(10, s.width  * scaleX),
      height:   Math.max(10, s.height * scaleY),
      rotation: node.rotation(),
    })
  }, [upsertShape])

  // ── Drag common props ──
  const dragProps = (s: Shape) => ({
    id:        s.id,
    draggable: tool === "select",
    onClick:   (e: any) => {
      e.cancelBubble = true
      if (e.evt.shiftKey) {
        setSelected(selected.includes(s.id)
          ? selected.filter(x => x !== s.id)
          : [...selected, s.id])
      } else {
        setSelected([s.id])
      }
    },
    onDblClick: (e: any) => {
      const node = e.target
      const abs  = node.absolutePosition()
      openTextEditor(s, abs.x, abs.y)
    },
    onDragEnd:  (e: any) => upsertShape({ ...s, x: e.target.x(), y: e.target.y() }),
    onTransformEnd: (e: any) => handleTransformEnd(s, e.target),
  })

  // ── Glow on selected ──
  const glow = (s: Shape) => selected.includes(s.id)
    ? { shadowColor: "#6c63ff", shadowBlur: 12, shadowOpacity: 0.9 }
    : {}

  // ── Label rendered inside shapes ──
  const shapeLabel = (s: Shape) => {
    if (!s.label) return null
    return (
      <Text
        text={s.label}
        fontSize={s.fontSize || 14}
        fontStyle={s.fontStyle || "normal"}
        fill={s.textColor || "#eaeaf4"}
        width={s.width}
        height={s.height}
        align="center"
        verticalAlign="middle"
        listening={false}
        wrap="word"
      />
    )
  }

  const bgColor = darkMode ? "#0f0f14" : "#f0f2f5"

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: bgColor,
        cursor: spaceHeld.current
          ? (isPanning.current ? "grabbing" : "grab")
          : tool === "select" ? "default" : "crosshair",
      }}
    >
      {/* Dot grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: darkMode
          ? "radial-gradient(circle, rgba(108,99,255,.13) 1px, transparent 1px)"
          : "radial-gradient(circle, rgba(0,0,0,.08) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }} />

      {/* Zoom hint */}
      <div style={{
        position: "absolute", top: 10, right: 12, zIndex: 10,
        fontFamily: "DM Mono, monospace", fontSize: 10,
        color: darkMode ? "#58587a" : "#94a3b8",
        background: darkMode ? "rgba(12,12,16,.7)" : "rgba(255,255,255,.7)",
        padding: "4px 10px", borderRadius: 20,
        border: `1px solid ${darkMode ? "#22222e" : "#e2e8f0"}`,
        pointerEvents: "none",
      }}>
        {Math.round(stageScale * 100)}% · scroll=zoom · space+drag=pan
      </div>

      {/* Zoom buttons */}
      <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 10, display: "flex", gap: 6 }}>
        {[
          { label: "+", action: () => setStageScale(s => Math.min(s * 1.2, 8)) },
          { label: "−", action: () => setStageScale(s => Math.max(s / 1.2, 0.1)) },
          { label: "⊡", action: () => { setStageScale(1); setStagePop({ x: 0, y: 0 }) } },
        ].map(btn => (
          <button key={btn.label} onClick={btn.action} style={{
            width: 32, height: 32, borderRadius: 8,
            background: darkMode ? "#131318" : "#fff",
            border: `1px solid ${darkMode ? "#22222e" : "#e2e8f0"}`,
            color: darkMode ? "#eaeaf4" : "#1a202c",
            fontFamily: "monospace", fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{btn.label}</button>
        ))}
      </div>

      {/* Context hint */}
      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        background: darkMode ? "rgba(12,12,16,.88)" : "rgba(255,255,255,.88)",
        border: `1px solid ${darkMode ? "#22222e" : "#e2e8f0"}`,
        borderRadius: 20, padding: "5px 14px",
        fontFamily: "DM Mono, monospace", fontSize: 11,
        color: darkMode ? "#58587a" : "#64748b",
        pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap",
      }}>
        {tool === "select"  && (selected.length > 0 ? `${selected.length} selected · Delete to remove · Shift+click to add` : "click to select · drag to multi-select · Shift+click to add")}
        {tool === "rect"    && "click and drag to draw a rectangle"}
        {tool === "ellipse" && "click and drag to draw an ellipse (use for Start/End in flowcharts)"}
        {tool === "diamond" && "click and drag to draw a diamond (use for decisions)"}
        {tool === "triangle" && "click and drag to draw a triangle"}
        {tool === "cylinder" && "click and drag to draw a cylinder"}
        {tool === "parallelogram" && "click and drag to draw a parallelogram"}
        {tool === "text"    && "click to place text · double-click shape to edit"}
        {tool === "pen"     && "click and drag to draw freehand (no straight line at start)"}
        {tool === "arrow"   && "click and drag to draw a connector arrow"}
      </div>

      {/* ── STAGE ── */}
      {size.w > 0 && size.h > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onMouseLeave={() => {
            isDrawing.current   = false
            drawId.current      = null
            isPanning.current   = false
            isSelecting.current = false
            setSelBox(null)
          }}
        >
          <Layer ref={layerRef}>

            {shapes.map(s => {
              switch (s.type) {

                case "rect": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dragProps(s)}>
                    <Rect width={s.width} height={s.height} fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} cornerRadius={6} {...glow(s)} />
                    {shapeLabel(s)}
                  </Group>
                )

                case "ellipse": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dragProps(s)}>
                    <Ellipse
                      x={s.width / 2} y={s.height / 2}
                      radiusX={Math.max(1, s.width / 2)} radiusY={Math.max(1, s.height / 2)}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} {...glow(s)} />
                    {shapeLabel(s)}
                  </Group>
                )

                case "diamond": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dragProps(s)}>
                    <Line points={diamondPoints(s.width, s.height)} closed
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} {...glow(s)} />
                    {shapeLabel(s)}
                  </Group>
                )

                case "triangle": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dragProps(s)}>
                    <Line points={trianglePoints(s.width, s.height)} closed
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} {...glow(s)} />
                    {shapeLabel(s)}
                  </Group>
                )

                case "parallelogram": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dragProps(s)}>
                    <Line points={parallelogramPoints(s.width, s.height)} closed
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      opacity={s.opacity} {...glow(s)} />
                    {shapeLabel(s)}
                  </Group>
                )

                case "cylinder": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dragProps(s)}>
                    <Rect width={s.width} height={s.height} fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} cornerRadius={[0, 0, 4, 4]} />
                    <Ellipse x={s.width / 2} y={0} radiusX={s.width / 2} radiusY={s.height * 0.12}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} />
                    <Ellipse x={s.width / 2} y={s.height} radiusX={s.width / 2} radiusY={s.height * 0.12}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} />
                    {shapeLabel(s)}
                  </Group>
                )

                case "text": return (
                  <Text
                    key={s.id}
                    id={s.id}
                    x={s.x} y={s.y}
                    text={s.label || "Text"}
                    fontSize={s.fontSize || 14}
                    fontStyle={s.fontStyle || "normal"}
                    fill={s.textColor || (darkMode ? "#eaeaf4" : "#1a202c")}
                    opacity={s.opacity}
                    wrap="word"
                    width={Math.max(s.width, 120)}
                    draggable={tool === "select"}
                    onClick={(e: any) => {
                      e.cancelBubble = true
                      if (e.evt.shiftKey) {
                        setSelected(selected.includes(s.id) ? selected.filter(x => x !== s.id) : [...selected, s.id])
                      } else setSelected([s.id])
                    }}
                    onDblClick={(e: any) => {
                      const abs = e.target.absolutePosition()
                      openTextEditor(s, abs.x / stageScale, abs.y / stageScale)
                    }}
                    onDragEnd={(e: any) => upsertShape({ ...s, x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={(e: any) => handleTransformEnd(s, e.target)}
                  />
                )

                case "pen": return s.points ? (
                  <Line
                    key={s.id}
                    id={s.id}
                    x={s.x} y={s.y}
                    points={s.points}
                    stroke={s.stroke} strokeWidth={s.strokeWidth}
                    tension={0.5} lineCap="round" lineJoin="round"
                    opacity={s.opacity}
                    onClick={(e: any) => {
                      e.cancelBubble = true
                      setSelected([s.id])
                    }}
                  />
                ) : null

                case "arrow": {
                  const pts = s.points && s.points.length >= 4
                    ? s.points
                    : [s.x, s.y, s.x + (s.width || 80), s.y + (s.height || 0)]
                  const x1 = pts[0], y1 = pts[1], x2 = pts[2], y2 = pts[3]
                  return (
                    <Arrow
                      key={s.id}
                      id={s.id}
                      x={x1} y={y1}
                      points={[0, 0, x2 - x1, y2 - y1]}
                      fill={s.stroke} stroke={s.stroke}
                      strokeWidth={s.strokeWidth}
                      pointerLength={10} pointerWidth={8}
                      opacity={s.opacity}
                      {...glow(s)}
                      draggable={tool === "select"}
                      onClick={(e: any) => {
                        e.cancelBubble = true
                        setSelected([s.id])
                      }}
                      onDragEnd={(e: any) => {
                        const dx = e.target.x() - x1
                        const dy = e.target.y() - y1
                        upsertShape({ ...s, x: x1 + dx, y: y1 + dy, points: [x1+dx, y1+dy, x2+dx, y2+dy] })
                      }}
                    />
                  )
                }

                default: return null
              }
            })}

            {/* Multi-select rubber-band box */}
            {selBox && (
              <Rect
                x={selBox.x} y={selBox.y}
                width={selBox.w} height={selBox.h}
                fill="rgba(108,99,255,.08)"
                stroke="#6c63ff" strokeWidth={1}
                dash={[6, 3]}
                listening={false}
              />
            )}

            {/* Transformer for resize */}
            <Transformer
              ref={trRef}
              keepRatio={false}
              boundBoxFunc={(oldBox: any, newBox: any) => {
                if (newBox.width < 10 || newBox.height < 10) return oldBox
                return newBox
              }}
            />
          </Layer>
        </Stage>
      )}

      {/* ── Text editor overlay ── */}
      {textEditor && (
        <div style={{
          position: "absolute",
          left:   textEditor.x * stageScale + stagePos.x,
          top:    textEditor.y * stageScale + stagePos.y,
          zIndex: 50,
        }}>
          <textarea
            ref={textareaRef}
            defaultValue={textEditor.value}
            style={{
              minWidth:   Math.max(textEditor.width * stageScale, 160),
              minHeight:  Math.max(textEditor.height * stageScale, 60),
              fontSize:   textEditor.fontSize * stageScale,
              fontFamily: "DM Mono, monospace",
              fontStyle:  textEditor.fontStyle,
              color:      textEditor.color,
              background: darkMode ? "rgba(12,12,16,.95)" : "rgba(255,255,255,.95)",
              border:     "2px solid #6c63ff",
              borderRadius: 8,
              outline:    "none",
              padding:    "8px 12px",
              resize:     "both",
              caretColor: "#6c63ff",
              lineHeight: 1.5,
              boxShadow:  "0 0 0 4px rgba(108,99,255,.15)",
            }}
            placeholder="Type text... (Enter=new line, Esc=done)"
            onKeyDown={e => {
              if (e.key === "Escape") commitText((e.target as HTMLTextAreaElement).value)
              // Enter creates new line naturally — don't intercept
            }}
            onBlur={e => commitText(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* ── Peer cursors ── */}
      {cursors.map(c => {
        const sx = c.x * stageScale + stagePos.x
        const sy = c.y * stageScale + stagePos.y
        return (
          <div key={c.socketId} style={{
            position: "absolute", left: sx, top: sy,
            pointerEvents: "none", zIndex: 20,
            transform: "translate(-2px,-2px)",
            transition: "left .04s linear, top .04s linear",
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 8L8 9L6 14L2 2Z" fill={c.color} stroke="rgba(255,255,255,.7)" strokeWidth=".8"/>
            </svg>
            <span style={{
              position: "absolute", top: 13, left: 13,
              background: c.color, borderRadius: 4,
              padding: "2px 7px", fontSize: 10,
              fontFamily: "DM Mono, monospace",
              color: "#fff", fontWeight: 500, whiteSpace: "nowrap",
            }}>{c.name}</span>
          </div>
        )
      })}
    </div>
  )
}