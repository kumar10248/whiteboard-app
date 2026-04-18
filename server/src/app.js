const express=require("express")
const app=express()

app.use(express.json())
const cors = require("cors");

app.use(cors({
  origin: "https://reviewai.devashish.top",
  credentials: true
}));

app.get('/',(req,res)=>{
    res.send("Welcome to AI Code Review API")
})

module.exports=app