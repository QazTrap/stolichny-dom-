/* STOLDOM.SITE: pure bank statement rules, shared by browser and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.STOLDOM_CORE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Some bank exports replace the Kazakh ң with '?' or U+FFFD (те?ге).
  // Correct only this unambiguous currency word; do not alter unrelated '?'
  // or Russian spelling "тенге".
  function fixTengeText(value) {
    return String(value ?? "").replace(/(^|[^\p{L}])те[?\uFFFD□]ге(?=$|[^\p{L}])/giu,
      (match, prefix) => {
        const word=match.slice(prefix.length);
        const fixed=word===word.toUpperCase()?"ТЕҢГЕ":
          /^Т/.test(word)?"Теңге":"теңге";
        return prefix+fixed;
      });
  }
  const norm = value => fixTengeText(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  function money(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let s = String(value ?? "").replace(/[\s\u00a0\u202f₸$€]/g, "").trim();
    if (!s) return NaN;
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    s=s.replace(/[^0-9.,+-]/g,"");
    const comma=s.lastIndexOf(","),dot=s.lastIndexOf(".");
    if(comma>=0&&dot>=0){
      const decimal=comma>dot?",":".";
      const thousands=decimal===","?".":",";
      s=s.split(thousands).join("").replace(decimal,".");
    } else if(comma>=0){
      if(/^[-+]?\d{1,3}(?:,\d{3})+$/.test(s))s=s.replace(/,/g,"");
      else s=s.replace(",",".");
    } else if(dot>=0 && /^[-+]?\d{1,3}(?:\.\d{3})+$/.test(s)){
      s=s.replace(/\./g,"");
    }
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
    const name = fixTengeText(value).trim();
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
  // КНП is a useful signal, but the payment description and direction take priority.
  // All results remain suggestions, never verified 1C catalogue entries.
  function suggestArticleDetailed(purpose,direction,knp="",counterparty="") {
    const p=norm(purpose),cp=norm(counterparty);
    const raw=String(knp??"").trim();
    const code=/^\d{1,3}$/.test(raw)?raw.padStart(3,"0"):raw;
    if(!direction||!p)return {article:"",reason:"Недостаточно данных",confidence:"none"};
    const suggestion=(article,reason,confidence="high")=>({article,reason,confidence});
    const isOutgoing=direction==="Исходящее";
    const isIncoming=direction==="Входящее";
    if(!isOutgoing&&!isIncoming)return {article:"",reason:"Неизвестное направление",confidence:"none"};

    // Bank charges often mention НДС, ОПВ, штрафы or пени of the *underlying*
    // transaction, so recognize the charge before any tax rules.
    const bankFee=/(комисси.{0,25}(банк|операц|перевод)|банк.{0,25}комисси|обслуживани.{0,12}(счет|счёт)|согласно тарифам банка|эквайрингов.{0,12}комисси)/.test(p);
    if(isOutgoing&&(bankFee||(code==="841"&&/(комисси|тариф|банковск)/.test(p))))
      return suggestion("Банковские комиссии","Комиссия банка"+(code==="841"?" · КНП 841":""));

    if(isOutgoing&&(/алимент/.test(p)||(code==="118"&&/дет|содержани|алим/.test(p))))
      return suggestion("Алименты","Алименты"+(code==="118"?" · КНП 118":""),"review");
    if(isOutgoing&&/(исполнительн.{0,30}(производств|лист)|судебн.{0,20}исполн|взыскани.{0,20}по исполнительн)/.test(p))
      return suggestion("Исполнительные документы","Перечисление по исполнительному документу; сверьте статью с 1С","review");

    if(isOutgoing&&/(возврат.{0,24}(денежн|оплат|платеж|покупател)|возврат покупателю)/.test(p))
      return suggestion("Возврат денежных средств","Возврат платежа");
    if(isIncoming&&/(возврат.{0,25}(от поставщик|переплат|денежн|платеж)|возврат поставщиком)/.test(p))
      return suggestion("Возврат денежных средств","Возврат поступления");
    if(/(между своими счетами|между собственными счетами|со своего счета|на свой счет|внутренн.{0,10}перевод|перемещени.{0,22}(счет|счёт))/.test(p))
      return suggestion("Перевод между счетами","Перемещение собственных денежных средств","review");

    if(isOutgoing){
      const social=/(обязательн.{0,12}пенсионн.{0,12}взнос|пенсионн.{0,12}взнос работодател|обязательн.{0,15}социальн.{0,15}отчислен|взнос.{0,30}социальн.{0,20}медицинск|отчислен.{0,30}социальн.{0,20}медицинск|обязательн.{0,12}социальн.{0,12}медицинск|социальн.{0,12}отчислен)/.test(p);
      const tax=/(социальн.{0,6}налог|индивидуальн.{0,12}подоходн.{0,6}налог|корпоративн.{0,12}подоходн.{0,6}налог|налог на добавленн.{0,12}стоим|уплат.{0,15}налог|уплат.{0,10}ндс|перечислен.{0,10}ндс|ндс.{0,20}в бюджет|налог.{0,12}в бюджет|обязательств.{0,12}в бюджет)/.test(p);
      const taxAbbr=/(?:^|[^a-zа-я0-9])(опв|опвр|осмс|восмс|ипн|кпн)(?=$|[^a-zа-я0-9])/.test(p);
      if(social||tax||taxAbbr||(code==="911"&&/налог|бюджет/.test(p))||
        (["010","012","089","121","122"].includes(code)&&/взнос|отчислен|страхован/.test(p)))
        return suggestion("Налоги и отчисления","Налоги, взносы или отчисления"+(code?" · КНП "+code:""));
      if(/(зарплат|заработн.{0,9}плат|з\/п|оплата труда|аванс сотруд|преми.{0,12}сотруд)/.test(p))
        return suggestion("Заработная плата","Выплата заработной платы");
      if(/(аренд|арендная плата)/.test(p))
        return suggestion("Аренда","Арендный платёж");
      if(/(погашен.{0,15}(кредит|займ)|возврат.{0,15}(кредит|займ))/.test(p))
        return suggestion("Погашение займа","Погашение обязательства по займу");
      if(["710","819","859","854"].includes(code))
        return suggestion("Оплата поставщику","Оплата товаров или услуг · КНП "+code,"medium");
      if(/(оплат|приобретен|счет на оплату|счёта на оплату|поставщик|за товар|за услуг|за работ|по договору)/.test(p))
        return suggestion("Оплата поставщику","Оплата товаров или услуг по назначению","medium");
    } else {
      if(/(получен.{0,15}(займ|кредит)|выдач.{0,10}займ|поступлен.{0,15}заемн)/.test(p))
        return suggestion("Получение займа","Получение займа");
      if(["710","819","859"].includes(code))
        return suggestion("Оплата от покупателя","Поступление за товары или услуги · КНП "+code,"medium");
      if(/(оплат|покупател|выручк|реализац|оказанн.{0,10}услуг|за товар|за услуг|за работ|по счету|по сч)/.test(p))
        return suggestion("Оплата от покупателя","Оплата покупателя по назначению","medium");
    }
    return {article:"",reason:code?"Неоднозначное назначение · КНП "+code:"Неоднозначное назначение",confidence:"none"};
  }
  function suggestArticle(purpose,direction,knp="",counterparty=""){
    return suggestArticleDetailed(purpose,direction,knp,counterparty).article;
  }


  // Draft postings only; ambiguous account correspondences are left blank.
  function suggestPosting(x) {
    const p=norm(x.purpose), article=x.article||"", direction=x.direction;
    const result={debit:"",credit:"",debitReason:"",creditReason:""};
    if(direction==="Исходящее") {
      result.credit="1030";
      result.creditReason="Списание денежных средств с расчётного счёта";
      if(article==="Банковские комиссии") {
        result.debit="7210";
        result.debitReason="Предполагаемые административные расходы на банковскую комиссию; сверьте счёт затрат";
      } else if(article==="Алименты" && /алимент/.test(p)) {
        result.debit="3390";
        result.debitReason="Перечисление ранее удержанных алиментов; проверьте счёт задолженности";
      } else if(article==="Заработная плата" && /(зарплат|заработн.{0,9}плат|з\/п|выплат.{0,20}сотруд)/.test(p)) {
        result.debit="3350";
        result.debitReason="Выплата ранее начисленной заработной платы";
      } else if(article==="Налоги и отчисления") {
        // KNP and explicit payment purpose determine the *liability* account,
        // not the expense account. A generic "tax payment" is left unresolved.
        // Particular subaccounts (3211/3212/3213/3250) must be checked in 1C.
        const knp=/^\d{1,3}$/.test(String(x.knp||"").trim())?String(x.knp).trim().padStart(3,"0"):"";
        const candidates=[
          ["3250","Обязательные пенсионные взносы работодателя",/(опвр|пенсионн.{0,20}взнос.{0,20}работодател)/,["089"]],
          ["3220","Обязательные пенсионные взносы работников",/(опв(?!р)|обязательн.{0,12}пенсионн.{0,12}взнос)/,["010"]],
          ["3211","Социальные отчисления",/(социальн.{0,12}отчислен|соц\.?\s*отчислен)/,["012"]],
          ["3212","Взносы на ОСМС",/(восмс|взнос.{0,30}(медицинск|осмс))/,["122"]],
          ["3213","Отчисления на ОСМС",/(оосмс|отчислен.{0,30}(медицинск|осмс))/,["121"]],
          ["3120","Индивидуальный подоходный налог",/(индивидуальн.{0,15}подоходн.{0,12}налог|(?:^|[^а-я])ипн(?:$|[^а-я]))/,[]],
          ["3110","Корпоративный подоходный налог",/(корпоративн.{0,15}подоходн.{0,12}налог|(?:^|[^а-я])кпн(?:$|[^а-я]))/,[]],
          ["3130","НДС к уплате в бюджет",/(налог.{0,20}добавленн.{0,16}стоим|(?:^|[^а-я])ндс(?:$|[^а-я]))/,[]],
          ["3150","Социальный налог",/социальн.{0,8}налог/,[]],
          ["3160","Земельный налог",/земельн.{0,8}налог/,[]],
          ["3170","Налог на транспорт",/налог.{0,12}транспорт/,[]],
          ["3180","Налог на имущество",/налог.{0,12}имуществ/,[]]
        ];
        const matches=candidates.filter(([, ,re,knps])=>re.test(p)||(knp&&knps.includes(knp)));
        if(matches.length===1) {
          const [account,label]=matches[0];
          result.debit=account;
          result.debitReason="Предполагаемое погашение обязательства: "+label+"; проверьте счёт и аналитику в своей базе 1С"+(knp?" (КНП "+knp+")":"");
        }
      } else if(article==="Оплата поставщику" && /(аванс|предоплат|предварительн.{0,10}оплат)/.test(p)) {
        result.debit="1610";
        result.debitReason="Аванс поставщику; проверьте договор и аналитику";
      } else if(article==="Оплата поставщику" && /(погашен.{0,24}задолжен|оплат.{0,25}ранее (поставлен|получен|оказан)|погашени.{0,15}кредитор)/.test(p)) {
        result.debit="3310";
        result.debitReason="Погашение задолженности поставщику; проверьте обязательство";
      }
    } else if(direction==="Входящее") {
      result.debit="1030";
      result.debitReason="Поступление денежных средств на расчётный счёт";
      if(article==="Оплата от покупателя" && /(аванс|предоплат|предварительн.{0,10}оплат)/.test(p)) {
        result.credit="3510";
        result.creditReason="Полученный аванс покупателя; проверьте договор";
      } else if(article==="Оплата от покупателя" && /(погашен.{0,24}задолжен|оплат.{0,25}ранее (отгружен|поставлен|оказан)|погашени.{0,15}дебитор)/.test(p)) {
        result.credit="1210";
        result.creditReason="Погашение задолженности покупателя; проверьте дебиторскую задолженность";
      }
    }
    return result;
  }
  // Recalculate suggestions only for fields that were empty or auto-filled.
  // Explicitly entered numbers, including edits from old drafts, always win.
  function refreshSuggestedPosting(x) {
    const proposal=suggestPosting(x);
    let changed=false;
    for(const side of ["debit","credit"]) {
      const source=side+"Source", reason=side+"Reason";
      if(["manual","statement"].includes(x[source]))continue;
      if(x[side] && x[source]!=="auto")continue;
      const newValue=proposal[side]||"";
      if(x[side]!==newValue)changed=true;
      x[side]=newValue;
      x[source]=newValue?"auto":"";
      x[reason]=newValue?proposal[reason]:"";
    }
    x.status=validateOperation(x);
    return changed;
  }

  const BANK_FEE_DOCUMENT="Платёжный ордер (списание денежных средств)";
  function suggestDocumentType(direction,article) {
    if(direction==="Входящее")return "Платёжное поручение входящее";
    if(direction==="Исходящее")return article==="Банковские комиссии"
      ?BANK_FEE_DOCUMENT:"Платёжное поручение исходящее";
    return "";
  }
  function suggestDocumentOperation(article,docType) {
    if(article==="Банковские комиссии" && docType===BANK_FEE_DOCUMENT)
      return "Прочее списание безналичных денежных средств";
    return "";
  }
  // Respect explicitly saved 1C document choices when DDS rules are updated.
  // Legacy drafts lack docTypeSource; only migrate the original default documents.
  function refreshSuggestedDocument(x) {
    if(x.docTypeSource==="manual")return false;
    const ordinary=suggestDocumentType(x.direction,"");
    if(!x.docTypeSource && x.docType && x.docType!==ordinary)return false;
    const proposal=suggestDocumentType(x.direction,x.article);
    if(!proposal)return false;
    const changed=x.docType!==proposal;
    x.docType=proposal;
    x.docTypeSource="auto";
    return changed;
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
    bin:["бин/иин контрагента","бин контрагента","иин контрагента","бин","иин","бин/иин","иин/бин"],
    knp:["кнп","код назначения платежа"],
    bankRef:["референс операции абис","референс операции","идентификатор транзакции","transaction id"]
  };
  function colIndex(headers,key) {
    if(key==="date") {
      // "Дата выписки" is the export generation date, not the payment date.
      for(const wanted of ["дата документа","дата операции","дата платежа","дата валютирования","дата проводки","operation date","transaction date","дата"]){
        const i=headers.indexOf(wanted);
        if(i>=0)return i;
      }
      return -1;
    }
    const exact=headers.findIndex(h=>aliases[key].includes(h));
    if(exact>=0)return exact;
    // Never accidentally treat "Сумма НДС", debit or credit as total amount.
    if(key==="amount")return -1;
    return headers.findIndex(h=>aliases[key].some(a=>h.includes(a)));
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
      else if(/^(вход|приход|поступ|credit|crdt|кредит|кт$|к$|c$)/.test(rawDirection)) direction="Входящее";
      else if(/^(исход|расход|спис|debit|dbit|дебет|дт$|д$|d$)/.test(rawDirection)) direction="Исходящее";
      else if(Number.isFinite(originalAmount)&&originalAmount<0) direction="Исходящее";
      const amount=Number.isFinite(originalAmount)&&originalAmount!==0?originalAmount:(hasDebit?debit:hasCredit?credit:NaN);
      if(!Number.isFinite(amount)||!amount) continue;
      const payer=String(get("payer")||"").trim(), receiver=String(get("receiver")||"").trim();
      const companyName=fixTengeText(get("name")||(direction==="Входящее"?payer:receiver)||payer||receiver||"").trim();
      const purpose=fixTengeText(get("purpose")||"").trim();
      const rawKnp=String(get("knp")??"").trim();
      const knp=/^\d{1,3}$/.test(rawKnp)?rawKnp.padStart(3,"0"):rawKnp;
      const articleSuggestion=suggestArticleDetailed(purpose,direction,knp,companyName);
      const article=articleSuggestion.article;
      const bankDebit=String(get("accountDebit")||"").trim(),bankCredit=String(get("accountCredit")||"").trim();
      const docType=suggestDocumentType(direction,article);
      const entry={
        id:0, date:dateText(get("date")), name:shortLegalName(companyName), originalName:companyName, purpose,
        amount:roundMoney(Math.abs(amount)), direction, docType, docTypeSource:docType?"auto":"", article, articleSource:article?"auto":"",
        articleReason:articleSuggestion.reason,articleConfidence:articleSuggestion.confidence,knp,bankRef:String(get("bankRef")??"").trim(),
        debit:/^\d{4}$/.test(bankDebit)?bankDebit:"", debitSource:/^\d{4}$/.test(bankDebit)?"statement":"",
        credit:/^\d{4}$/.test(bankCredit)?bankCredit:"", creditSource:/^\d{4}$/.test(bankCredit)?"statement":"",
        debitReason:"",creditReason:"",
        bin:String(get("bin")||"").trim(), sourceDoc:String(get("bankDoc")||"").trim(),
        docNumber:String(get("number")||"").trim(), sourceSheet:sheetName,
        possibleDuplicate:false, duplicateConfirmed:false, status:"review"
      };
      refreshSuggestedPosting(entry);
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
      dir==="Исходящее" ? ["Платёжное поручение исходящее","РКО","Списание с расчётного счёта",BANK_FEE_DOCUMENT].includes(type) : false;
    const cashAccountValid=(type==="ПКО")?String(x.debit)==="1010":
      (type==="РКО")?String(x.credit)==="1010":true;
    const ready=!!(x.date && x.name?.trim() && x.purpose?.trim() && Number(x.amount)>0 &&
      dir && compatible && cashAccountValid && x.article?.trim() && /^\d{4}$/.test(String(x.debit||"")) &&
      /^\d{4}$/.test(String(x.credit||"")) && (!x.possibleDuplicate||x.duplicateConfirmed));
    if(ready) return "ready";
    return compatible && x.date && !x.possibleDuplicate ? "detected":"review";
  }
  function totals(rows) {
    const incoming=roundMoney(rows.filter(x=>x.direction==="Входящее").reduce((s,x)=>s+Number(x.amount||0),0));
    const outgoing=roundMoney(rows.filter(x=>x.direction==="Исходящее").reduce((s,x)=>s+Number(x.amount||0),0));
    return {incoming,outgoing,net:roundMoney(incoming-outgoing),count:rows.length,unknown:rows.filter(x=>!x.direction).length};
  }
  return {norm,fixTengeText,escapeHtml,money,dateText,shortLegalName,suggestArticle,suggestArticleDetailed,suggestPosting,refreshSuggestedPosting,suggestDocumentType,suggestDocumentOperation,refreshSuggestedDocument,parseRows,markDuplicates,validateOperation,totals,BANK_FEE_DOCUMENT};
});