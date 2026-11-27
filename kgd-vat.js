"use strict";
// KGD VAT registry: official manual shows GET query parameters in its successful
// Postman example and describes POST JSON in the text.
const ENDPOINT="https://portal.kgd.gov.kz/services/isnaportalsync/public/search-payer-data";
const blank=value=>value==null||value==="";
const date=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
function registryFields(data,xin,today){
  if(!data||typeof data!=="object"||Array.isArray(data)||String(data.iinBin||"")!==xin)return {vatRegistryStatus:"Ответ реестра НДС не подтверждён"};
  const registered=date(data.ndsRegistrationDate),removed=date(data.ndsDeregistrationDate);
  const out={vatRegistryStatus:"Сведения о действующем статусе не подтверждены"};
  if(registered)out.vatRegistryRegistrationDate=registered;
  if(removed)out.vatRegistryDeregistrationDate=removed;
  const reason=data.ndsDeregistrationReason;
  const label=typeof reason==="string"?reason:typeof reason?.ru==="string"?reason.ru:"";
  if(label)out.vatRegistryDeregistrationReason=label.slice(0,3000);
  if(registered&&registered<=today&&((Object.hasOwn(data,"ndsDeregistrationDate")&&blank(data.ndsDeregistrationDate))||(removed&&removed<registered))){
    out.vatRegistryStatus="Состоит на учёте по НДС (по данным реестра)";
    out.vatInfo="Состоит на учёте по НДС (реестр НДС)";
    out.vatDate=registered;
  }else if(removed&&removed<=today&&(!registered?blank(data.ndsRegistrationDate):removed>=registered)){
    out.vatRegistryStatus="Снят с учёта по НДС (по данным реестра)";
    out.vatInfo="Снят с учёта по НДС (реестр НДС)";
    if(registered)out.vatDate=registered;
  }else if(!registered&&!removed&&blank(data.ndsRegistrationDate)&&blank(data.ndsDeregistrationDate)){
    out.vatRegistryStatus="Реестр НДС не вернул даты постановки и снятия";
  }
  return out;
}
async function lookupVat(xin,token,{fetchImpl=fetch,today=new Date(Date.now()+5*3600000).toISOString().slice(0,10)}={}){
  const headers={"X-Portal-Token":token,"Accept":"application/json"};
  const signal=AbortSignal.timeout(12000);
  const endpoints=[ENDPOINT,ENDPOINT.replace("portal.kgd.gov.kz","kgd.gov.kz")];
  let failure="Реестр НДС временно недоступен";
  for(const endpoint of endpoints){
    const host=new URL(endpoint).hostname;
    for(const method of ["GET","POST"]){
      if(signal.aborted)return {vatRegistryStatus:failure};
      try{
        const url=method==="GET"?endpoint+"?taxpayerCode="+encodeURIComponent(xin):endpoint;
        const options={method,headers:method==="POST"?{...headers,"Content-Type":"application/json"}:headers,redirect:"manual",signal};
        if(method==="POST")options.body=JSON.stringify({taxpayerCode:xin});
        const response=await fetchImpl(url,options);
        const type=(response.headers?.get("content-type")||"").split(";")[0].trim().toLowerCase();
        const media=/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)?type:"unknown";
        if(response.status>=300&&response.status<400){
          console.warn("[kgd-vat]",host,method,"HTTP redirect",response.status);
          failure="Реестр НДС перенаправляет запрос (HTTP "+response.status+")";break;
        }
        if(!response.ok){
          console.warn("[kgd-vat]",host,method,"HTTP",response.status,media);
          if([401,403].includes(response.status))return {vatRegistryStatus:"Доступ к реестру НДС не подтверждён (HTTP "+response.status+")"};
          failure=response.status===404?"Доступ к реестру НДС не подтверждён (HTTP 404)":"Реестр НДС не обработал запрос (HTTP "+response.status+")";
          if([400,404,405,415,422].includes(response.status))continue;
          break;
        }
        let data;
        try{data=await response.json();}catch{
          console.warn("[kgd-vat]",host,method,"HTTP",response.status,media,"non-JSON");
          failure="Реестр НДС вернул ответ не в формате JSON";continue;
        }
        const result=registryFields(data,xin,today);
        console.info("[kgd-vat]",host,method,"HTTP",response.status,result.vatInfo?"confirmed":"status not confirmed");
        if(!data||typeof data!=="object"||Array.isArray(data)||String(data.iinBin||"")!==xin){failure=result.vatRegistryStatus;continue;}
        return result;
      }catch(err){
        const reason=err?.cause?.code||err?.name||"Error";
        const code=/^[A-Za-z0-9_]{1,60}$/.test(String(reason))?String(reason):"Error";
        console.warn("[kgd-vat]",host,method,"request failed",code);
        failure="Ошибка соединения с реестром НДС ("+code+")";
        break;
      }
    }
  }
  return {vatRegistryStatus:failure};
}
module.exports={lookupVat,registryFields};
