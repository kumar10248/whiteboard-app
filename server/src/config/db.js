const mongoose=require("mongoose")

const url=process.env.MONGO_URI|| "mongodb://localhost:27017/ai_code_review"

mongoose.connect(url).then(()=>console.log("connected to database")).catch((err)=>console.log(err))
module.exports=mongoose