(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.StoldomExchange=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const str=v=>String(v??"");
  function create(operations,company={},options={}){
    if(!Array.isArray(operations)||!operations.length||operations.length>20000)throw Error("Нет операций или превышен лимит 20 000 операций.");
    const warnings=options.reviewNotes||(()=>[]);
    const org=Object.fromEntries(["name","bin","bank","account","period","currency"].map(k=>[k,str(company[k])]));
    const rows=operations.map((x,i)=>{
      const amount=Number(x.amount);
      if(!Number.isFinite(amount)||amount<=0)throw Error("Некорректная сумма операции № "+(i+1));
      const minor=Math.round(amount*100);
      if(!Number.isSafeInteger(minor)||Math.abs(amount-minor/100)>0.000001)throw Error("Некорректная точность суммы операции № "+(i+1));
      if(!["Входящее","Исходящее"].includes(x.direction))throw Error("Не определено направление операции № "+(i+1));
      const notes=warnings(x).map(str);
      return {
        row:i+1,date:str(x.date),direction:x.direction==="Входящее"?"incoming":"outgoing",
        amount:minor.toString(),currency:org.currency||null,
        counterparty:{name:str(x.name),bin:str(x.bin),account:str(x.counterpartyAccount),bik:str(x.bik)},
        payment:{number:str(x.docNumber),bankReference:str(x.bankRef),knp:str(x.knp),purpose:str(x.purpose),comment:str(x.comment),sourceDocument:str(x.sourceDoc)},
        accounting:{documentType:str(x.docType),operationType:str(options.operationType?.(x)),debit:str(x.debit),credit:str(x.credit),cashFlowArticle:str(x.article),contract:null},
        review:{fieldsFilled:x.status==="ready",requiresReview:true,possibleDuplicate:!!x.possibleDuplicate,duplicateAcknowledged:!!x.duplicateConfirmed,notes}
      };
    });
    const sum=direction=>rows.filter(r=>r.direction===direction).reduce((s,r)=>s+BigInt(r.amount),0n).toString();
    return {format:"STOLDOM-1C",schemaVersion:1,createdAt:(options.now||new Date()).toISOString(),amountUnit:"minor",amountScale:2,
      importPolicy:{createUnposted:true,requireAccountAndOrganizationMatch:true,requireExistingContractResolution:true,requireDuplicateCheck:true,requireManualReview:true},
      source:{filename:str(options.filename),organization:org},totals:{count:rows.length,incoming:sum("incoming"),outgoing:sum("outgoing")},operations:rows};
  }
  return {create};
});
