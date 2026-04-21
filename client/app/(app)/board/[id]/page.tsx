// app/(app)/board/[id]/page.tsx
// CRITICAL FIX: Duplicate key bug caused by Yjs Y.Map emitting observe
// for the same key multiple times when both local + remote apply the same update.
// Fix: deduplicate shapes by id before setting state.
"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import * as Y from "yjs"
import { connectSocket, disconnectSocket } from "@/lib/socket"
import { boardAPI } from "@/lib/api"
import { useAuthGuard } from "@/lib/useAuth"

const KonvaBoard = dynamic(() => import("./Konvaboard"), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#58587a", fontFamily: "monospace", fontSize: 13 }}>
      Loading canvas...
    </div>
  ),
})

export type ShapeType = "rect" | "ellipse" | "diamond" | "text" | "pen" | "arrow" | "triangle" | "star" | "cylinder" | "parallelogram"

export interface Shape {
  id:          string
  type:        ShapeType
  x:           number
  y:           number
  width:       number
  height:      number
  fill:        string
  stroke:      string
  strokeWidth: number
  label?:      string
  fontSize?:   number
  fontFamily?: string
  fontStyle?:  string   // "bold" | "italic" | "normal"
  textColor?:  string
  points?:     number[]
  opacity:     number
  rotation:    number
}

export interface Cursor {
  socketId: string; userId: string
  name: string; color: string; x: number; y: number
}

export type Tool = "select" | "rect" | "ellipse" | "diamond" | "triangle" | "cylinder" | "parallelogram" | "text" | "pen" | "arrow"

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "select",       icon: "↖",  label: "Select      V" },
  { id: "rect",         icon: "▭",  label: "Rectangle   R" },
  { id: "ellipse",      icon: "○",  label: "Ellipse     E" },
  { id: "diamond",      icon: "◇",  label: "Diamond     D" },
  { id: "triangle",     icon: "△",  label: "Triangle    G" },
  { id: "cylinder",     icon: "⬭",  label: "Cylinder    Y" },
  { id: "parallelogram",icon: "▱",  label: "Parallelogram" },
  { id: "text",         icon: "T",  label: "Text        T" },
  { id: "pen",          icon: "✏",  label: "Pen         P" },
  { id: "arrow",        icon: "→",  label: "Arrow       A" },
]

const PALETTE = [
  // existing
  "#6c63ff","#22d3a0","#f87171","#fbbf24","#3b82f6","#c084fc","#fb923c","#e2e8f0","#1a1a2e",

  // 🔥 vibrant
  "#ef4444","#f97316","#eab308","#84cc16","#10b981","#06b6d4","#0ea5e9","#6366f1","#a855f7","#ec4899",

  // 🌈 pastel
  "#fecaca","#fed7aa","#fef3c7","#d9f99d","#bbf7d0","#bae6fd","#bfdbfe","#ddd6fe","#fbcfe8",

  // 🌑 dark shades
  "#111827","#1f2937","#374151","#4b5563","#6b7280",

  // ⚪ light / neutral
  "#f8fafc","#f1f5f9","#e5e7eb","#d1d5db","#9ca3af"
];
// ── Normalize AI shapes so they render on Konva correctly ──
function normalizeAIShape(s: any): Shape {
  const base: Shape = {
    id:          s.id || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type:        (s.type || "rect") as ShapeType,
    x:           Number(s.x) || 100,
    y:           Number(s.y) || 100,
    width:       Number(s.width)  || 140,
    height:      Number(s.height) || 60,
    fill:        s.fill   || "#1a1535",
    stroke:      s.stroke || "#6c63ff",
    strokeWidth: Number(s.strokeWidth) || 1.5,
    label:       s.label  || "",
    fontSize:    Number(s.fontSize) || 14,
    opacity:     1,
    rotation:    0,
  }
  // AI arrows come with points[] already computed by ai.service.js
  if (base.type === "arrow" && !s.points) {
    base.points = [s.x, s.y, s.x + (s.width || 80), s.y + (s.height || 0)]
  }
  return base
}

// ── Deduplicate shapes by id — fixes duplicate key React warning ──
function dedupeShapes(shapes: Shape[]): Shape[] {
  const seen = new Map<string, Shape>()
  for (const s of shapes) seen.set(s.id, s)
  return Array.from(seen.values())
}

