/* STOLDOM.SITE: pure bank statement rules, shared by browser and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.STOLDOM_CORE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const norm = value => String(value ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  function money(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let s = String(value ?? "").replace(/[\s\u00a0\u202f₸$€]/g, "").trim();
    if (!s) return NaN;
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    s = s.replace(/,/g, ".").replace(/[^0-9.+-]/g, "");
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  function dateText(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return [String(value.getDate()).padStart(2,"0"), String(value.getMonth()+1).padStart(2,"0"), value.getFullYear()].join(".");
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 1 && value < 100000) {
      const d = new Date(Date.UTC(1899,11,30) + Math.floor(value) * 86400000);
      return [String(d.getUTCDate()).padStart(2,"0"),String(d.getUTCMonth()+1).padStart(2,"0"),d.getUTCFullYear()].join(".");
    }
    const s = String(value ?? "").trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return formatDate(Number(m[3]),Number(m[2]),Number(m[1]));
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return formatDate(Number(m[1]),Number(m[2]),Number(m[3]));
    return "";
  }
  function formatDate(d,m,y) {
    const t = new Date(Date.UTC(y,m-1,d));
    if (y<2000 || y>2100 || t.getUTCDate()!==d || t.getUTCMonth()!==m-1 || t.getUTCFullYear()!==y) return "";
    return [String(d).padStart(2,"0"),String(m).padStart(2,"0"),y].join(".");
  }
  function shortLegalName(value) {
    const name = String(value ?? "").trim();
    const rules = [
      [/^товарищество\s+с\s+ограниченной\s+ответственностью(?=\s|$)/i,"ТОО"],
      [/^индивидуальный\s+предприниматель(?=\s|$)/i,"ИП"],
      [/^товарищество\s+с\s+дополнительной\s+ответственностью(?=\s|$)/i,"ТДО"],
      [/^акционерное\s+общество(?=\s|$)/i,"АО"],
      [/^общество\s+с\s+ограниченной\s+ответственностью(?=\s|$)/i,"ООО"],
      [/^частное\s+учреждение(?=\s|$)/i,"ЧУ"],
      [/^производственный\s+кооператив(?=\s|$)/i,"ПК"]
    ];
    for (const [re,short] of rules) if (re.test(name)) return name.replace(re,short);
    return name;
  }
  function suggestArticle(purpose, direction) {
    const p = norm(purpose);
    if (!p || !direction) return "";
    const taxAbbr = /(?:^|[^a-zа-я0-9])(опв|опвр|осмс|восмс|ипн|кпн|ндс|со|ооc)(?=$|[^a-zа-я0-9])/i;
    if (direction === "Исходящее") {
      if (taxAbbr.test(p) || /(налог|пен[ия]|штраф|бюджет|казначейств|гос.?доход|соц.?отчислен)/.test(p)) return "Налоги и отчисления";
      if (/(заработн.{0,8} плат|зарплат|з\/п|оплата труда|премия сотруд|аванс сотруд)/.test(p)) return "Заработная плата";
      if (/(аренд|арендная плата)/.test(p)) return "Аренда";
      if (/(комисси.{0,8} банк|банковск.{0,12} комисси|обслуживани.{0,8} счет|эквайринг)/.test(p)) return "Банковские комиссии";
      if (/(возврат.{0,20}(денежн|оплат|платеж|покупател))/.test(p)) return "Возврат денежных средств";
      if (/(перевод.{0,15}(между|своими|собственн).{0,20} счет|перемещени.{0,20} счет)/.test(p)) return "Перевод между счетами";
      if (/(погашени.{0,12}(кредит|займ)|возврат.{0,12}(кредит|займ))/.test(p)) return "Погашение займа";
      if (/(оплат|поставщик|за товар|за услуг|за работ|по договору|согласно счет)/.test(p)) return "Оплата поставщику";
      if (/прочие списания|прочее списание/.test(p)) return "Прочие списания";
    }
    if (direction === "Входящее") {
      if (/(получен.{0,12}(займ|кредит)|предоставлен.{0,12} займ)/.test(p)) return "Получение займа";
      if (/(возврат.{0,15}(от поставщик|переплат|денежн))/.test(p)) return "Возврат денежных средств";
      if (/(перевод.{0,15}(между|своими|собственн).{0,20} счет|поступлен.{0,15} со своего счет)/.test(p)) return "Перевод между счетами";
      if (/(оплат|покупател|выручк|реализац|за товар|за услуг|за работ|по счету)/.test(p)) return "Оплата от покупателя";
      if (/прочие поступления|прочее поступление/.test(p)) return "Прочие поступления";
    }
    return "";
  }
  const aliases = {
    date:["дата операции","дата документа","дата платежа","дата валютирования","дата проводки","дата","operation date","transaction date"],
    payer:["наименование плательщика","плательщик","отправитель","от кого","payer","sender"],
    receiver:["наименование получателя","получатель","кому","receiver","beneficiary"],
    name:["наименование контрагента","контрагент","название контрагента","counterparty"],
    purpose:["назначение платежа","назначение","детали платежа","описание платежа","описание","purpose","details"],
    amount:["сумма операции","сумма платежа","сумма в валюте счета","сумма","amount"],
    debit:["сумма по дебету","дебетовая сумма","сумма дебет","расход","списание","дебет","debit"],
    credit:["сумма по кредиту","кредитовая сумма","сумма кредит","приход","поступление","кредит","credit"],
    direction:["индикатор дебета/кредита","индикатор дебета кредита","дебет/кредит","тип операции","direction","дебет кредит"],
    bankDoc:["тип документа","вид документа","документ","document type"],
    number:["номер документа","№ документа","номер платежа","референс","reference","document number"],
    accountDebit:["счет дебета","счёт дебета","счет дебет","дебет счет","счет списания"],
    accountCredit:["счет кредита","счёт кредита","счет кредит","кредит счет","счет зачисления"],
    bin:["бин/иин контрагента","бин контрагента","иин контрагента","бин","иин","бин/иин","иин/бин"]
  };
  function colIndex(headers,key) {
    const exact = headers.findIndex(h=>aliases[key].includes(h));
    return exact>=0 ? exact : headers.findIndex(h=>aliases[key].some(a=>h.includes(a)));
  }
  function parseRows(matrix, sheetName="") {
    if (!Array.isArray(matrix) || !matrix.length) return [];
    let header=-1, headers=[];
    for (let i=0;i<Math.min(matrix.length,30);i++) {
      const h=(matrix[i]||[]).map(norm);
      const hasDate=h.some(x=>aliases.date.some(a=>x===a || x.includes(a)));
      const hasMoney=h.some(x=>[...aliases.amount,...aliases.debit,...aliases.credit].some(a=>x===a||x.includes(a)));
      if(hasDate&&hasMoney){header=i;headers=h;break;}
    }
    if(header<0) return [];
    const cols={};
    for (const key of Object.keys(aliases)) cols[key]=colIndex(headers,key);
    const result=[];
    for(let rowIdx=header+1;rowIdx<matrix.length;rowIdx++){
      const row=matrix[rowIdx]||[];
      if(!row.some(v=>String(v??"").trim()))continue;
      const get=key=>cols[key]>=0?row[cols[key]]:"";
      const debit=money(get("debit")),credit=money(get("credit")),originalAmount=money(get("amount"));
      const hasDebit=Number.isFinite(debit)&&debit!==0, hasCredit=Number.isFinite(credit)&&credit!==0;
      const rawDirection=norm(get("direction"));
      let direction="";
      if(hasDebit&&hasCredit) direction="";
      else if(hasCredit) direction="Входящее";
      else if(hasDebit) direction="Исходящее";
      else if(/^(вход|приход|поступ|credit|кредит|к\b)/.test(rawDirection)) direction="Входящее";
      else if(/^(исход|расход|спис|debit|дебет|д\b)/.test(rawDirection)) direction="Исходящее";
      else if(Number.isFinite(originalAmount)&&originalAmount<0) direction="Исходящее";
      const amount=Number.isFinite(originalAmount)&&originalAmount!==0?originalAmount:(hasDebit?debit:hasCredit?credit:NaN);
      if(!Number.isFinite(amount)||!amount) continue;
      const payer=String(get("payer")||"").trim(), receiver=String(get("receiver")||"").trim();
      const companyName=String(get("name")||(direction==="Входящее"?payer:receiver)||payer||receiver||"").trim();
      const purpose=String(get("purpose")||"").trim();
      const article=suggestArticle(purpose,direction);
      const bankDebit=String(get("accountDebit")||"").trim(),bankCredit=String(get("accountCredit")||"").trim();
      const docType=direction==="Входящее"?"Платёжное поручение входящее":direction==="Исходящее"?"Платёжное поручение исходящее":"";
      const entry={
        id:0, date:dateText(get("date")), name:shortLegalName(companyName), originalName:companyName, purpose,
        amount:roundMoney(Math.abs(amount)), direction, docType, article, articleSource:article?"auto":"",
        debit:/^\d{4}$/.test(bankDebit)?bankDebit:(direction==="Входящее"?"1030":""),
        credit:/^\d{4}$/.test(bankCredit)?bankCredit:(direction==="Исходящее"?"1030":""),
        bin:String(get("bin")||"").trim(), sourceDoc:String(get("bankDoc")||"").trim(),
        docNumber:String(get("number")||"").trim(), sourceSheet:sheetName,
        possibleDuplicate:false, duplicateConfirmed:false, status:"review"
      };
      entry.status=validateOperation(entry);
      result.push(entry);
    }
    return result;
  }
  function duplicateKey(x) {
    if(!x.date||!x.direction||!x.amount) return "";
    const ref=norm(x.docNumber);
    const identity=norm(x.bin||x.originalName||x.name);
    const purpose=norm(x.purpose);
    if(!identity&&!ref) return "";
    return [x.date,x.direction,roundMoney(x.amount),identity,ref||purpose].join("|");
  }
  function markDuplicates(ops) {
    const seen=new Map();
    for (const x of ops) x.possibleDuplicate=false;
    for (const x of ops) {
      const key=duplicateKey(x);
      if(!key) continue;
      if(seen.has(key)) {
        x.possibleDuplicate=true;
        seen.get(key).possibleDuplicate=true;
      } else seen.set(key,x);
    }
    for (const x of ops) x.status=validateOperation(x);
    return ops;
  }
  function validateOperation(x) {
    const dir=x.direction, type=x.docType||"";
    const compatible=dir==="Входящее" ? ["Платёжное поручение входящее","ПКО","Поступление на расчётный счёт"].includes(type) :
      dir==="Исходящее" ? ["Платёжное поручение исходящее","РКО","Списание с расчётного счёта"].includes(type) : false;
    const ready=!!(x.date && x.name?.trim() && x.purpose?.trim() && Number(x.amount)>0 &&
      dir && compatible && x.article?.trim() && /^\d{4}$/.test(String(x.debit||"")) &&
      /^\d{4}$/.test(String(x.credit||"")) && (!x.possibleDuplicate||x.duplicateConfirmed));
    if(ready) return "ready";
    return compatible && x.date && !x.possibleDuplicate ? "detected":"review";
  }
  function totals(rows) {
    const incoming=roundMoney(rows.filter(x=>x.direction==="Входящее").reduce((s,x)=>s+Number(x.amount||0),0));
    const outgoing=roundMoney(rows.filter(x=>x.direction==="Исходящее").reduce((s,x)=>s+Number(x.amount||0),0));
    return {incoming,outgoing,net:roundMoney(incoming-outgoing),count:rows.length,unknown:rows.filter(x=>!x.direction).length};
  }
  return {norm,escapeHtml,money,dateText,shortLegalName,suggestArticle,parseRows,markDuplicates,validateOperation,totals};
});