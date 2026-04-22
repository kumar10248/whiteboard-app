// app/(app)/dashboard/page.tsx
"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { boardAPI, authAPI, clearToken, type Board } from "@/lib/api"
import { useAuthGuard } from "@/lib/useAuth"

function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function DashboardPage() {
  const router = useRouter()
  const { ready } = useAuthGuard()

  const [boards, setBoards]     = useState<Board[]>([])
  const [user, setUser]         = useState<{ name: string; email: string } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [error, setError]       = useState("")
  const [mounted, setMounted]   = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!ready) return
    const load = async () => {
      try {
        const [me, data] = await Promise.all([authAPI.me(), boardAPI.getAll()])
        setUser({ name: me.user.name, email: me.user.email })
        setBoards(data.boards)
      } catch (err: any) {
        if (err.message?.toLowerCase().includes("unauthorized")) { clearToken(); router.replace("/login") }
        else setError("Failed to load boards")
      } finally { setLoading(false) }
    }
    load()
  }, [ready])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const { board } = await boardAPI.create({ title: newTitle.trim() })
      setBoards(p => [board, ...p])
      setNewTitle(""); setShowCreate(false)
      router.push(`/board/${board._id}`)
    } catch (err: any) { setError(err.message) }
    finally { setCreating(false) }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await boardAPI.delete(deleteId)
      setBoards(p => p.filter(b => b._id !== deleteId))
      setDeleteId(null)
    } catch (err: any) { setError(err.message) }
  }

  const initials = user?.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "??"

  if (!ready || loading) return <Loader />

  return (
    <>
      <style>{STYLES}</style>
      <div style={{ minHeight: "100vh", background: "var(--bg)", opacity: mounted ? 1 : 0, transition: "opacity .3s" }}>

        {/* ── NAV ── */}
        <nav style={{ display: "flex", alignItems: "center", padding: "0 28px", height: 56, borderBottom: "1px solid var(--border)", background: "var(--bg2)", position: "sticky", top: 0, zIndex: 50 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", animation: "pulse 2s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 500 }}>
              collab<span style={{ color: "var(--accent)" }}>board</span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{user?.name}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>{user?.email}</span>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(108,99,255,.15)", border: "1px solid rgba(108,99,255,.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--accent)", fontFamily: "var(--mono)" }}>
              {initials}
            </div>
            <button
              onClick={() => { clearToken(); router.replace("/login") }}
              style={{ background: "transparent", border: "1px solid var(--border2)", color: "var(--muted)", padding: "6px 14px", borderRadius: "var(--r)", fontSize: 12, transition: "all .15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
            >Sign out</button>
          </div>
        </nav>

        <main style={{ maxWidth: 1000, margin: "0 auto", padding: "36px 28px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.8px", marginBottom: 4 }}>Your boards</h1>
              <p style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)" }}>{boards.length} board{boards.length !== 1 ? "s" : ""}</p>
            </div>
            <button className="create-btn" onClick={() => setShowCreate(true)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              New board
            </button>
          </div>

          {error && (
            <div style={{ background: "rgba(248,113,113,.07)", border: "1px solid rgba(248,113,113,.2)", borderRadius: "var(--r)", padding: "10px 14px", marginBottom: 20, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--red)" }}>{error}</span>
              <button onClick={() => setError("")} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </div>
          )}

          {/* Board grid */}
          {boards.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "80px 0", textAlign: "center" }}>
              <div style={{ width: 60, height: 60, borderRadius: "var(--rl)", background: "var(--bg3)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="var(--muted)" strokeWidth="1.5"/><path d="M3 9h18M9 3v18" stroke="var(--muted)" strokeWidth="1.5"/></svg>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 15 }}>No boards yet.</p>
              <button className="create-btn" onClick={() => setShowCreate(true)}>+ Create your first board</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {boards.map((board, i) => (
                <div
                  key={board._id}
                  className="board-card"
                  style={{ animationDelay: `${i * 0.06}s` }}
                  onClick={() => router.push(`/board/${board._id}`)}
                >
                  {/* Preview area */}
                  <div style={{ height: 120, background: "var(--bg3)", borderRadius: "8px 8px 0 0", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", borderBottom: "1px solid var(--border)" }}>
                    {/* Grid pattern */}
                    <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(108,99,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(108,99,255,.05) 1px,transparent 1px)", backgroundSize: "24px 24px" }} />
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ position: "relative", zIndex: 1, opacity: .3 }}>
                      <rect x="4" y="4" width="24" height="24" rx="4" stroke="var(--accent)" strokeWidth="1.5"/>
                      <path d="M4 12h24M12 4v24" stroke="var(--accent)" strokeWidth="1.5"/>
                    </svg>
                    {board.isPublic && (
                      <span style={{ position: "absolute", top: 8, right: 8, fontFamily: "var(--mono)", fontSize: 9, color: "var(--green)", background: "rgba(34,211,160,.1)", border: "1px solid rgba(34,211,160,.2)", borderRadius: 4, padding: "2px 6px" }}>public</span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.title}</p>
                      <button
                        className="delete-btn"
                        onClick={e => { e.stopPropagation(); setDeleteId(board._id) }}
                        title="Delete board"
                      >✕</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                        {board.members.length} member{board.members.length !== 1 ? "s" : ""}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                        {timeAgo(board.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* ── CREATE MODAL ── */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 18, letterSpacing: "-.4px" }}>New board</h3>
              <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input
                  className="auth-input"
                  placeholder="Board title..."
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  autoFocus required
                />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setShowCreate(false)} style={{ background: "transparent", border: "1px solid var(--border2)", color: "var(--muted)", padding: "9px 20px", borderRadius: "var(--r)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  <button type="submit" className="create-btn" disabled={creating} style={{ opacity: creating ? .7 : 1 }}>
                    {creating ? "Creating..." : "Create →"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── DELETE MODAL ── */}
        {deleteId && (
          <div className="modal-overlay" onClick={() => setDeleteId(null)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>⚠</div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Delete board?</h3>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.6 }}>
                This permanently deletes the board and all its canvas data. <span style={{ color: "var(--red)" }}>Cannot be undone.</span>
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setDeleteId(null)} style={{ background: "transparent", border: "1px solid var(--border2)", color: "var(--muted)", padding: "9px 18px", borderRadius: "var(--r)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button onClick={handleDelete} style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.4)", color: "var(--red)", padding: "9px 18px", borderRadius: "var(--r)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Yes, delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function Loader() {
  return (
    <div style={{ minHeight: "100vh", background: "#0c0c10", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -400px 0 }
          100% { background-position: 400px 0 }
        }
        .skel {
          background: linear-gradient(90deg, #131318 25%, #1a1a22 50%, #131318 75%);
          background-size: 400px 100%;
          animation: shimmer 1.4s ease-in-out infinite;
          border-radius: 8px;
        }
      `}</style>
      {/* Nav skeleton */}
      <div style={{ height: 56, borderBottom: "1px solid #22222e", background: "#131318", display: "flex", alignItems: "center", padding: "0 28px", gap: 12 }}>
        <div className="skel" style={{ width: 120, height: 16 }} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <div className="skel" style={{ width: 80, height: 16, borderRadius: 20 }} />
          <div className="skel" style={{ width: 32, height: 32, borderRadius: "50%" }} />
        </div>
      </div>
      {/* Content skeleton */}
      <div style={{ maxWidth: 1000, margin: "36px auto", padding: "0 28px", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div>
            <div className="skel" style={{ width: 140, height: 24, marginBottom: 8 }} />
            <div className="skel" style={{ width: 80, height: 14 }} />
          </div>
          <div className="skel" style={{ width: 120, height: 36, borderRadius: 10 }} />
        </div>
        {/* Board card skeletons */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #22222e", animationDelay: `${i*0.05}s` }}>
              <div className="skel" style={{ height: 120, borderRadius: 0 }} />
              <div style={{ padding: "14px 16px", background: "#131318" }}>
                <div className="skel" style={{ width: "60%", height: 14, marginBottom: 8 }} />
                <div className="skel" style={{ width: "40%", height: 11 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0c0c10;--bg2:#131318;--bg3:#1a1a22;--border:#22222e;--border2:#2e2e3e;--text:#eaeaf4;--muted:#58587a;--accent:#6c63ff;--green:#22d3a0;--red:#f87171;--mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;--r:10px;--rl:14px}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes popIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}

  .board-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);cursor:pointer;transition:border-color .18s,box-shadow .18s,transform .18s;animation:fadeUp .5s cubic-bezier(.22,1,.36,1) both;overflow:hidden}
  .board-card:hover{border-color:rgba(108,99,255,.35);box-shadow:0 4px 24px rgba(108,99,255,.1);transform:translateY(-2px)}

  .create-btn{background:var(--accent);border:none;color:#fff;padding:10px 18px;border-radius:var(--r);font-size:13px;font-weight:700;font-family:var(--sans);display:inline-flex;align-items:center;gap:7px;transition:box-shadow .2s,transform .2s;cursor:pointer}
  .create-btn:hover{box-shadow:0 0 18px rgba(108,99,255,.45);transform:translateY(-1px)}
  .create-btn:disabled{opacity:.7}

  .delete-btn{background:transparent;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:2px 4px;transition:color .15s;flex-shrink:0}
  .delete-btn:hover{color:var(--red)}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:200;backdrop-filter:blur(4px);animation:fadeIn .15s ease}
  .modal-box{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rl);padding:26px 28px;max-width:380px;width:90%;animation:popIn .2s cubic-bezier(.22,1,.36,1)}
  .auth-input{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);padding:11px 14px;font-size:14px;font-family:var(--mono);outline:none;transition:border-color .2s}
  .auth-input:focus{border-color:rgba(108,99,255,.5);box-shadow:0 0 0 3px rgba(108,99,255,.1)}
`