const headers=["Дата операции","№ документа","Дебет","Кредит","КНП","Назначение платежа","Контрагент","БИН/ИИН контрагента"];
const layoutError=()=>new Error("Не удалось распознать таблицу Alatau City Bank. Загрузите текстовый PDF стандартной выписки или Excel.");
export function parseAlatauPages(pages,C){
  const first=pages[0]||[];
  if(!first.some(p=>/Alatau City Bank/i.test(p.s))||!first.some(p=>/\bKZT\b/i.test(p.s)))throw layoutError();
  function summary(label){
    const item=first.find(p=>p.s.startsWith(label));
    if(!item)throw layoutError();
    const inline=item.s.slice(label.length).trim();
    const next=first.find(p=>Math.abs(p.y-item.y)<1&&p.x>item.x+10&&/^\d/.test(p.s));
    const amount=C.money(inline||next?.s);
    if(!Number.isFinite(amount))throw layoutError();
    return amount;
  }
  const balances=[summary("Входящий остаток:"),summary("Исходящий остаток:")];
  // Use the first page's header only: never interpret counterparties as
  // the statement owner's company identity.
  const heading=first.find(p=>p.s==="Дата операции");
  const headerItems=first.filter(p=>!heading||p.y<heading.y-2)
    .sort((a,b)=>a.y-b.y||a.x-b.x);
  const metadataRows=[];
  for(const item of headerItems){
    const previous=metadataRows[metadataRows.length-1];
    if(previous&&Math.abs(previous.y-item.y)<=2)previous.cells.push(item.s);
    else metadataRows.push({y:item.y,cells:[item.s]});
  }
  const company=C.extractStatementCompany(metadataRows.map(row=>row.cells),"Alatau City Bank");
  if(!company.currency)company.currency="KZT";
  const rows=[headers];
  for(const page of pages){
    const heading=page.find(p=>p.s==="Дата операции");
    const credit=page.find(p=>p.s==="Кредит"&&Math.abs(p.y-heading?.y)<2);
    if(!heading||!credit)throw layoutError();
    // Column positions in the bank's landscape form, scaled to its header.
    const scale=(credit.x-heading.x)/193.7;
    const items=page.filter(p=>p.y>heading.y+2).map(p=>({...p,x:(p.x-heading.x)/scale+13})).sort((a,b)=>a.y-b.y||a.x-b.x);
    let row=null;
    for(const {x,s} of items){
      if(x<60&&/^ИТОГО/i.test(s))break;
      if(x<60&&/^\d{2}\.\d{2}\.\d{4}$/.test(s)){
        row=[s,"","","","","","",""];
        rows.push(row);
        continue;
      }
      if(!row||x<110)continue;
      if(x<146)row[1]+=s;
      else if(x<190)row[2]+=s;
      else if(x<238)row[3]+=s;
      else if(x>=360&&x<386)row[4]+=s;
      else if(x>=386&&x<508)row[5]+=(row[5]?" ":"")+s;
      else if(x>=508&&x<601)row[6]+=(row[6]?" ":"")+s;
      else if(x>=601&&x<663)row[7]+=s;
    }
  }
  const operations=C.parseRows(rows,"Alatau City Bank");
  const totals=C.totals(operations);
  const cents=value=>Math.round(value*100);
  if(!operations.length||operations.length!==rows.length-1||totals.unknown||
    cents(totals.incoming)!==cents(summary("Обороты по кредиту:"))||
    cents(totals.outgoing)!==cents(summary("Обороты по дебету:"))||
    cents(balances[0])+cents(totals.net)!==cents(balances[1])){
    throw Error("Операции PDF не сошлись с итогами банка. Импорт отменён.");
  }
  return {operations,balances,company};
}

export async function readAlatauPdf(file,C){
  const pdfjs=await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc=new URL("./vendor/pdfjs/pdf.worker.min.mjs",import.meta.url).href;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
  try{
    const document=await task.promise,pages=[];
    for(let i=1;i<=document.numPages;i++){
      const page=await document.getPage(i),viewport=page.getViewport({scale:1});
      const {items}=await page.getTextContent();
      pages.push(items.filter(item=>item.str?.trim()).map(item=>{
        const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
        return {x,y,s:item.str.trim()};
      }).filter(item=>!(item.y>viewport.height-15 && item.s===String(i))));
      page.cleanup();
    }
    return parseAlatauPages(pages,C);
  }finally{await task.destroy();}
}
