/* STOLDOM.SITE browser workspace. Bank files remain on the user's device. */
(() => {
  "use strict";
  const downloadsEnabled=false;
  const C=window.STOLDOM_CORE;
  if(!C){console.error("STOLDOM rules could not load");return;}
  const $=id=>document.getElementById(id);
  // Keep the UI responsive and give the browser a chance to draw before synchronous parsing.
  const letSpinnerPaint=()=>new Promise(resolve=>setTimeout(resolve,35));
  function showProcessing(active,message="Обрабатываем данные…"){
    const layer=$("workspaceBusy");
    if(!layer)return;
    if(active)$("workspaceBusyText").textContent=message;
    layer.hidden=!active;
    document.body.classList.toggle("is-processing",active);
  }
  const statementCurrency=()=>{
    const code=String(company?.currency||"KZT").toUpperCase();
    return /^(KZT|USD|EUR|RUB|GBP|CNY)$/.test(code)?code:"KZT";
  };
  const fmt=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2})
    .format(Number(n)||0)+(statementCurrency()==="KZT"?" ₸":" "+statementCurrency());
  const show=x=>C.escapeHtml(x);
  const formatBalance=n=>{
    const code=statementCurrency();
    return new Intl.NumberFormat("ru-RU",{style:"currency",currency:code,
      currencyDisplay:code==="KZT"?"narrowSymbol":"code"}).format(Number(n)||0);
  };
  const balanceLabels=["Вх.остаток на начало периода в нац.валюте","Исх.остаток на конец периода в нац.валюте"].map(C.norm);
  let balances=[],company={};
  const sessionKey="stoldom.workspace.v2";
  const ledgerVisibilityKey="stoldom.ledgerColumnsHidden.v1";
  let ledgerColumnsHidden=false;
  try{ledgerColumnsHidden=localStorage.getItem(ledgerVisibilityKey)==="1";}catch{}
  let ops=[],selected=null,filter="all",directionFilter="all",fileLabel="",saveTimer=0,selectedMonth="",periodFrom="",periodTo="";
  function toast(message){
    $("toast").textContent=String(message);
    $("toast").style.display="block";
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>$("toast").style.display="none",4500);
  }
  function saveDraft(){
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({version:2,ops,fileLabel,balances,company,savedAt:new Date().toISOString()}));
      if($("draftStatus")) $("draftStatus").textContent="Черновик в этой вкладке сохранён";
    } catch {
      if($("draftStatus")) $("draftStatus").textContent="Автосохранение в этой вкладке недоступно";
    }
  }
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=0;saveDraft();},200);}
  window.addEventListener("pagehide",()=>{if(saveTimer){clearTimeout(saveTimer);saveTimer=0;saveDraft();}});
  function sanitizeImported(raw){
    if(!Array.isArray(raw)||raw.length>20000) throw Error("Неверный формат черновика");
    return raw.map((x,i)=>{
      if(!x || typeof x!=="object" || Array.isArray(x)) throw Error("Некорректная операция");
      const str=k=>C.fixTengeText(String(x[k]??"").slice(0,3000));
      const amount=Number(x.amount);
      if(!Number.isFinite(amount)||amount<=0||amount>1e15)throw Error("Некорректная сумма операции");
      return {
        id:i+1,date:C.dateText(str("date")),name:str("name"),originalName:str("originalName")||str("name"),
        purpose:str("purpose"),comment:str("comment"),amount,direction:["Входящее","Исходящее"].includes(str("direction"))?str("direction"):"",
        docType:str("docType"),docTypeSource:str("docTypeSource"),article:str("article"),articleSource:str("articleSource"),articleReason:str("articleReason"),articleConfidence:str("articleConfidence"),knp:str("knp"),bankRef:str("bankRef"),debit:str("debit"),credit:str("credit"),debitSource:str("debitSource"),creditSource:str("creditSource"),debitReason:str("debitReason"),creditReason:str("creditReason"),
        isBankFee:x.isBankFee===true,bik:str("bik"),bin:str("bin"),counterpartyAccount:str("counterpartyAccount"),sourceDoc:str("sourceDoc"),docNumber:str("docNumber"),sourceSheet:str("sourceSheet"),
        possibleDuplicate:false,duplicateConfirmed:!!x.duplicateConfirmed,status:"review"
      };
    });
  }
  function restoreDraft(){
    try {
      const saved=sessionStorage.getItem(sessionKey);
      if(!saved)return;
      const parsed=JSON.parse(saved);
      if(parsed.version!==2)return;
      ops=sanitizeImported(parsed.ops);
      ops.forEach(recomputeArticle);
      ops.forEach(C.refreshSuggestedDocument);
      ops.forEach(C.refreshSuggestedPosting);
      C.markDuplicates(ops);
      selected=null;
      fileLabel=String(parsed.fileLabel||"Черновик").slice(0,200);
      balances=Array.isArray(parsed.balances)?parsed.balances:[];
      company=C.mergeStatementCompanies([parsed.company||{}]);
      if(ops.length) toast("Восстановлен черновик текущей вкладки: "+ops.length+" операций");
    }catch{try{sessionStorage.removeItem(sessionKey);}catch{}}
  }
  function recomputeArticle(x) {
    // Never overwrite a choice explicitly saved by the accountant.
    if(x.articleSource==="manual")return false;
    const proposal=C.suggestArticleDetailed(x.isBankFee?"Комиссия банка":x.purpose,x.direction,x.knp,x.originalName||x.name);
    const changed=x.article!==proposal.article;
    x.article=proposal.article;
    x.articleSource=x.article?"auto":"";
    x.articleReason=proposal.reason;
    x.articleConfidence=proposal.confidence;
    const docChanged=C.refreshSuggestedDocument(x);
    const postingChanged=C.refreshSuggestedPosting(x);
    x.status=C.validateOperation(x);
    return changed||docChanged||postingChanged;
  }
  function counterpartyKey(operation){
    return C.norm(operation.name)+"|"+(operation.bin||"");
  }
  function updateCounterpartyFilter(){
    const select=$("counterpartyFilter");
    if(!select)return;
    const selectedKey=select.value;
    const names=new Map();
    for(const operation of ops){
      if(operation.name?.trim())names.set(counterpartyKey(operation),operation.name.trim());
    }
    const entries=[...names].sort((a,b)=>a[1].localeCompare(b[1],"ru"));
    const labels=new Map();
    for(const [,name] of entries)labels.set(name,(labels.get(name)||0)+1);
    select.replaceChildren(new Option("Все контрагенты",""),...entries.map(([key,name])=>{
      const bin=key.slice(key.lastIndexOf("|")+1);
      return new Option(labels.get(name)>1&&bin?name+" · "+bin:name,key);
    }));
    select.value=names.has(selectedKey)?selectedKey:"";
    select.disabled=!entries.length;
  }
  function amountKey(value){
    return String(Math.round(Number(value)*100));
  }
  function updateValueColumnFilters(){
    const dateSelect=$("dateColumnFilter"),amountSelect=$("amountColumnFilter");
    if(dateSelect){
      const selected=dateSelect.value;
      const dates=[...new Set(ops.map(x=>x.date).filter(Boolean))]
        .sort((a,b)=>b.split(".").reverse().join("").localeCompare(a.split(".").reverse().join("")));
      dateSelect.replaceChildren(new Option("Все даты",""),...dates.map(date=>new Option(date,date)));
      dateSelect.value=dates.includes(selected)?selected:"";
      dateSelect.disabled=!dates.length;
    }
    if(amountSelect){
      const selected=amountSelect.value;
      const amounts=[...new Set(ops.map(x=>amountKey(x.amount)))]
        .sort((a,b)=>Number(a)-Number(b));
      amountSelect.replaceChildren(new Option("Все суммы",""),...amounts.map(key=>new Option(fmt(Number(key)/100),key)));
      amountSelect.value=amounts.includes(selected)?selected:"";
      amountSelect.disabled=!amounts.length;
    }
  }
  function ddsArticleKey(operation){
    const value=C.norm(operation.article||"");
    return value?"dds:"+value:"missing";
  }
  function updateDdsArticleFilter(){
    const select=$("ddsArticleFilter");
    if(!select)return;
    const selected=select.value;
    const entries=new Map();
    for(const operation of ops){
      const key=ddsArticleKey(operation);
      const entry=entries.get(key);
      if(entry)entry.count++;
      else entries.set(key,{name:operation.article?.trim()||"Не указана",count:1});
    }
    const sorted=[...entries].sort((a,b)=>{
      if(a[0]==="missing")return -1;
      if(b[0]==="missing")return 1;
      return a[1].name.localeCompare(b[1].name,"ru");
    });
    select.replaceChildren(new Option("Все статьи ДДС",""),...sorted.map(([key,entry])=>
      new Option(entry.name+" · "+entry.count,key)));
    select.value=entries.has(selected)?selected:"";
    select.disabled=!sorted.length;
  }
  function rowsForDate(){
    const rows=C.filterPeriod(ops,{date:$("checkDate").value,month:selectedMonth,from:periodFrom,to:periodTo});
    const counterparty=$("counterpartyFilter")?.value;
    const amount=$("amountColumnFilter")?.value;
    const article=$("ddsArticleFilter")?.value;
    if(!counterparty&&!amount&&!article)return rows;
    return rows.filter(x=>(!counterparty||counterpartyKey(x)===counterparty)&&
      (!amount||amountKey(x.amount)===amount)&&
      (!article||ddsArticleKey(x)===article));
  }
  function currentRows(dateRows){
    const query=C.norm($("search").value);
    return dateRows.filter(x=>(filter==="all"||x.status===filter)&&(directionFilter==="all"||x.direction===directionFilter)&&
      (!query||C.norm([x.name,x.originalName,x.purpose,x.article,x.docType,x.bin,x.docNumber,x.date,x.comment].join(" ")).includes(query)));
  }

  function updateStatementCompany(){
    const card=$("statementCompany");
    card.hidden=!fileLabel;
    if(!fileLabel){card.open=false;return;}
    const info=company||{};
    const val=key=>String(info[key]||"").trim();
    const fallback=(key)=>val(key)||"Не указано";
    const name=val("name")||"Организация не указана";
    $("companyMiniName").textContent=C.compactLegalDisplayName(name);
    $("companyMiniName").title=name;
    const period=C.statementPeriodLabel(info,ops);
    $("companyMiniPeriod").textContent=period.text;
    $("companyMiniPeriod").title=period.source==="operations"?"Даты первой и последней операций; банк не указал полный период выписки":period.source==="statement"?"Период, указанный банком в выписке":"Даты периода отсутствуют в файле";
    $("companyMiniBin").textContent=val("bin")?"ИИН/БИН "+val("bin"):"ИИН/БИН не указан";
    $("companyMiniBank").textContent=val("bank")||"Банк не указан";
    $("companyMiniAccount").textContent=val("account")?"Счёт "+val("account").slice(0,2)+"••••"+val("account").slice(-4):"Счёт не указан";
    for(const [id,key] of [["companyNameFull","name"],["companyBinFull","bin"],
      ["companyBankFull","bank"],["companyAccountFull","account"],
      ["companyPeriodFull","period"],["companyCurrencyFull","currency"]]){
      $(id).textContent=fallback(key);
    }
  }
  function updateStats(visible,dateRows){
    const ready=ops.filter(x=>x.status==="ready").length;
    $("allChip").textContent=dateRows.length;
    $("detectedChip").textContent=dateRows.filter(x=>x.status==="detected").length;
    $("reviewChip").textContent=dateRows.filter(x=>x.status==="review").length;
    $("readyChip").textContent=dateRows.filter(x=>x.status==="ready").length;
    $("directionAllChip").textContent=dateRows.length;
    $("outgoingChip").textContent=dateRows.filter(x=>x.direction==="Исходящее").length;
    $("incomingChip").textContent=dateRows.filter(x=>x.direction==="Входящее").length;
    const t=C.totals(visible);
    $("filteredTotal").textContent=fmt(t.incoming);
    $("outgoingTotal").textContent=fmt(t.outgoing);
    $("netTotal").textContent=fmt(t.net);
    $("filteredCount").textContent=t.count;
    $("filteredTotalLabel").textContent="Поступления по фильтру";
    // Whole-statement controls must never depend on status, date or search.
    // Otherwise the user may mistake partial results for the bank's turnover.
    const whole=C.totals(ops);
    $("statementReconcile").hidden=!fileLabel;
    $("statementReconcileNumbers").textContent=ops.length?
      whole.count+" операций · поступления "+fmt(whole.incoming)+
      " · списания "+fmt(whole.outgoing)+" · разница "+fmt(whole.net):"";
    const balanceCheck=$("statementBalanceCheck");
    const haveBalances=Number.isFinite(balances[0])&&Number.isFinite(balances[1]);
    balanceCheck.hidden=!haveBalances||!fileLabel;
    if(haveBalances&&fileLabel){
      const actual=Math.round((balances[1]-balances[0])*100);
      const calculated=Math.round(whole.net*100);
      const delta=actual-calculated;
      const matches=Math.abs(delta)<=1;
      balanceCheck.classList.toggle("mismatch",!matches);
      balanceCheck.textContent=matches?"Контроль остатков: разница сходится":
        "Внимание: итог операций и изменение остатков расходятся на "+fmt(Math.abs(delta)/100)+". Сверьте исходный файл.";
    }
    const ddsFilter=$("ddsArticleFilter")?.value;
    const narrowed=ops.length>0 && (visible.length!==ops.length||filter!=="all"||directionFilter!=="all"||!!ddsFilter);
    $("activeFilterNotice").hidden=!narrowed;
    if(narrowed){
      const applied=[];
      if(filter!=="all")applied.push(filter==="detected"?"Документы определены":
        filter==="ready"?"Полностью заполнены":"Проверить");
      if(directionFilter!=="all")applied.push(directionFilter==="Входящее"?"Входящие":"Исходящие");
      if(ddsFilter)applied.push("Статья ДДС: "+($("ddsArticleFilter").selectedOptions[0]?.textContent||"выбрана"));
      if(!applied.length)applied.push("поиск или другие фильтры");
      $("activeFilterText").textContent="Активен фильтр («"+applied.join(" · ")+"»). Показано "+visible.length+
        " из "+ops.length+" операций. Суммы в карточках относятся только к выбранным операциям.";
    }
    const pendingCount=ops.length-ready;
    $("bottomMessage").textContent=!ops.length?(fileLabel?"Выписка загружена. За указанный период операций нет.":"Загрузите банковскую выписку, чтобы начать работу."):
      "Реквизиты заполнены: "+ready+" из "+ops.length+". "+
      (pendingCount>0?"Ещё "+pendingCount+" операций требуют заполнения. ":"")+
      "Перед переносом обязательно сверьте Дт/Кт, ДДС и документы с 1С.";
    const statusIcon=$("bottomStatusIcon").querySelector("use");
    if(statusIcon)statusIcon.setAttribute("href","#ic-alert");
    $("bottomStatusIcon").parentElement.classList.add("pending");
    $("export").disabled=!downloadsEnabled || ops.length===0;
    ["openingBalance","closingBalance"].forEach((id,index)=>{
      const value=$(id);
      if(!value)return;
      const amount=balances[index];
      value.textContent=Number.isFinite(amount)?formatBalance(amount):"—";
    });
    if($("statementBalances"))$("statementBalances").hidden=!fileLabel;
    $("tableCaption").textContent=fileLabel||"Операции";
    updateStatementCompany();
  }

  // A practical local list, not the user's live 1C chart of accounts.
  // Any other four-digit account can be entered via "Другой счёт…".
  const ledgerGroups=[
    ["Денежные средства",[["1010","Касса"],["1020","Денежные средства в пути"],["1030","Текущие банковские счета"],["1040","Корреспондентские счета"],["1050","Сберегательные счета"],["1060","Прочие денежные средства"]]],
    ["Покупатели и поставщики",[["1210","Долги покупателей"],["1250","Задолженность работников"],["1280","Прочая краткосрочная дебиторская задолженность"],["1610","Авансы выданные"],["3310","Долги поставщикам"],["3510","Авансы полученные"]]],
    ["Запасы и активы",[["1310","Сырьё и материалы"],["1320","Готовая продукция"],["1330","Товары"],["1340","Незавершённое производство"],["1350","Прочие запасы"],["2410","Основные средства"],["2420","Амортизация основных средств"],["2730","Прочие нематериальные активы"]]],
    ["Налоги и социальные платежи",[["3110","КПН"],["3120","ИПН"],["3130","НДС"],["3150","Социальный налог"],["3160","Земельный налог"],["3170","Транспортный налог"],["3180","Налог на имущество"],["3211","Социальные отчисления"],["3212","Взносы ОСМС"],["3213","Отчисления ОСМС"],["3220","ОПВ"],["3250","ОПВ работодателя"]]],
    ["Расчёты и займы",[["3010","Краткосрочные финансовые обязательства"],["3350","Расчёты по оплате труда"],["3390","Прочая краткосрочная кредиторская задолженность"],["4010","Долгосрочные финансовые обязательства"]]],
    ["Доходы и расходы",[["6010","Доход от реализации"],["7010","Себестоимость реализации"],["7110","Расходы по реализации"],["7210","Административные расходы"],["7310","Расходы по вознаграждениям"],["7470","Прочие расходы"]]]
  ];
  const knownLedgerAccounts=new Set(ledgerGroups.flatMap(group=>group[1].map(entry=>entry[0])));
  // Populate account lists only when an accountant opens a cell.
  // Prevent thousands of hidden options from slowing large statement tables.
  function ledgerOptions(code){
    let options='<option value=""'+(!code?' selected':"")+'>Указать / очистить</option>';
    if(code&&!knownLedgerAccounts.has(code))
      options+='<option value="'+show(code)+'" selected>'+show(code)+' — выбранный счёт</option>';
    for(const [group,accounts] of ledgerGroups){
      options+='<optgroup label="'+show(group)+'">';
      options+=accounts.map(([number,title])=>'<option value="'+number+'"'+(code===number?" selected":"")+'>'+number+' — '+show(title)+'</option>').join("");
      options+='</optgroup>';
    }
    options+='<option value="__other__">Другой счёт…</option>';
    return options;
  }
  function accountPicker(x,side){
    const code=String(x[side]||"");
    const label=side==="debit"?"Дт":"Кт";
    const initialLabel=code?show(code)+" — выбранный счёт":"Указать / очистить";
    return '<span class="inline-ledger-picker'+(code?"":" unset")+'"><span class="inline-ledger-current">'+(code?show(code):"Указать")+'</span>'+
      '<select class="inline-ledger-select" data-ledger-side="'+side+'" data-ledger-expanded="false" title="Выбрать '+label+' прямо в таблице" aria-label="Выбрать '+label+' по операции '+x.id+'">'+
      '<option value="'+show(code)+'" selected>'+initialLabel+'</option></select></span>';
  }
  function expandLedgerSelect(select){
    if(select.dataset.ledgerExpanded==="true")return;
    const code=select.value;
    select.innerHTML=ledgerOptions(code);
    select.value=code;
    select.dataset.ledgerExpanded="true";
  }
  function completionHint(x){
    if(x.status==="ready")return "Операция полностью заполнена.";
    const missing=[];
    if(!/^\d{4}$/.test(String(x.debit||"")))missing.push("Дт");
    if(!/^\d{4}$/.test(String(x.credit||"")))missing.push("Кт");
    if(!x.article?.trim())missing.push("статью ДДС");
    if(!x.docType?.trim())missing.push("тип документа 1С");
    if(!x.purpose?.trim())missing.push("назначение платежа");
    if(!x.name?.trim())missing.push("контрагента");
    if(!x.direction)missing.push("направление");
    if(x.possibleDuplicate&&!x.duplicateConfirmed)missing.push("проверку возможного дубля");
    return missing.length?
      "Операция ещё не полностью заполнена. Осталось: "+missing.join(", ")+"."
      :"Операция требует проверки документа или проводки.";
  }
  function saveInlineLedger(row,side,account){
    const x=ops.find(op=>op.id===Number(row.dataset.id));
    if(!x || !C.setManualPostingAccount(x,side,account)){
      toast("Введите четырёхзначный номер счёта, например 3310");
      return false;
    }
    C.markDuplicates(ops);
    if(selected===x.id){
      $(side).value=x[side];
      $("postingHint").textContent="Счёт "+(side==="debit"?"Дт":"Кт")+" выбран в таблице. Сверьте проводку с вашей базой 1С.";
    }
    render();
    scheduleSave();
    const title="Счёт "+(side==="debit"?"Дт":"Кт");
    toast((x[side]?title+" "+x[side]+" сохранён":title+" очищен")+". "+completionHint(x));
    const count=x[side]?C.countSimilarOperations(ops,x,[side]):0;
    if(count>0){
      const btn=document.createElement("button");
      btn.type="button";
      btn.className="toast-action";
      btn.textContent="Применить этот счёт к "+count+" похожим операциям";
      btn.addEventListener("click",()=>{
        const before=ops.filter(item=>item.status==="ready").length;
        const result=C.applyPostingToSimilar(ops,x,C.operationRuleKey(x),[side]);
        C.markDuplicates(ops);render();scheduleSave();
        const after=ops.filter(item=>item.status==="ready").length;
        const growth=after-before;
        const note=result.updated?
          "Полностью заполнено: "+after+(growth>0?" (+"+growth+")":" (не изменилось: есть незаполненные поля)")+".":
          "Изменений нет: значения уже заданы вручную или из выписки.";
        toast(title+" применён к "+result.updated+" из "+result.matched+" похожих операций. "+note+" Ручные значения сохранены.");
      });
      $("toast").append(btn);
      clearTimeout(toast.timer);
      toast.timer=setTimeout(()=>$("toast").style.display="none",12000);
    }
    return true;
  }
  function editOtherLedger(select){
    const cell=select.closest("td"),row=select.closest("tr[data-id]"),side=select.dataset.ledgerSide;
    if(!cell||!row)return;
    const existing=ops.find(op=>op.id===Number(row.dataset.id))?.[side]||"";
    cell.innerHTML='<div class="inline-ledger-custom" data-inline-side="'+side+'">'+
      '<input type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" aria-label="Номер счёта '+(side==="debit"?"дебета":"кредита")+'" placeholder="4 цифры" value="'+show(existing)+'">'+
      '<button type="button" data-inline-save aria-label="Сохранить счёт" title="Сохранить">✓</button>'+
      '<button type="button" data-inline-cancel aria-label="Отменить" title="Отменить">×</button></div>';
    const input=cell.querySelector("input");
    input.focus();
    input.select();
  }

  // Sync both horizontal tracks once per animation frame; ignore mirrored events.
  const mirroredScroll=new WeakMap();
  function syncTableScrollWidth(){
    const upper=$("tableScrollTop"),lower=$("tableScrollBottom");
    const spacer=$("tableScrollTopSpacer");
    if(!upper||!lower||!spacer)return;
    const fullWidth=lower.scrollWidth;
    const width=fullWidth+"px";
    if(spacer.style.width!==width)spacer.style.width=width;
    const shouldHide=fullWidth<=lower.clientWidth+1;
    if(upper.hidden!==shouldHide)upper.hidden=shouldHide;
    if(!shouldHide&&Math.abs(upper.scrollLeft-lower.scrollLeft)>1){
      mirroredScroll.set(upper,lower.scrollLeft);
      upper.scrollLeft=lower.scrollLeft;
    }
  }
  function initTableScroll(){
    const upper=$("tableScrollTop"),lower=$("tableScrollBottom");
    let pendingSource=null,scrollFrame=0,widthFrame=0;
    function onScroll(source){
      const mirrored=mirroredScroll.get(source);
      if(mirrored!==undefined){
        mirroredScroll.delete(source);
        if(Math.abs(source.scrollLeft-mirrored)<=1)return;
      }
      pendingSource=source;
      if(scrollFrame)return;
      scrollFrame=requestAnimationFrame(()=>{
        scrollFrame=0;
        const active=pendingSource;
        pendingSource=null;
        if(!active||upper.hidden)return;
        const target=active===upper?lower:upper;
        const maxLeft=Math.max(0,target.scrollWidth-target.clientWidth);
        const nextLeft=Math.max(0,Math.min(maxLeft,active.scrollLeft));
        if(Math.abs(target.scrollLeft-nextLeft)>1){
          mirroredScroll.set(target,nextLeft);
          target.scrollLeft=nextLeft;
        }
      });
    }
    function scheduleWidthSync(){
      if(widthFrame)return;
      widthFrame=requestAnimationFrame(()=>{
        widthFrame=0;
        syncTableScrollWidth();
      });
    }
    upper.addEventListener("scroll",()=>onScroll(upper),{passive:true});
    lower.addEventListener("scroll",()=>onScroll(lower),{passive:true});
    window.addEventListener("resize",scheduleWidthSync,{passive:true});
    if(typeof ResizeObserver!=="undefined"){
      const observer=new ResizeObserver(scheduleWidthSync);
      observer.observe(lower);
      observer.observe(lower.querySelector("table"));
    }
    syncTableScrollWidth();
  }

  const cellFields=new Map([
    [1,$("operationDirection")],[2,$("counterparty")],[4,$("debit")],
    [5,$("credit")],[6,$("article")],[7,$("docType")]
  ]);
  const storage=$("rowEditStorage");
  function syncLedgerVisibility(){
    $("operationsTable").classList.toggle("ledger-columns-hidden",ledgerColumnsHidden);
    const toggle=$("toggleLedgerColumns");
    toggle.setAttribute("aria-pressed",String(ledgerColumnsHidden));
    const action=ledgerColumnsHidden?"Показать":"Скрыть";
    toggle.setAttribute("aria-label",action+" столбцы Дт и Кт");
    toggle.title=action+" столбцы Дт и Кт";
    const detailCell=$("rows").querySelector("tr.operation-detail td");
    if(detailCell)detailCell.colSpan=ledgerColumnsHidden?7:9;
    syncTableScrollWidth();
  }
  $("toggleLedgerColumns").addEventListener("click",()=>{
    ledgerColumnsHidden=!ledgerColumnsHidden;
    try{localStorage.setItem(ledgerVisibilityKey,ledgerColumnsHidden?"1":"0");}catch{}
    syncLedgerVisibility();
  });
  const extraFields=[$("customArticle"),$("editForm")];
  for(const [,accounts] of ledgerGroups){
    for(const [number,title] of accounts)$("ledgerCodes").append(new Option(number+" · "+title,number));
  }
  function attachRowEditor(row){
    cellFields.forEach((field,index)=>row.cells[index].replaceChildren(field));
    $("article").after($("customArticle"));
    const detail=document.createElement("tr");
    detail.className="operation-detail";
    const cell=detail.insertCell();
    cell.colSpan=row.cells.length-(ledgerColumnsHidden?2:0);
    cell.append($("editForm"));
    row.after(detail);
  }
  // One searchable menu services both row fields and filters.
  let openMenu=null, lastRowTap=null, lastCounterpartyTap=null, datePopup=null;
  const markedOperationIds=new Set();
  const doubleTapInterval=410;
  function counterpartyButton(x){
    return '<button type="button" class="counterparty-trigger" data-counterparty-id="'+x.id+'" title="Дважды нажмите для реквизитов контрагента" aria-label="'+show("Реквизиты контрагента: "+(x.originalName||x.name||"Не указан"))+'">'+show(C.compactLegalDisplayName(x.name||"Не указан"))+'</button>';
  }
  function markOperation(row,id,active){
    if(active)markedOperationIds.add(id);
    else markedOperationIds.delete(id);
    row.classList.toggle("operation-marked",active);
  }
  function resetOperationMarks(){
    lastRowTap=null;
    markedOperationIds.clear();
  }
  function statementDates(){
    // ISO strings sort chronologically and avoid dependence on today's date.
    return [...new Set(ops.map(x=>C.dateText(x.date)).filter(Boolean)
      .map(date=>date.split(".").reverse().join("-")))].sort();
  }
  function syncDateTrigger(){
    const iso=$("checkDate").value;
    let display="дд.мм.гггг";
    if(periodFrom&&periodTo)display=periodFrom.split("-").reverse().join(".")+" — "+periodTo.split("-").reverse().join(".");
    else if(selectedMonth){
      display=new Intl.DateTimeFormat("ru-RU",{month:"long",year:"numeric"})
        .format(new Date(Number(selectedMonth.slice(0,4)),Number(selectedMonth.slice(5,7))-1,1));
    }else if(iso)display=iso.split("-").reverse().join(".");
    $("dateTriggerLabel").textContent=display;
    $("dateTrigger").disabled=!ops.some(x=>!!C.dateText(x.date));
    $("dateTrigger").setAttribute("aria-label",iso||selectedMonth||periodFrom?"Итоги за "+display+", выбрать другой период":"Выбрать дату, месяц или период из выписки");
  }
  function closeDateCalendar(restoreFocus=false){
    if(!datePopup)return;
    datePopup.remove();
    datePopup=null;
    $("dateTrigger").setAttribute("aria-expanded","false");
    if(restoreFocus)$("dateTrigger").focus({preventScroll:true});
  }
  function openDateCalendar(){
    const anchor=$("dateTrigger");
    if(anchor.disabled)return;
    closeChoice();
    closeDateCalendar();
    const dates=statementDates();
    if(!dates.length)return;
    const available=new Set(dates);
    const earliest=dates[0],latest=dates[dates.length-1];
    const current=$("checkDate").value||(selectedMonth?selectedMonth+"-01":periodFrom||earliest);
    let year=Number(current.slice(0,4)),month=Number(current.slice(5,7))-1;
    let draftFrom=periodFrom||earliest,draftTo=periodTo||latest;
    const pad=n=>String(n).padStart(2,"0");
    const firstAllowed=earliest.slice(0,7)+"-01";
    const lastAllowed=latest.slice(0,7)+"-"+pad(new Date(Number(latest.slice(0,4)),Number(latest.slice(5,7)),0).getDate());
    const popup=document.createElement("div");
    popup.className="statement-date-popup";
    popup.setAttribute("role","dialog");
    popup.setAttribute("aria-label","Календарь дат банковской выписки");
    document.body.append(popup);
    datePopup=popup;
    anchor.setAttribute("aria-expanded","true");
    function drawCalendar(){
      const monthKey=year+"-"+pad(month+1);
      const first=new Date(year,month,1);
      const offset=(first.getDay()+6)%7;
      const length=new Date(year,month+1,0).getDate();
      const title=new Intl.DateTimeFormat("ru-RU",{month:"long",year:"numeric"}).format(first);
      let cells='<span class="statement-date-empty"></span>'.repeat(offset);
      for(let day=1;day<=length;day++){
        const iso=monthKey+"-"+pad(day);
        const has=available.has(iso);
        const selected=$("checkDate").value===iso;
        const inRange=!!(periodFrom&&periodTo&&iso>=periodFrom&&iso<=periodTo);
        cells+='<button type="button" data-calendar-day="'+iso+'" class="'+
          (has?"has-operations ":"")+(selected?"selected ":"")+(inRange?"in-range":"")+
          '" aria-label="'+pad(day)+"."+pad(month+1)+"."+year+'">'+day+'</button>';
      }
      popup.innerHTML='<div class="statement-date-head"><strong>'+title+'</strong>'+
        '<div class="statement-date-nav"><button type="button" data-calendar-prev aria-label="Предыдущий месяц">‹</button>'+
        '<button type="button" data-calendar-next aria-label="Следующий месяц">›</button></div></div>'+
        '<div class="statement-date-weekdays">'+["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(x=>"<span>"+x+"</span>").join("")+'</div>'+
        '<div class="statement-date-days">'+cells+'</div>'+
        '<div class="statement-date-footer"><p class="statement-date-legend"><span class="date-dot" aria-hidden="true"></span>Точка — день с операциями</p>'+
        '<button type="button" data-calendar-month="'+monthKey+'" class="statement-month-select'+
          (selectedMonth===monthKey?" active":"")+'">Показать весь месяц</button>'+
        '<div class="statement-range-header">Установить период</div>'+
        '<div class="statement-range-fields">'+
        '<label>С<input data-range-from type="date" min="'+firstAllowed+'" max="'+lastAllowed+'" value="'+draftFrom+'"></label>'+
        '<label>По<input data-range-to type="date" min="'+firstAllowed+'" max="'+lastAllowed+'" value="'+draftTo+'"></label></div>'+
        '<button type="button" data-range-apply class="statement-range-apply">Применить период</button></div>';
      popup.querySelector("[data-calendar-prev]").disabled=monthKey<=earliest.slice(0,7);
      popup.querySelector("[data-calendar-next]").disabled=monthKey>=latest.slice(0,7);
    }
    popup.addEventListener("change",event=>{
      if(event.target.matches("[data-range-from]"))draftFrom=event.target.value;
      if(event.target.matches("[data-range-to]"))draftTo=event.target.value;
    });
    popup.addEventListener("click",event=>{
      if(event.target.closest("[data-range-apply]")){
        const from=popup.querySelector("[data-range-from]"),to=popup.querySelector("[data-range-to]");
        draftFrom=from.value;draftTo=to.value;
        if(!draftFrom||!draftTo||draftFrom>draftTo||draftFrom<firstAllowed||draftTo>lastAllowed){
          toast("Укажите корректный период: дата «С» должна быть не позже даты «По» и в пределах выписки.");
          if(!draftFrom||draftFrom>draftTo)from.focus();else to.focus();
          return;
        }
        periodFrom=draftFrom;periodTo=draftTo;
        selectedMonth="";$("checkDate").value="";$("dateColumnFilter").value="";
        closeDateCalendar();render();anchor.focus({preventScroll:true});return;
      }
      if(event.target.closest("[data-calendar-prev]")){month--;if(month<0){month=11;year--;}drawCalendar();return;}
      if(event.target.closest("[data-calendar-next]")){month++;if(month>11){month=0;year++;}drawCalendar();return;}
      const monthButton=event.target.closest("[data-calendar-month]");
      if(monthButton){
        periodFrom="";periodTo="";
        selectedMonth=monthButton.dataset.calendarMonth;
        $("checkDate").value="";
        $("dateColumnFilter").value="";
        closeDateCalendar();
        render();
        anchor.focus({preventScroll:true});
        return;
      }
      const day=event.target.closest("[data-calendar-day]");
      if(!day)return;
      periodFrom="";periodTo="";
      selectedMonth="";
      $("checkDate").value=day.dataset.calendarDay;
      closeDateCalendar();
      $("checkDate").dispatchEvent(new Event("change",{bubbles:true}));
      anchor.focus({preventScroll:true});
    });
    drawCalendar();
    const box=anchor.getBoundingClientRect();
    const left=Math.max(8,Math.min(box.right-popup.offsetWidth,innerWidth-popup.offsetWidth-8));
    popup.style.left=left+"px";
    popup.style.maxHeight=Math.max(230,innerHeight-24)+"px";
    popup.style.overflowY="auto";
    popup.style.top=(box.bottom+popup.offsetHeight+8>innerHeight && box.top>popup.offsetHeight+8
      ?Math.max(8,box.top-popup.offsetHeight-5):box.bottom+5)+"px";
    if(parseFloat(popup.style.top)+popup.offsetHeight>innerHeight-8)
      popup.style.top=Math.max(8,innerHeight-popup.offsetHeight-8)+"px";
  }
  $("dateTrigger").addEventListener("click",()=>{
    if(datePopup)closeDateCalendar();
    else openDateCalendar();
  });
  document.addEventListener("pointerdown",event=>{
    if(datePopup&&!datePopup.contains(event.target)&&!$("dateTrigger").contains(event.target))closeDateCalendar();
  },true);
  document.addEventListener("keydown",event=>{
    if(datePopup&&event.key==="Escape"){
      event.preventDefault();
      closeDateCalendar(true);
    }
  });
  function closeChoice(restoreFocus=false){
    if(!openMenu)return;
    const {popup,anchor}=openMenu;
    openMenu=null;
    popup.remove();
    anchor.removeAttribute("aria-expanded");
    if(restoreFocus&&anchor.isConnected)anchor.focus({preventScroll:true});
  }
  function openChoice(anchor,quick=null){
    closeDateCalendar();
    closeChoice();
    if(anchor.disabled)return;
    if(anchor.matches("select[data-ledger-side]"))expandLedgerSelect(anchor);
    const isInput=anchor.matches("input[list]");
    const options=quick?.options||(isInput?anchor.list?.options:anchor.options);
    const current=quick?quick.value:anchor.value;
    const isArticleChoice=!!quick?.customArticle||anchor.id==="article"||anchor.dataset.field==="article";
    if(!options)return;
    const popup=document.createElement("div");
    popup.className="choice-popup";
    popup.innerHTML='<input type="search" class="choice-search" role="combobox" aria-expanded="true" aria-controls="choiceOptions" autocomplete="off" placeholder="Поиск…"><div id="choiceOptions" role="listbox" class="choice-options"></div><div class="choice-empty" hidden>Совпадений нет</div>';
    const search=popup.querySelector("input"), list=popup.querySelector('[role="listbox"]');
    const label=anchor.getAttribute("aria-label")||anchor.labels?.[0]?.textContent.trim()||"Выбор значения";
    search.setAttribute("aria-label","Поиск · "+label);
    list.setAttribute("aria-label",label);
    (anchor.closest("dialog[open]")||document.body).append(popup);
    openMenu={popup,anchor};
    anchor.setAttribute("aria-expanded","true");
    const bounds=anchor.getBoundingClientRect();
    const below=innerHeight-bounds.bottom-12,above=bounds.top-12;
    const up=below<200&&above>below;
    popup.style.maxHeight=Math.max(100,Math.min(340,up?above:below))+"px";
    popup.style.width=Math.min(innerWidth-16,Math.max(265,bounds.width))+"px";
    popup.style.left=Math.max(8,Math.min(bounds.left,innerWidth-popup.offsetWidth-8))+"px";
    if(up)popup.style.bottom=(innerHeight-bounds.top+3)+"px";
    else popup.style.top=(bounds.bottom+3)+"px";
    let active=-1, matches=[];
    function highlight(index,scroll){
      list.children[active]?.classList.remove("highlight");
      active=index;
      const item=list.children[index];
      if(!item){search.removeAttribute("aria-activedescendant");return;}
      item.classList.add("highlight");
      search.setAttribute("aria-activedescendant",item.id);
      if(scroll){
        const box=list.getBoundingClientRect(), row=item.getBoundingClientRect();
        if(row.top<box.top)list.scrollTop+=row.top-box.top;
        else if(row.bottom>box.bottom)list.scrollTop+=row.bottom-box.bottom;
      }
    }
    function draw(){
      const query=C.norm(search.value);
      matches=Array.from(options).filter(opt=>!opt.disabled && C.norm(opt.label+" "+opt.value).includes(query));
      if(isInput&&!query)matches.unshift(new Option("Очистить счёт",""));
      if(isInput&&/^\d{4}$/.test(query)&&!matches.some(opt=>opt.value===query))matches.push(new Option(query,query));
      if(quick?.customArticle&&query&&!matches.some(opt=>C.norm(opt.value)===query)){
        const typed=search.value.trim().slice(0,300);
        matches.push(new Option("Использовать «"+typed+"»",typed));
      }
      const fragment=document.createDocumentFragment();
      matches.forEach((opt,i)=>{
        const item=document.createElement("div");
        item.setAttribute("role","option");
        item.setAttribute("aria-selected",String(opt.value===current));
        item.id="choiceOption"+i;item.dataset.index=i;item.textContent=opt.label;
        fragment.append(item);
      });
      list.replaceChildren(fragment);
      popup.querySelector(".choice-empty").hidden=matches.length>0;
      list.scrollTop=0;active=-1;
      // DDS article menus always open at the beginning of the list, even when
      // the current article is further down. Other menus retain their position.
      if(isArticleChoice)highlight(matches.length?0:-1,false);
      else highlight(matches.length?Math.max(0,matches.findIndex(opt=>opt.value===current)):-1,true);
    }
    function choose(i){
      const opt=matches[i];if(!opt)return;
      closeChoice(true);
      if(quick){quick.save(opt.value);return;}
      anchor.value=opt.value;
      anchor.dispatchEvent(new Event("change",{bubbles:true}));
    }
    search.addEventListener("input",draw);
    popup.addEventListener("keydown",event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();closeChoice(true);}
      else if(event.key==="Tab"){closeChoice(true);}
      else if(event.key==="Enter"){event.preventDefault();choose(active);}
      else if(matches.length&&["ArrowDown","ArrowUp"].includes(event.key)){
        event.preventDefault();
        highlight(Math.max(0,Math.min(matches.length-1,active+(event.key==="ArrowDown"?1:-1))),true);
      }
    });
    list.addEventListener("click",event=>{
      const item=event.target.closest("[data-index]");
      if(item)choose(Number(item.dataset.index));
    });
    draw();search.focus({preventScroll:true});
  }
  const choiceSelector="select:not([multiple]),input.cell-field[list]";
  document.addEventListener("pointerdown",event=>{
    if(openMenu&&!openMenu.popup.contains(event.target)&&event.target!==openMenu.anchor)closeChoice();
    if(event.button!==0)return;
    const field=event.target.closest(choiceSelector);
    if(field&&!field.disabled){
      event.preventDefault();
      if(openMenu?.anchor!==field)openChoice(field);
    }
  },true);
  document.addEventListener("mousedown",event=>{
    if(event.target.closest(choiceSelector))event.preventDefault();
  },true);
  document.addEventListener("click",event=>{
    const field=event.target.closest(choiceSelector);
    if(field&&!field.disabled){event.preventDefault();event.stopPropagation();if(openMenu?.anchor!==field)openChoice(field);}
  },true);
  document.addEventListener("keydown",event=>{
    const field=event.target.closest(choiceSelector);
    if(field&&["Enter"," ","ArrowDown","ArrowUp"].includes(event.key)){
      event.preventDefault();openChoice(field);
    }
  });
  document.addEventListener("scroll",event=>{
    if(openMenu&&!openMenu.popup.contains(event.target))closeChoice();
    if(datePopup&&!datePopup.contains(event.target))closeDateCalendar();
  },true);
  window.addEventListener("resize",()=>{closeChoice();closeDateCalendar();});
  function fieldDropdown(id,label,value){
    return '<button type="button" class="row-dropdown" data-field="'+id+'" aria-haspopup="listbox" aria-label="'+show(label+": "+value)+'">'+show(value)+'</button>';
  }
  function directionDropdown(direction){
    const outgoing=direction==="Исходящее",incoming=direction==="Входящее";
    const label=outgoing?"Исходящие":incoming?"Входящие":"Не определено";
    const icon=outgoing?"#ic-arrowup":incoming?"#ic-arrowdown":"";
    return '<button type="button" class="row-dropdown row-direction '+(outgoing?"direction-out":incoming?"direction-in":"")+
      '" data-field="operationDirection" aria-haspopup="listbox" aria-label="'+show("Направление: "+label)+'">'+
      (icon?'<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="'+icon+'"></use></svg>':"")+
      '<span>'+show(label)+'</span></button>';
  }
  function render(){
    closeChoice();
    updateDdsArticleFilter();
    const dateRows=rowsForDate();
    const visible=currentRows(dateRows);
    updateStats(visible,dateRows);
    const shown=visible.slice(0,400);
    storage.append(...cellFields.values(),...extraFields);
    lastRowTap=null;
    lastCounterpartyTap=null;
    hideCounterpartyInfo();
    if(!shown.some(x=>x.id===selected))selected=null;
    $("rows").innerHTML=shown.length?shown.map(x=>
      '<tr data-id="'+x.id+'"'+(markedOperationIds.has(x.id)?' class="operation-marked"':'')+' tabindex="0">'+
      '<td>'+show(x.date||"Проверить дату")+'</td>'+
      '<td>'+directionDropdown(x.direction)+'</td>'+
      '<td>'+counterpartyButton(x)+(x.possibleDuplicate&&!x.duplicateConfirmed?'<div class="notice">Возможный дубль</div>':"")+'</td>'+
      '<td class="amount">'+fmt(x.amount)+'</td>'+
      '<td class="account-cell">'+accountPicker(x,"debit")+'</td>'+
      '<td class="account-cell">'+accountPicker(x,"credit")+'</td>'+
      '<td>'+fieldDropdown("article","Статья ДДС",x.article||"Не указана")+'</td>'+
      '<td>'+fieldDropdown("docType","Тип документа 1С",x.docType||"Не выбран")+'</td>'+
      '<td class="statement-comment" title="'+show(x.comment?x.comment:(x.purpose?"Назначение платежа из выписки: "+x.purpose:"В выписке не найден ни комментарий, ни назначение платежа"))+'"><span class="comment-preview">'+show(x.comment||x.purpose||"—")+'</span></td></tr>'
    ).join(""):'<tr><td colspan="'+(ledgerColumnsHidden?7:9)+'" class="empty">'+(fileLabel?"В выписке нет операций за выбранный период":"Операции не найдены")+'</td></tr>';
    if(selected!==null)attachRowEditor($("rows").querySelector('tr[data-id="'+selected+'"]'));
    syncLedgerVisibility();
    $("shownCount").textContent=ops.length?"Показано "+shown.length+" из "+visible.length+" по фильтру (всего "+ops.length+")":"Операций пока нет";

    if($("clearDateFilter"))$("clearDateFilter").hidden=!$("checkDate").value&&!selectedMonth&&!periodFrom;
    syncDateTrigger();
    if(!$("previewPanel").hidden)renderPreview();
  }


  function hideCounterpartyInfo(){
    const card=$("counterpartyInfo");
    if(card)card.hidden=true;
  }
  function showCounterpartyInfo(x,anchor){
    if(!x)return;
    closeChoice();
    closeDateCalendar();
    lastRowTap=null;
    const card=$("counterpartyInfo");
    $("counterpartyInfoName").textContent=x.originalName||x.name||"Не указан";
    const bin=String(x.bin||"").trim();
    $("counterpartyInfoBin").textContent=/^\d{12}$/.test(bin)?bin:"Не указан в выписке";
    const account=String(x.counterpartyAccount||"").trim();
    $("counterpartyInfoAccount").textContent=/^KZ[A-Z0-9]{18}$/i.test(account)?account:"Не указан в выписке";
    card.hidden=false;
    card.style.left="8px";
    card.style.top="8px";
    const rect=anchor.getBoundingClientRect();
    const width=card.offsetWidth,height=card.offsetHeight;
    const left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8));
    const below=rect.bottom+height+8<=window.innerHeight;
    const top=below?rect.bottom+7:Math.max(8,rect.top-height-7);
    card.style.left=left+"px";
    card.style.top=top+"px";
  }
  $("counterpartyInfoClose").addEventListener("click",hideCounterpartyInfo);
  document.addEventListener("pointerdown",event=>{
    const card=$("counterpartyInfo");
    if(!card.hidden&&!card.contains(event.target)&&!event.target.closest(".counterparty-trigger"))hideCounterpartyInfo();
  },true);
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!$("counterpartyInfo").hidden)hideCounterpartyInfo();
  });
  document.addEventListener("scroll",event=>{
    if(!$("counterpartyInfo").hidden&&!$("counterpartyInfo").contains(event.target))hideCounterpartyInfo();
  },true);
  window.addEventListener("resize",hideCounterpartyInfo);
  $("rows").addEventListener("keydown",event=>{
    const trigger=event.target.closest(".counterparty-trigger");
    if(trigger&&["Enter"," "].includes(event.key)){
      event.preventDefault();
      showCounterpartyInfo(ops.find(x=>x.id===Number(trigger.dataset.counterpartyId)),trigger);
    }
  });

  // Ledger pickers can be used without opening the rest of the row.
  $("rows").addEventListener("click",event=>{
    const target=event.target;
    const row=target.closest("tr[data-id]");
    if(!row)return;
    if(target.closest(".inline-ledger-select,.inline-ledger-custom")){
      if(target.matches("[data-inline-save]")){
        const custom=target.closest(".inline-ledger-custom");
        saveInlineLedger(row,custom.dataset.inlineSide,custom.querySelector("input").value);
      }else if(target.matches("[data-inline-cancel]"))render();
      return;
    }
    const counterpartyTrigger=target.closest(".counterparty-trigger");
    if(counterpartyTrigger){
      lastRowTap=null;
      const id=Number(row.dataset.id),now=performance.now();
      if(lastCounterpartyTap?.id===id&&(event.detail>=2||now-lastCounterpartyTap.time<450)){
        lastCounterpartyTap=null;
        showCounterpartyInfo(ops.find(x=>x.id===id),counterpartyTrigger);
      }else lastCounterpartyTap={id,time:now};
      return;
    }
    lastCounterpartyTap=null;
    const dropdown=target.closest(".row-dropdown");
    if(!dropdown&&target.closest("input,button,select,textarea"))return;
    const id=Number(row.dataset.id);
    if(dropdown){
      lastRowTap=null;
      const operation=ops.find(x=>x.id===id);
      const field=dropdown.dataset.field;
      const key=field==="operationDirection"?"direction":field;
      const options=Array.from($(field).options).filter(opt=>opt.value!=="__custom__");
      if(key==="article"&&operation.article&&!options.some(opt=>opt.value===operation.article)){
        options.push(new Option(operation.article,operation.article));
      }
      openChoice(dropdown,{options,value:operation[key],customArticle:key==="article",save(value){
        operation[key]=value;
        if(key==="article")operation.articleSource="manual";
        if(key==="docType")operation.docTypeSource="manual";
        else C.refreshSuggestedDocument(operation);
        C.refreshSuggestedPosting(operation);
        C.markDuplicates(ops);
        render();scheduleSave();
        $("rows").querySelector('tr[data-id="'+id+'"] [data-field="'+field+'"]')?.focus({preventScroll:true});
      }});
      return;
    }
    const now=performance.now();
    if(lastRowTap?.id===id&&(event.detail===2||now-lastRowTap.time<doubleTapInterval)){
      markOperation(row,id,lastRowTap.wasMarked);
      openRowEditor(row);
      return;
    }
    const wasMarked=markedOperationIds.has(id);
    markOperation(row,id,!wasMarked);
    lastRowTap={id,time:now,wasMarked};
  });
  function openRowEditor(row){
    lastRowTap=null;
    const id=Number(row.dataset.id);
    if(selected===id)return;
    selected=id;
    loadEditor();render();
    $("operationDirection").focus({preventScroll:true});
  }
  $("rows").addEventListener("keydown",event=>{
    if(event.key==="Enter"&&event.target.matches("tr[data-id]")){
      event.preventDefault();openRowEditor(event.target);
    }
  });
  // Expand before iOS opens its native select; focus handles keyboard access.
  ["touchstart","pointerdown","focusin"].forEach(type=>{
    $("rows").addEventListener(type,event=>{
      const select=event.target.closest?.("select[data-ledger-side]");
      if(select)expandLedgerSelect(select);
    },{passive:true});
  });
  $("rows").addEventListener("change",event=>{
    const select=event.target.closest("select[data-ledger-side]");
    if(!select)return;
    const row=select.closest("tr[data-id]");
    if(!row)return;
    if(select.value==="__other__"){
      editOtherLedger(select);
      return;
    }
    saveInlineLedger(row,select.dataset.ledgerSide,select.value);
  });
  $("rows").addEventListener("keydown",event=>{
    const custom=event.target.closest(".inline-ledger-custom");
    if(!custom||event.target.tagName!=="INPUT")return;
    if(event.key==="Enter"){
      event.preventDefault();
      saveInlineLedger(custom.closest("tr[data-id]"),custom.dataset.inlineSide,event.target.value);
    }else if(event.key==="Escape"){
      event.preventDefault();
      render();
    }
  });

  const articles=[...$("article").options].map(x=>x.value);
  function loadEditor(){
    const x=ops.find(v=>v.id===selected);
    if(!x)return;
    $("operationMeta").textContent=(x.date||"Дата не определена")+" · "+fmt(x.amount)+(x.docNumber?" · Документ "+x.docNumber:"");
    $("operationDirection").value=x.direction||"";
    $("docType").value=x.docType||"";
    $("operationKindHint").textContent=C.suggestDocumentOperation(x.article,x.docType)
      ? "Вид операции в 1С: "+C.suggestDocumentOperation(x.article,x.docType)+" (проверьте настройки своей базы)."
      : "Тип документа можно изменить вручную.";
    $("counterparty").value=x.name;
    $("purpose").value=x.purpose;
    $("debit").value=x.debit;
    $("credit").value=x.credit;
    $("postingHint").textContent=[["Дт",x.debit,x.debitSource,x.debitReason],["Кт",x.credit,x.creditSource,x.creditReason]].map(([side,account,source,reason])=>
      side+": "+(account||"не указан")+(source==="auto"?" — предложен автоматически"+(reason?" ("+reason+")":""):source==="manual"?" — изменён бухгалтером":source==="statement"?" — из файла":" — требуется проверка")).join(". ");
    if(x.article&&articles.includes(x.article)){
      $("article").value=x.article;$("customArticle").style.display="none";$("customArticle").value="";
    }else if(x.article){
      $("article").value="__custom__";$("customArticle").style.display="block";$("customArticle").value=x.article;
    }else{$("article").value="";$("customArticle").style.display="none";$("customArticle").value="";}
    $("articleHint").textContent=x.articleSource==="auto"?
      "Предложение: "+(x.articleReason||"по назначению платежа")+". Проверьте соответствие статье в справочнике 1С.":
      x.articleSource==="manual"?"Статья выбрана бухгалтером вручную.":
      "Нет надёжного предложения. "+(x.articleReason||"Проверьте назначение и КНП")+". Укажите статью из справочника 1С.";
    $("duplicateWarning").hidden=!x.possibleDuplicate;
    $("confirmDuplicate").checked=!!x.duplicateConfirmed;
    $("duplicateHint").textContent=x.possibleDuplicate?
      "В выписке найдены похожие дата, сумма, контрагент и назначение/номер документа. Сверьте с банком, прежде чем подтверждать.":"";
    const count=C.countSimilarOperations(ops,x);
    $("similarActions").hidden=count===0;
    $("similarCount").textContent=String(count);
    $("applyToSimilar").checked=false;
  }
  $("editForm").addEventListener("submit",event=>{
    event.preventDefault();
    const x=ops.find(v=>v.id===selected);
    if(!x)return;
    const previousCounterparty=counterpartyKey(x);
    const originalRuleKey=C.operationRuleKey(x);
    const applyBulk=$("applyToSimilar").checked;
    const previousName=x.name;
    x.name=C.fixTengeText($("counterparty").value.trim().slice(0,300));
    if(x.name!==previousName)x.originalName=x.name;
    if(previousCounterparty!==counterpartyKey(x))updateCounterpartyFilter();
    x.purpose=C.fixTengeText($("purpose").value.trim().slice(0,3000));
    x.article=($("article").value==="__custom__"?$("customArticle").value:$("article").value).trim().slice(0,300);
    x.articleSource="manual";
    const debitEdited=$("debit").value.trim()!==x.debit;
    const creditEdited=$("credit").value.trim()!==x.credit;
    x.debit=$("debit").value.trim();x.credit=$("credit").value.trim();
    if(debitEdited){x.debitSource="manual";x.debitReason="Счёт изменён бухгалтером";}
    if(creditEdited){x.creditSource="manual";x.creditReason="Счёт изменён бухгалтером";}
    x.direction=$("operationDirection").value;x.docType=$("docType").value;
    C.refreshSuggestedPosting(x);
    x.docTypeSource="manual";
    x.duplicateConfirmed=$("confirmDuplicate").checked;
    const readyBefore=ops.filter(item=>item.status==="ready").length;
    const bulk=applyBulk?C.applyPostingToSimilar(ops,x,originalRuleKey):null;
    C.markDuplicates(ops);
    closeRowEditor();scheduleSave();
    if(bulk){
      const readyAfter=ops.filter(item=>item.status==="ready").length;
      toast("Массовое применение: обновлено "+bulk.updated+" из "+bulk.matched+
        " похожих операций. Полностью заполнено: "+readyAfter+
        (readyAfter>readyBefore?" (+"+(readyAfter-readyBefore)+")":" (без изменения — проверьте остальные поля)")+
        ". Ручные настройки сохранены.");
    }
    else toast(x.status==="ready"?"Реквизиты заполнены. Проводку необходимо сверить с 1С.":"Изменения сохранены. Проверьте оставшиеся поля или возможный дубль.");
  });
  $("article").addEventListener("change",()=>{
    $("customArticle").style.display=$("article").value==="__custom__"?"block":"none";
    if($("article").value==="__custom__")$("customArticle").focus();
    const x=ops.find(v=>v.id===selected);
    if(x && $("article").value==="Банковские комиссии" &&
       x.direction==="Исходящее" &&
       $("docType").value==="Платёжное поручение исходящее" &&
       x.docTypeSource!=="manual") {
      $("docType").value=C.BANK_FEE_DOCUMENT;
      $("operationKindHint").textContent="Вид операции в 1С: Прочее списание безналичных денежных средств (проверьте настройки своей базы).";
    }
  });
  function closeRowEditor(){
    const id=selected;
    selected=null;
    render();
    $("rows").querySelector('tr[data-id="'+id+'"] .row-dropdown')?.focus({preventScroll:true});
  }
  $("reset").addEventListener("click",closeRowEditor);
  $("search").addEventListener("input",render);
  $("counterpartyFilter")?.addEventListener("change",render);
  $("amountColumnFilter")?.addEventListener("change",render);
  $("ddsArticleFilter")?.addEventListener("change",render);
  $("dateColumnFilter")?.addEventListener("change",()=>{
    const date=$("dateColumnFilter").value;
    periodFrom="";periodTo="";
    selectedMonth="";
    $("checkDate").value=date?date.split(".").reverse().join("-"):"";
    render();
  });
  $("showAllFilters").addEventListener("click",()=>{
    filter="all";directionFilter="all";
    resetFilters();
    render();
  });
  $("reclassifyDDS").addEventListener("click",async ()=>{
    if(!ops.length){toast("Сначала загрузите выписку");return;}
    showProcessing(true,"Пересчитываем статьи ДДС…");
    try{
      await letSpinnerPaint();
      const eligible=ops.filter(x=>x.articleSource!=="manual");
      const changed=eligible.filter(recomputeArticle).length;
      const documentUpdates=ops.filter(C.refreshSuggestedDocument).length;
      C.markDuplicates(ops);loadEditor();render();scheduleSave();
      toast("ДДС обновлено: "+changed+"; типов документов обновлено: "+documentUpdates+". Ручные значения сохранены.");
    }catch(err){toast(err.message||"Не удалось пересчитать ДДС");}
    finally{showProcessing(false);}
  });
  document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
    filter=button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("active",b===button));render();
  }));
  document.querySelectorAll("[data-direction]").forEach(button=>button.addEventListener("click",()=>{
    directionFilter=button.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach(b=>b.classList.toggle("active",b===button));render();
  }));
  $("checkDate").addEventListener("change",()=>{
    periodFrom="";periodTo="";
    selectedMonth="";
    $("dateColumnFilter").value=C.dateText($("checkDate").value);
    render();
  });
  $("clearDateFilter")?.addEventListener("click",()=>{
    periodFrom="";periodTo="";
    selectedMonth="";
    $("checkDate").value="";
    $("dateColumnFilter").value="";
    render();
    $("dateTrigger").focus();
  });
  function issues(x){
    const a=[];
    if(!x.date)a.push("Дата");
    if(!x.direction)a.push("Направление");
    if(!x.name?.trim())a.push("Контрагент");
    if(!x.purpose?.trim())a.push("Назначение платежа");
    if(!x.article?.trim())a.push("Статья ДДС");
    if(!/^\d{4}$/.test(String(x.debit||"")))a.push("Счёт дебета");
    if(!/^\d{4}$/.test(String(x.credit||"")))a.push("Счёт кредита");
    if(!x.docType)a.push("Документ 1С");
    else if(!["Платёжное поручение входящее","ПКО","Поступление на расчётный счёт"].includes(x.docType)&&x.direction==="Входящее" ||
      !["Платёжное поручение исходящее","РКО","Списание с расчётного счёта",C.BANK_FEE_DOCUMENT].includes(x.docType)&&x.direction==="Исходящее")a.push("Направление не совпадает с документом 1С");
    if(x.article==="Банковские комиссии" && x.direction==="Исходящее" &&
       x.docType==="Платёжное поручение исходящее")
      a.push("Комиссия банка: проверьте платёжный ордер (списание денежных средств)");
    if(x.docType==="ПКО"&&x.debit!=="1010")a.push("Для ПКО проверьте счёт дебета 1010");
    if(x.docType==="РКО"&&x.credit!=="1010")a.push("Для РКО проверьте счёт кредита 1010");
    if(x.possibleDuplicate&&!x.duplicateConfirmed)a.push("Возможный дубль");
    return a;
  }
  function reviewNotes(x){return [...issues(x),...C.reconciliationNotes(x)];}
  function renderPreview(){
    const unfinished=ops.filter(x=>x.status!=="ready");
    const filled=ops.filter(x=>x.status==="ready");
    const checks=[...unfinished,...filled].slice(0,200);
    $("previewContent").innerHTML='<p><strong>Всего операций: '+ops.length+
      ' · Реквизиты заполнены: '+filled.length+
      ' · Требуют заполнения: '+unfinished.length+'</strong></p>'+
      '<p class="notice"><strong>Все '+ops.length+' операций требуют бухгалтерской сверки с 1С.</strong> Заполненные поля и автоматические предложения не подтверждают правильность проводок.</p>'+
      '<div class="tablewrap"><table style="min-width:750px"><thead><tr><th>№</th><th>Контрагент</th><th>Дт</th><th>Кт</th><th>Что проверить</th></tr></thead><tbody>'+
      checks.map(x=>'<tr><td>'+String(ops.indexOf(x)+1)+'</td><td>'+show(x.name||"Не указан")+'</td><td>'+show(x.debit||"—")+'</td><td>'+show(x.credit||"—")+'</td><td>'+
        show(reviewNotes(x).length?reviewNotes(x).join("; "):"Сверить проводку, статью ДДС и документы с базой 1С")+'</td></tr>').join("")+
      '</tbody></table></div>'+
      (ops.length>checks.length?'<p class="notice">Показаны первые '+checks.length+' операций.</p>':"");
  }
  function safeText(value){
    const text=String(value??"");
    return /^[\s]*[=+@-]/.test(text)?"'"+text:text;
  }
  $("export").addEventListener("click",()=>{
    if(!downloadsEnabled || !ops.length)return;
    if($("previewPanel").hidden){
      $("previewPanel").hidden=false;
      renderPreview();
      $("previewPanel").scrollIntoView({behavior:"smooth",block:"start"});
      toast("Перед скачиванием просмотрите список для сверки с 1С, затем нажмите «Скачать Excel» ещё раз.");
      return;
    }
    if(!window.XLSX){toast("Не удалось загрузить библиотеку Excel");return;}
    const headers=["№","Дата","Направление","Контрагент","БИН/ИИН","Назначение платежа","Комментарий банка","Сумма, "+(statementCurrency()==="KZT"?"₸":statementCurrency()),"Статья ДДС","Основание подбора ДДС","КНП","Документ 1С","Вид операции в 1С (предложение)","Дебет","Кредит","Номер документа","Статус","Что проверить","Лист источника"];
    const rows=ops.map((x,i)=>[i+1,x.date,x.direction,safeText(x.name),safeText(x.bin),safeText(x.purpose),safeText(x.comment),Number(x.amount),safeText(x.article),safeText(x.articleReason),safeText(x.knp),x.docType,safeText(C.suggestDocumentOperation(x.article,x.docType)),x.debit,x.credit,safeText(x.docNumber),
      x.status==="ready"?"Реквизиты заполнены":"Требует заполнения",safeText(reviewNotes(x).join("; ")||"Сверить с 1С"),safeText(x.sourceSheet)]);
    const workbook=XLSX.utils.book_new();
    function sheet(name,data,widths){
      const ws=XLSX.utils.aoa_to_sheet(data);
      ws["!cols"]=(widths||[8,14,18,28,17,56,18,25,50,10,44,50,11,11,18,17,50,20]).map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(workbook,ws,name);
    }
    sheet("Все операции",[headers,...rows]);
    sheet("Поля заполнены",[headers,...rows.filter((r,i)=>ops[i].status==="ready")]);
    sheet("Нужно заполнить",[headers,...rows.filter((r,i)=>ops[i].status!=="ready")]);
    sheet("Сверка с 1С",[headers,...rows]);
    const t=C.totals(ops);
    sheet("Контроль",[["Показатель","Значение"],["Количество",t.count],["Поступления",t.incoming],["Списания",t.outgoing],["Чистое движение",t.net],
      ["Реквизиты заполнены (не сверены с 1С)",ops.filter(x=>x.status==="ready").length],["Требуют заполнения",ops.filter(x=>x.status!=="ready").length],
      ["Бухгалтерская сверка с 1С",ops.length],
      ["Примечание","Это контрольный Excel, не файл прямого обмена с 1С. Статус заполненности не подтверждает корректность проводок."]],[32,72]);
    try{
      XLSX.writeFile(workbook,"STOLDOM_подготовка_1С_"+new Date().toISOString().slice(0,10)+".xlsx",{compression:true});
      toast("Контрольный Excel скачан. Все проводки и статьи ДДС необходимо сверить с 1С.");
    }catch(e){toast("Не удалось сформировать Excel: "+e.message);}
  });
  $("clearDraft").addEventListener("click",()=>{
    if(!ops.length&&!fileLabel)return;
    if(!confirm("Очистить текущую выписку и операции?"))return;
    ops=[];balances=[];company={};selected=null;resetOperationMarks();fileLabel="";filter="all";directionFilter="all";resetFilters();
    try{sessionStorage.removeItem(sessionKey);}catch{}
    loadEditor();render();toast("Данные текущей вкладки очищены");
  });
  function resetFilters(){
    lastRowTap=null;
    periodFrom="";periodTo="";
    selectedMonth="";
    closeDateCalendar();
    $("search").value="";
    if($("counterpartyFilter"))$("counterpartyFilter").value="";
    if($("dateColumnFilter"))$("dateColumnFilter").value="";
    if($("amountColumnFilter"))$("amountColumnFilter").value="";
    if($("ddsArticleFilter"))$("ddsArticleFilter").value="";
    updateCounterpartyFilter();
    updateValueColumnFilters();
    $("checkDate").value="";
    document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
    document.querySelectorAll("[data-direction]").forEach(x=>x.classList.toggle("active",x.dataset.direction==="all"));
  }
  function collectStatementBalances(rows, values){
    for(const [i,label] of ["входящий остаток:","исходящий остаток:"].entries()){
      const row=rows.find(row=>C.norm(row[0])===label);
      if(row?.some(cell=>C.norm(cell)==="kzt")){
        const amount=C.money(row.slice(1).find(cell=>Number.isFinite(C.money(cell))));
        if(Number.isFinite(amount))values[i].add(amount);
      }
    }
    for(const [index,label] of balanceLabels.entries()){
      const header=rows.findIndex(row=>row?.some(cell=>C.norm(cell)===label));
      if(header<0)continue;
      const column=rows[header].findIndex(cell=>C.norm(cell)===label);
      for(let row=header+1;row<rows.length;row++){
        const amount=C.money(rows[row]?.[column]);
        if(Number.isFinite(amount))values[index].add(amount);
      }
    }
  }
  function decodeBankText(buffer){
    const bytes=new Uint8Array(buffer);
    if(bytes[0]===255&&bytes[1]===254)return new TextDecoder("utf-16le").decode(bytes);
    if(bytes[0]===254&&bytes[1]===255)return new TextDecoder("utf-16be").decode(bytes);
    try{return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
    catch{return new TextDecoder("windows-1251").decode(bytes);}
  }
  function readClientBank(text){
    const accounts=new Set(), documents=[];
    let section="",fields={};
    for(const line of text.split(/\r\n|\r|\n/)){
      const separator=line.indexOf("=");
      const key=(separator<0?line:line.slice(0,separator)).trim();
      const value=separator<0?"":line.slice(separator+1).trim();
      if(key==="СекцияДокумент"||key==="СекцияРасчСчет"){
        section=key;
        fields=Object.create(null);
      }else if(key==="КонецРасчСчет"&&section==="СекцияРасчСчет"){
        if(fields.РасчСчет)accounts.add(fields.РасчСчет);
        section="";
      }else if(key==="КонецДокумента"&&section==="СекцияДокумент"){
        documents.push(fields);
        if(documents.length>20000)throw Error("Слишком много операций (максимум 20 000)");
        section="";
      }else if(separator>=0){
        if(section)fields[key]=value;
        else if(key==="РасчСчет"&&value)accounts.add(value);
      }
    }
    if(section)throw Error("Файл обмена обрывается внутри раздела. Выгрузите его полностью.");
    if(accounts.size!==1)throw Error("Для обмена 1С нужна выписка с одним расчётным счётом. Выгрузите один счёт за период.");
    const rows=[["Дата операции","Сумма","Направление","Контрагент","БИН/ИИН контрагента","Назначение платежа","Номер документа","КНП","Счёт контрагента"]];
    for(const doc of documents){
      const outgoing=accounts.has(doc.ПлательщикСчет),incoming=accounts.has(doc.ПолучательСчет);
      if(outgoing===incoming)throw Error("В файле 1С есть документ с неоднозначным направлением. Выгрузите табличную выписку.");
      const party=outgoing?"Получатель":"Плательщик";
      rows.push([(outgoing?doc.ДатаСписано:doc.ДатаПоступило)||doc.Дата,doc.Сумма,outgoing?"Исходящее":"Входящее",
        doc[party+"1"]||doc[party]||"",doc[party+"БИН"]||doc[party+"ИНН"]||"",
        doc.НазначениеПлатежа||[1,2,3,4,5,6].map(n=>doc["НазначениеПлатежа"+n]).filter(Boolean).join(" "),
        doc.Номер,doc.КНП,doc[party+"Счет"]||""]);
    }
    const operations=C.parseRows(rows,"Клиент-банк");
    if(!operations.length||operations.length!==documents.length)throw Error("Не все документы файла 1С содержат сумму операции. Проверьте выгрузку.");
    // The exchange file does not reliably identify the balance currency.
    return {operations,balances:[],company:{account:[...accounts][0]||""}};
  }
  function mapSheet(rows,sheet){
    const dialog=$("importMapping"), header=$("mappingHeader"), fields=$("mappingColumns");
    const feedback=$("mappingFeedback");
    const labels={comment:"Комментарий из выписки",date:"Дата операции",debit:"Списания",credit:"Поступления",amount:"Сумма операции",direction:"Направление",name:"Контрагент",purpose:"Назначение платежа",bin:"БИН/ИИН",number:"Номер документа",knp:"КНП",payer:"Плательщик",receiver:"Получатель"};
    $("mappingSheet").textContent="Лист «"+sheet+"». Укажите дату и сумму или колонки списаний и поступлений.";
    header.max=rows.length;
    header.value=Math.max(1,rows.findIndex(row=>row.filter(value=>String(value).trim()).length>=3)+1);
    function showFields(){
      fields.replaceChildren();
      feedback.textContent="";
      const cells=rows[Number(header.value)-1]||[];
      for(const [key,title] of Object.entries(labels)){
        const label=document.createElement("label"), select=document.createElement("select");
        label.textContent=title;
        select.name=key;
        select.add(new Option("Не выбрано",""));
        cells.forEach((cell,index)=>{
          const letter=XLSX.utils.encode_col(index);
          select.add(new Option(letter+" · "+(String(cell||"").slice(0,90)||"Без названия"),String(index)));
        });
        label.append(select);
        fields.append(label);
      }
    }
    header.onchange=showFields;
    showFields();
    let operations=[];
    const form=dialog.querySelector("form");
    form.onsubmit=event=>{
      if(event.submitter?.value!=="apply")return;
      const columns={};
      for(const select of fields.querySelectorAll("select")){
        if(select.value!=="")columns[select.name]=Number(select.value);
      }
      if(columns.date===undefined||[columns.debit,columns.credit,columns.amount].every(v=>v===undefined)){
        event.preventDefault();
        feedback.textContent="Укажите дату и хотя бы одну колонку с суммой.";
        return;
      }
      if(new Set(Object.values(columns)).size!==Object.keys(columns).length){
        event.preventDefault();
        feedback.textContent="Каждому полю нужна отдельная колонка.";
        return;
      }
      operations=C.parseRows(rows,sheet,{header:Number(header.value)-1,columns});
      if(!operations.some(op=>op.date)){
        event.preventDefault();
        feedback.textContent="Нет операций с датой и суммой. Проверьте строку заголовков и колонки.";
      }
    };
    dialog.returnValue="";
    // The user must be able to interact with manual column mapping; never cover it with a loader.
    showProcessing(false);
    return new Promise((resolve,reject)=>{
      dialog.onclose=()=>{
        if(dialog.returnValue==="apply")resolve(operations);
        else if(dialog.returnValue==="skip")resolve([]);
        else reject(Error("Импорт отменён"));
      };
      dialog.showModal();
    });
  }
  async function readStatement(file){
    const requireExcel=()=>{if(!window.XLSX)throw Error("Библиотека Excel не загрузилась. Проверьте соединение и обновите страницу.");};
    const ext=file.name.split(".").pop().toLowerCase();
    if(ext==="pdf"){
      const {readAlatauPdf}=await import("./alatau-pdf.mjs?v=alatau-usd-20261122-v3");
      return readAlatauPdf(file,C);
    }
    let book;
    if(["csv","tsv","txt"].includes(ext)){
      const text=decodeBankText(await file.arrayBuffer());
      if(/^1CClientBankExchange/i.test(text.trimStart()))return readClientBank(text);
      requireExcel();
      const options={type:"string",raw:true};
      if(ext==="tsv")options.FS="\t";
      book=XLSX.read(text,options);
    }
    else {
      requireExcel();
      book=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    }
    const all=[];
    const companyCandidates=[];
    const balanceValues=balanceLabels.map(()=>new Set());
    let recognizedAlatau=false;
    for(const sheet of book.SheetNames){
      const rows=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:"",raw:true});
      if(!rows.some(row=>row.some(value=>String(value).trim())))continue;
      const ws=book.Sheets[sheet];
      const start=XLSX.utils.decode_range(ws["!ref"]).s;
      const alatau=C.parseAlatauSheet(rows,sheet,(r,c)=>
        ws[XLSX.utils.encode_cell({r:start.r+r,c:start.c+c})]?.w);
      if(alatau){
        recognizedAlatau=true;
        companyCandidates.push(alatau.company);
        alatau.balances.forEach((amount,i)=>{if(Number.isFinite(amount))balanceValues[i].add(amount);});
        if(all.length+alatau.operations.length>20000)throw Error("Слишком много операций (максимум 20 000)");
        all.push(...alatau.operations);
        continue;
      }
      let operations=C.parseRows(rows,sheet);
      if(!operations.length){
        operations=await mapSheet(rows,sheet);
        showProcessing(true,"Продолжаем обработку выписки…");
        await letSpinnerPaint();
      }
      if(!operations.length)continue;
      const kaspiHeader=rows.find(row=>row.some(cell=>C.norm(cell)==="наименование бенефициара / отправителя денег"));
      if(kaspiHeader){
        const debit=kaspiHeader.findIndex(cell=>C.norm(cell)==="дебет");
        const credit=kaspiHeader.findIndex(cell=>C.norm(cell)==="кредит");
        const totalsRow=rows.find(row=>row.some(cell=>C.norm(cell)==="итого обороты в валюте счета"));
        const countRow=rows.find(row=>row.some(cell=>C.norm(cell)==="итого операций за период"));
        const totals=C.totals(operations);
        if(debit>=0&&credit>=0&&(
          (totalsRow&&(totals.outgoing!==C.money(totalsRow[debit])||totals.incoming!==C.money(totalsRow[credit])))||
          (countRow&&(operations.filter(op=>op.direction==="Исходящее").length!==C.money(countRow[debit])||
                      operations.filter(op=>op.direction==="Входящее").length!==C.money(countRow[credit]))))){
          throw Error("Операции не сошлись с итогами Kaspi. Проверьте колонки дебета и кредита.");
        }
      }
      all.push(...operations);
      companyCandidates.push(C.extractStatementCompany(rows));
      collectStatementBalances(rows,balanceValues);
      if(all.length>20000)throw Error("Слишком много операций (максимум 20 000)");
    }
    if(!all.length&&!recognizedAlatau)throw Error("В файле не найдена таблица операций с колонками «Дата» и «Сумма/Дебет/Кредит»");
    return {operations:all,balances:balanceValues.map(values=>values.size===1?[...values][0]:null),company:C.mergeStatementCompanies(companyCandidates)};
  }
  $("fileInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try{
      if(!/\.(xlsx|xls|xlsm|xlsb|ods|csv|tsv|txt|pdf)$/i.test(file.name))throw Error("Выберите выписку Excel, ODS, CSV, TSV, табличный TXT или PDF Alatau City Bank");
      if(file.size>20*1024*1024)throw Error("Файл больше 20 МБ");
      e.target.disabled=true;
      showProcessing(true,"Читаем банковскую выписку…");
      await letSpinnerPaint();
      const data=await readStatement(file);
      showProcessing(true,"Формируем таблицу операций…");
      await letSpinnerPaint();
      ops=data.operations.map((x,i)=>({...x,id:i+1}));C.markDuplicates(ops);
      balances=data.balances;
      company=C.mergeStatementCompanies([data.company||{}]);
      $("statementCompany").open=false;
      selected=null;resetOperationMarks();fileLabel=file.name;filter="all";directionFilter="all";resetFilters();
      loadEditor();render();scheduleSave();
      toast(ops.length?"Загружено "+ops.length+" операций. Требуют проверки: "+ops.filter(x=>x.status!=="ready").length:"Выписка загружена: операций нет. Реквизиты и остатки банка обновлены.");
    }catch(err){toast(err.message||"Ошибка чтения файла");}
    finally{
      showProcessing(false);
      e.target.disabled=false;
      e.target.value="";
    }
  });
  initTableScroll();
  restoreDraft();updateCounterpartyFilter();updateValueColumnFilters();loadEditor();render();
})();



