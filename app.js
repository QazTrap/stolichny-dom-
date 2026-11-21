/* STOLDOM.SITE browser workspace. Bank files remain on the user's device. */
(() => {
  "use strict";
  const downloadsEnabled=false;
  const C=window.STOLDOM_CORE;
  if(!C){console.error("STOLDOM rules could not load");return;}
  const $=id=>document.getElementById(id);
  const fmt=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n)||0)+" ₸";
  const show=x=>C.escapeHtml(x);
  const formatBalance=new Intl.NumberFormat("ru-RU",{style:"currency",currency:"KZT",currencyDisplay:"narrowSymbol"});
  const balanceLabels=["Вх.остаток на начало периода в нац.валюте","Исх.остаток на конец периода в нац.валюте"].map(C.norm);
  let balances=[];
  const sessionKey="stoldom.workspace.v2";
  let ops=[],selected=null,filter="all",directionFilter="all",fileLabel="",saveTimer=0;
  function toast(message){
    $("toast").textContent=String(message);
    $("toast").style.display="block";
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>$("toast").style.display="none",4500);
  }
  function saveDraft(){
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({version:2,ops,fileLabel,balances,savedAt:new Date().toISOString()}));
      if($("draftStatus")) $("draftStatus").textContent="Черновик в этой вкладке сохранён";
    } catch {
      if($("draftStatus")) $("draftStatus").textContent="Автосохранение недоступно — скачайте черновик";
    }
  }
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,200);}
  function sanitizeImported(raw){
    if(!Array.isArray(raw)||raw.length>20000) throw Error("Неверный формат черновика");
    return raw.map((x,i)=>{
      if(!x || typeof x!=="object" || Array.isArray(x)) throw Error("Некорректная операция");
      const str=k=>C.fixTengeText(String(x[k]??"").slice(0,3000));
      const amount=Number(x.amount);
      if(!Number.isFinite(amount)||amount<=0||amount>1e15)throw Error("Некорректная сумма операции");
      return {
        id:i+1,date:C.dateText(str("date")),name:str("name"),originalName:str("originalName")||str("name"),
        purpose:str("purpose"),amount,direction:["Входящее","Исходящее"].includes(str("direction"))?str("direction"):"",
        docType:str("docType"),docTypeSource:str("docTypeSource"),article:str("article"),articleSource:str("articleSource"),articleReason:str("articleReason"),articleConfidence:str("articleConfidence"),knp:str("knp"),bankRef:str("bankRef"),debit:str("debit"),credit:str("credit"),debitSource:str("debitSource"),creditSource:str("creditSource"),debitReason:str("debitReason"),creditReason:str("creditReason"),
        bin:str("bin"),sourceDoc:str("sourceDoc"),docNumber:str("docNumber"),sourceSheet:str("sourceSheet"),
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
      selected=ops[0]?.id??null;
      fileLabel=String(parsed.fileLabel||"Черновик").slice(0,200);
      balances=Array.isArray(parsed.balances)?parsed.balances:[];
      if(ops.length) toast("Восстановлен черновик текущей вкладки: "+ops.length+" операций");
    }catch{try{sessionStorage.removeItem(sessionKey);}catch{}}
  }
  function recomputeArticle(x) {
    // Never overwrite a choice explicitly saved by the accountant.
    if(x.articleSource==="manual")return false;
    const proposal=C.suggestArticleDetailed(x.purpose,x.direction,x.knp,x.originalName||x.name);
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
  function currentRows(){
    const query=C.norm($("search").value);
    const date=C.dateText($("checkDate").value);
    return ops.filter(x=>(filter==="all"||x.status===filter)&&(directionFilter==="all"||x.direction===directionFilter)&&
      (!date||x.date===date)&&
      (!query||C.norm([x.name,x.originalName,x.purpose,x.article,x.bin,x.docNumber,x.date].join(" ")).includes(query)));
  }
  function updateStats(visible){
    const ready=ops.filter(x=>x.status==="ready").length;
    const detected=ops.filter(x=>x.status==="detected").length;
    const review=ops.filter(x=>x.status==="review").length;
    $("allChip").textContent=ops.length;
    $("detectedChip").textContent=detected;
    $("reviewChip").textContent=review;
    $("readyChip").textContent=ready;
    $("directionAllChip").textContent=ops.length;
    $("outgoingChip").textContent=ops.filter(x=>x.direction==="Исходящее").length;
    $("incomingChip").textContent=ops.filter(x=>x.direction==="Входящее").length;
    const t=C.totals(visible);
    $("filteredTotal").textContent=fmt(t.incoming);
    $("outgoingTotal").textContent=fmt(t.outgoing);
    $("netTotal").textContent=fmt(t.net);
    $("filteredCount").textContent=t.count;
    $("filteredTotalLabel").textContent="Поступления по фильтру";
    const pendingCount=ops.length-ready;
    $("bottomMessage").textContent=!ops.length?"Загрузите банковскую выписку, чтобы начать работу.":
      "Реквизиты заполнены: "+ready+" из "+ops.length+". "+
      (pendingCount>0?"Ещё "+pendingCount+" операций требуют заполнения. ":"")+
      "Перед переносом обязательно сверьте Дт/Кт, ДДС и документы с 1С.";
    const statusIcon=$("bottomStatusIcon").querySelector("use");
    if(statusIcon)statusIcon.setAttribute("href","#ic-alert");
    $("bottomStatusIcon").parentElement.classList.add("pending");
    $("export").disabled=!downloadsEnabled || ops.length===0;
    $("saveDraftFile").disabled=!downloadsEnabled;
    $("preview").disabled=ops.length===0;
    $("editorPanel").hidden=ops.length===0;
    ["openingBalance","closingBalance"].forEach((id,index)=>{
      const value=$(id);
      if(!value)return;
      const amount=balances[index];
      value.textContent=Number.isFinite(amount)?formatBalance.format(amount):"—";
    });
    if($("statementBalances"))$("statementBalances").hidden=!fileLabel;
    $("tableCaption").textContent=fileLabel||"Операции";
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
    toast(x[side]?"Счёт "+(side==="debit"?"Дт":"Кт")+" "+x[side]+" сохранён":"Счёт "+(side==="debit"?"Дт":"Кт")+" очищен");
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

  function render(){
    const visible=currentRows();
    updateStats(visible);
    const shown=visible.slice(0,400);
    $("rows").innerHTML=shown.length?shown.map(x=>
      '<tr data-id="'+x.id+'" class="'+(x.id===selected?"selected":"")+'">'+
      '<td>'+show(x.date||"Проверить дату")+'</td>'+
      '<td>'+show(x.direction==="Входящее"?"Входящие":x.direction==="Исходящее"?"Исходящие":"Не определено")+'</td>'+
      '<td><strong>'+show(x.name||"Не указан")+'</strong>'+(x.possibleDuplicate&&!x.duplicateConfirmed?'<div class="notice">Возможный дубль</div>':"")+'</td>'+
      '<td class="amount">'+fmt(x.amount)+'</td>'+
      '<td class="account-cell">'+accountPicker(x,"debit")+'</td>'+
      '<td class="account-cell">'+accountPicker(x,"credit")+'</td>'+
      '<td>'+show(x.article||"Не указана")+'</td>'+
      '<td>'+show(x.docType||"Не выбран")+'</td>'+
      '<td><span class="pill '+(x.status==="ready"?"info":x.status==="detected"?"info":"warn")+'">'+
      (x.status==="ready"?"Реквизиты заполнены":x.status==="detected"?"Документ определён":"Проверить")+"</span></td></tr>"
    ).join(""):'<tr><td colspan="9" class="empty">Операции не найдены</td></tr>';
    syncTableScrollWidth();
    $("shownCount").textContent=ops.length?"Показано "+shown.length+" из "+visible.length+" по фильтру (всего "+ops.length+")":"Операций пока нет";

    if($("clearDateFilter"))$("clearDateFilter").hidden=!$("checkDate").value;
    if(!$("previewPanel").hidden)renderPreview();
  }

  // Event delegation survives table rerenders and avoids opening the right
  // editor when selecting a ledger account inside a cell.
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
    selected=Number(row.dataset.id);
    loadEditor();render();
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
    if(!x){$("operationNumber").textContent="";$("operationMeta").textContent="";return;}
    $("operationNumber").textContent="№ "+String(ops.indexOf(x)+1).padStart(3,"0");
    $("operationMeta").textContent=(x.date||"Дата не определена")+" · "+fmt(x.amount)+(x.docNumber?" · Документ "+x.docNumber:"");
    const match=x.date?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    $("editDate").value=match?match[3]+"-"+match[2]+"-"+match[1]:"";
    $("editAmount").value=Number(x.amount)||"";
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
  }
  $("editForm").addEventListener("submit",event=>{
    event.preventDefault();
    const x=ops.find(v=>v.id===selected);
    if(!x)return;
    x.date=C.dateText($("editDate").value);
    x.amount=Math.round(Number($("editAmount").value)*100)/100;
    if(!Number.isFinite(x.amount)||x.amount<=0){toast("Укажите корректную положительную сумму");return;}
    x.name=C.fixTengeText($("counterparty").value.trim().slice(0,300));
    x.originalName=x.name;
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
    C.markDuplicates(ops);
    render();loadEditor();scheduleSave();
    toast(x.status==="ready"?"Реквизиты заполнены. Проводку необходимо сверить с 1С.":"Изменения сохранены. Проверьте оставшиеся поля или возможный дубль.");
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
  $("reset").addEventListener("click",loadEditor);
  $("search").addEventListener("input",render);
  $("reclassifyDDS").addEventListener("click",()=>{
    if(!ops.length){toast("Сначала загрузите выписку");return;}
    const eligible=ops.filter(x=>x.articleSource!=="manual");
    const changed=eligible.filter(recomputeArticle).length;
    const documentUpdates=ops.filter(C.refreshSuggestedDocument).length;
    C.markDuplicates(ops);loadEditor();render();scheduleSave();
    toast("ДДС обновлено: "+changed+"; типов документов обновлено: "+documentUpdates+". Ручные значения сохранены.");
  });
  document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
    filter=button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("active",b===button));render();
  }));
  document.querySelectorAll("[data-direction]").forEach(button=>button.addEventListener("click",()=>{
    directionFilter=button.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach(b=>b.classList.toggle("active",b===button));render();
  }));
  $("checkDate").addEventListener("change",render);
  $("clearDateFilter")?.addEventListener("click",()=>{
    $("checkDate").value="";
    render();
    $("checkDate").focus();
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
  $("preview").addEventListener("click",()=>{
    if(!ops.length)return;
    $("previewPanel").hidden=!$("previewPanel").hidden;
    if(!$("previewPanel").hidden)renderPreview();
  });
  const download=(data,name,mime)=>{
    const blob=new Blob([data],{type:mime});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  };
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
    const headers=["№","Дата","Направление","Контрагент","БИН/ИИН","Назначение платежа","Сумма, ₸","Статья ДДС","Основание подбора ДДС","КНП","Документ 1С","Вид операции в 1С (предложение)","Дебет","Кредит","Номер документа","Статус","Что проверить","Лист источника"];
    const rows=ops.map((x,i)=>[i+1,x.date,x.direction,safeText(x.name),safeText(x.bin),safeText(x.purpose),Number(x.amount),safeText(x.article),safeText(x.articleReason),safeText(x.knp),x.docType,safeText(C.suggestDocumentOperation(x.article,x.docType)),x.debit,x.credit,safeText(x.docNumber),
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
  $("saveDraftFile").addEventListener("click",()=>{
    if(!downloadsEnabled)return;
    if(!ops.length){toast("Нет операций для сохранения");return;}
    const data=JSON.stringify({version:2,fileLabel,balances,savedAt:new Date().toISOString(),ops},null,2);
    download(data,"STOLDOM_черновик_"+new Date().toISOString().slice(0,10)+".json","application/json;charset=utf-8");
  });
  $("restoreDraftFile").addEventListener("click",()=>$("draftInput").click());
  $("draftInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try{
      if(file.size>20*1024*1024)throw Error("Черновик слишком большой");
      const data=JSON.parse(await file.text());
      if(data.version!==2)throw Error("Этот формат черновика не поддерживается");
      ops=sanitizeImported(data.ops);ops.forEach(recomputeArticle);ops.forEach(C.refreshSuggestedDocument);ops.forEach(C.refreshSuggestedPosting);C.markDuplicates(ops);
      selected=ops[0]?.id??null;fileLabel=String(data.fileLabel||file.name).slice(0,200);
      balances=Array.isArray(data.balances)?data.balances:[];
      filter="all";directionFilter="all";resetFilters();
      loadEditor();render();scheduleSave();toast("Черновик загружен: "+ops.length+" операций");
    }catch(err){toast(err.message||"Ошибка открытия черновика");}
    e.target.value="";
  });
  $("clearDraft").addEventListener("click",()=>{
    if(!ops.length)return;
    if(!confirm("Очистить текущие операции?"))return;
    ops=[];balances=[];selected=null;fileLabel="";filter="all";directionFilter="all";resetFilters();
    try{sessionStorage.removeItem(sessionKey);}catch{}
    loadEditor();render();toast("Данные текущей вкладки очищены");
  });
  function resetFilters(){
    $("search").value="";
    $("checkDate").value="";
    document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
    document.querySelectorAll("[data-direction]").forEach(x=>x.classList.toggle("active",x.dataset.direction==="all"));
  }
  function collectStatementBalances(rows, values){
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
  async function readStatement(file){
    if(!window.XLSX)throw Error("Библиотека Excel не загрузилась. Проверьте соединение и обновите страницу.");
    const ext=file.name.split(".").pop().toLowerCase();
    let book;
    if(ext==="csv"||ext==="txt")book=XLSX.read(await file.text(),{type:"string",cellDates:true});
    else book=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    const all=[];
    const balanceValues=balanceLabels.map(()=>new Set());
    for(const sheet of book.SheetNames){
      const rows=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:"",raw:true});
      all.push(...C.parseRows(rows,sheet));
      collectStatementBalances(rows,balanceValues);
      if(all.length>20000)throw Error("Слишком много операций (максимум 20 000)");
    }
    if(!all.length)throw Error("В файле не найдена таблица операций с колонками «Дата» и «Сумма/Дебет/Кредит»");
    return {operations:all,balances:balanceValues.map(values=>values.size===1?[...values][0]:null)};
  }
  $("fileInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try{
      if(!/\.(xlsx|xls|csv|txt)$/i.test(file.name))throw Error("Поддерживаются только XLSX, XLS, CSV и TXT");
      if(file.size>20*1024*1024)throw Error("Файл больше 20 МБ");
      const data=await readStatement(file);
      ops=data.operations.map((x,i)=>({...x,id:i+1}));C.markDuplicates(ops);
      balances=data.balances;
      selected=ops[0].id;fileLabel=file.name;filter="all";directionFilter="all";resetFilters();
      loadEditor();render();scheduleSave();
      toast("Загружено "+ops.length+" операций. Требуют проверки: "+ops.filter(x=>x.status!=="ready").length);
    }catch(err){toast(err.message||"Ошибка чтения файла");}
    e.target.value="";
  });
  initTableScroll();
  restoreDraft();loadEditor();render();
})();