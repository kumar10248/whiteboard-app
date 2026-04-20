// app/page.tsx — Landing page (FIXED: scroll works, full page visible)
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

type FakeCursor = {
  id: number; x: number; y: number
  name: string; color: string; vx: number; vy: number
}

const CURSOR_USERS = [
  { name: "alice", color: "#22d3a0" },
  { name: "bob",   color: "#f87171" },
  { name: "carol", color: "#fbbf24" },
]

const DEMO_SHAPES = [
  { id: 1,  type: "rect",    x: 60,  y: 60,  w: 130, h: 58, color: "#6c63ff", label: "User"        },
  { id: 2,  type: "rect",    x: 265, y: 60,  w: 130, h: 58, color: "#22d3a0", label: "Post"        },
  { id: 3,  type: "rect",    x: 470, y: 60,  w: 130, h: 58, color: "#f87171", label: "Comment"     },
  { id: 4,  type: "arrow",   x: 190, y: 89,  w: 75,  h: 0,  color: "#6c63ff" },
  { id: 5,  type: "arrow",   x: 395, y: 89,  w: 75,  h: 0,  color: "#22d3a0" },
  { id: 6,  type: "ellipse", x: 155, y: 185, w: 120, h: 52, color: "#fbbf24", label: "Auth"        },
  { id: 7,  type: "ellipse", x: 340, y: 185, w: 130, h: 52, color: "#3b82f6", label: "Storage"     },
  { id: 8,  type: "rect",    x: 60,  y: 290, w: 145, h: 46, color: "#c084fc", label: "API Gateway" },
  { id: 9,  type: "rect",    x: 240, y: 290, w: 145, h: 46, color: "#22d3a0", label: "WebSockets"  },
  { id: 10, type: "rect",    x: 420, y: 290, w: 145, h: 46, color: "#f87171", label: "Redis Pub"   },
  { id: 11, type: "text",    x: 60,  y: 380, w: 300, h: 24, color: "#6c63ff", label: '// AI: "draw ERD for a blog" →' },
]

const FEATURES = [
  { icon: "▦", title: "Real-time canvas sync",    desc: "Every stroke synced instantly via Yjs CRDTs — zero merge conflicts, even with 10 simultaneous users." },
  { icon: "✦", title: "AI diagram generator",     desc: 'Type "ERD for a blog" — AI places nodes, arrows, labels on the shared canvas in seconds.' },
  { icon: "↖", title: "Live cursor presence",     desc: "See every collaborator's cursor with their name tag. Disappears instantly on disconnect." },
  { icon: "◷", title: "Version history",          desc: "Auto-saves every 30s. Rewind to any snapshot — restores exact canvas state for everyone in the room." },
  { icon: "⇗", title: "Share & invite",           desc: "Invite teammates by email or share a public read-only link. Permissions handled server-side." },
  { icon: "↓", title: "PNG / SVG export",         desc: "Export the full canvas as a high-resolution PNG with one click. Konva renders it at 2× pixel ratio." },
]

