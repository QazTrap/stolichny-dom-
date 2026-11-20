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
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
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
for(const name of ["workspace-core.js","app.js"]){
  app.get("/"+name,(_req,res)=>{
    res.set("Cache-Control","no-store");
    res.type("application/javascript");
    res.sendFile(path.join(__dirname,name));
  });
}
app.get("/api/health",(_req,res)=>{
  res.set("Cache-Control","no-store");
  res.json({ok:true,service:"STOLDOM.SITE",module:"bank-statement-workspace",dataProcessing:"browser-only"});
});
app.get("/",(_req,res)=>{
  res.set("Cache-Control","no-store");
  res.sendFile(path.join(__dirname,"index.html"));
});
app.listen(PORT,()=>console.log("STOLDOM.SITE listening on port "+PORT));