export default function BoardPage() {
  const { id: boardId } = useParams<{ id: string }>()
  const router = useRouter()
  const { ready } = useAuthGuard()

  const [shapes, setShapes]           = useState<Shape[]>([])
  const [cursors, setCursors]         = useState<Cursor[]>([])
  const [tool, setTool]               = useState<Tool>("rect")
  const [color, setColor]             = useState("#6c63ff")
  const [fillColor, setFillColor]     = useState("transparent")
  const [strokeColor, setStrokeColor] = useState("#6c63ff")
  const [strokeW, setStrokeW]         = useState(2)
  const [fontSize, setFontSize]       = useState(14)
  const [fontStyle, setFontStyle]     = useState<"normal"|"bold"|"italic">("normal")
  const [selected, setSelected]       = useState<string[]>([])
  const [boardTitle, setBoardTitle]   = useState("")
  const [members, setMembers]         = useState<{ id: string; name: string; color: string }[]>([])
  const [connected, setConnected]     = useState(false)
  const [statusMsg, setStatusMsg]     = useState("")
  const [darkMode, setDarkMode]       = useState(true)
  const [mounted, setMounted]         = useState(false)

  const [showAI, setShowAI]           = useState(false)
  const [aiPrompt, setAiPrompt]       = useState("")
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiShapes, setAiShapes]       = useState<Shape[] | null>(null)
  const [aiThinking, setAiThinking]   = useState("")
  const [aiMermaid, setAiMermaid]     = useState<string | null>(null)

  const [showVersions, setShowVersions] = useState(false)
  const [snapshots, setSnapshots]       = useState<{ index: number; label: string; savedAt: string }[]>([])

  const [showShare, setShowShare]     = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviting, setInviting]       = useState(false)
  const [shareLink, setShareLink]     = useState("")
  const [inviteMsg, setInviteMsg]     = useState("")
  const [copiedLink, setCopiedLink]   = useState(false)

  // Property panel for selected shapes
  const [showProps, setShowProps]     = useState(false)

  const isApplyingRemote = useRef(false)   // prevents echo loop
  const ydocRef      = useRef<Y.Doc | null>(null)
  const shapesMapRef = useRef<Y.Map<Shape> | null>(null)
  const stageRef     = useRef<any>(null)
  const cursorThrottle = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setMounted(true) }, [])

  // ── Socket + Yjs ──
  useEffect(() => {
    if (!ready || !boardId) return

    const ydoc    = new Y.Doc()
    const yShapes = ydoc.getMap<Shape>("shapes")
    ydocRef.current     = ydoc
    shapesMapRef.current = yShapes

    // observeDeep fires ONCE per transaction (not once per key change).
    // This prevents multiple React state updates when inserting many shapes at once,
    // which was causing intermediate renders and stale closure issues.
    const syncShapesToReact = () => {
      const all = Array.from(yShapes.values())
      setShapes(dedupeShapes(all))
    }
    yShapes.observe(syncShapesToReact)

    const socket = connectSocket()
    setConnected(socket.connected)

    const onConnect = () => {
      setConnected(true)
      socket.emit("board:join", { boardId })
    }
    socket.on("connect",    onConnect)
    socket.on("disconnect", () => setConnected(false))

    socket.on("yjs:full_state", ({ update, boardTitle: t }: any) => {
      if (t) setBoardTitle(t)
      const uint8 = new Uint8Array(Buffer.from(update, "base64"))
      // Mark as remote so ydoc.on("update") does not re-broadcast
      isApplyingRemote.current = true
      try {
        const freshDoc    = new Y.Doc()
        const freshShapes = freshDoc.getMap<Shape>("shapes")
        Y.applyUpdate(freshDoc, uint8)
        // Single transact = single observe() call = single React render
        ydoc.transact(() => {
          yShapes.forEach((_: Shape, k: string) => yShapes.delete(k))
          freshShapes.forEach((v: Shape, k: string) => yShapes.set(k, v))
        }, "remote")
        freshDoc.destroy()
      } catch {
        Y.applyUpdate(ydoc, uint8)
      } finally {
        isApplyingRemote.current = false
      }
    })

    // When applying a remote update, set flag so ydoc.on("update") skips
    // re-broadcasting it back to the server (breaks the echo loop).
    socket.on("yjs:update", ({ update }: any) => {
      if (!update) return
      isApplyingRemote.current = true
      try {
        Y.applyUpdate(ydoc, new Uint8Array(Buffer.from(update, "base64")))
      } catch (err) {
        console.warn("[yjs] Failed to apply remote update:", err)
      } finally {
        isApplyingRemote.current = false
      }
    })

    socket.on("cursor:update", (c: Cursor) =>
      setCursors(prev => [...prev.filter(x => x.socketId !== c.socketId), c])
    )
    socket.on("cursor:remove", ({ socketId }: any) =>
      setCursors(prev => prev.filter(c => c.socketId !== socketId))
    )
    socket.on("presence:update", ({ users }: any) => setMembers(users))

    socket.on("ai:thinking",      ({ userName }: any) => { setAiThinking(`${userName} generating...`); setAiLoading(true) })
    socket.on("ai:thinking_done", ()                  => { setAiThinking(""); setAiLoading(false) })
    socket.on("ai:result",        ({ shapes: s }: any) => {
      setAiShapes(s.map(normalizeAIShape))
      setAiLoading(false)
    })
    socket.on("ai:placed",  ()             => { setAiShapes(null); setAiPrompt(""); setAiMermaid(null) })
    socket.on("ai:error",   ({ msg }: any) => {
      setStatusMsg(`AI: ${msg}`)
      setAiLoading(false)
      setTimeout(() => setStatusMsg(""), 5000)
    })
    socket.on("board:snapshot_saved", () => {
      setStatusMsg("✓ Saved")
      setTimeout(() => setStatusMsg(""), 2000)
    })

    if (socket.connected) socket.emit("board:join", { boardId })

    // Only broadcast updates that WE created locally.
    // If isApplyingRemote is true, it means we're processing
    // a server-sent update — never re-broadcast those.
    const onYjsUpdate = (update: Uint8Array) => {
      if (isApplyingRemote.current) return
      socket.emit("yjs:update", {
        boardId,
        update: Buffer.from(update).toString("base64"),
        opMeta: { type: "draw" },
      })
    }
    ydoc.on("update", onYjsUpdate)

    return () => {
      ydoc.off("update", onYjsUpdate)
      socket.off("connect"); socket.off("disconnect")
      socket.off("yjs:full_state"); socket.off("yjs:update")
      socket.off("cursor:update"); socket.off("cursor:remove")
      socket.off("presence:update")
      socket.off("ai:thinking"); socket.off("ai:thinking_done")
      socket.off("ai:result"); socket.off("ai:placed"); socket.off("ai:error")
      socket.off("board:snapshot_saved")
      socket.emit("board:leave", { boardId })
      disconnectSocket()
    }
  }, [ready, boardId])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const map: Record<string, Tool> = {
      v: "select", r: "rect", e: "ellipse", d: "diamond",
      g: "triangle", y: "cylinder", t: "text", p: "pen", a: "arrow",
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return
      const t = map[ev.key.toLowerCase()]
      if (t) { setTool(t); return }
      if ((ev.key === "Delete" || ev.key === "Backspace") && selected.length > 0) {
        selected.forEach(id => deleteShape(id))
        setSelected([])
        return
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") {
        ev.preventDefault()
        connectSocket().emit("board:snapshot", { boardId, label: "Manual save" })
      }
      if (ev.key === "Escape") setSelected([])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, boardId])

  // ── Yjs shape helpers ──
  const upsertShape = useCallback((shape: Shape) => {
    if (!shapesMapRef.current || !ydocRef.current) return
    ydocRef.current.transact(() => {
      shapesMapRef.current!.set(shape.id, shape)
    }, "local")
  }, [])

  const upsertShapes = useCallback((newShapes: Shape[]) => {
    if (!shapesMapRef.current || !ydocRef.current) return
    ydocRef.current.transact(() => {
      newShapes.forEach(s => shapesMapRef.current!.set(s.id, s))
    }, "local")
  }, [])

  const deleteShape = useCallback((id: string) => {
    if (!shapesMapRef.current || !ydocRef.current) return
    ydocRef.current.transact(() => {
      shapesMapRef.current!.delete(id)
    }, "local")
  }, [])

  const broadcastCursor = useCallback((x: number, y: number) => {
    if (cursorThrottle.current) clearTimeout(cursorThrottle.current)
    cursorThrottle.current = setTimeout(() => {
      connectSocket().emit("cursor:move", { boardId, x: Math.round(x), y: Math.round(y) })
    }, 50)
  }, [boardId])

  // ── Update properties of selected shapes ──
  const updateSelectedShapes = useCallback((patch: Partial<Shape>) => {
    selected.forEach(id => {
      const s = shapes.find(sh => sh.id === id)
      if (s) upsertShape({ ...s, ...patch })
    })
  }, [selected, shapes, upsertShape])

  // ── AI ──
  const handleAIGenerate = () => {
    if (!aiPrompt.trim() || aiLoading) return
    setAiLoading(true)
    setAiMermaid(null)
    connectSocket().emit("ai:generate", { boardId, prompt: aiPrompt.trim() })
  }

  const handleAIPlace = () => {
    if (!aiShapes || aiShapes.length === 0) return
    // Only emit to server — server inserts into Yjs and broadcasts back.
    // Do NOT also insert locally (would create duplicates).
    connectSocket().emit("ai:place", { boardId, shapes: aiShapes, prompt: aiPrompt })
    setAiShapes(null)
    setAiPrompt("")
  }

  // ── Version history ──
  const loadSnapshots = async () => {
    try {
      const data = await boardAPI.getSnapshots(boardId)
      setSnapshots([...data.snapshots].reverse())
    } catch {}
    setShowVersions(true)
  }

  const handleRewind = (index: number) => {
    connectSocket().emit("board:rewind", { boardId, snapshotIndex: index })
    setShowVersions(false)
    setStatusMsg("✓ Restored")
    setTimeout(() => setStatusMsg(""), 3000)
  }

  // ── Share ──
  const openShare = () => {
    setShareLink(typeof window !== "undefined" ? window.location.href : "")
    setShowShare(true)
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true); setInviteMsg("")
    try {
      await boardAPI.addMember(boardId, inviteEmail.trim())
      setInviteMsg(`✓ ${inviteEmail} added!`)
      setInviteEmail("")
    } catch (err: any) {
      setInviteMsg(`✗ ${err.message}`)
    } finally { setInviting(false) }
  }

  if (!ready) return <Loader />

  const dm = darkMode
  const bg       = dm ? "#0c0c10" : "#f8f9fa"
  const surface  = dm ? "#131318" : "#ffffff"
  const border   = dm ? "#22222e" : "#e2e8f0"
  const text     = dm ? "#eaeaf4" : "#1a202c"
  const muted    = dm ? "#58587a" : "#64748b"

  const selectedShapes = shapes.filter(s => selected.includes(s.id))
  const firstSelected  = selectedShapes[0]

  return (
    <>
      <style>{getStyles(dm)}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: bg, overflow: "hidden", color: text }}>

        {/* ── TOP BAR ── */}
        <header className="topbar" style={{ background: surface, borderColor: border }}>
          <button className="back-btn" style={{ color: muted }} onClick={() => router.push("/dashboard")}>← Dashboard</button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className={`status-dot${connected ? " on" : ""}`} title={connected ? "Live" : "Connecting..."} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 500 }}>{boardTitle || "Loading..."}</span>
          </div>

          {statusMsg  && <span className="status-pill">{statusMsg}</span>}
          {aiThinking && <span className="ai-pill mono">{aiThinking}</span>}

          <div className="topbar-right">
            {/* presence */}
            <div style={{ display: "flex" }}>
              {members.slice(0, 5).map((m, i) => (
                <div key={m.id} title={m.name} className="avatar" style={{ background: m.color, marginLeft: i > 0 ? -8 : 0 }}>
                  {m.name?.[0]?.toUpperCase()}
                </div>
              ))}
              {members.length > 5 && (
                <div className="avatar" style={{ background: muted, marginLeft: -8, fontSize: 9 }}>+{members.length - 5}</div>
              )}
            </div>

            <button className="tb-btn accent" onClick={openShare}>⇗ Share</button>
            <button className={`tb-btn${showAI ? " active" : ""}`} onClick={() => setShowAI(s => !s)}>✦ AI</button>
            <button className="tb-btn" onClick={loadSnapshots}>◷ History</button>
            <button className="tb-btn" onClick={() => setDarkMode(d => !d)} title="Toggle dark/light mode">
              {darkMode ? "☀" : "🌙"}
            </button>
            <button className="tb-btn" onClick={() => {
              if (stageRef.current) {
                const uri = stageRef.current.toDataURL({ pixelRatio: 2 })
                const a = document.createElement("a"); a.href = uri
                a.download = `${boardTitle || "board"}.png`; a.click()
              }
            }}>↓ Export</button>
          </div>
        </header>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── LEFT TOOLBAR ── */}
          <aside className="sidebar" style={{ background: surface, borderColor: border }}>
            {TOOLS.map(t => (
              <button key={t.id} className={`tool-btn${tool === t.id ? " active" : ""}`} onClick={() => setTool(t.id)} title={t.label}>
                {t.icon}
              </button>
            ))}

            <div className="divider" style={{ background: border }} />

            {/* Stroke color palette */}
            <div title="Stroke color" style={{ fontSize: 9, color: muted, fontFamily: "var(--mono)", marginBottom: 2 }}>STK</div>
            {PALETTE.map(c => (
              <button key={c} className="color-dot" title={c} onClick={() => { setStrokeColor(c); setColor(c) }}
                style={{ background: c, outline: strokeColor === c ? "2px solid #fff" : "2px solid transparent", outlineOffset: 2 }} />
            ))}

            <div className="divider" style={{ background: border }} />

            {/* Fill color palette */}
            <div title="Fill color" style={{ fontSize: 9, color: muted, fontFamily: "var(--mono)", marginBottom: 2 }}>FILL</div>
            <button className="color-dot" title="No fill" onClick={() => setFillColor("transparent")}
              style={{ background: "transparent", border: "2px dashed #6c63ff", outline: fillColor === "transparent" ? "2px solid #fff" : "2px solid transparent", outlineOffset: 2 }} />
            {PALETTE.map(c => (
              <button key={`f${c}`} className="color-dot" title={c} onClick={() => setFillColor(c)}
                style={{ background: c, outline: fillColor === c ? "2px solid #fff" : "2px solid transparent", outlineOffset: 2 }} />
            ))}

            <div className="divider" style={{ background: border }} />

            {/* Stroke width */}
            <div style={{ fontSize: 9, color: muted, fontFamily: "var(--mono)" }}>W</div>
            {[1, 2, 3, 4].map(w => (
              <button key={w} onClick={() => setStrokeW(w)} title={`Stroke ${w}px`}
                style={{ width: 28, height: 20, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 18, height: w, background: strokeW === w ? "#6c63ff" : muted, borderRadius: 1 }} />
              </button>
            ))}
          </aside>

          {/* ── CANVAS ── */}
          {mounted && (
            <KonvaBoard
              stageRef={stageRef}
              shapes={shapes}
              cursors={cursors}
              tool={tool}
              strokeColor={strokeColor}
              fillColor={fillColor}
              strokeWidth={strokeW}
              fontSize={fontSize}
              fontStyle={fontStyle}
              selected={selected}
              setSelected={setSelected}
              upsertShape={upsertShape}
              deleteShape={deleteShape}
              broadcastCursor={broadcastCursor}
              boardId={boardId}
              darkMode={darkMode}
            />
          )}

          {/* ── PROPERTIES PANEL (when shapes are selected) ── */}
          {selected.length > 0 && (
            <aside className="props-panel" style={{ background: surface, borderColor: border, color: text }}>
              <div className="panel-hdr" style={{ borderColor: border }}>
                <span className="mono" style={{ fontSize: 11, color: "#6c63ff" }}>// properties</span>
                <button className="icon-btn" onClick={() => setSelected([])}>✕</button>
              </div>
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ fontSize: 11, color: muted }}>
                  {selected.length} shape{selected.length > 1 ? "s" : ""} selected
                </p>

                {/* Fill */}
                <div>
                  <label className="prop-label" style={{ color: muted }}>Fill color</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    <button onClick={() => updateSelectedShapes({ fill: "transparent" })}
                      style={{ width: 20, height: 20, borderRadius: "50%", background: "transparent", border: "2px dashed #6c63ff", cursor: "pointer" }} />
                    {PALETTE.map(c => (
                      <button key={c} onClick={() => updateSelectedShapes({ fill: c })}
                        style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: firstSelected?.fill === c ? "2px solid #fff" : "none", cursor: "pointer" }} />
                    ))}
                  </div>
                </div>

                {/* Stroke */}
                <div>
                  <label className="prop-label" style={{ color: muted }}>Stroke color</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {PALETTE.map(c => (
                      <button key={c} onClick={() => updateSelectedShapes({ stroke: c })}
                        style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: firstSelected?.stroke === c ? "2px solid #fff" : "none", cursor: "pointer" }} />
                    ))}
                  </div>
                </div>

                {/* Stroke width */}
                <div>
                  <label className="prop-label" style={{ color: muted }}>Stroke width</label>
                  <input type="range" min="1" max="8" step="1"
                    value={firstSelected?.strokeWidth || 2}
                    onChange={e => updateSelectedShapes({ strokeWidth: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </div>

                {/* Opacity */}
                <div>
                  <label className="prop-label" style={{ color: muted }}>Opacity</label>
                  <input type="range" min="0.1" max="1" step="0.05"
                    value={firstSelected?.opacity || 1}
                    onChange={e => updateSelectedShapes({ opacity: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </div>

                {/* Text properties (only for text/rect/ellipse) */}
                {firstSelected && ["text","rect","ellipse","diamond"].includes(firstSelected.type) && (
                  <>
                    <div>
                      <label className="prop-label" style={{ color: muted }}>Font size</label>
                      <input type="number" min="8" max="72" value={firstSelected?.fontSize || 14}
                        onChange={e => updateSelectedShapes({ fontSize: Number(e.target.value) })}
                        className="prop-input" style={{ background: dm ? "#1a1a22" : "#f1f5f9", color: text, borderColor: border }}
                      />
                    </div>
                    <div>
                      <label className="prop-label" style={{ color: muted }}>Font style</label>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        {(["normal","bold","italic"] as const).map(fs => (
                          <button key={fs} onClick={() => updateSelectedShapes({ fontStyle: fs })}
                            className={`style-btn${firstSelected?.fontStyle === fs ? " active" : ""}`}>
                            {fs === "normal" ? "N" : fs === "bold" ? "B" : "I"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="prop-label" style={{ color: muted }}>Text color</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {["#eaeaf4","#1a202c","#6c63ff","#22d3a0","#f87171","#fbbf24"].map(c => (
                          <button key={c} onClick={() => updateSelectedShapes({ textColor: c })}
                            style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: firstSelected?.textColor === c ? "2px solid #6c63ff" : "none", cursor: "pointer" }} />
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Delete */}
                <button
                  onClick={() => { selected.forEach(id => deleteShape(id)); setSelected([]) }}
                  style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", color: "#f87171", padding: "8px", borderRadius: "var(--r)", fontSize: 12, cursor: "pointer", fontFamily: "var(--sans)", marginTop: 4 }}
                >
                  Delete selected
                </button>
              </div>
            </aside>
          )}

          {/* ── AI PANEL ── */}
          {showAI && (
            <aside className="side-panel" style={{ background: surface, borderColor: border }}>
              <div className="panel-hdr" style={{ borderColor: border }}>
                <span className="mono" style={{ fontSize: 11, color: "#6c63ff" }}>// AI diagram</span>
                <button className="icon-btn" onClick={() => setShowAI(false)}>✕</button>
              </div>
              <div className="panel-body">
                <p style={{ fontSize: 12, color: muted, lineHeight: 1.65 }}>
                  Describe a diagram. AI builds it with connected shapes. Try "ATM withdrawal flowchart", "login system", or "microservices for e-commerce".
                </p>
                <textarea
                  className="ai-input" rows={4}
                  style={{ background: dm ? "#1a1a22" : "#f1f5f9", color: text, borderColor: border }}
                  placeholder="ATM withdrawal flowchart..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAIGenerate() } }}
                />
                <p className="mono" style={{ fontSize: 10, color: muted, textAlign: "center" }}>⌘+Enter to generate</p>
                <button className={`ai-btn${!aiPrompt.trim() || aiLoading ? " dim" : ""}`}
                  disabled={!aiPrompt.trim() || aiLoading} onClick={handleAIGenerate}>
                  {aiLoading ? <><span className="spinner" /> Generating...</> : "✦ Generate diagram"}
                </button>

                {aiShapes && (
                  <div className="ai-preview">
                    <span className="mono" style={{ fontSize: 11, color: "#22d3a0" }}>
                      ✓ {aiShapes.length} shapes ready
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="place-btn" onClick={handleAIPlace}>Place on canvas</button>
                      <button className="discard-btn" onClick={() => { setAiShapes(null); setAiPrompt("") }}>Discard</button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ── SHARE MODAL ── */}
      {showShare && (
        <div className="overlay" onClick={() => { setShowShare(false); setInviteMsg("") }}>
          <div className="modal" style={{ background: surface, borderColor: border, color: text }} onClick={e => e.stopPropagation()}>
            <div className="modal-hdr"><h3>Share &amp; invite</h3><button className="icon-btn" onClick={() => setShowShare(false)}>✕</button></div>
            <p className="modal-label" style={{ color: muted }}>Board link:</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <div className="link-preview mono" style={{ background: dm ? "#1a1a22" : "#f1f5f9", color: muted }}>{shareLink}</div>
              <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(shareLink); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) }}>
                {copiedLink ? "✓" : "Copy"}
              </button>
            </div>
            <p className="modal-label" style={{ color: muted }}>Invite as editor:</p>
            <form onSubmit={handleInvite} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="modal-input" type="email" placeholder="teammate@example.com"
                value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteMsg("") }} required
                style={{ background: dm ? "#1a1a22" : "#f1f5f9", color: text, borderColor: border }} />
              {inviteMsg && <p className="mono" style={{ fontSize: 12, color: inviteMsg.startsWith("✓") ? "#22d3a0" : "#f87171" }}>{inviteMsg}</p>}
              <button type="submit" className="invite-btn" disabled={inviting}>{inviting ? "Sending..." : "Send invite →"}</button>
            </form>
            {members.length > 0 && (
              <>
                <p className="modal-label" style={{ color: muted, marginTop: 18 }}>Online now ({members.length}):</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {members.map(m => (
                    <div key={m.id} className="member-row" style={{ background: dm ? "#1a1a22" : "#f1f5f9" }}>
                      <div className="avatar sm" style={{ background: m.color }}>{m.name?.[0]?.toUpperCase()}</div>
                      <span style={{ fontSize: 13 }}>{m.name}</span>
                      <div className="online-dot" style={{ marginLeft: "auto" }} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── VERSION HISTORY MODAL ── */}
      {showVersions && (
        <div className="overlay" onClick={() => setShowVersions(false)}>
          <div className="modal" style={{ background: surface, borderColor: border, color: text }} onClick={e => e.stopPropagation()}>
            <div className="modal-hdr"><h3>Version history</h3><button className="icon-btn" onClick={() => setShowVersions(false)}>✕</button></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
              {snapshots.length === 0
                ? <p className="mono" style={{ fontSize: 12, color: muted }}>No snapshots yet.</p>
                : snapshots.map(s => (
                  <div key={s.index} className="snap-row" style={{ background: dm ? "#1a1a22" : "#f1f5f9", borderColor: border }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</p>
                      <p className="mono" style={{ fontSize: 10, color: muted, marginTop: 2 }}>{new Date(s.savedAt).toLocaleString()}</p>
                    </div>
                    <button className="restore-btn" onClick={() => handleRewind(s.index)}>Restore</button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Loader() {
  return (
    <div style={{ minHeight: "100vh", background: "#0c0c10", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
      <div style={{ display: "flex", gap: 6 }}>
        {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#6c63ff", animation: `pulse 1.2s ease-in-out ${i*.18}s infinite` }} />)}
      </div>
    </div>
  )
}

function getStyles(dm: boolean) {
  return `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;--r:10px;--rl:14px}
html,body{height:100%;overflow:hidden}
body{font-family:var(--sans);-webkit-font-smoothing:antialiased}
button{cursor:pointer;font-family:var(--sans)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#2e2e3e;border-radius:2px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes popIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.mono{font-family:var(--mono)}
.topbar{display:flex;align-items:center;gap:10px;padding:0 14px;height:50px;border-bottom:1px solid;flex-shrink:0;z-index:10}
.back-btn{background:transparent;border:none;font-family:var(--mono);font-size:12px;cursor:pointer;transition:color .15s;white-space:nowrap}
.status-dot{width:7px;height:7px;border-radius:50%;background:#f87171;flex-shrink:0;transition:all .3s}
.status-dot.on{background:#22d3a0;box-shadow:0 0 6px #22d3a0}
.status-pill{font-family:var(--mono);font-size:11px;color:#22d3a0;background:rgba(34,211,160,.08);border:1px solid rgba(34,211,160,.2);border-radius:20px;padding:3px 10px;animation:fadeIn .2s ease;white-space:nowrap}
.ai-pill{font-size:11px;color:#6c63ff;animation:pulse 1.5s ease-in-out infinite;white-space:nowrap}
.topbar-right{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}
.avatar{width:26px;height:26px;border-radius:50%;border:2px solid transparent;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;font-family:var(--mono);flex-shrink:0}
.avatar.sm{width:22px;height:22px;font-size:9px}
.tb-btn{background:transparent;border:1px solid;padding:5px 11px;border-radius:var(--r);font-size:12px;transition:all .15s;white-space:nowrap}
.tb-btn.active{border-color:rgba(108,99,255,.5);color:#6c63ff;background:rgba(108,99,255,.1)}
.tb-btn.accent{background:#6c63ff;border:none;color:#fff;font-weight:700}
.tb-btn.accent:hover{box-shadow:0 0 14px rgba(108,99,255,.45);transform:translateY(-1px)}
.sidebar{width:50px;border-right:1px solid;display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:3px;flex-shrink:0;z-index:5;overflow-y:auto}
.tool-btn{width:34px;height:34px;border-radius:var(--r);background:transparent;border:1px solid transparent;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
.tool-btn.active{background:rgba(108,99,255,.15);border-color:rgba(108,99,255,.5);color:#6c63ff}
.color-dot{width:20px;height:20px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;transition:transform .15s,outline .15s}
.color-dot:hover{transform:scale(1.15)}
.divider{width:28px;height:1px;margin:3px 0;flex-shrink:0}
.props-panel{width:220px;border-left:1px solid;display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto}
.side-panel{width:280px;border-left:1px solid;display:flex;flex-direction:column;flex-shrink:0;animation:slideR .25s cubic-bezier(.22,1,.36,1)}
@keyframes slideR{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
.panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid}
.panel-body{padding:14px;display:flex;flex-direction:column;gap:11px;flex:1;overflow-y:auto}
.icon-btn{background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1;transition:color .15s}
.ai-input{background:transparent;border:1px solid;border-radius:var(--r);padding:10px 12px;font-size:12px;font-family:var(--mono);resize:none;outline:none;width:100%;transition:border-color .2s}
.ai-btn{background:#6c63ff;border:none;color:#fff;padding:11px;border-radius:var(--r);font-size:13px;font-weight:700;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;transition:box-shadow .2s;font-family:var(--sans)}
.ai-btn:hover:not(.dim){box-shadow:0 0 16px rgba(108,99,255,.4)}
.ai-btn.dim{background:#2e2e3e;color:#58587a;cursor:not-allowed}
.spinner{width:12px;height:12px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;flex-shrink:0}
.ai-preview{border:1px solid rgba(108,99,255,.3);border-radius:var(--r);padding:12px;background:rgba(108,99,255,.05);display:flex;flex-direction:column;gap:10px;animation:fadeIn .3s ease}
.place-btn{flex:1;background:#6c63ff;border:none;color:#fff;padding:9px;border-radius:var(--r);font-size:12px;font-weight:700;cursor:pointer;font-family:var(--sans)}
.discard-btn{background:transparent;border:1px solid;padding:9px 12px;border-radius:var(--r);font-size:12px;cursor:pointer}
.prop-label{font-size:11px;font-family:var(--mono);letter-spacing:.04em;display:block}
.prop-input{width:100%;background:transparent;border:1px solid;border-radius:var(--r);padding:6px 8px;font-size:13px;font-family:var(--mono);outline:none;margin-top:6px}
.style-btn{width:28px;height:28px;border-radius:6px;background:transparent;border:1px solid;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}
.style-btn.active{background:rgba(108,99,255,.15);border-color:rgba(108,99,255,.5);color:#6c63ff}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:200;backdrop-filter:blur(4px);animation:fadeIn .15s ease}
.modal{border:1px solid;border-radius:var(--rl);padding:24px 26px;max-width:400px;width:90%;animation:popIn .2s cubic-bezier(.22,1,.36,1);max-height:85vh;overflow-y:auto}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.modal-hdr h3{font-size:17px;font-weight:700}
.modal-label{font-size:12px;margin-bottom:7px}
.link-preview{flex:1;border:1px solid;border-radius:var(--r);padding:8px 12px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.copy-btn{background:#6c63ff;border:none;color:#fff;padding:8px 16px;border-radius:var(--r);font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0}
.modal-input{width:100%;border:1px solid;border-radius:var(--r);padding:10px 13px;font-size:13px;font-family:var(--mono);outline:none;transition:border-color .2s}
.invite-btn{background:#6c63ff;border:none;color:#fff;padding:11px;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--sans)}
.member-row{display:flex;align-items:center;gap:10px;border-radius:var(--r);padding:8px 12px}
.online-dot{width:6px;height:6px;border-radius:50%;background:#22d3a0;box-shadow:0 0 5px #22d3a0}
.snap-row{display:flex;align-items:center;gap:12px;border:1px solid;border-radius:var(--r);padding:10px 12px}
.restore-btn{background:#6c63ff;border:none;color:#fff;padding:5px 12px;border-radius:var(--r);font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0}
`
}