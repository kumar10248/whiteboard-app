const User=require("../models/User")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const {generateAccessToken,generateRefreshToken}=require("../utils/generateToken")
require("dotenv").config()

const refreshAccessToken = async (req, res) => {

const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(401, "No refresh token");
  }

  let decoded;

try {
  decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
} catch (err) {
  throw new ApiError(401, "Invalid refresh token");
}

  const user = await User.findById(decoded.id);

  if (!user || user.refreshToken !== refreshToken) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const newAccessToken = generateAccessToken(user);

  res.status(200).json({
  success: true,
  accessToken: newAccessToken
});
}
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ msg: "All fields are required" })
    }

    const emailNormalized = email.toLowerCase().trim()

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/

    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        msg: "Password must be at least 8 characters and include letters & numbers"
      })
    }

    const existUser = await User.findOne({ email: emailNormalized })
    if (existUser) {
      return res.status(409).json({ msg: "User already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    await User.create({
      name,
      email: emailNormalized,
      password: hashedPassword
    })

    res.status(201).json({ msg: "Registered successfully" })

  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: "Something went wrong" })
  }
}

const login = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ msg: "All fields are required" })
    }

    const emailNormalized = email.toLowerCase().trim()

    const user = await User.findOne({ email: emailNormalized })
    if (!user) {
      return res.status(401).json({ msg: "Invalid credentials" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ msg: "Invalid credentials" })
    }

    
    const token = generateAccessToken(user)
    const refreshToken=generateRefreshToken(user)
    user.refreshToken=refreshToken;
    await user.save()


res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "strict"
});
    res.status(200).json({
      token,
      msg: "Login successful",
  
    })
    

  } catch (error) {
    console.error(error)
    res.status(500).json({ msg: "Internal server error" })
  }
}

const getUserData=async(req,res)=>{
  try {
    const user=await User.findById(req.user.id).select("-password -refreshToken")

    if (!user) {
  return res.status(404).json({ msg: "User not found" })
}
     res.status(200).json({
      success: true,
      msg: "User data fetched successfully",
      user
    })

  } catch (error) {
    console.error("getUserData error:", error)

    res.status(500).json({
      success: false,
      msg: "Internal server error"
    })
  }
}

const changePassword=async(req,res)=>{
    try{
      const user = await User.findById(req.user.id).select("+password");

  if (!user) {
    return res.status(401).json({msg:"User not found"});
  }

const oldPassword = req.body.oldPassword?.trim()
const newPassword = req.body.newPassword?.trim()
 
 if (!oldPassword || !newPassword) {
      return res.status(400).json({ msg: "oldPassword and newPassword are required" })
    }
 
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        msg: "newPassword must be at least 8 characters and include letters & numbers"
      })
    }

    const isMatch=await bcrypt.compare(oldPassword,user.password)
    if(!isMatch){
        return res.status(401).json({msg:"old password is Incorrect"})
    }
  if (oldPassword === newPassword){
        return res.status(400).json({msg:"new password must be different"})

    }

    const hashNewpassword=await bcrypt.hash(newPassword,10)
    user.password=hashNewpassword;
    user.passwordChangedAt = Date.now()
   await user.save()
   res.status(200).json({msg:"password updated successfully"})
}catch(error){
return res.status(500).json({msg:"server error"})
}
   

}

module.exports = { register, login ,changePassword,refreshAccessToken,getUserData}