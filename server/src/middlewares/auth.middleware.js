const jwt = require("jsonwebtoken")
const User = require("../models/User")
require("dotenv").config();
const verifyJWT = async (req, res, next) => {
  try {
    const authToken = req.get("Authorization")

    if (!authToken || !authToken.startsWith("Bearer ")) {
      return res.status(401).json({ msg: "Unauthorized access" })
    }

    const token = authToken.split(" ")[1]

    const decoded = await jwt.verify(token, process.env.JWT_SECRET, { issuer: "ai-review-app" })
    

    if (!decoded?.id) {
      return res.status(401).json({ msg: "Invalid token payload" })
    }

    if (!decoded.iat) {
      return res.status(401).json({ msg: "Invalid token (no iat)" })
    }

    const user = await User.findById(decoded.id)
      .select("-password")
      .lean()

    if (!user) {
      return res.status(401).json({ msg: "Invalid token user" })
    }

    const tokenIssuedAt = decoded.iat * 1000
    const passwordChangedTime = user.passwordChangedAt
      ? new Date(user.passwordChangedAt).getTime()
      : null

    if (passwordChangedTime && passwordChangedTime > tokenIssuedAt) {
      return res.status(401).json({
        msg: "Password changed. Please login again."
      })
    }

    req.user = {
      id: user._id,
      email: user.email
    }

    next()

  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ msg: "Token expired" })
    }
console.log(error)
    return res.status(401).json({ msg: "Invalid token" })
  }
}


module.exports = verifyJWT