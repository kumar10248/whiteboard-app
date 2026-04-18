// server/src/server.js
const http = require("http")
const app  = require("./src/app")
const initSocket = require("./src/socket")
require("./src/config/db")  // connect to database

const httpServer = http.createServer(app)
const io = initSocket(httpServer)   // ← pass httpServer, not app

httpServer.listen(process.env.PORT || 8000, () => console.log("Server running on :8000"))