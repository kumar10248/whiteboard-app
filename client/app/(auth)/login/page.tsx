// app/(auth)/login/page.tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { authAPI, setToken } from "@/lib/api"
import { useGuestGuard } from "@/lib/useAuth"

export default function LoginPage() {
  const router = useRouter()
  const { ready } = useGuestGuard()
  const [form, setForm]       = useState({ email: "", password: "" })
  const [error, setError]     = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError("")
    try {
      const data = await authAPI.login(form)
      setToken(data.token)
      router.push("/dashboard")
    } catch (err: any) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  if (!ready) return <Loader />

  return (
    <>
      <Styles />
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: "24px" }}>
        <div style={{ width: "100%", maxWidth: 420, animation: "popIn .5s cubic-bezier(.22,1,.36,1)" }}>

          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={logoDot} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 500, letterSpacing: "-.3px" }}>
                collab<span style={{ color: "var(--accent)" }}>board</span>
              </span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-1px", marginBottom: 6 }}>Welcome back</h1>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              No account?{" "}
              <Link href="/register" style={{ color: "var(--accent)", fontWeight: 500 }}>Sign up free</Link>
            </p>
          </div>

          {/* Form card */}
          <div style={card}>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <Field label="Email">
                <input className="auth-input" type="email" placeholder="you@example.com"
                  value={form.email} onChange={e => { setForm(p => ({ ...p, email: e.target.value })); setError("") }}
                  required autoComplete="email" />
              </Field>
              <Field label="Password">
                <input className="auth-input" type="password" placeholder="••••••••"
                  value={form.password} onChange={e => { setForm(p => ({ ...p, password: e.target.value })); setError("") }}
                  required autoComplete="current-password" />
              </Field>

              {error && <ErrorBox msg={error} />}

              <button type="submit" className="submit-btn" disabled={loading} style={{ opacity: loading ? .7 : 1 }}>
                {loading ? <><Spinner />Signing in...</> : "Sign in →"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── shared tiny components ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" as const }}>{label}</label>
      {children}
    </div>
  )
}
function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: "var(--r)", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", animation: "shake .35s ease" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, color: "var(--red)" }}>ERR</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--red)" }}>{msg}</span>
    </div>
  )
}
function Spinner() {
  return <span style={{ width: 13, height: 13, border: "2px solid rgba(0,0,0,.3)", borderTopColor: "#000", borderRadius: "50%", animation: "spin .6s linear infinite", display: "inline-block" }} />
}
function Loader() {
  return (
    <div style={{ minHeight: "100vh", background: "#0c0c10", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#6c63ff", animation: `pulse 1.2s ease-in-out ${i * .18}s infinite` }} />)}
      </div>
    </div>
  )
}

const logoDot: React.CSSProperties = { width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }
const card: React.CSSProperties = { background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--rl)", padding: "28px 28px" }

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      :root{--bg:#0c0c10;--bg2:#131318;--bg3:#1a1a22;--border:#22222e;--border2:#2e2e3e;--text:#eaeaf4;--muted:#58587a;--accent:#6c63ff;--red:#f87171;--mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;--r:10px;--rl:16px}
      body{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
      @keyframes popIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
      .auth-input{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);padding:12px 14px;font-size:14px;font-family:var(--mono);outline:none;transition:border-color .2s,box-shadow .2s}
      .auth-input:focus{border-color:rgba(108,99,255,.5);box-shadow:0 0 0 3px rgba(108,99,255,.1)}
      .submit-btn{background:var(--accent);border:none;color:#fff;padding:13px;border-radius:var(--r);font-size:14px;font-weight:700;font-family:var(--sans);width:100%;display:flex;align-items:center;justify-content:center;gap:8px;transition:box-shadow .2s,transform .2s}
      .submit-btn:hover:not(:disabled){box-shadow:0 0 20px rgba(108,99,255,.45);transform:translateY(-1px)}
    `}</style>
  )
}