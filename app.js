/* STOLDOM.SITE browser workspace. Bank files remain on the user's device. */
(() => {
  "use strict";
  const C=window.STOLDOM_CORE;
  if(!C){console.error("STOLDOM rules could not load");return;}
  const $=id=>document.getElementById(id);
  const fmt=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n)||0)+" ₸";
  const show=x=>C.escapeHtml(x);
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
      sessionStorage.setItem(sessionKey, JSON.stringify({version:2,ops,fileLabel,savedAt:new Date().toISOString()}));
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
        docType:str("docType"),docTypeSource:str("docTypeSource"),article:str("article"),articleSource:str("articleSource"),articleReason:str("articleReason"),articleConfidence:str("articleConfidence"),knp:str("knp"),bankRef:str("bankRef"),debit:str("debit"),credit:str("credit"),
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
      C.markDuplicates(ops);
      selected=ops[0]?.id??null;
      fileLabel=String(parsed.fileLabel||"Черновик").slice(0,200);
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
    x.status=C.validateOperation(x);
    return changed||docChanged;
  }
  function currentRows(){
    const query=C.norm($("search").value);
    return ops.filter(x=>(filter==="all"||x.status===filter)&&(directionFilter==="all"||x.direction===directionFilter)&&
      (!query||C.norm([x.name,x.originalName,x.purpose,x.article,x.bin,x.docNumber,x.date].join(" ")).includes(query)));
  }
  function updateStats(visible){
    const ready=ops.filter(x=>x.status==="ready").length;
    const detected=ops.filter(x=>x.status==="detected").length;
    const review=ops.filter(x=>x.status==="review").length;
    $("totalCount").textContent=ops.length;
    $("detectedCount").textContent=detected+ready;
    $("reviewCount").textContent=review;
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
    const complete=ops.length>0&&pendingCount===0;
    $("bottomMessage").textContent=!ops.length?"Загрузите банковскую выписку, чтобы начать работу.":
      "Заполнены необходимые реквизиты: "+ready+" из "+ops.length+". "+
      (pendingCount>0?"Остальные операции требуют проверки.":"Сверьте Excel с учётными данными перед переносом в 1С.");
    $("bottomStatusIcon").textContent=complete?"✓":"!";
    $("bottomStatusIcon").parentElement.classList.toggle("pending",!complete);
    $("export").disabled=ops.length===0;
    $("preview").disabled=ops.length===0;
    $("editorPanel").hidden=ops.length===0;
    $("tableCaption").textContent=fileLabel||"Операции";
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
      '<td class="amount">'+fmt(x.amount)+'</td><td>'+show(x.article||"Не указана")+'</td>'+
      '<td>'+show(x.docType||"Не выбран")+'</td>'+
      '<td><span class="pill '+(x.status==="ready"?"good":x.status==="detected"?"info":"warn")+'">'+
      (x.status==="ready"?"Готово":x.status==="detected"?"Документ определён":"Проверить")+"</span></td></tr>"
    ).join(""):'<tr><td colspan="7" class="empty">Операции не найдены</td></tr>';
    $("shownCount").textContent=ops.length?"Показано "+shown.length+" из "+visible.length+" по фильтру (всего "+ops.length+")":"Операций пока нет";
    $("rows").querySelectorAll("tr[data-id]").forEach(tr=>tr.addEventListener("click",()=>{
      selected=Number(tr.dataset.id);loadEditor();render();
    }));
    if(!$("dateCheckPanel").hidden&&$("checkDate").value)renderDateCheck();
    if(!$("previewPanel").hidden)renderPreview();
  }
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
    x.debit=$("debit").value.trim();x.credit=$("credit").value.trim();
    x.direction=$("operationDirection").value;x.docType=$("docType").value;
    x.docTypeSource="manual";
    x.duplicateConfirmed=$("confirmDuplicate").checked;
    C.markDuplicates(ops);
    render();loadEditor();scheduleSave();
    toast(x.status==="ready"?"Операция готова для подготовки файла":"Изменения сохранены. Проверьте оставшиеся поля или возможный дубль.");
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
  $("toggleDateCheck").addEventListener("click",()=>{
    $("dateCheckPanel").hidden=!$("dateCheckPanel").hidden;
    if(!$("dateCheckPanel").hidden)$("checkDate").focus();
  });
  function renderDateCheck(){
    const raw=$("checkDate").value;
    if(!raw)return;
    const date=C.dateText(raw),direction=$("checkDirection").value;
    const found=ops.filter(x=>x.date===date&&(direction==="all"||x.direction===direction));
    const t=C.totals(found);
    const rows=found.map(x=>'<tr><td>'+show(x.name)+'</td><td>'+show(x.purpose)+'</td><td>'+fmt(x.amount)+'</td></tr>').join("");
    $("dateCheckResult").innerHTML=
      '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px">'+
      '<div><span class="muted">Операций</span><div style="font-size:22px;font-weight:800">'+t.count+'</div></div>'+
      '<div><span class="muted">Поступления</span><div style="font-size:22px;font-weight:800">'+fmt(t.incoming)+'</div></div>'+
      '<div><span class="muted">Списания</span><div style="font-size:22px;font-weight:800">'+fmt(t.outgoing)+'</div></div>'+
      '<div><span class="muted">Разница</span><div style="font-size:22px;font-weight:800">'+fmt(t.net)+'</div></div></div>'+
      (rows?'<div class="tablewrap"><table style="min-width:560px"><thead><tr><th>Контрагент</th><th>Назначение</th><th>Сумма</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
      '<div class="empty">За '+show(date)+' операций выбранного типа нет.</div>');
  }
  $("runDateCheck").addEventListener("click",()=>{
    if(!$("checkDate").value){toast("Выберите дату");return;}renderDateCheck();
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
      !["Платёжное поручение исходящее","РКО","Списание с расчётного счёта"].includes(x.docType)&&x.direction==="Исходящее")a.push("Направление не совпадает с документом 1С");
    if(x.article==="Банковские комиссии" && x.direction==="Исходящее" &&
       x.docType==="Платёжное поручение исходящее")
      a.push("Комиссия банка: проверьте платёжный ордер (списание денежных средств)");
    if(x.docType==="ПКО"&&x.debit!=="1010")a.push("Для ПКО проверьте счёт дебета 1010");
    if(x.docType==="РКО"&&x.credit!=="1010")a.push("Для РКО проверьте счёт кредита 1010");
    if(x.possibleDuplicate&&!x.duplicateConfirmed)a.push("Возможный дубль");
    return a;
  }
  function renderPreview(){
    const review=ops.filter(x=>x.status!=="ready");
    $("previewContent").innerHTML='<p><strong>Всего: '+ops.length+
      ' · Готовы: '+ops.filter(x=>x.status==="ready").length+
      ' · Нужна проверка: '+review.length+'</strong></p>'+
      '<p class="notice">Предварительная подготовка: Excel не является проверенным форматом прямой загрузки в 1С. Сверьте счета и ДДС перед использованием.</p>'+
      (review.length?'<div class="tablewrap"><table><thead><tr><th>№</th><th>Контрагент</th><th>Что проверить</th></tr></thead><tbody>'+
      review.slice(0,100).map(x=>'<tr><td>'+String(ops.indexOf(x)+1)+'</td><td>'+show(x.name)+'</td><td>'+show(issues(x).join(", "))+'</td></tr>').join("")+
      '</tbody></table></div>':"<p>Все операции заполнены для подготовки файла. Проверьте реквизиты и сопоставление с 1С.</p>");
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
    if(!ops.length)return;
    if(!window.XLSX){toast("Не удалось загрузить библиотеку Excel");return;}
    const headers=["№","Дата","Направление","Контрагент","БИН/ИИН","Назначение платежа","Сумма, ₸","Статья ДДС","Основание подбора ДДС","КНП","Документ 1С","Вид операции в 1С (предложение)","Дебет","Кредит","Номер документа","Статус","Что проверить","Лист источника"];
    const rows=ops.map((x,i)=>[i+1,x.date,x.direction,safeText(x.name),safeText(x.bin),safeText(x.purpose),Number(x.amount),safeText(x.article),safeText(x.articleReason),safeText(x.knp),x.docType,safeText(C.suggestDocumentOperation(x.article,x.docType)),x.debit,x.credit,safeText(x.docNumber),
      x.status==="ready"?"Готово":"Проверить",issues(x).join("; "),safeText(x.sourceSheet)]);
    const workbook=XLSX.utils.book_new();
    function sheet(name,data,widths){
      const ws=XLSX.utils.aoa_to_sheet(data);
      ws["!cols"]=(widths||[8,14,18,28,17,56,18,25,50,10,44,50,11,11,18,17,50,20]).map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(workbook,ws,name);
    }
    sheet("Все операции",[headers,...rows]);
    sheet("Готовые",[headers,...rows.filter((r,i)=>ops[i].status==="ready")]);
    sheet("На проверку",[headers,...rows.filter((r,i)=>ops[i].status!=="ready")]);
    const t=C.totals(ops);
    sheet("Контроль",[["Показатель","Значение"],["Количество",t.count],["Поступления",t.incoming],["Списания",t.outgoing],["Чистое движение",t.net],
      ["Готово",ops.filter(x=>x.status==="ready").length],["Требуют проверки",ops.filter(x=>x.status!=="ready").length],
      ["Примечание","Это контрольный Excel, не файл прямого обмена с 1С."]],[32,72]);
    try{
      XLSX.writeFile(workbook,"STOLDOM_подготовка_1С_"+new Date().toISOString().slice(0,10)+".xlsx",{compression:true});
      toast("Excel сформирован. Для прямой загрузки в 1С потребуется согласованный формат обмена.");
    }catch(e){toast("Не удалось сформировать Excel: "+e.message);}
  });
  $("saveDraftFile").addEventListener("click",()=>{
    if(!ops.length){toast("Нет операций для сохранения");return;}
    const data=JSON.stringify({version:2,fileLabel,savedAt:new Date().toISOString(),ops},null,2);
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
      ops=sanitizeImported(data.ops);ops.forEach(recomputeArticle);ops.forEach(C.refreshSuggestedDocument);C.markDuplicates(ops);
      selected=ops[0]?.id??null;fileLabel=String(data.fileLabel||file.name).slice(0,200);
      filter="all";directionFilter="all";resetFilters();
      loadEditor();render();scheduleSave();toast("Черновик загружен: "+ops.length+" операций");
    }catch(err){toast(err.message||"Ошибка открытия черновика");}
    e.target.value="";
  });
  $("clearDraft").addEventListener("click",()=>{
    if(!ops.length)return;
    if(!confirm("Очистить текущие операции? Сначала можно скачать черновик."))return;
    ops=[];selected=null;fileLabel="";filter="all";directionFilter="all";resetFilters();
    try{sessionStorage.removeItem(sessionKey);}catch{}
    loadEditor();render();toast("Данные текущей вкладки очищены");
  });
  function resetFilters(){
    $("search").value="";
    document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
    document.querySelectorAll("[data-direction]").forEach(x=>x.classList.toggle("active",x.dataset.direction==="all"));
  }
  async function readStatement(file){
    if(!window.XLSX)throw Error("Библиотека Excel не загрузилась. Проверьте соединение и обновите страницу.");
    const ext=file.name.split(".").pop().toLowerCase();
    let book;
    if(ext==="csv"||ext==="txt")book=XLSX.read(await file.text(),{type:"string",cellDates:true});
    else book=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    const all=[];
    for(const sheet of book.SheetNames){
      const rows=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:"",raw:true});
      all.push(...C.parseRows(rows,sheet));
      if(all.length>20000)throw Error("Слишком много операций (максимум 20 000)");
    }
    if(!all.length)throw Error("В файле не найдена таблица операций с колонками «Дата» и «Сумма/Дебет/Кредит»");
    return all;
  }
  $("fileInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try{
      if(!/\.(xlsx|xls|csv|txt)$/i.test(file.name))throw Error("Поддерживаются только XLSX, XLS, CSV и TXT");
      if(file.size>20*1024*1024)throw Error("Файл больше 20 МБ");
      const data=await readStatement(file);
      ops=data.map((x,i)=>({...x,id:i+1}));C.markDuplicates(ops);
      selected=ops[0].id;fileLabel=file.name;filter="all";directionFilter="all";resetFilters();
      loadEditor();render();scheduleSave();
      toast("Загружено "+ops.length+" операций. Требуют проверки: "+ops.filter(x=>x.status!=="ready").length);
    }catch(err){toast(err.message||"Ошибка чтения файла");}
    e.target.value="";
  });
  restoreDraft();loadEditor();render();
})();