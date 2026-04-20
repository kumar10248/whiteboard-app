// client/lib/useAuth.ts
"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getAuthStatus, clearToken } from "./api"

export function useAuthGuard() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const status = getAuthStatus()
    if (status === "valid") { setReady(true) }
    else { clearToken(); router.replace("/login") }
  }, [])
  return { ready }
}

export function useGuestGuard() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (getAuthStatus() === "valid") { router.replace("/dashboard") }
    else { setReady(true) }
  }, [])
  return { ready }
}