export default function HomePage() {
  const router    = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mounted, setMounted]   = useState(false)
  const [visIdx, setVisIdx]     = useState(0)
  const [cursors, setCursors]   = useState<FakeCursor[]>([])

  useEffect(() => { setMounted(true) }, [])

  /* reveal shapes one by one */
  useEffect(() => {
    const t = setInterval(() => setVisIdx(v => Math.min(v + 1, DEMO_SHAPES.length)), 320)
    return () => clearInterval(t)
  }, [])

  /* animate fake cursors */
  useEffect(() => {
    setCursors(CURSOR_USERS.map((u, i) => ({
      id: i, name: u.name, color: u.color,
      x: 80 + i * 200, y: 120 + i * 70,
      vx: (Math.random() - 0.5) * 0.7,
      vy: (Math.random() - 0.5) * 0.7,
    })))
    const iv = setInterval(() => {
      setCursors(prev => prev.map(c => {
        let nx = c.x + c.vx, ny = c.y + c.vy
        let vx = c.vx, vy = c.vy
        if (nx < 10 || nx > 620) { vx *= -1; nx = Math.max(10, Math.min(620, nx)) }
        if (ny < 10 || ny > 400) { vy *= -1; ny = Math.max(10, Math.min(400, ny)) }
        return { ...c, x: nx, y: ny, vx, vy }
      }))
    }, 30)
    return () => clearInterval(iv)
  }, [])

  /* dot-grid background canvas */
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ctx = el.getContext("2d")!
    let raf: number, frame = 0
    const draw = () => {
      el.width = el.offsetWidth; el.height = el.offsetHeight
      ctx.clearRect(0, 0, el.width, el.height)
      frame++
      for (let y = 0; y <= el.height; y += 32)
        for (let x = 0; x <= el.width; x += 32) {
          const a = 0.04 + 0.12 * Math.abs(Math.sin(frame * 0.006 + x * 0.03 + y * 0.025))
          ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(108,99,255,${a})`; ctx.fill()
        }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  const visible = DEMO_SHAPES.slice(0, visIdx)

  return (
    <>
      <style>{CSS}</style>

      {/* ── NAV ── */}
      <nav>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div className="accent-dot" />
          <span className="logo-text">collab<span style={{ color: "var(--accent)" }}>board</span></span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="nav-ghost" onClick={() => router.push("/login")}>Sign in</button>
          <button className="nav-cta"   onClick={() => router.push("/register")}>Get started free</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero-section">
        <canvas ref={canvasRef} className="dot-canvas" />
        <div className="hero-blob" />

        <div className="badge fu0">
          <span className="accent-dot small" style={{ animation: "glow 1.8s ease-in-out infinite" }} />
          <span className="mono" style={{ fontSize: 11, color: "var(--accent)", letterSpacing: ".04em" }}>live · real-time collaboration</span>
        </div>

        <h1 className="hero-title fu1">
          Draw together,<br />
          <span className="hero-italic">think together.</span>
        </h1>

        <p className="hero-sub fu2">
          A real-time collaborative whiteboard with AI diagram generation,
          live cursors, and version history. No friction. Just draw.
        </p>

        <div className="hero-ctas fu3">
          <button className="cta-primary" onClick={() => router.push("/register")}>Start drawing free →</button>
          <button className="ghost-link"  onClick={() => router.push("/login")}>Sign in</button>
        </div>

        {/* ── DEMO BOARD ── */}
        <div className="demo-board fu4">
          {/* glow top edge */}
          <div className="board-glow-edge" />

          {/* title bar */}
          <div className="board-titlebar">
            <div style={{ display: "flex", gap: 6 }}>
              {(["#f87171","#fbbf24","#22d3a0"] as const).map((c,i) => (
                <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />
              ))}
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>System Architecture — Live</span>
            <div style={{ display: "flex" }}>
              {CURSOR_USERS.map((u, i) => (
                <div key={u.name} className="presence-avatar" style={{ background: u.color, marginLeft: i > 0 ? -6 : 0 }}>
                  {u.name[0].toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          {/* canvas area */}
          <div className="board-canvas-area">
            <div className="board-dot-grid" />

            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 660 420" preserveAspectRatio="xMidYMid meet">
              <defs>
                {DEMO_SHAPES.filter(s => s.type === "arrow").map(s => (
                  <marker key={`m${s.id}`} id={`arr${s.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M2 1L8 5L2 9" fill="none" stroke={s.color} strokeWidth="1.5" strokeLinecap="round"/>
                  </marker>
                ))}
              </defs>

              {visible.map((s, idx) => {
                const op = Math.min(1, (visIdx - idx) * 0.35)
                if (s.type === "rect") return (
                  <g key={s.id} style={{ animation: "shapeIn .4s cubic-bezier(.22,1,.36,1)" }}>
                    <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="8" fill={s.color + "20"} stroke={s.color} strokeWidth="1.5" opacity={op}/>
                    {s.label && <text x={s.x + s.w/2} y={s.y + s.h/2 + 5} textAnchor="middle" fill={s.color} fontSize="13" fontFamily="DM Mono,monospace" fontWeight="500" opacity={op}>{s.label}</text>}
                  </g>
                )
                if (s.type === "ellipse") return (
                  <g key={s.id} style={{ animation: "shapeIn .4s cubic-bezier(.22,1,.36,1)" }}>
                    <ellipse cx={s.x + s.w/2} cy={s.y + s.h/2} rx={s.w/2} ry={s.h/2} fill={s.color + "20"} stroke={s.color} strokeWidth="1.5" opacity={op}/>
                    {s.label && <text x={s.x + s.w/2} y={s.y + s.h/2 + 5} textAnchor="middle" fill={s.color} fontSize="13" fontFamily="DM Mono,monospace" fontWeight="500" opacity={op}>{s.label}</text>}
                  </g>
                )
                if (s.type === "arrow") return (
                  <line key={s.id} x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h}
                    stroke={s.color} strokeWidth="1.5" markerEnd={`url(#arr${s.id})`} opacity={op}
                    style={{ animation: "shapeIn .4s cubic-bezier(.22,1,.36,1)" }}/>
                )
                if (s.type === "text") return (
                  <text key={s.id} x={s.x} y={s.y} fill={s.color} fontSize="12" fontFamily="DM Mono,monospace" opacity={op}
                    style={{ animation: "shapeIn .4s cubic-bezier(.22,1,.36,1)" }}>
                    {s.label}
                  </text>
                )
                return null
              })}
            </svg>

            {/* fake cursors */}
            {cursors.map(c => (
              <div key={c.id} className="fake-cursor" style={{ left: c.x, top: c.y, transition: "left .03s linear, top .03s linear" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2 2L14 8L8 9L6 14L2 2Z" fill={c.color} stroke="rgba(255,255,255,.7)" strokeWidth=".8"/>
                </svg>
                <span className="cursor-label" style={{ background: c.color }}>{c.name}</span>
              </div>
            ))}
          </div>

          {/* status bar */}
          <div className="board-statusbar">
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)", animation: "glow 2s ease-in-out infinite" }} />
            <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>3 collaborators online</span>
            <span className="mono" style={{ fontSize: 10, color: "var(--accent)", marginLeft: "auto", animation: "glow 2.5s ease-in-out infinite" }}>✦ AI ready</span>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="features-section">
        <p className="section-tag">// what's inside</p>
        <h2 className="section-title">
          Everything you need<br />
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>to collaborate visually.</span>
        </h2>
        <div className="feat-grid">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="feat-card" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="feat-corner-glow" />
              <span className="feat-icon mono">{f.icon}</span>
              <h3 className="feat-title">{f.title}</h3>
              <p className="feat-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="steps-section">
        <p className="section-tag">// how it works</p>
        <h2 className="section-title" style={{ marginBottom: 40 }}>Three steps to real-time.</h2>
        <div className="steps-grid">
          {[
            { num: "01", title: "Create a board",  desc: "Give it a name. Invite teammates by email or share a public link for guests." },
            { num: "02", title: "Draw anything",   desc: "Shapes, arrows, freehand, text. Or type a prompt and let AI build the diagram." },
            { num: "03", title: "It syncs itself", desc: "Every change merged instantly via CRDT. No conflicts. No refresh. No stale state." },
          ].map(s => (
            <div key={s.num} className="step-card">
              <div className="step-num mono">{s.num}</div>
              <h3 className="step-title">{s.title}</h3>
              <p className="step-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── TECH STRIP ── */}
      <div className="tech-strip">
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>built with</span>
        {["Next.js 14","Socket.io","Yjs CRDT","Konva.js","MongoDB","Redis","OpenAI"].map(t => (
          <span key={t} className="tech-pill mono">{t}</span>
        ))}
      </div>

      {/* ── CTA ── */}
      <section className="cta-section">
        <div className="orbit-ring" style={{ width: 260, height: 260 }} />
        <div className="orbit-ring" style={{ width: 170, height: 170 }} />
        <div className="orbit-dot" />

        <h2 className="cta-title">
          Start drawing.<br />
          <span style={{ color: "var(--accent)", fontStyle: "italic" }}>Right now.</span>
        </h2>
        <button className="cta-primary" style={{ fontSize: 16, padding: "14px 36px" }} onClick={() => router.push("/register")}>
          Create free account →
        </button>
        <p className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>No credit card · No install · Works in your browser</p>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <span className="logo-text mono">collab<span style={{ color: "var(--accent)" }}>board</span></span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>Next.js · Socket.io · Yjs · Konva · MongoDB · Redis · OpenAI</span>
      </footer>
    </>
  )
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c10;--bg2:#131318;--bg3:#1a1a22;--bg4:#22222e;
  --border:#22222e;--border2:#2e2e3e;
  --text:#eaeaf4;--muted:#58587a;
  --accent:#6c63ff;--green:#22d3a0;
  --mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;
  --r:10px;--rl:14px;
}

/* ── CRITICAL FIX: body must scroll, not be hidden ── */
html{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
body{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased;overflow-y:auto!important;min-height:100vh}

button{cursor:pointer;font-family:var(--sans)}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}

@keyframes fadeUp  {from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes glow    {0%,100%{opacity:.45}50%{opacity:1}}
@keyframes glowL   {0%,100%{opacity:.3}50%{opacity:.8}}
@keyframes shapeIn {from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}
@keyframes orbit   {from{transform:translate(-50%,-50%) rotate(0deg) translateX(110px) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(360deg) translateX(110px) rotate(-360deg)}}
@keyframes spin    {to{transform:rotate(360deg)}}
@keyframes blink   {0%,100%{opacity:1}50%{opacity:0}}

.fu0{animation:fadeUp .7s cubic-bezier(.22,1,.36,1) .05s both}
.fu1{animation:fadeUp .7s cubic-bezier(.22,1,.36,1) .15s both}
.fu2{animation:fadeUp .7s cubic-bezier(.22,1,.36,1) .25s both}
.fu3{animation:fadeUp .7s cubic-bezier(.22,1,.36,1) .35s both}
.fu4{animation:fadeUp .7s cubic-bezier(.22,1,.36,1) .45s both}
.mono{font-family:var(--mono)}

/* NAV */
nav{display:flex;align-items:center;justify-content:space-between;padding:0 44px;height:58px;border-bottom:1px solid var(--border);background:rgba(12,12,16,.9);backdrop-filter:blur(16px);position:sticky;top:0;z-index:100;position:sticky}
.logo-text{font-family:var(--mono);font-size:17px;font-weight:500;letter-spacing:-.2px}
.accent-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent);flex-shrink:0;animation:glow 2s ease-in-out infinite}
.accent-dot.small{width:6px;height:6px;display:inline-block}
.nav-ghost{background:transparent;border:1px solid var(--border2);color:var(--text);padding:8px 18px;border-radius:var(--r);font-size:14px;transition:border-color .2s}
.nav-ghost:hover{border-color:rgba(108,99,255,.45)}
.nav-cta{background:var(--accent);border:none;color:#fff;padding:9px 20px;border-radius:var(--r);font-size:14px;font-weight:700;transition:box-shadow .2s,transform .2s}
.nav-cta:hover{box-shadow:0 0 20px rgba(108,99,255,.5);transform:translateY(-1px)}

/* HERO */
.hero-section{display:flex;flex-direction:column;align-items:center;padding:80px 24px 60px;text-align:center;position:relative;gap:24px;overflow:hidden}
.dot-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.7}
.hero-blob{position:absolute;top:5%;left:50%;transform:translateX(-50%);width:560px;height:280px;background:radial-gradient(ellipse,rgba(108,99,255,.09) 0%,transparent 70%);filter:blur(24px);pointer-events:none}
.badge{display:inline-flex;align-items:center;gap:10px;background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.2);border-radius:20px;padding:6px 16px;position:relative;z-index:1}
.hero-title{font-family:var(--sans);font-size:clamp(42px,7.5vw,84px);font-weight:900;line-height:1.04;letter-spacing:-3px;position:relative;z-index:1;max-width:820px}
.hero-italic{color:var(--accent);font-style:italic;text-shadow:0 0 30px rgba(108,99,255,.4)}
.hero-sub{font-size:18px;color:var(--muted);max-width:520px;line-height:1.75;position:relative;z-index:1}
.hero-ctas{display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:center;position:relative;z-index:1}
.cta-primary{background:var(--accent);border:none;color:#fff;padding:13px 28px;border-radius:var(--r);font-size:15px;font-weight:700;font-family:var(--sans);transition:box-shadow .2s,transform .2s}
.cta-primary:hover{box-shadow:0 0 28px rgba(108,99,255,.55);transform:translateY(-2px)}
.ghost-link{background:transparent;border:none;color:var(--muted);font-size:15px;font-family:var(--sans);cursor:pointer;padding:13px 4px;transition:color .2s}
.ghost-link:hover{color:var(--text)}

/* DEMO BOARD */
.demo-board{width:100%;max-width:700px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rl);overflow:hidden;box-shadow:0 0 0 1px rgba(108,99,255,.07),0 28px 80px rgba(0,0,0,.55);position:relative;z-index:1;margin-top:8px}
.board-glow-edge{position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(108,99,255,.7) 40%,rgba(108,99,255,.7) 60%,transparent);animation:glowL 3s ease-in-out infinite;z-index:2}
.board-titlebar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg3)}
.presence-avatar{width:22px;height:22px;border-radius:50%;border:2px solid var(--bg3);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;font-family:var(--mono)}
.board-canvas-area{height:420px;background:var(--bg2);position:relative;overflow:hidden}
.board-dot-grid{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(108,99,255,.12) 1px,transparent 1px);background-size:28px 28px;pointer-events:none}
.fake-cursor{position:absolute;pointer-events:none;z-index:10;transform:translate(-2px,-2px)}
.cursor-label{position:absolute;top:13px;left:13px;border-radius:4px;padding:2px 7px;font-size:10px;font-family:var(--mono);color:#fff;font-weight:500;white-space:nowrap}
.board-statusbar{display:flex;align-items:center;gap:10px;padding:7px 16px;background:var(--bg3);border-top:1px solid var(--border)}

/* FEATURES */
.features-section{padding:80px 44px;max-width:1060px;margin:0 auto;width:100%}
.section-tag{font-family:var(--mono);font-size:12px;color:var(--accent);margin-bottom:12px;letter-spacing:.06em}
.section-title{font-size:clamp(28px,4vw,46px);font-weight:800;letter-spacing:-1.4px;margin-bottom:48px;line-height:1.12}
.feat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.feat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:26px 22px;position:relative;overflow:hidden;transition:border-color .25s,box-shadow .25s,transform .25s;animation:fadeUp .6s cubic-bezier(.22,1,.36,1) both}
.feat-card:hover{border-color:rgba(108,99,255,.28);box-shadow:0 0 28px rgba(108,99,255,.07);transform:translateY(-3px)}
.feat-corner-glow{position:absolute;top:0;right:0;width:80px;height:80px;background:radial-gradient(circle at top right,rgba(108,99,255,.06),transparent 70%);pointer-events:none}
.feat-icon{font-size:22px;color:var(--accent);display:block;margin-bottom:14px}
.feat-title{font-size:15px;font-weight:600;letter-spacing:-.3px;margin-bottom:8px}
.feat-desc{font-size:13px;color:var(--muted);line-height:1.7}

