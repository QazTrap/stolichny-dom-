"use strict";
const {createHmac,randomBytes,timingSafeEqual}=require("node:crypto");
const TTL=30*24*60*60*1000;
function sign(secret,body){return createHmac("sha256",secret).update("stoldom-kgd-session-v1:"+body).digest("base64url");}
function issue(secret,now=Date.now()){
  const expiresAt=now+TTL;
  const body=expiresAt+"."+randomBytes(24).toString("base64url");
  return {session:body+"."+sign(secret,body),expiresAt};
}
function valid(secret,token,now=Date.now()){
  if(typeof secret!=="string"||secret.length<24||typeof token!=="string"||!/^\d{13}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token))return false;
  const [expiry,nonce,signature]=token.split(".");
  if(Number(expiry)<=now||Number(expiry)>now+TTL)return false;
  const expected=sign(secret,expiry+"."+nonce);
  return timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
}
module.exports={TTL,issue,valid};
