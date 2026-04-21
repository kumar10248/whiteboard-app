// client/lib/socket.ts
import { io, Socket } from "socket.io-client"
import { getToken } from "./api"

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io("http://localhost:5000", {
      autoConnect:  false,
      transports:   ["websocket", "polling"],
      // Send JWT in handshake — server reads socket.handshake.auth.token
      
 auth: { token: `Bearer ${getToken()}` },
 
 
 
    })
 
    socket.on("connect",         () => console.log("[socket] connected:", socket?.id))
    socket.on("disconnect",   r => console.log("[socket] disconnected:", r))
    socket.on("connect_error", e => console.error("[socket] error:", e.message))
    socket.on("error",        e => console.error("[socket] server error:", e))
  }
  return socket
}

// Call before navigating to /board/:id — refreshes the auth token in case it changed
export function connectSocket() {
  const s = getSocket()
  // Update auth token (in case user just logged in)
  if (s.auth && typeof s.auth === "object") {
    (s.auth as Record<string, string>).token = getToken() || ""
  }
  if (!s.connected) s.connect()
  return s
}

export function disconnectSocket() {
  socket?.disconnect()
}