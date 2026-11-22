const headers=["Дата операции","№ документа","Дебет","Кредит","КНП","Назначение платежа","Контрагент","БИН/ИИН контрагента"];
const layoutError=()=>new Error("Не удалось распознать таблицу Alatau City Bank. Загрузите текстовый PDF стандартной выписки или Excel.");
export function parseAlatauPages(pages,C){
  const first=pages[0]||[];
  // PDF.js may split a visual line into several text fragments.
  const firstText=first.map(p=>String(p.s||"")).join(" ");
  if(!/Alatau/i.test(firstText)||!/City/i.test(firstText)||!/Bank/i.test(firstText)||
     !/\bKZT\b/i.test(firstText))throw layoutError();
  function summary(label){
    const item=first.find(p=>p.s.startsWith(label));
    if(!item)throw layoutError();
    const inline=item.s.slice(label.length).trim();
    const next=first.find(p=>Math.abs(p.y-item.y)<5&&p.x>item.x+35&&/^\d/.test(p.s));
    const amount=C.money(inline||next?.s);
    if(!Number.isFinite(amount))throw layoutError();
    return amount;
  }
  const balances=[summary("Входящий остаток:"),summary("Исходящий остаток:")];
  // Parse the PDF header using text coordinates. Its client name is often
  // split over several lines, not laid out as Excel label/value cells.
  const heading=first.find(p=>p.s==="Дата операции");
  const headerItems=first.filter(p=>!heading||p.y<heading.y-2)
    .sort((a,b)=>a.y-b.y||a.x-b.x);
  const company={name:"",bin:"",bank:"Alatau City Bank",account:"",period:"",currency:""};
  const periodItem=headerItems.find(p=>/за период с/i.test(p.s));
  const periodMatch=periodItem?.s.match(/с\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/i);
  if(periodMatch)company.period=periodMatch[1]+" — "+periodMatch[2];
  const accountItem=headerItems.find(p=>/\bKZ[A-Z0-9]{18}\b/i.test(p.s));
  const accountMatch=accountItem?.s.match(/\bKZ[A-Z0-9]{18}\b/i);
  if(accountMatch)company.account=accountMatch[0].toUpperCase();
  const currencyMatch=accountItem?.s.match(/\b(KZT|USD|EUR|RUB|GBP|CNY)\b/i);
  if(currencyMatch)company.currency=currencyMatch[1].toUpperCase();
  const binLabel=headerItems.find(p=>/^ИИН\s*\(\s*БИН\s*\)\s*:/i.test(p.s));
  const binItem=binLabel&&headerItems.find(p=>
    Math.abs(p.y-binLabel.y)<4 && p.x>binLabel.x+30 && /^\d{12}$/.test(p.s));
  if(binItem)company.bin=binItem.s;
  const clientLabel=headerItems.find(p=>/^Клиент\s*:/i.test(p.s));
  if(clientLabel){
    const bottom=binLabel?.y??clientLabel.y+45;
    company.name=headerItems.filter(p=>
      p!==clientLabel && p.y>=clientLabel.y-2 && p.y<bottom-2 &&
      p.x>clientLabel.x+35 &&
      !/^Клиент\s*:/i.test(p.s) && !/^\d{12}$/.test(p.s))
      .sort((a,b)=>a.y-b.y||a.x-b.x)
      .map(p=>p.s.trim()).filter(Boolean).join(" ").slice(0,240);
  }
  // A genuine bank statement can contain no transactions at all. In that
  // case PDF.js may not provide stable table column coordinates. Check the
  // bank's explicit zero debit/credit totals and unchanged balances instead.
  const credited=summary("Обороты по кредиту:");
  const debited=summary("Обороты по дебету:");
  const rounded=value=>Math.round(value*100);
  const allText=pages.flat().map(p=>String(p.s||"")).join(" ");
  if(rounded(credited)===0&&rounded(debited)===0&&
     rounded(balances[0])===rounded(balances[1])&&
     /ИТОГО\s*:?/i.test(allText)&&/Дата/i.test(allText)&&/операции/i.test(allText)){
    return {operations:[],balances,company};
  }
  const rows=[headers];
  for(const page of pages){
    const heading=page.find(p=>/^Дата\s+операции$/i.test(String(p.s||"").trim()));
    const credit=page.find(p=>/^Кредит$/i.test(String(p.s||"").trim())&&Math.abs(p.y-heading?.y)<8);
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
  // A statement with zero transactions is valid when the bank also reports
  // zero debit/credit turnover and the opening and closing balances reconcile.
  if(operations.length!==rows.length-1||totals.unknown||
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
