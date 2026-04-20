// app/(app)/board/[id]/page.tsx
// KEY FIXES:
// 1. All Konva imports in ONE dynamic() call — fixes "Cannot use 'in' operator" SSR error
// 2. Drawing: mousedown on Stage itself only — no condition blocking it
// 3. AI shapes: arrow type uses points[] not width/height, all shapes normalize correctly
"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import * as Y from "yjs"
import { connectSocket, disconnectSocket } from "@/lib/socket"
import { boardAPI } from "@/lib/api"
import { useAuthGuard } from "@/lib/useAuth"

/* ── CRITICAL: Import ALL Konva components in ONE dynamic() ──────────
   Importing them separately (Stage in one, Layer in another) causes
   "Cannot use 'in' operator to search for 'default' in Layer"
   because each dynamic() creates a separate module evaluation context. */
const KonvaBoard = dynamic(() => import("./Konvaboard"), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#58587a", fontFamily: "monospace", fontSize: 13 }}>
      Loading canvas...
    </div>
  ),
})

/* ── Types ── */
type Tool = "select" | "rect" | "ellipse" | "text" | "pen" | "arrow"

export interface Shape {
  id: string; type: string
  x: number; y: number; width: number; height: number
  fill: string; stroke: string; strokeWidth: number
  label?: string; fontSize?: number
  points?: number[]     // for pen strokes
  opacity: number; rotation: number
}

interface Cursor {
  socketId: string; userId: string
  name: string; color: string; x: number; y: number
}

/* ── Config ── */
const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "select",  icon: "↖", label: "Select  V" },
  { id: "rect",    icon: "▭", label: "Rect    R" },
  { id: "ellipse", icon: "○", label: "Ellipse E" },
  { id: "text",    icon: "T", label: "Text    T" },
  { id: "pen",     icon: "✏", label: "Pen     P" },
  { id: "arrow",   icon: "→", label: "Arrow   A" },
]

const PALETTE = ["#6c63ff","#22d3a0","#f87171","#fbbf24","#3b82f6","#c084fc","#fb923c","#e2e8f0","#1a1a2e"]

