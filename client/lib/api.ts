// client/lib/api.ts
const BASE = "http://localhost:5000/api/v1"

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("wb_token")
}
export function setToken(t: string) { localStorage.setItem("wb_token", t) }
export function clearToken()        { localStorage.removeItem("wb_token") }

export function isTokenExpired(token: string): boolean {
  try {
    const p = JSON.parse(atob(token.split(".")[1]))
    return p.exp * 1000 < Date.now()
  } catch { return true }
}

export function getAuthStatus(): "valid" | "expired" | "none" {
  const token = getToken()
  if (!token) return "none"
  if (isTokenExpired(token)) { clearToken(); return "expired" }
  return "valid"
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json()
  if (res.status === 401) { clearToken(); throw new Error(data.msg || "Unauthorized") }
  if (!res.ok)            { throw new Error(data.msg || "Request failed") }
  return data
}

/* ── Auth ── */
export const authAPI = {
  register: (b: { name: string; email: string; password: string }) =>
    request<{ msg: string }>("/auth/register", { method: "POST", body: JSON.stringify(b) }),

  login: (b: { email: string; password: string }) =>
    request<{ token: string; msg: string }>("/auth/login", { method: "POST", body: JSON.stringify(b) }),

  refresh: () =>
    request<{ token: string }>("/auth/refresh", { method: "POST" }),

  logout: () =>
    request<{ msg: string }>("/auth/logout", { method: "POST" }),

  me: () =>
    request<{ success: boolean; user: { _id: string; name: string; email: string } }>("/auth/me"),
}

/* ── Boards ── */
export interface Board {
  _id:       string
  title:     string
  ownerId:   string
  members:   string[]
  isPublic:  boolean
  thumbnail: string | null
  createdAt: string
  updatedAt: string
}

export const boardAPI = {
  create: (b: { title: string; isPublic?: boolean }) =>
    request<{ board: Board }>("/boards", { method: "POST", body: JSON.stringify(b) }),

  getAll: () =>
    request<{ boards: Board[] }>("/boards"),

  getById: (id: string) =>
    request<{ board: Board }>(`/boards/${id}`),

  update: (id: string, b: { title?: string; isPublic?: boolean }) =>
    request<{ board: Board }>(`/boards/${id}`, { method: "PATCH", body: JSON.stringify(b) }),

  delete: (id: string) =>
    request<{ msg: string }>(`/boards/${id}`, { method: "DELETE" }),

  addMember: (id: string, email: string) =>
    request<{ msg: string }>(`/boards/${id}/members`, { method: "POST", body: JSON.stringify({ email }) }),

  getSnapshots: (id: string) =>
    request<{ snapshots: { index: number; label: string; savedAt: string }[] }>(`/boards/${id}/snapshots`),

  saveThumbnail: (id: string, image: string) =>
    request<{ msg: string }>(`/boards/${id}/thumbnail`, { method: "POST", body: JSON.stringify({ image }) }),
}