// models/User.js
const mongoose = require("mongoose")

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,   // always store email in lowercase
    trim: true
  },
  password: {
    type: String,
    required: true
    // hashing happens in the controller with bcrypt, NOT here
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  refreshToken: {
  type: String
},
  passwordChangedAt: {
  type: Date
}
}, { timestamps: true })  // auto adds createdAt + updatedAt

module.exports = mongoose.model("User", userSchema)