// app/(app)/board/[id]/KonvaBoard.tsx
// All Konva imports in ONE file — loaded via dynamic({ ssr: false })
// Features: zoom/pan, multi-select rubber band, resize handles (Transformer),
//   text editor overlay (multiline), double-click to edit, pen fix, all shapes
"use client"

import { useRef, useCallback, useEffect, useState } from "react"
import {
  Stage, Layer,
  Rect, Ellipse, Text, Arrow, Line, Group,
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
  id: string
  x: number; y: number
  w: number; h: number
  value: string; fontSize: number; color: string; fontStyle: string
}

function diamondPts(w: number, h: number) { return [w/2, 0, w, h/2, w/2, h, 0, h/2] }
function triPts(w: number, h: number)     { return [w/2, 0, w, h, 0, h] }
function paraPts(w: number, h: number)    { const s=20; return [s,0,w,0,w-s,h,0,h] }

export default function KonvaBoard({
  stageRef, shapes, cursors,
  tool, strokeColor, fillColor, strokeWidth, fontSize, fontStyle,
  selected, setSelected,
  upsertShape, deleteShape, broadcastCursor,
  boardId, darkMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // ── Zoom / pan state ──
  const [scale, setScale] = useState(1)
  const [pos,   setPos  ] = useState({ x: 0, y: 0 })
  const isPanning   = useRef(false)
  const panStart    = useRef({ x: 0, y: 0 })
  const spaceHeld   = useRef(false)

  // ── Drawing state ──
  const isDrawing  = useRef(false)
  const drawId     = useRef<string | null>(null)
  const drawStart  = useRef({ x: 0, y: 0 })

  // ── Multi-select rubber band ──
  const isBanding  = useRef(false)
  const bandStart  = useRef({ x: 0, y: 0 })
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // ── Text editor ──
  const [textEd, setTextEd] = useState<TextEditor | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // ── Transformer ──
  const trRef    = useRef<any>(null)
  const layerRef = useRef<any>(null)

  /* ── Container size ── */
  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const obs = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    obs.observe(el)
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => obs.disconnect()
  }, [])

  /* ── Focus textarea when editor opens ── */
  useEffect(() => {
    if (textEd) setTimeout(() => taRef.current?.focus(), 30)
  }, [textEd?.id])

  /* ── Attach Transformer to selected nodes ── */
  useEffect(() => {
    if (!trRef.current || !layerRef.current) return
    const nodes = selected
      .map(id => layerRef.current.findOne(`#${id}`))
      .filter(Boolean)
    trRef.current.nodes(nodes)
    trRef.current.getLayer()?.batchDraw()
  }, [selected, shapes])

  /* ── Space = pan mode ── */
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

  const makeId = () => `s${Date.now()}${Math.random().toString(36).slice(2,6)}`

  /* Screen → canvas coordinates */
  const toCanvas = (sx: number, sy: number) => ({
    x: (sx - pos.x) / scale,
    y: (sy - pos.y) / scale,
  })

  const stagePtr = () => {
    const p = stageRef.current?.getPointerPosition()
    return p ? toCanvas(p.x, p.y) : null
  }

  /* ── Wheel: zoom ── */
  const onWheel = useCallback((e: any) => {
    e.evt.preventDefault()
    const stage = stageRef.current; if (!stage) return
    const factor = 1.08
    const ptr    = stage.getPointerPosition(); if (!ptr) return
    const newScale = e.evt.deltaY < 0
      ? Math.min(scale * factor, 8)
      : Math.max(scale / factor, 0.1)
    const anchor = { x: (ptr.x - pos.x) / scale, y: (ptr.y - pos.y) / scale }
    setScale(newScale)
    setPos({ x: ptr.x - anchor.x * newScale, y: ptr.y - anchor.y * newScale })
  }, [scale, pos])

  /* ── Mouse down ── */
  const onMouseDown = useCallback((e: any) => {
    // Pan: middle mouse or Space + left click
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceHeld.current)) {
      isPanning.current = true
      panStart.current  = { x: e.evt.clientX - pos.x, y: e.evt.clientY - pos.y }
      return
    }
    if (e.evt.button !== 0) return
    const pt = stagePtr(); if (!pt) return
    const onStage = e.target === e.target.getStage()

    /* SELECT tool ── */
    if (tool === "select") {
      if (onStage) {
        setSelected([])
        isBanding.current = true
        bandStart.current = pt
        setBand({ x: pt.x, y: pt.y, w: 0, h: 0 })
      }
      return
    }

    /* TEXT tool — place immediately ── */
    if (tool === "text") {
      const id = makeId()
      const s: Shape = {
        id, type: "text",
        x: pt.x, y: pt.y,
        width: 200, height: 30,
        fill: "transparent", stroke: "transparent", strokeWidth: 0,
        label: "", fontSize, fontStyle,
        textColor: strokeColor,
        opacity: 1, rotation: 0,
      }
      upsertShape(s)
      setSelected([id])
      setTextEd({ id, x: pt.x, y: pt.y, w: 220, h: 80, value: "", fontSize, color: strokeColor, fontStyle })
      return
    }

    /* All drawing tools ── */
    const id = makeId()
    drawId.current    = id
    drawStart.current = pt
    isDrawing.current = true

    if (tool === "pen") {
      // FIX: origin at drawStart, points start at [0,0]
      upsertShape({ id, type: "pen", x: pt.x, y: pt.y, width: 0, height: 0, fill: "transparent", stroke: strokeColor, strokeWidth, points: [0, 0], opacity: 1, rotation: 0 })
      return
    }
    if (tool === "arrow") {
      upsertShape({ id, type: "arrow", x: pt.x, y: pt.y, width: 0, height: 0, fill: strokeColor, stroke: strokeColor, strokeWidth, points: [pt.x, pt.y, pt.x, pt.y], opacity: 1, rotation: 0 })
      return
    }
    upsertShape({ id, type: tool, x: pt.x, y: pt.y, width: 2, height: 2, fill: fillColor, stroke: strokeColor, strokeWidth, opacity: 1, rotation: 0 })
  }, [tool, strokeColor, fillColor, strokeWidth, fontSize, fontStyle, pos, scale, upsertShape, setSelected])

  /* ── Mouse move ── */
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
      const dx = pt.x - drawStart.current.x
      const dy = pt.y - drawStart.current.y
      upsertShape({ ...s, points: [...(s.points || [0,0]), dx, dy] })
      return
    }
    if (tool === "arrow") {
      const s = shapes.find(sh => sh.id === id); if (!s) return
      upsertShape({ ...s, points: [drawStart.current.x, drawStart.current.y, pt.x, pt.y] })
      return
    }
    const s = shapes.find(sh => sh.id === id); if (!s) return
    const rawW = pt.x - drawStart.current.x
    const rawH = pt.y - drawStart.current.y
    upsertShape({ ...s,
      x: rawW >= 0 ? drawStart.current.x : pt.x,
      y: rawH >= 0 ? drawStart.current.y : pt.y,
      width:  Math.max(2, Math.abs(rawW)),
      height: Math.max(2, Math.abs(rawH)),
    })
  }, [tool, shapes, pos, scale, upsertShape, broadcastCursor])

  /* ── Mouse up ── */
  const onMouseUp = useCallback(() => {
    isPanning.current = false

    if (isBanding.current && band) {
      isBanding.current = false
      if (band.w > 5 && band.h > 5) {
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
    // Remove tiny accidental shapes
    if (s?.type !== "pen" && s?.type !== "arrow" && (s?.width ?? 0) < 5 && (s?.height ?? 0) < 5) {
      deleteShape(id)
    }
    if (s?.type === "arrow") {
      const pts = s.points || []
      if (Math.hypot((pts[2]??0)-(pts[0]??0), (pts[3]??0)-(pts[1]??0)) < 8) deleteShape(id)
    }
    isDrawing.current = false
    drawId.current    = null
  }, [shapes, band, deleteShape, setSelected])

  /* ── Text commit ── */
  const commitText = useCallback((val: string) => {
    if (!textEd) return
    const s = shapes.find(sh => sh.id === textEd.id)
    if (s) upsertShape({ ...s, label: val.trim() || "Text" })
    setTextEd(null)
  }, [textEd, shapes, upsertShape])

  /* ── Open text editor ── */
  const openEditor = useCallback((s: Shape, absX: number, absY: number) => {
    setTextEd({ id: s.id, x: absX, y: absY, w: Math.max(s.width, 200), h: Math.max(s.height+12, 60), value: s.label || "", fontSize: s.fontSize||14, color: s.textColor||strokeColor, fontStyle: s.fontStyle||"normal" })
  }, [strokeColor])

  /* ── Transform end (resize) ── */
  const onTransformEnd = useCallback((s: Shape, node: any) => {
    const scaleX = node.scaleX(), scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    upsertShape({ ...s, x: node.x(), y: node.y(), width: Math.max(10, s.width*scaleX), height: Math.max(10, s.height*scaleY), rotation: node.rotation() })
  }, [upsertShape])

  /* Common drag / click / transform props for shapes */
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
    onDragEnd:      (e: any) => upsertShape({ ...s, x: e.target.x(), y: e.target.y() }),
    onTransformEnd: (e: any) => onTransformEnd(s, e.target),
  })

  const glow = (s: Shape) => selected.includes(s.id)
    ? { shadowColor: "#6c63ff", shadowBlur: 12, shadowOpacity: 0.9 } : {}

  /* Centred label inside a shape */
  const lbl = (s: Shape) => !s.label ? null : (
    <Text text={s.label} fontSize={s.fontSize||13} fontStyle={s.fontStyle||"normal"}
      fill={s.textColor||"#eaeaf4"} width={s.width} height={s.height}
      align="center" verticalAlign="middle" listening={false} wrap="word" />
  )

  const bg = darkMode ? "#0f0f14" : "#f0f2f5"

  return (
    <div ref={containerRef} style={{
      flex: 1, position: "relative", overflow: "hidden", background: bg,
      cursor: spaceHeld.current ? (isPanning.current ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair",
    }}>
      {/* Grid */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: darkMode
          ? "radial-gradient(circle, rgba(108,99,255,.12) 1px, transparent 1px)"
          : "radial-gradient(circle, rgba(0,0,0,.07) 1px, transparent 1px)",
        backgroundSize: "28px 28px" }} />

      {/* Zoom indicator */}
      <div style={{ position: "absolute", top: 10, right: 12, zIndex: 10,
        fontFamily: "DM Mono, monospace", fontSize: 10,
        color: darkMode ? "#58587a" : "#94a3b8",
        background: darkMode ? "rgba(12,12,16,.8)" : "rgba(255,255,255,.8)",
        padding: "3px 10px", borderRadius: 20,
        border: `1px solid ${darkMode ? "#22222e" : "#e2e8f0"}`,
        pointerEvents: "none" }}>
        {Math.round(scale * 100)}% · scroll=zoom · space+drag=pan
      </div>

      {/* Zoom buttons */}
      <div style={{ position: "absolute", bottom: 50, right: 14, zIndex: 10, display: "flex", flexDirection: "column", gap: 5 }}>
        {[{l:"+", a:()=>setScale(s=>Math.min(s*1.2,8))}, {l:"−", a:()=>setScale(s=>Math.max(s/1.2,.1))}, {l:"⊡", a:()=>{setScale(1);setPos({x:0,y:0})}}].map(b => (
          <button key={b.l} onClick={b.a} style={{
            width:32,height:32,borderRadius:8,
            background: darkMode?"#131318":"#fff",
            border:`1px solid ${darkMode?"#22222e":"#e2e8f0"}`,
            color: darkMode?"#eaeaf4":"#1a202c",
            fontFamily:"monospace",fontSize:16,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"
          }}>{b.l}</button>
        ))}
      </div>

      {/* Context hint */}
      <div style={{
        position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)",
        background: darkMode?"rgba(12,12,16,.9)":"rgba(255,255,255,.9)",
        border:`1px solid ${darkMode?"#22222e":"#e2e8f0"}`,
        borderRadius:20,padding:"5px 14px",
        fontFamily:"DM Mono, monospace",fontSize:11,
        color: darkMode?"#58587a":"#64748b",
        pointerEvents:"none",zIndex:5,whiteSpace:"nowrap"
      }}>
        {tool==="select" && (selected.length>0 ? `${selected.length} selected · Delete · Shift+click to add` : "click to select · drag empty area to multi-select")}
        {tool==="rect"    && "click and drag → rectangle"}
        {tool==="ellipse" && "click and drag → ellipse  (use for Start / End in flowcharts)"}
        {tool==="diamond" && "click and drag → diamond  (use for decisions)"}
        {tool==="triangle"      && "click and drag → triangle"}
        {tool==="cylinder"      && "click and drag → cylinder"}
        {tool==="parallelogram" && "click and drag → parallelogram"}
        {tool==="text"    && "click to place · double-click any shape to edit text"}
        {tool==="pen"     && "click and drag → freehand line"}
        {tool==="arrow"   && "click and drag → connector arrow (any angle)"}
      </div>

      {/* ── Stage ── */}
      {size.w > 0 && size.h > 0 && (
        <Stage ref={stageRef} width={size.w} height={size.h}
          scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onClick={(e:any) => { if (e.target===e.target.getStage()) setSelected([]) }}
          onMouseLeave={() => { isPanning.current=false; isDrawing.current=false; drawId.current=null; isBanding.current=false; setBand(null) }}
        >
          <Layer ref={layerRef}>
            {shapes.map(s => {
              switch (s.type) {
                case "rect": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)}>
                    <Rect width={s.width} height={s.height} fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} cornerRadius={6} {...glow(s)} />
                    {lbl(s)}
                  </Group>
                )
                case "ellipse": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)}>
                    <Ellipse x={s.width/2} y={s.height/2} radiusX={Math.max(1,s.width/2)} radiusY={Math.max(1,s.height/2)}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} {...glow(s)} />
                    {lbl(s)}
                  </Group>
                )
                case "diamond": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)}>
                    <Line points={diamondPts(s.width,s.height)} closed fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} {...glow(s)} />
                    {lbl(s)}
                  </Group>
                )
                case "triangle": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)}>
                    <Line points={triPts(s.width,s.height)} closed fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} {...glow(s)} />
                    {lbl(s)}
                  </Group>
                )
                case "parallelogram": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)}>
                    <Line points={paraPts(s.width,s.height)} closed fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} {...glow(s)} />
                    {lbl(s)}
                  </Group>
                )
                case "cylinder": return (
                  <Group key={s.id} x={s.x} y={s.y} {...dp(s)}>
                    <Rect width={s.width} height={s.height} fill={s.fill} stroke={s.stroke}
                      strokeWidth={s.strokeWidth} opacity={s.opacity} cornerRadius={[0,0,4,4]} />
                    <Ellipse x={s.width/2} y={0} radiusX={s.width/2} radiusY={s.height*0.12}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} />
                    <Ellipse x={s.width/2} y={s.height} radiusX={s.width/2} radiusY={s.height*0.12}
                      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} />
                    {lbl(s)}
                  </Group>
                )
                case "text": return (
                  <Text key={s.id} id={s.id} x={s.x} y={s.y}
                    text={s.label||"Text"} fontSize={s.fontSize||14}
                    fontStyle={s.fontStyle||"normal"}
                    fill={s.textColor||(darkMode?"#eaeaf4":"#1a202c")}
                    opacity={s.opacity} wrap="word" width={Math.max(s.width,100)}
                    draggable={tool==="select"}
                    onClick={(e:any)=>{ e.cancelBubble=true; setSelected(e.evt.shiftKey ? (selected.includes(s.id)?selected.filter(x=>x!==s.id):[...selected,s.id]) : [s.id]) }}
                    onDblClick={(e:any)=>{ const abs=e.target.absolutePosition(); openEditor(s,abs.x/scale,abs.y/scale) }}
                    onDragEnd={(e:any)=>upsertShape({...s,x:e.target.x(),y:e.target.y()})}
                    onTransformEnd={(e:any)=>onTransformEnd(s,e.target)}
                  />
                )
                case "pen": return s.points ? (
                  <Line key={s.id} id={s.id} x={s.x} y={s.y} points={s.points}
                    stroke={s.stroke} strokeWidth={s.strokeWidth}
                    tension={0.5} lineCap="round" lineJoin="round" opacity={s.opacity}
                    onClick={(e:any)=>{ e.cancelBubble=true; setSelected([s.id]) }} />
                ) : null
                case "arrow": {
                  const pts = (s.points && s.points.length>=4) ? s.points : [s.x,s.y,s.x+(s.width||80),s.y+(s.height||0)]
                  const [x1,y1,x2,y2] = pts
                  return (
                    <Arrow key={s.id} id={s.id} x={x1} y={y1}
                      points={[0,0,x2-x1,y2-y1]}
                      fill={s.stroke} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      pointerLength={10} pointerWidth={8} opacity={s.opacity}
                      {...glow(s)}
                      draggable={tool==="select"}
                      onClick={(e:any)=>{ e.cancelBubble=true; setSelected([s.id]) }}
                      onDragEnd={(e:any)=>{
                        const dx=e.target.x()-x1, dy=e.target.y()-y1
                        upsertShape({...s,x:x1+dx,y:y1+dy,points:[x1+dx,y1+dy,x2+dx,y2+dy]})
                      }}
                    />
                  )
                }
                default: return null
              }
            })}

            {/* Rubber-band selection box */}
            {band && (
              <Rect x={band.x} y={band.y} width={band.w} height={band.h}
                fill="rgba(108,99,255,.08)" stroke="#6c63ff" strokeWidth={1}
                dash={[6,3]} listening={false} />
            )}

            {/* Resize / rotate handles */}
            <Transformer ref={trRef} keepRatio={false}
              boundBoxFunc={(o:any,n:any)=>n.width<10||n.height<10?o:n} />
          </Layer>
        </Stage>
      )}

      {/* ── Text editor overlay ── */}
      {textEd && (
        <div style={{
          position:"absolute",
          left: textEd.x * scale + pos.x,
          top:  textEd.y * scale + pos.y,
          zIndex: 50,
        }}>
          <textarea ref={taRef}
            defaultValue={textEd.value}
            style={{
              minWidth:  Math.max(textEd.w*scale,160),
              minHeight: Math.max(textEd.h*scale,60),
              fontSize:  textEd.fontSize*scale,
              fontFamily:"DM Mono, monospace",
              fontStyle: textEd.fontStyle,
              color:     textEd.color,
              background: darkMode?"rgba(12,12,16,.95)":"rgba(255,255,255,.95)",
              border:     "2px solid #6c63ff",
              borderRadius:8,outline:"none",
              padding:"8px 12px",resize:"both",
              caretColor:"#6c63ff",lineHeight:1.5,
              boxShadow:"0 0 0 4px rgba(108,99,255,.15)",
            }}
            placeholder="Type… Enter=newline · Esc=done"
            onKeyDown={e=>{ if(e.key==="Escape") commitText((e.target as HTMLTextAreaElement).value) }}
            onBlur={e=>commitText(e.target.value)}
          />
        </div>
      )}

      {/* ── Peer cursors ── */}
      {cursors.map(c => {
        const sx = c.x*scale+pos.x, sy = c.y*scale+pos.y
        return (
          <div key={c.socketId} style={{
            position:"absolute",left:sx,top:sy,
            pointerEvents:"none",zIndex:20,
            transform:"translate(-2px,-2px)",
            transition:"left .04s linear,top .04s linear",
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 8L8 9L6 14L2 2Z" fill={c.color} stroke="rgba(255,255,255,.7)" strokeWidth=".8"/>
            </svg>
            <span style={{ position:"absolute",top:13,left:13,background:c.color,borderRadius:4,padding:"2px 7px",fontSize:10,fontFamily:"DM Mono,monospace",color:"#fff",fontWeight:500,whiteSpace:"nowrap" }}>
              {c.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}