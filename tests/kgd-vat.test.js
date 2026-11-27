"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {lookupVat,registryFields}=require("../kgd-vat");
const xin="012345678901",today="2026-11-27";
test("confirmed VAT enrollment and deregistration",()=>{
 let result=registryFields({iinBin:xin,ndsRegistrationDate:"2025-05-29",ndsDeregistrationDate:null},xin,today);
 assert.match(result.vatInfo,/Состоит/);
 assert.equal(result.vatDate,"2025-05-29");
 result=registryFields({iinBin:xin,ndsRegistrationDate:"2025-05-29",ndsDeregistrationDate:"2026-02-01",ndsDeregistrationReason:{ru:"Причина"}},xin,today);
 assert.match(result.vatInfo,/Снят/);
 assert.equal(result.vatRegistryDeregistrationReason,"Причина");
});
test("no data and mismatched identifier do not assert VAT status",()=>{
 assert.equal(registryFields({iinBin:xin,ndsRegistrationDate:null,ndsDeregistrationDate:null},xin,today).vatInfo,undefined);
 assert.equal(registryFields({iinBin:"999999999999",ndsRegistrationDate:"2025-05-29",ndsDeregistrationDate:null},xin,today).vatInfo,undefined);
 assert.equal(registryFields({iinBin:xin,ndsRegistrationDate:"2025-05-29"},xin,today).vatInfo,undefined);
});
test("GET fallback to documented POST, preserving authorization on the official fixed host",async()=>{
 const calls=[];
 const out=await lookupVat(xin,"test-secret",{today,fetchImpl:async(url,options)=>{
  calls.push([url,options]);
  if(calls.length===1)return {ok:false,status:405};
  return {ok:true,status:200,json:async()=>({iinBin:xin,ndsRegistrationDate:"2025-05-29",ndsDeregistrationDate:null})};
 }});
 assert.match(calls[0][0],/taxpayerCode=012345678901$/);
 assert.equal(calls[1][1].method,"POST");
 assert.equal(JSON.parse(calls[1][1].body).taxpayerCode,xin);
 assert.match(out.vatInfo,/Состоит/);
});
test("access denied does not overwrite base KGD data",async()=>{
 const out=await lookupVat(xin,"test-secret",{today,fetchImpl:async()=>({ok:false,status:404})});
 assert.match(out.vatRegistryStatus,/404/);
 assert.equal(out.vatInfo,undefined);
});

test("a redirect is never followed and the alternate official host can answer",async()=>{
 const calls=[];
 const result=await lookupVat(xin,"test-secret",{today,fetchImpl:async(url,options)=>{
  calls.push([url,options]);
  if(calls.length===1)return {ok:false,status:302};
  return {ok:true,status:200,json:async()=>({iinBin:xin,ndsRegistrationDate:"2025-05-29",ndsDeregistrationDate:null})};
 }});
 assert.equal(calls[0][1].redirect,"manual");
 assert.equal(new URL(calls[1][0]).hostname,"kgd.gov.kz");
 assert.match(result.vatInfo,/Состоит/);
});