/* ── Normalize AI shapes so they render correctly on Konva ── */
function normalizeAIShape(s: any): Shape {
  const base: Shape = {
    id:          s.id || `ai-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type:        s.type || "rect",
    x:           Number(s.x) || 100,
    y:           Number(s.y) || 100,
    width:       Number(s.width)  || 140,
    height:      Number(s.height) || 60,
    fill:        s.fill   || "#1a1a2e",
    stroke:      s.stroke || "#6c63ff",
    strokeWidth: Number(s.strokeWidth) || 1.5,
    label:       s.label  || "",
    fontSize:    Number(s.fontSize) || 13,
    opacity:     1,
    rotation:    0,
  }
  // AI arrows use width/height as direction vector → convert to points[]
  if (base.type === "arrow") {
    base.points = [0, 0, base.width, base.height]
    base.width  = 0
    base.height = 0
  }
  return base
}

/* ════════════════════════════════════════════════════════════════════
   Main page component — handles all socket/Yjs logic
   KonvaBoard handles all canvas rendering
════════════════════════════════════════════════════════════════════ */
export default function BoardPage() {
  const { id: boardId } = useParams<{ id: string }>()
  const router = useRouter()
  const { ready } = useAuthGuard()

  /* ── State ── */
  const [shapes, setShapes]         = useState<Shape[]>([])
  const [cursors, setCursors]       = useState<Cursor[]>([])
  const [tool, setTool]             = useState<Tool>("rect")
  const [color, setColor]           = useState("#6c63ff")
  const [selected, setSelected]     = useState<string | null>(null)
  const [boardTitle, setBoardTitle] = useState("")
  const [members, setMembers]       = useState<{ id: string; name: string; color: string }[]>([])
  const [connected, setConnected]   = useState(false)
  const [statusMsg, setStatusMsg]   = useState("")
  const [mounted, setMounted]       = useState(false)

  /* ── AI ── */
  const [showAI, setShowAI]         = useState(false)
  const [aiPrompt, setAiPrompt]     = useState("")
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiShapes, setAiShapes]     = useState<Shape[] | null>(null)
  const [aiThinking, setAiThinking] = useState("")

  /* ── Versions ── */
  const [showVersions, setShowVersions] = useState(false)
  const [snapshots, setSnapshots] = useState<{ index: number; label: string; savedAt: string }[]>([])

  /* ── Share ── */
  const [showShare, setShowShare]   = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviting, setInviting]     = useState(false)
  const [shareLink, setShareLink]   = useState("")
  const [inviteMsg, setInviteMsg]   = useState("")
  const [copiedLink, setCopiedLink] = useState(false)

  /* ── Yjs refs ── */
  const ydocRef       = useRef<Y.Doc | null>(null)
  const shapesMapRef  = useRef<Y.Map<Shape> | null>(null)
  const stageRef      = useRef<any>(null)
  const cursorThrottle = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setMounted(true) }, [])

  /* ── Socket + Yjs ── */
  useEffect(() => {
    if (!ready || !boardId) return

    const ydoc    = new Y.Doc()
    const yShapes = ydoc.getMap<Shape>("shapes")
    ydocRef.current     = ydoc
    shapesMapRef.current = yShapes

    yShapes.observe(() => setShapes(Array.from(yShapes.values())))

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

      // For a version restore the server sends the FULL state of a
      // previous snapshot. We must replace the current doc contents,
      // not just merge the delta — otherwise deleted shapes reappear.
      // Strategy: apply to a fresh doc, then transact-replace our live doc.
      try {
        const freshDoc    = new Y.Doc()
        const freshShapes = freshDoc.getMap<Shape>("shapes")
        Y.applyUpdate(freshDoc, uint8)

        ydoc.transact(() => {
          // Clear every existing shape key
          yShapes.forEach((_: Shape, k: string) => yShapes.delete(k))
          // Insert everything from the restored snapshot
          freshShapes.forEach((v: Shape, k: string) => yShapes.set(k, v))
        }, "remote")   // mark as remote so we don't re-broadcast it

        freshDoc.destroy()
      } catch {
        // Fallback: just apply the update (works for initial join)
        Y.applyUpdate(ydoc, uint8)
      }
    })
    socket.on("yjs:update", ({ update }: any) => {
      Y.applyUpdate(ydoc, new Uint8Array(Buffer.from(update, "base64")))
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
      // Normalize AI shapes before setting them as preview
      setAiShapes(s.map(normalizeAIShape))
      setAiLoading(false)
    })
    socket.on("ai:placed",        ()             => { setAiShapes(null); setAiPrompt("") })
    socket.on("ai:error",         ({ msg }: any) => {
      setStatusMsg(`AI: ${msg}`)
      setAiLoading(false)
      setTimeout(() => setStatusMsg(""), 5000)
    })
    socket.on("board:snapshot_saved", () => {
      setStatusMsg("✓ Saved")
      setTimeout(() => setStatusMsg(""), 2000)
    })

    if (socket.connected) socket.emit("board:join", { boardId })

    const onYjsUpdate = (update: Uint8Array, origin: any) => {
      if (origin === "remote") return
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

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const map: Record<string, Tool> = {
      v: "select", r: "rect", e: "ellipse",
      t: "text",   p: "pen",  a: "arrow",
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return
      const t = map[ev.key.toLowerCase()]
      if (t) { setTool(t); return }
      if ((ev.key === "Delete" || ev.key === "Backspace") && selected) {
        deleteShape(selected); setSelected(null); return
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") {
        ev.preventDefault()
        connectSocket().emit("board:snapshot", { boardId, label: "Manual save" })
      }
      if (ev.key === "Escape") { setSelected(null) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, boardId])

  /* ── Yjs shape helpers ── */
  const upsertShape = useCallback((shape: Shape) => {
    if (!shapesMapRef.current || !ydocRef.current) return
    ydocRef.current.transact(() => {
      shapesMapRef.current!.set(shape.id, shape)
    }, "local")
  }, [])

  const deleteShape = useCallback((id: string) => {
    if (!shapesMapRef.current || !ydocRef.current) return
    ydocRef.current.transact(() => {
      shapesMapRef.current!.delete(id)
    }, "local")
  }, [])

  /* ── Cursor broadcast ── */
  const broadcastCursor = useCallback((x: number, y: number) => {
    if (cursorThrottle.current) clearTimeout(cursorThrottle.current)
    cursorThrottle.current = setTimeout(() => {
      connectSocket().emit("cursor:move", { boardId, x: Math.round(x), y: Math.round(y) })
    }, 50)
  }, [boardId])

  /* ── AI ── */
  const handleAIGenerate = () => {
    if (!aiPrompt.trim() || aiLoading) return
    setAiLoading(true)
    connectSocket().emit("ai:generate", { boardId, prompt: aiPrompt.trim() })
  }

  const handleAIPlace = () => {
    if (!aiShapes || aiShapes.length === 0) return
    // Insert directly into local Yjs doc (no need to go through socket for local user)
    if (ydocRef.current && shapesMapRef.current) {
      ydocRef.current.transact(() => {
        aiShapes.forEach(s => shapesMapRef.current!.set(s.id, s))
      }, "local")
    }
    // Also tell the server to broadcast to other users
    connectSocket().emit("ai:place", { boardId, shapes: aiShapes, prompt: aiPrompt })
    setAiShapes(null)
    setAiPrompt("")
  }

  /* ── Version history ── */
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

  /* ── Share ── */
  const openShare = () => {
    setShareLink(window.location.href)
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

  return (
    <>
      <style>{STYLES}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden" }}>

        {/* ── TOP BAR ── */}
        <header className="topbar">
          <button className="back-btn" onClick={() => router.push("/dashboard")}>← Dashboard</button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className={`status-dot${connected ? " on" : ""}`} title={connected ? "Live" : "Connecting..."} />
            <span className="mono board-name">{boardTitle || "Loading..."}</span>
          </div>

          {statusMsg   && <span className="status-pill">{statusMsg}</span>}
          {aiThinking  && <span className="ai-pill mono">{aiThinking}</span>}

          <div className="topbar-right">
            <div style={{ display: "flex" }}>
              {members.slice(0, 5).map((m, i) => (
                <div key={m.id} title={m.name} className="avatar" style={{ background: m.color, marginLeft: i > 0 ? -8 : 0 }}>
                  {m.name?.[0]?.toUpperCase()}
                </div>
              ))}
              {members.length > 5 && (
                <div className="avatar" style={{ background: "var(--bg4)", marginLeft: -8, color: "var(--muted)", fontSize: 9 }}>
                  +{members.length - 5}
                </div>
              )}
            </div>
            <button className="tb-btn accent" onClick={openShare}>⇗ Share</button>
            <button className={`tb-btn${showAI ? " active" : ""}`} onClick={() => setShowAI(s => !s)}>✦ AI</button>
            <button className="tb-btn" onClick={loadSnapshots}>◷ History</button>
            <button className="tb-btn" onClick={() => {
              if (stageRef.current) {
                const uri = stageRef.current.toDataURL({ pixelRatio: 2 })
                const a = document.createElement("a")
                a.href = uri; a.download = `${boardTitle || "board"}.png`; a.click()
              }
            }}>↓ Export</button>
          </div>
        </header>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── LEFT TOOLBAR ── */}
          <aside className="sidebar">
            {TOOLS.map(t => (
              <button
                key={t.id}
                className={`tool-btn${tool === t.id ? " active" : ""}`}
                onClick={() => setTool(t.id)}
                title={t.label}
              >
                {t.icon}
              </button>
            ))}

            <div className="divider" />

            {PALETTE.map(c => (
              <button
                key={c}
                className="color-dot"
                title={c}
                onClick={() => setColor(c)}
                style={{
                  background:     c,
                  outline:        color === c ? "2px solid #fff" : "2px solid transparent",
                  outlineOffset:  "2px",
                  transform:      color === c ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}

            <div className="divider" />

            {/* active color preview */}
            <div style={{ width: 22, height: 22, borderRadius: 6, background: color, border: "1px solid rgba(255,255,255,.15)", flexShrink: 0 }} />
          </aside>

          {/* ── CANVAS — rendered by KonvaBoard child ── */}
          {mounted && (
            <KonvaBoard
              stageRef={stageRef}
              shapes={shapes}
              cursors={cursors}
              tool={tool}
              color={color}
              selected={selected}
              setSelected={setSelected}
              upsertShape={upsertShape}
              deleteShape={deleteShape}
              broadcastCursor={broadcastCursor}
              boardId={boardId}
            />
          )}

          {/* ── AI PANEL ── */}
          {showAI && (
            <aside className="side-panel">
              <div className="panel-hdr">
                <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>// AI diagram</span>
                <button className="icon-btn" onClick={() => setShowAI(false)}>✕</button>
              </div>
              <div className="panel-body">
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.65 }}>
                  Describe a diagram. AI draws it for everyone in the room. Try "ERD for a blog", "login flowchart", or "microservices for e-commerce".
                </p>

                <textarea
                  className="ai-input"
                  rows={4}
                  placeholder="Draw an ERD for a blog with users, posts, and comments..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault(); handleAIGenerate()
                    }
                  }}
                />

                <p className="mono" style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>
                  ⌘+Enter to generate
                </p>

                <button
                  className={`ai-btn${!aiPrompt.trim() || aiLoading ? " dim" : ""}`}
                  disabled={!aiPrompt.trim() || aiLoading}
                  onClick={handleAIGenerate}
                >
                  {aiLoading
                    ? <><span className="spinner" /> Generating...</>
                    : "✦ Generate diagram"}
                </button>

                {aiShapes && (
                  <div className="ai-preview">
                    <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-hdr">
              <h3>Share &amp; invite</h3>
              <button className="icon-btn" onClick={() => { setShowShare(false); setInviteMsg("") }}>✕</button>
            </div>

            <p className="modal-label">Board link — anyone can view:</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <div className="link-preview mono">{shareLink}</div>
              <button
                className="copy-btn"
                onClick={() => { navigator.clipboard.writeText(shareLink); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) }}
              >
                {copiedLink ? "✓" : "Copy"}
              </button>
            </div>

            <p className="modal-label">Invite as editor (by email):</p>
            <form onSubmit={handleInvite} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                className="modal-input"
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteMsg("") }}
                required
              />
              {inviteMsg && (
                <p className="mono" style={{ fontSize: 12, color: inviteMsg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>
                  {inviteMsg}
                </p>
              )}
              <button type="submit" className="invite-btn" disabled={inviting}>
                {inviting ? "Sending..." : "Send invite →"}
              </button>
            </form>

            {members.length > 0 && (
              <>
                <p className="modal-label" style={{ marginTop: 20 }}>Online now ({members.length}):</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {members.map(m => (
                    <div key={m.id} className="member-row">
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-hdr">
              <h3>Version history</h3>
              <button className="icon-btn" onClick={() => setShowVersions(false)}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
              {snapshots.length === 0
                ? <p className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>No snapshots yet. Board auto-saves every 30s.</p>
                : snapshots.map(s => (
                  <div key={s.index} className="snap-row">
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</p>
                      <p className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        {new Date(s.savedAt).toLocaleString()}
                      </p>
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
        {[0,1,2].map(i => (
          <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#6c63ff", animation: `pulse 1.2s ease-in-out ${i * .18}s infinite` }} />
        ))}
      </div>
    </div>
  )
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c10;--bg2:#131318;--bg3:#1a1a22;--bg4:#22222e;
  --border:#22222e;--border2:#2e2e3e;
  --text:#eaeaf4;--muted:#58587a;
  --accent:#6c63ff;--green:#22d3a0;--red:#f87171;
  --mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;
  --r:10px;--rl:14px;
}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
button{cursor:pointer;font-family:var(--sans)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes popIn {from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
@keyframes spin  {to{transform:rotate(360deg)}}
@keyframes pulse {0%,100%{opacity:.4}50%{opacity:1}}
.mono{font-family:var(--mono)}

/* TOP BAR */
.topbar{display:flex;align-items:center;gap:10px;padding:0 14px;height:50px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0;z-index:10}
.back-btn{background:transparent;border:none;color:var(--muted);font-family:var(--mono);font-size:12px;cursor:pointer;transition:color .15s;white-space:nowrap}
.back-btn:hover{color:var(--text)}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--red);flex-shrink:0;transition:all .3s}
.status-dot.on{background:var(--green);box-shadow:0 0 6px var(--green)}
.board-name{font-size:13px;font-weight:500}
.status-pill{font-family:var(--mono);font-size:11px;color:var(--green);background:rgba(34,211,160,.08);border:1px solid rgba(34,211,160,.2);border-radius:20px;padding:3px 10px;animation:fadeIn .2s ease;white-space:nowrap}
.ai-pill{font-size:11px;color:var(--accent);animation:pulse 1.5s ease-in-out infinite;white-space:nowrap}
.topbar-right{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}
.avatar{width:26px;height:26px;border-radius:50%;border:2px solid var(--bg2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;font-family:var(--mono);flex-shrink:0}
.avatar.sm{width:24px;height:24px;border:none;font-size:10px}
.tb-btn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:5px 11px;border-radius:var(--r);font-size:12px;transition:all .15s;white-space:nowrap}
.tb-btn:hover{border-color:rgba(108,99,255,.45);color:var(--accent);background:rgba(108,99,255,.06)}
.tb-btn.active{border-color:rgba(108,99,255,.5);color:var(--accent);background:rgba(108,99,255,.1)}
.tb-btn.accent{background:var(--accent);border:none;color:#fff;font-weight:700}
.tb-btn.accent:hover{box-shadow:0 0 14px rgba(108,99,255,.45);transform:translateY(-1px)}

/* SIDEBAR */
.sidebar{width:50px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:3px;flex-shrink:0;z-index:5;overflow-y:auto}
.tool-btn{width:34px;height:34px;border-radius:var(--r);background:transparent;border:1px solid transparent;color:var(--muted);font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
.tool-btn:hover{background:var(--bg3);color:var(--text);border-color:var(--border)}
.tool-btn.active{background:rgba(108,99,255,.15);border-color:rgba(108,99,255,.5);color:var(--accent)}
.color-dot{width:20px;height:20px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;transition:transform .15s,outline .15s}
.color-dot:hover{transform:scale(1.15)}
.divider{width:28px;height:1px;background:var(--border);margin:3px 0;flex-shrink:0}

/* AI SIDE PANEL */
.side-panel{width:290px;background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;z-index:5;animation:slideR .25s cubic-bezier(.22,1,.36,1)}
@keyframes slideR{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
.panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border)}
.panel-body{padding:14px;display:flex;flex-direction:column;gap:11px;flex:1;overflow-y:auto}
.icon-btn{background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;transition:color .15s}
.icon-btn:hover{color:var(--text)}
.ai-input{background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);padding:10px 12px;font-size:12px;font-family:var(--mono);resize:none;outline:none;width:100%;transition:border-color .2s}
.ai-input:focus{border-color:rgba(108,99,255,.5)}
.ai-btn{background:var(--accent);border:none;color:#fff;padding:11px;border-radius:var(--r);font-size:13px;font-weight:700;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;transition:box-shadow .2s;font-family:var(--sans)}
.ai-btn:hover:not(.dim){box-shadow:0 0 16px rgba(108,99,255,.4)}
.ai-btn.dim{background:var(--bg4);color:var(--muted);cursor:not-allowed}
.spinner{width:12px;height:12px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;flex-shrink:0}
.ai-preview{border:1px solid rgba(108,99,255,.3);border-radius:var(--r);padding:12px;background:rgba(108,99,255,.05);display:flex;flex-direction:column;gap:10px;animation:fadeIn .3s ease}
.place-btn{flex:1;background:var(--accent);border:none;color:#fff;padding:9px;border-radius:var(--r);font-size:12px;font-weight:700;cursor:pointer;font-family:var(--sans)}
.place-btn:hover{box-shadow:0 0 12px rgba(108,99,255,.35)}
.discard-btn{background:transparent;border:1px solid var(--border2);color:var(--muted);padding:9px 12px;border-radius:var(--r);font-size:12px;cursor:pointer}

/* MODALS */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:200;backdrop-filter:blur(4px);animation:fadeIn .15s ease}
.modal{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rl);padding:24px 26px;max-width:400px;width:90%;animation:popIn .2s cubic-bezier(.22,1,.36,1);max-height:85vh;overflow-y:auto}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.modal-hdr h3{font-size:17px;font-weight:700}
.modal-label{font-size:12px;color:var(--muted);margin-bottom:7px}
.link-preview{flex:1;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);padding:8px 12px;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.copy-btn{background:var(--accent);border:none;color:#fff;padding:8px 16px;border-radius:var(--r);font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;transition:box-shadow .2s}
.copy-btn:hover{box-shadow:0 0 12px rgba(108,99,255,.4)}
.modal-input{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);padding:10px 13px;font-size:13px;font-family:var(--mono);outline:none;transition:border-color .2s}
.modal-input:focus{border-color:rgba(108,99,255,.5)}
.invite-btn{background:var(--accent);border:none;color:#fff;padding:11px;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--sans);transition:box-shadow .2s}
.invite-btn:hover:not(:disabled){box-shadow:0 0 14px rgba(108,99,255,.4)}
.invite-btn:disabled{opacity:.65}
.member-row{display:flex;align-items:center;gap:10px;background:var(--bg3);border-radius:var(--r);padding:8px 12px}
.online-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 5px var(--green)}
.snap-row{display:flex;align-items:center;gap:12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px}
.restore-btn{background:var(--accent);border:none;color:#fff;padding:5px 12px;border-radius:var(--r);font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0}
`