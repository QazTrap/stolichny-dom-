"use strict";
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.sheetjs.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://stoldom-api-production.up.railway.app"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: "no-referrer" }
}));

app.get("/vendor/xlsx.full.min.js", (_req,res) => {
  res.set("Cache-Control","public, max-age=86400");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname,"node_modules","xlsx","dist","xlsx.full.min.js"));
});
app.use("/vendor/pdfjs",express.static(path.join(__dirname,"vendor","pdfjs")));
for(const name of ["workspace-core.js","app.js","alatau-pdf.mjs","kgd-export.js","kgd-brand.js","vendor/qrcode.js"]){
  app.get("/"+name,(_req,res)=>{
    res.set("Cache-Control","no-store");
    res.type("application/javascript");
    res.sendFile(path.join(__dirname,name));
  });
}
app.get("/stoldom-people-logo.webp",(_req,res)=>res.sendFile(path.join(__dirname,"stoldom-people-logo.webp")));
app.get(["/apple-touch-icon.png","/apple-touch-icon-precomposed.png"],(_req,res)=>res.sendFile(path.join(__dirname,"apple-touch-icon.png")));
require("./kgd-api")(app);
const {createHash,timingSafeEqual}=require("node:crypto");
const exportOrigins=new Set(["https://stoldom.site","https://www.stoldom.site"]);
const exportAuthPath="/api/export/access";
function exportHeaders(req,res,next){
  res.set("Cache-Control","no-store");
  const origin=req.get("Origin");
  if(origin){if(!exportOrigins.has(origin))return res.sendStatus(403);
    res.set("Access-Control-Allow-Origin",origin);res.vary("Origin");
    res.set("Access-Control-Allow-Methods","POST, OPTIONS");
    res.set("Access-Control-Allow-Headers","Authorization");}
  next();
}
let exportFailureWindow=0,exportFailures=0;
app.options(exportAuthPath,exportHeaders,(_req,res)=>res.sendStatus(204));
app.post(exportAuthPath,exportHeaders,(req,res)=>{
  const key=process.env.STOLDOM_EXPORT_ACCESS_KEY;
  if(!key||key.length<24)return res.status(503).json({error:"Закрытый экспорт ещё не настроен."});
  const digest=v=>createHash("sha256").update(v).digest();
  const now=Date.now();if(now-exportFailureWindow>=60000){exportFailureWindow=now;exportFailures=0;}
  if(exportFailures>=10){res.set("Retry-After","60");return res.status(429).json({error:"Повторите через минуту."});}
  if(!timingSafeEqual(digest(req.get("Authorization")||""),digest("Bearer "+key))){exportFailures++;return res.status(401).json({error:"Неверный код доступа."});}
  return res.json({ok:true});
});
app.get("/api/health",(_req,res)=>{
  res.set("Cache-Control","no-store");
  res.json({ok:true,service:"STOLDOM.SITE",module:"bank-statement-workspace",dataProcessing:"browser-only"});
});
app.get("/",(_req,res)=>{
  res.set("Cache-Control","no-store");
  res.sendFile(path.join(__dirname,"index.html"));
});
app.listen(PORT,()=>console.log("STOLDOM.SITE listening on port "+PORT));

