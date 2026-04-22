// client/lib/socket.ts
// PERFORMANCE: Socket stays connected across board visits.
// No reconnect overhead when navigating between boards.
import { io, Socket } from "socket.io-client"
import { getToken } from "./api"

let socket: Socket | null = null

export function getSocket(): Socket {
  if (socket) return socket

  socket = io("https://whiteboard-app-ey8e.onrender.com", {
    autoConnect:  false,
    transports:   ["websocket"],   // skip polling — direct WebSocket only
    reconnection: true,
    reconnectionDelay:    500,     // retry after 500ms
    reconnectionDelayMax: 3000,    // max 3s between retries
    reconnectionAttempts: 10,
    auth: { token: getToken() },
    // Timeout fast — don't wait 20s for a dead connection
    timeout: 5000,
  })

  socket.on("connect",       () => console.log("[socket] connected", socket?.id))
  socket.on("disconnect", reason => console.log("[socket] disconnected:", reason))
  socket.on("connect_error", err  => console.error("[socket] error:", err.message))

  return socket
}

// Call on every board page mount — updates auth token and connects if needed.
// Does NOT disconnect on board leave — keeps the TCP connection alive.
export function connectSocket(): Socket {
  const s = getSocket()
  // Always refresh token (it may have been refreshed via /auth/refresh)
  if (s.auth && typeof s.auth === "object") {
    (s.auth as Record<string, string>).token = getToken() || ""
  }
  if (!s.connected) {
    console.log("[socket] connecting...")
    s.connect()
  }
  return s
}

// Only call this on explicit logout or app unmount.
// Do NOT call on board page unmount.
export function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect()
  }
}