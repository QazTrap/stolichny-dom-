/* STOLDOM: local-only, manually entered reconciliation draft.
   Does NOT read 1C ledgers or claim to be a completed two-sided act. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const dlg=$("reconciliationDialog"), form=$("reconForm");
  if(!dlg||!form)return;
  const rows=$("reconRows"), preview=$("reconPreview"), printButton=$("reconPrint");
  const money=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+" ₸";
  const dateText=iso=>{
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||"");
    return m?`${m[3]}.${m[2]}.${m[1]}`:String(iso||"");
  };
  function elem(tag,text,cls){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  }
  function addRow(){
    const row=document.createElement("div");
    row.className="recon-input-row";
    row.innerHTML='<label>Дата<input type="date" data-recon="date" aria-label="Дата документа"></label>'+
      '<label>Документ<input type="text" data-recon="document" maxlength="250" placeholder="№ и наименование" aria-label="Документ"></label>'+
      '<label>Дебет, ₸<input type="number" data-recon="debit" min="0" step="0.01" placeholder="0,00" aria-label="Дебет"></label>'+
      '<label>Кредит, ₸<input type="number" data-recon="credit" min="0" step="0.01" placeholder="0,00" aria-label="Кредит"></label>'+
      '<button type="button" class="recon-remove" data-recon-remove aria-label="Удалить строку">×</button>';
    row.querySelector("[data-recon-remove]").addEventListener("click",()=>{
      if(rows.children.length>1)row.remove();
      else row.querySelectorAll("input").forEach(input=>input.value="");
      invalidate();
    });
    rows.append(row);
  }
  function invalidate(){
    preview.hidden=true;
    printButton.hidden=true;
  }
  function fillContext(){
    const company=$("companyNameFull")?.textContent?.trim()||"";
    if(company&&!/^(не указано|не указан|компания не указана)$/i.test(company))
      $("reconOrganization").value=company;
    const source=$("counterpartyFilter");
    const suggestions=$("reconCounterparties");
    suggestions.replaceChildren();
    const unique=new Set();
    Array.from(source?.options||[]).forEach(option=>{
      const name=option.textContent.trim();
      if(!option.value||!name||unique.has(name))return;
      unique.add(name);
      const item=elem("option");
      item.value=name;
      suggestions.append(item);
    });
  }
  $("openReconciliation").addEventListener("click",()=>{
    fillContext();
    if(!rows.children.length)addRow();
    if(!dlg.open)dlg.showModal();
  });
  $("reconClose").addEventListener("click",()=>dlg.close());
  $("reconAddRow").addEventListener("click",()=>{addRow();invalidate();});
  form.addEventListener("input",invalidate);
  form.addEventListener("change",invalidate);
  $("reconPrint").addEventListener("click",()=>{if(!preview.hidden)window.print();});
  form.addEventListener("submit",event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    const from=$("reconFrom").value,to=$("reconTo").value;
    if(from>to){$("reconFeedback").textContent="Дата начала должна быть раньше даты окончания.";return;}
    const openingDebit=Number($("reconOpeningDebit").value||0);
    const openingCredit=Number($("reconOpeningCredit").value||0);
    if(![openingDebit,openingCredit].every(n=>Number.isFinite(n)&&n>=0) || (openingDebit>0&&openingCredit>0)){
      $("reconFeedback").textContent="Укажите одно начальное сальдо — дебетовое или кредитовое.";return;
    }
    const entries=[];
    for(const row of rows.children){
      const get=key=>row.querySelector('[data-recon="'+key+'"]').value.trim();
      const date=get("date"),documentName=get("document");
      const debitText=get("debit"),creditText=get("credit");
      if(!date&&!documentName&&!debitText&&!creditText)continue;
      const debit=debitText?Number(debitText):0,credit=creditText?Number(creditText):0;
      if(!date||!documentName||!Number.isFinite(debit)||!Number.isFinite(credit)||debit<0||credit<0||
         (debit>0&&credit>0)||(debit===0&&credit===0)){
        $("reconFeedback").textContent="Заполните дату, документ и одну сумму (дебет или кредит) в каждой строке.";return;
      }
      if(date<from||date>to){
        $("reconFeedback").textContent="Дата документа должна входить в выбранный период.";return;
      }
      entries.push({date,documentName,debit,credit});
    }
    if(!entries.length){$("reconFeedback").textContent="Добавьте хотя бы один документ из регистров взаиморасчётов.";return;}
    $("reconFeedback").textContent="";
    entries.sort((a,b)=>a.date.localeCompare(b.date));
    const debitTotal=entries.reduce((s,x)=>s+x.debit,0),creditTotal=entries.reduce((s,x)=>s+x.credit,0);
    const balance=openingDebit-openingCredit+debitTotal-creditTotal;
    const result=elem("div",undefined,"recon-paper");
    result.append(elem("h2","Акт сверки взаимных расчётов — ЧЕРНОВИК"));
    result.append(elem("p","Период: с "+dateText(from)+" по "+dateText(to)));
    result.append(elem("p","По данным организации: "+$("reconOrganization").value.trim()));
    result.append(elem("p","Контрагент: "+$("reconCounterparty").value.trim()));
    result.append(elem("p","Счёт учёта: "+$("reconAccount").value.trim()));
    if($("reconContract").value.trim())result.append(elem("p","Договор: "+$("reconContract").value.trim()));
    result.append(elem("p","Данные второй стороны не получены. Не является согласованным актом.","recon-warning"));
    const table=elem("table");
    const thead=elem("thead"),headrow=elem("tr");
    ["Дата","Документ","Дебет, ₸","Кредит, ₸"].forEach(label=>headrow.append(elem("th",label)));
    thead.append(headrow);table.append(thead);
    const tbody=elem("tbody");
    const makeRow=(date,desc,debit,credit)=>{
      const tr=elem("tr");
      [date,desc,debit,credit].forEach(value=>tr.append(elem("td",value)));
      return tr;
    };
    tbody.append(makeRow("—","Сальдо на начало периода",money(openingDebit),money(openingCredit)));
    entries.forEach(x=>tbody.append(makeRow(dateText(x.date),x.documentName,x.debit?money(x.debit):"—",x.credit?money(x.credit):"—")));
    tbody.append(makeRow("—","Обороты за период",money(debitTotal),money(creditTotal)));
    tbody.append(makeRow("—","Сальдо на конец периода",balance>0?money(balance):"—",balance<0?money(-balance):"—"));
    table.append(tbody);result.append(table);
    result.append(elem("p",balance===0?"Конечное сальдо: 0,00 ₸":("Конечное сальдо: "+money(Math.abs(balance))+" ("+(balance>0?"дебетовое":"кредитовое")+")")));
    result.append(elem("p","Документы и суммы введены вручную. Перед подписанием проверьте счёт учёта, аналитику, обороты, первичные документы, начало периода и данные контрагента.","recon-warning"));
    result.append(elem("p","От организации: __________________    От контрагента: __________________","recon-signatures"));
    preview.replaceChildren(result);
    preview.hidden=false;
    printButton.hidden=false;
    preview.scrollIntoView({block:"nearest",behavior:"smooth"});
  });
})();
