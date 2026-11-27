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
  try{
    let response=await fetchImpl(ENDPOINT+"?taxpayerCode="+encodeURIComponent(xin),{method:"GET",headers,redirect:"error",signal});
    if([400,405,415].includes(response.status)){
      response=await fetchImpl(ENDPOINT,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({taxpayerCode:xin}),redirect:"error",signal});
    }
    if(!response.ok){
      // The supplied KGD manual identifies 403 and 404 as authorization/access errors.
      if([401,403,404].includes(response.status))return {vatRegistryStatus:"Доступ к реестру НДС не подтверждён (HTTP "+response.status+")"};
      return {vatRegistryStatus:"Реестр НДС не обработал запрос (HTTP "+response.status+")"};
    }
    return registryFields(await response.json(),xin,today);
  }catch{
    return {vatRegistryStatus:"Реестр НДС временно недоступен"};
  }
}
module.exports={lookupVat,registryFields};
