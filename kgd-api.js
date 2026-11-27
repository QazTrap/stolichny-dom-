"use strict";
const express = require("express");
const {timingSafeEqual, createHash} = require("node:crypto");
const sessionAuth=require("./kgd-session");
const {lookupVat}=require("./kgd-vat");
const ENDPOINT = "https://kgd.gov.kz/services/isnaportal/public/get-sur-data";
const ORIGINS = new Set(["https://stoldom.site","https://www.stoldom.site"]);
const PATH = "/api/kgd/counterparty";
const fields = ["actuality","xin","name","regDate","residency","oked","okedName","okedDate","vatInfo","vatDate","taxMode","taxModeDate","registrationInvalid","reRegistrationInvalid","operationsWOWork","esfRestrinctions","inactive","regAddressAbsent","bankrupt","selfRegulatoryRegistry","courtDecisionRegistry","taxDebt","taxDebt1","taxDebt2","taxDebt3","taxDebt4","statistics"];
function publicValue(value){
  if(value===null || typeof value==="number" || typeof value==="boolean")return value;
  if(typeof value==="string")return value.slice(0,3000);
  if(value && typeof value==="object" && !Array.isArray(value)){
    return Object.fromEntries(["ru","kk"].filter(k=>typeof value[k]==="string").map(k=>[k,value[k].slice(0,3000)]));
  }
  return null;
}
function normalize(data){
  const out={};
  for(const key of fields){
    if(!Object.hasOwn(data,key))continue;
    if(key==="statistics"){
      if(Array.isArray(data.statistics))out.statistics=data.statistics.slice(0,30).filter(x=>x&&typeof x==="object").map(x=>Object.fromEntries(["year","workersCount","taxIn","knn","knnAvg","vatAmount"].filter(k=>Object.hasOwn(x,k)).map(k=>[k,publicValue(x[k])])));
    }else out[key]=publicValue(data[key]);
  }
  return out;
}
const digest=value=>createHash("sha256").update(value).digest();
module.exports=function mountKgd(app){
  let windowStart=0, count=0, active=0, loginWindow=0, loginFailures=0;
  function headers(req,res,next){
    res.set("Cache-Control","no-store");
    const origin=req.get("Origin");
    if(origin){
      if(!ORIGINS.has(origin))return res.status(403).json({error:"Источник запроса не разрешён."});
      res.set("Access-Control-Allow-Origin",origin);
      res.vary("Origin");
      res.set("Access-Control-Allow-Methods","POST, OPTIONS");
      res.set("Access-Control-Allow-Headers","Content-Type, Authorization");
    }
    next();
  }
  app.options(PATH,headers,(_req,res)=>res.sendStatus(204));
  const sessionPath="/api/kgd/session";
  app.options(sessionPath,headers,(_req,res)=>res.sendStatus(204));
  app.post(sessionPath,headers,(req,res)=>{
    const access=process.env.STOLDOM_KGD_ACCESS_KEY;
    if(!access||access.length<24)return res.status(503).json({error:"Интеграция КГД ещё не настроена."});
    const supplied=req.get("Authorization")||"";
    if(!timingSafeEqual(digest(supplied),digest("Bearer "+access))){
      const now=Date.now();
      if(now-loginWindow>=60000){loginWindow=now;loginFailures=0;}
      if(++loginFailures>10){res.set("Retry-After","60");return res.status(429).json({error:"Слишком много попыток. Повторите через минуту."});}
      return res.status(401).json({error:"Неверный код доступа."});
    }
    return res.json({ok:true,...sessionAuth.issue(access)});
  });
  app.post(PATH,headers,express.json({limit:"2kb"}),async(req,res)=>{
    const token=process.env.KGD_API_TOKEN;
    const access=process.env.STOLDOM_KGD_ACCESS_KEY;
    const endpoint=process.env.KGD_API_URL||ENDPOINT;
    if(!token||!access||access.length<24||endpoint!==ENDPOINT)return res.status(503).json({error:"Интеграция КГД ещё не настроена."});
    const supplied=req.get("Authorization")||"";
    if(!timingSafeEqual(digest(supplied),digest("Bearer "+access))&&!sessionAuth.valid(access,supplied.startsWith("Bearer ")?supplied.slice(7):""))return res.status(401).json({error:"Сессия истекла. Введите код доступа."});
    const xin=req.body?.xin;
    if(typeof xin!=="string"||!/^\d{12}$/.test(xin))return res.status(400).json({error:"Введите 12 цифр БИН или ИИН."});
    const now=Date.now();
    if(now-windowStart>=60000){windowStart=now;count=0;}
    if(count>=20||active>=4){res.set("Retry-After","60");return res.status(429).json({error:"Лимит запросов. Повторите позже."});}
    count++;active++;
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"X-Portal-Token":token,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({xin}),redirect:"error",signal:AbortSignal.timeout(15000)});
      if(!response.ok)return res.status(response.status===400?400:response.status===404?404:502).json({error:response.status===400?"КГД отклонил запрос.":response.status===404?"Сведения не найдены.":"КГД не обработал запрос."});
      const data=await response.json();
      if(!data||typeof data!=="object"||Array.isArray(data)||String(data.xin||"")!==xin)return res.status(502).json({error:"Не удалось подтвердить ответ КГД."});
      const result=normalize(data);
      const vat=await lookupVat(xin,process.env.KGD_VAT_API_TOKEN||token);
      return res.json({ok:true,source:"КГД",data:{...result,...vat}});
    }catch{
      return res.status(502).json({error:"Сервис КГД недоступен или вернул некорректный ответ."});
    }finally{active--;}
  });
};
