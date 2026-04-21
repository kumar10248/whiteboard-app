// server/src/config/redis.js
// Redis serves two purposes in this project:
// 1. Socket.io adapter — syncs socket rooms across multiple server instances
// 2. Pub/Sub — broadcasts AI generation events between servers
// For a single-server deploy (Railway free tier), Redis is optional
// but keeps you ready to scale without refactoring.

const { createClient } = require("redis")

let client = null
let subscriber = null
let publisher = null

async function createRedisClient(name = "client") {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379"

  const c = createClient({
    url: redisUrl,

    // ✅ REQUIRED for Upstash (TLS)
    socket: redisUrl.startsWith("rediss://")
      ? {
          tls: true,
          rejectUnauthorized: false, // avoids TLS cert issues
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error(`[Redis] ${name}: Max reconnect attempts reached`)
              return new Error("Max retries exceeded")
            }
            const delay = Math.min(retries * 100, 3000)
            console.log(`[Redis] ${name}: Reconnecting in ${delay}ms (attempt ${retries})`)
            return delay
          },
        }
      : {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error(`[Redis] ${name}: Max reconnect attempts reached`)
              return new Error("Max retries exceeded")
            }
            const delay = Math.min(retries * 100, 3000)
            console.log(`[Redis] ${name}: Reconnecting in ${delay}ms (attempt ${retries})`)
            return delay
          },
        },
  })

  c.on("error", err => console.error(`[Redis] ${name} error:`, err.message))
  c.on("connect", () => console.log(`[Redis] ${name}: connected`))
  c.on("reconnecting", () => console.log(`[Redis] ${name}: reconnecting...`))
  c.on("ready", () => console.log(`[Redis] ${name}: ready`))

  await c.connect()
  return c
}

/* ── Initialize all Redis clients ────────────────────────────────── */
async function initRedis() {
  try {
    [client, subscriber, publisher] = await Promise.all([
      createRedisClient("main"),
      createRedisClient("subscriber"),
      createRedisClient("publisher"),
    ])
    console.log("[Redis] All clients initialized")
    return { client, subscriber, publisher }
  } catch (err) {
    // Redis is optional — warn but don't crash the server
    console.warn("[Redis] Failed to connect — running without Redis:", err.message)
    console.warn("[Redis] Multi-server scaling and pub/sub will be disabled.")
    return { client: null, subscriber: null, publisher: null }
  }
}

/* ── Getters — use these in other files ──────────────────────────── */
function getClient()     { return client }
function getSubscriber() { return subscriber }
function getPublisher()  { return publisher }

/* ── Cache helpers ───────────────────────────────────────────────── */
// Simple wrapper so you don't need to check if Redis is available

async function cacheSet(key, value, ttlSeconds = 300) {
  if (!client) return
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds })
  } catch (err) {
    console.warn(`[Redis] cacheSet failed for key=${key}:`, err.message)
  }
}

async function cacheGet(key) {
  if (!client) return null
  try {
    const raw = await client.get(key)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    console.warn(`[Redis] cacheGet failed for key=${key}:`, err.message)
    return null
  }
}

async function cacheDel(key) {
  if (!client) return
  try {
    await client.del(key)
  } catch (err) {
    console.warn(`[Redis] cacheDel failed for key=${key}:`, err.message)
  }
}

/* ── Pub/Sub helpers ─────────────────────────────────────────────── */
// Used to broadcast AI generation events across multiple server instances.
// On a single server this is redundant — Socket.io handles it in-process.
// On multiple servers (Railway horizontal scaling), this becomes essential.

async function publish(channel, data) {
  if (!publisher) return
  try {
    await publisher.publish(channel, JSON.stringify(data))
  } catch (err) {
    console.warn(`[Redis] publish failed channel=${channel}:`, err.message)
  }
}

async function subscribe(channel, callback) {
  if (!subscriber) return
  try {
    await subscriber.subscribe(channel, (message) => {
      try {
        callback(JSON.parse(message))
      } catch (err) {
        console.error(`[Redis] Failed to parse message on channel=${channel}:`, err.message)
      }
    })
    console.log(`[Redis] Subscribed to channel: ${channel}`)
  } catch (err) {
    console.warn(`[Redis] subscribe failed channel=${channel}:`, err.message)
  }
}

async function unsubscribe(channel) {
  if (!subscriber) return
  try {
    await subscriber.unsubscribe(channel)
  } catch (err) {
    console.warn(`[Redis] unsubscribe failed channel=${channel}:`, err.message)
  }
}

/* ── Graceful shutdown ───────────────────────────────────────────── */
async function closeRedis() {
  try {
    await Promise.all([
      client?.quit(),
      subscriber?.quit(),
      publisher?.quit(),
    ])
    console.log("[Redis] All clients closed")
  } catch (err) {
    console.error("[Redis] Error during shutdown:", err.message)
  }
}

module.exports = {
  initRedis,
  getClient,
  getSubscriber,
  getPublisher,
  cacheSet,
  cacheGet,
  cacheDel,
  publish,
  subscribe,
  unsubscribe,
  closeRedis,
}