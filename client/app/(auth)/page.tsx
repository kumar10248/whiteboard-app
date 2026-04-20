// app/(auth)/register/page.tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { authAPI } from "@/lib/api"
import { useGuestGuard } from "@/lib/useAuth"

const getStrength = (pw: string) => {
  let s = 0
  if (pw.length >= 8)           s++
  if (/[A-Z]/.test(pw))         s++
  if (/[0-9]/.test(pw))         s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}
const strengthLabel = ["", "weak", "fair", "good", "strong"]
const strengthColor = ["", "#f87171", "#fb923c", "#fbbf24", "#22d3a0"]

export default function RegisterPage() {
  const router = useRouter()
  const { ready } = useGuestGuard()
  const [form, setForm]       = useState({ name: "", email: "", password: "" })
  const [error, setError]     = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const strength = getStrength(form.password)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return }
    setLoading(true); setError("")
    try {
      await authAPI.register(form)
      setSuccess(true)
      setTimeout(() => router.push("/login"), 1500)
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

          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 500 }}>
                collab<span style={{ color: "var(--accent)" }}>board</span>
              </span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-1px", marginBottom: 6 }}>Create account</h1>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              Already have one?{" "}
              <Link href="/login" style={{ color: "var(--accent)", fontWeight: 500 }}>Sign in</Link>
            </p>
          </div>

          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--rl)", padding: "28px" }}>
            {success ? (
              <div style={{ textAlign: "center", padding: "20px 0", animation: "popIn .3s ease" }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(34,211,160,.1)", border: "2px solid var(--green)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 22 }}>✓</div>
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Account created!</p>
                <p style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)" }}>Redirecting to login...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {[
                  { label: "Name",     name: "name",     type: "text",     placeholder: "Your name",         auto: "name" },
                  { label: "Email",    name: "email",    type: "email",    placeholder: "you@example.com",    auto: "email" },
                ].map(f => (
                  <div key={f.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={labelStyle}>{f.label}</label>
                    <input className="auth-input" type={f.type} placeholder={f.placeholder}
                      value={(form as any)[f.name]}
                      onChange={e => { setForm(p => ({ ...p, [f.name]: e.target.value })); setError("") }}
                      required autoComplete={f.auto} />
                  </div>
                ))}

                {/* Password with strength */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={labelStyle}>Password</label>
                    {form.password && (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: strengthColor[strength], transition: "color .3s" }}>
                        {strengthLabel[strength]}
                      </span>
                    )}
                  </div>
                  <input className="auth-input" type="password" placeholder="Min 8 chars + special char"
                    value={form.password}
                    onChange={e => { setForm(p => ({ ...p, password: e.target.value })); setError("") }}
                    required autoComplete="new-password" />
                  <div style={{ display: "flex", gap: 4 }}>
                    {[1, 2, 3, 4].map(n => (
                      <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: strength >= n ? strengthColor[strength] : "var(--border2)", transition: "background .3s", boxShadow: strength >= n ? `0 0 6px ${strengthColor[strength]}88` : "none" }} />
                    ))}
                  </div>
                </div>

                {error && (
                  <div style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: "var(--r)", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", animation: "shake .35s ease" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, color: "var(--red)" }}>ERR</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--red)" }}>{error}</span>
                  </div>
                )}

                <button type="submit" className="submit-btn" disabled={loading} style={{ opacity: loading ? .7 : 1 }}>
                  {loading ? (
                    <><span style={{ width: 13, height: 13, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .6s linear infinite", display: "inline-block" }} />Creating...</>
                  ) : "Create account →"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }

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

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      :root{--bg:#0c0c10;--bg2:#131318;--bg3:#1a1a22;--border:#22222e;--border2:#2e2e3e;--text:#eaeaf4;--muted:#58587a;--accent:#6c63ff;--green:#22d3a0;--red:#f87171;--mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;--r:10px;--rl:16px}
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