/* STEPS */
.steps-section{padding:0 44px 80px;max-width:1060px;margin:0 auto;width:100%}
.steps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.step-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:28px 24px}
.step-num{font-size:36px;font-weight:700;color:rgba(108,99,255,.15);line-height:1;margin-bottom:16px;letter-spacing:-1px}
.step-title{font-size:16px;font-weight:700;margin-bottom:10px;letter-spacing:-.3px}
.step-desc{font-size:13px;color:var(--muted);line-height:1.65}

/* TECH */
.tech-strip{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:22px 44px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center}
.tech-pill{font-size:11px;color:var(--text);background:var(--bg3);border:1px solid var(--border2);border-radius:20px;padding:4px 12px}

/* CTA */
.cta-section{display:flex;flex-direction:column;align-items:center;gap:22px;padding:80px 24px;text-align:center;position:relative;overflow:hidden}
.orbit-ring{position:absolute;border:1px solid rgba(108,99,255,.06);border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none}
.orbit-dot{position:absolute;top:50%;left:50%;width:8px;height:8px;margin:-4px;animation:orbit 7s linear infinite;pointer-events:none}
.orbit-dot::before{content:'';display:block;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent),0 0 24px rgba(108,99,255,.4)}
.cta-title{font-size:clamp(26px,5vw,52px);font-weight:900;letter-spacing:-1.8px;line-height:1.1;position:relative;z-index:1}

/* FOOTER */
.footer{display:flex;align-items:center;justify-content:space-between;padding:20px 44px;border-top:1px solid var(--border);flex-wrap:wrap;gap:12px}

/* RESPONSIVE */
@media(max-width:800px){
  nav{padding:0 18px!important}
  .hero-section{padding:60px 18px 48px!important}
  .hero-ctas{flex-direction:column;width:100%}
  .hero-ctas .cta-primary,.hero-ctas .ghost-link{width:100%;text-align:center}
  .features-section,.steps-section{padding-left:18px!important;padding-right:18px!important}
  .tech-strip{padding:18px!important}
  .footer{padding:16px 18px!important;flex-direction:column;gap:8px;text-align:center}
  .feat-grid{grid-template-columns:1fr!important}
}
`