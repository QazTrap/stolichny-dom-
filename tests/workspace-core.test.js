"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const C=require("../workspace-core.js");


test("keeps bank comment separate from payment purpose",()=>{
  const rows=[
    ["Дата","Дебет","Назначение платежа","Комментарий","Получатель"],
    ["21.11.2026","1000","Оплата за товар","Перевод с Alatau на другой счёт","ТОО Получатель"]
  ];
  const [operation]=C.parseRows(rows,"Тест");
  assert.equal(operation.purpose,"Оплата за товар");
  assert.equal(operation.comment,"Перевод с Alatau на другой счёт");
});

test("filters a yearly bank statement by a whole month or single day",()=>{
  const rows=[
    {date:"31.12.2025",amount:120,direction:"Исходящее"},
    {date:"01.01.2026",amount:100,direction:"Входящее"},
    {date:"15.03.2026",amount:250,direction:"Исходящее"},
    {date:"31.03.2026",amount:300,direction:"Входящее"},
    {date:"01.04.2026",amount:400,direction:"Исходящее"},
    {date:"",amount:999,direction:"Входящее"}
  ];
  const march=C.filterPeriod(rows,{month:"2026-03"});
  assert.deepEqual(march.map(x=>x.amount),[250,300]);
  assert.deepEqual(C.totals(march),{incoming:300,outgoing:250,net:50,count:2,unknown:0});
  assert.deepEqual(C.filterPeriod(rows,{date:"15.03.2026"}).map(x=>x.amount),[250]);
  assert.deepEqual(C.filterPeriod(rows,{month:"2026-03",date:"31.03.2026"}).map(x=>x.amount),[300]);
  assert.deepEqual(C.filterPeriod(rows,{month:"2026-02"}),[]);
  assert.equal(C.filterPeriod(rows,{}),rows);
  assert.equal(rows.length,6,"source operations must remain unchanged");
});

test("filters an annual statement by arbitrary inclusive date range",()=>{
  const rows=[
    {date:"31.12.2025",amount:8,direction:"Исходящее"},
    {date:"01.01.2026",amount:10,direction:"Входящее"},
    {date:"01.03.2026",amount:100,direction:"Входящее"},
    {date:"15.03.2026",amount:40,direction:"Исходящее"},
    {date:"30.04.2026",amount:70,direction:"Исходящее"},
    {date:"01.05.2026",amount:55,direction:"Входящее"},
    {date:"",amount:999,direction:"Входящее"}
  ];
  const spring=C.filterPeriod(rows,{from:"2026-03-01",to:"2026-04-30"});
  assert.deepEqual(spring.map(x=>x.amount),[100,40,70]);
  assert.deepEqual(C.totals(spring),{incoming:100,outgoing:110,net:-10,count:3,unknown:0});
  assert.deepEqual(C.filterPeriod(rows,{from:"2025-12-31",to:"2026-01-01"}).map(x=>x.amount),[8,10]);
  assert.deepEqual(C.filterPeriod(rows,{from:"2026-03-15",to:"2026-03-15"}).map(x=>x.amount),[40]);
  assert.deepEqual(C.filterPeriod(rows,{from:"2026-06-01",to:"2026-06-30"}),[]);
  assert.deepEqual(C.filterPeriod(rows,{month:"2026-03",from:"2026-03-01",to:"2026-04-30"}).map(x=>x.amount),[100,40]);
  assert.equal(rows.length,7);
});

test("reads outgoing and incoming bank statement columns",()=>{
  const rows=[
    ["Дата","Дебет","Кредит","Получатель","Плательщик","Назначение платежа","Номер документа"],
    ["20.11.2026","1 200,50","","Товарищество с ограниченной ответственностью Ромашка","ИП Плательщик","Оплата за услуги","115"],
    ["20.11.2026","","2 500,25","ИП Получатель","Акционерное общество Клиент","Оплата по счету","116"]
  ];
  const data=C.parseRows(rows,"Ноябрь");
  assert.equal(data.length,2);
  assert.equal(data[0].direction,"Исходящее");
  assert.equal(data[0].name,"ТОО Ромашка");
  assert.equal(data[0].amount,1200.5);
  assert.equal(data[0].article,"Оплата поставщику");
  assert.equal(data[1].direction,"Входящее");
  assert.equal(data[1].name,"АО Клиент");
  assert.equal(data[1].article,"Оплата от покупателя");
  assert.equal(data[1].sourceSheet,"Ноябрь");
});
test("identifies tax abbreviations in Cyrillic and pension contributions",()=>{
  assert.equal(C.suggestArticle("Уплата НДС за 3 квартал","Исходящее"),"Налоги и отчисления");
  assert.equal(C.suggestArticle("Перечисление ОПВ за октябрь","Исходящее"),"Налоги и отчисления");
  assert.equal(C.suggestArticle("Взносы ВОСМС за сотрудника","Исходящее"),"Налоги и отчисления");
  assert.equal(C.suggestArticle("Комиссия банка","Исходящее"),"Банковские комиссии");
});
test("keeps incoming and outgoing amounts separate for reconciliation",()=>{
  const value=C.totals([{direction:"Входящее",amount:1000.15},{direction:"Исходящее",amount:150.1},{direction:"",amount:25}]);
  assert.deepEqual(value,{incoming:1000.15,outgoing:150.1,net:850.05,count:3,unknown:1});
});
test("does not guess direction from an unsigned amount",()=>{
  const data=C.parseRows([["Дата","Сумма","Назначение платежа"],["2026-11-20",50000,"Оплата"]]);
  assert.equal(data.length,1);
  assert.equal(data[0].direction,"");
  assert.equal(data[0].status,"review");
});
test("flags matching bank operations but never silently removes them",()=>{
  const row={date:"20.11.2026",direction:"Исходящее",amount:7500,originalName:"ТОО Тест",name:"ТОО Тест",purpose:"Аренда",docNumber:"77",docType:"Платёжное поручение исходящее",article:"Аренда",debit:"7210",credit:"1030",duplicateConfirmed:false};
  const a={...row,id:1},b={...row,id:2};
  C.markDuplicates([a,b]);
  assert.equal(a.possibleDuplicate,true);
  assert.equal(b.possibleDuplicate,true);
  assert.equal(a.status,"review");
  b.duplicateConfirmed=true;
  C.markDuplicates([a,b]);
  assert.equal(b.status,"ready");
  assert.equal(a.status,"review");
});
test("different bank document numbers are not flagged as duplicates",()=>{
  const row={date:"20.11.2026",direction:"Исходящее",amount:7500,name:"ТОО Тест",purpose:"Аренда"};
  const a={...row,docNumber:"77"},b={...row,docNumber:"78"};
  C.markDuplicates([a,b]);
  assert.equal(a.possibleDuplicate,false);
  assert.equal(b.possibleDuplicate,false);
});
test("rejects wrong 1C document direction and invalid ledger account",()=>{
  const entry={date:"20.11.2026",name:"ТОО Тест",purpose:"Оплата",amount:100,direction:"Исходящее",docType:"ПКО",article:"Оплата поставщику",debit:"3310",credit:"1030"};
  assert.equal(C.validateOperation(entry),"review");
  entry.docType="РКО";assert.equal(C.validateOperation(entry),"detected");
  entry.credit="1010";assert.equal(C.validateOperation(entry),"ready");
  entry.debit="KZ0000123";assert.equal(C.validateOperation(entry),"detected");
});
test("parses European and US amount separators",()=>{
  assert.equal(C.money("1.234,56"),1234.56);
  assert.equal(C.money("1,234.56"),1234.56);
  assert.equal(C.money("1 234,56"),1234.56);
});
test("normalizes dates and escapes untrusted workbook values",()=>{
  assert.equal(C.dateText("2026-11-20"),"20.11.2026");
  assert.equal(C.dateText("31.02.2026"),"");
  assert.equal(C.escapeHtml('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(C.shortLegalName("Индивидуальный предприниматель Сапарбаев"),"ИП Сапарбаев");
});


test("Alatau-style export uses document date and KNP, not statement generation date",()=>{
  const headings=["Дата выписки","Дата документа","Индикатор дебета/кредита","Сумма по дебету","Сумма по кредиту","КНП","Назначение платежа","Наименование контрагента"];
  const rows=[headings,
    ["2026-11-17","2026-11-02T09:37:21","DEBIT","385","","841",'Комиссия за операцию "Переводные операции в тенге" согласно тарифам банка. НДС 16%',"Тест Банк"],
    ["2026-11-17","2026-11-02T18:33:44","CREDIT","","9648880","859","Услуги погрузчика, в т.ч. НДС 16%, платежи за услуги","Тест Покупатель"],
    ["2026-11-17","2026-11-03T13:12:48","DEBIT","200000","","859","Оплата за обработку бухгалтерских и налоговых документов за октябрь","Тест Поставщик"]
  ];
  const data=C.parseRows(rows);
  assert.equal(data.length,3);
  assert.equal(data[0].date,"02.11.2026");
  assert.equal(data[0].knp,"841");
  assert.equal(data[0].article,"Банковские комиссии");
  assert.equal(data[1].article,"Оплата от покупателя");
  assert.equal(data[2].article,"Оплата поставщику");
  assert.equal(data[2].date,"03.11.2026");
});

test("separates compulsory state levies from taxes, based on Alatau statement abbreviations",()=>{
  const bankPurpose="НДС не облагается. Плата за разм нар (виз) рекл на откр простр за пред помещ в городе респ знач, столице. Начисленные (исчисленные) и иные обязательства в бюджет. Период: 08.2026";
  const rows=[
    ["Дата операции","Сумма по дебету","Сумма по кредиту","КНП","Назначение платежа","Контрагент"],
    ["07.09.2026","21625","","911",bankPurpose,"УГД по Алматинскому району"]
  ];
  const [op]=C.parseRows(rows,"Alatau City Bank");
  assert.equal(op.article,"Другие обязательные платежи в бюджет");
  assert.equal(op.articleConfidence,"review");
  assert.equal(op.debit,"3230");
  assert.equal(op.credit,"1030");
  assert.ok(op.debitReason.includes("начисленного"));
  assert.ok(C.reconciliationNotes(op).some(note=>note.includes("3230")));

  assert.equal(C.suggestArticle("Плата за размещение наружной (визуальной) рекламы","Исходящее","911","УГД Нура"),
    "Другие обязательные платежи в бюджет");
  assert.equal(C.suggestArticle("Государственная пошлина за выдачу разрешения","Исходящее","911","Казначейство"),
    "Другие обязательные платежи в бюджет");
  assert.equal(C.suggestArticle("Оплата за размещение наружной рекламы по договору","Исходящее","859","ТОО Рекламное агентство"),
    "Оплата поставщику");
  assert.equal(C.suggestArticle("Плата за размещение наружной рекламы по договору","Исходящее","859","ТОО Рекламное агентство"),
    "Оплата поставщику");
  assert.equal(C.suggestArticle("Комиссия банка за уплату госпошлины","Исходящее","841","Alatau City Bank"),
    "Банковские комиссии");
  assert.equal(C.suggestArticle("Уплата НДС за 3 квартал","Исходящее","911","УГД"),
    "Налоги и отчисления");
  const manual={...op,debit:"7210",debitSource:"manual",article:"Налоги и отчисления",articleSource:"manual"};
  C.refreshSuggestedPosting(manual);
  assert.equal(manual.debit,"7210");
  assert.equal(manual.article,"Налоги и отчисления");
});

test("does not label service fees as taxes despite embedded НДС or penalties",()=>{
  assert.equal(C.suggestArticle("Комиссия за перевод пенсионных взносов, НДС, пеня","Исходящее","841"),"Банковские комиссии");
  assert.equal(C.suggestArticle("Оплата бухгалтерских и налоговых услуг по договору","Исходящее","859"),"Оплата поставщику");
  assert.equal(C.suggestArticle("Услуги погрузчика в т.ч. НДС 16%","Входящее","859"),"Оплата от покупателя");
  assert.equal(C.suggestArticle("Приобретение фильтров для экскаватора","Исходящее","710"),"Оплата поставщику");
});

test("identifies taxes, social payments, alimony and enforcement payments by context",()=>{
  const cases=[
    ["Обязательные пенсионные взносы за октябрь","010","Налоги и отчисления"],
    ["Обязательные пенсионные взносы работодателя","089","Налоги и отчисления"],
    ["Отчисления на обязательное социальное медицинское страхование","121","Налоги и отчисления"],
    ["Взносы на обязательное социальное медицинское страхование","122","Налоги и отчисления"],
    ["Обязательные социальные отчисления","012","Налоги и отчисления"],
    ["Социальный налог, подлежащий уплате в бюджет","911","Налоги и отчисления"],
    ["Индивидуальный подоходный налог за октябрь","911","Налоги и отчисления"],
    ["Налог на добавленную стоимость, подлежащий уплате в бюджет","911","Налоги и отчисления"],
    ["Алименты за октябрь по соглашению","118","Алименты"],
    ["Оплата задолженности по исполнительному производству за октябрь","854","Исполнительные документы"]
  ];
  for(const [purpose,knp,expected] of cases)
    assert.equal(C.suggestArticle(purpose,"Исходящее",knp),expected,purpose);
});

test("does not guess cashflow articles for ambiguous KNP",()=>{
  assert.equal(C.suggestArticle("Внутреннее распоряжение","Исходящее","999"),"");
});

test("repairs Kazakh ң corrupted in bank currency text without changing other words",()=>{
  assert.equal(C.fixTengeText("Оплата в те?ге за услуги"),"Оплата в теңге за услуги");
  assert.equal(C.fixTengeText("Сумма: ТЕ�ГЕ"),"Сумма: ТЕҢГЕ");
  assert.equal(C.fixTengeText("1000 те□ге"),"1000 теңге");
  assert.equal(C.fixTengeText("Сумма в тенге; что?"),"Сумма в тенге; что?");
  const rows=[
    ["Дата","Дебет","Назначение платежа","Получатель"],
    ["20.11.2026",500,"Возврат в те?ге","ТОО Те?ге"]
  ];
  const ops=C.parseRows(rows);
  assert.equal(ops.length,1);
  assert.equal(ops[0].purpose,"Возврат в теңге");
  assert.equal(ops[0].name,"ТОО Теңге");
});


test("bank fees get a payment order (cash debit), not an outgoing payment instruction",()=>{
  const rows=[
    ["Дата","Дебет","Кредит","КНП","Назначение платежа","Контрагент"],
    ["20.11.2026","350","","841","Комиссия за перевод согласно тарифам банка, включая НДС","Банк"],
    ["20.11.2026","7500","","859","Оплата за услуги по договору","ТОО Услуги"],
    ["20.11.2026","","10000","859","Оплата за работы по счёту","ТОО Заказчик"]
  ];
  const ops=C.parseRows(rows,"November");
  assert.equal(ops.length,3);
  assert.equal(ops[0].article,"Банковские комиссии");
  assert.equal(ops[0].docType,"Платёжный ордер (списание денежных средств)");
  assert.equal(ops[0].docTypeSource,"auto");
  assert.equal(ops[0].credit,"1030");
  assert.equal(C.suggestDocumentOperation(ops[0].article,ops[0].docType),"Прочее списание безналичных денежных средств");
  assert.equal(ops[1].docType,"Платёжное поручение исходящее");
  assert.equal(ops[2].docType,"Платёжное поручение входящее");
});

test("corrects previously inferred fee documents but keeps accountant-selected documents",()=>{
  const fee={
    date:"20.11.2026",direction:"Исходящее",amount:350,name:"Банк",purpose:"Банковская комиссия",article:"Банковские комиссии",
    docType:"Платёжное поручение исходящее",debit:"7210",credit:"1030"
  };
  assert.equal(C.refreshSuggestedDocument(fee),true);
  assert.equal(fee.docType,"Платёжный ордер (списание денежных средств)");
  assert.equal(C.validateOperation(fee),"ready");
  const manuallySelected={...fee,docType:"Платёжное поручение исходящее",docTypeSource:"manual"};
  assert.equal(C.refreshSuggestedDocument(manuallySelected),false);
  assert.equal(manuallySelected.docType,"Платёжное поручение исходящее");
  const incoming={...fee,direction:"Входящее",docType:"Платёжное поручение входящее",article:"Оплата от покупателя",docTypeSource:"auto"};
  assert.equal(C.refreshSuggestedDocument(incoming),false);
  assert.equal(incoming.docType,"Платёжное поручение входящее");
});

test("prefills draft accounts for clear payment categories without requiring apply",()=>{
  const header=["Дата","Дебет","Кредит","КНП","Назначение платежа","Контрагент"];
  const rows=[
    ["20.11.2026",50000,"","118","Перечисление удержанных алиментов за октябрь","Получатель"],
    ["20.11.2026",100000,"","","Выплата заработной платы за октябрь","Сотрудник"],
    ["20.11.2026",350,"","841","Комиссия за перевод согласно тарифам банка","Банк"],
    ["20.11.2026",120000,"","859","Аванс поставщику за материалы","ТОО Материалы"],
    ["20.11.2026",75000,"","859","Оплата по договору на услуги","ТОО Услуги"],
    ["20.11.2026","",250000,"859","Предоплата от покупателя за работы","ТОО Клиент"],
    ["20.11.2026","",85000,"859","Оплата покупателем по договору","ТОО Клиент"]
  ];
  const ops=C.parseRows([header,...rows]);
  assert.equal(ops.length,7);
  assert.deepEqual(ops.map(x=>[x.debit,x.credit]),[
    ["3390","1030"],["3350","1030"],["7210","1030"],["1610","1030"],
    ["","1030"],["1030","3510"],["1030",""]
  ]);
  assert.equal(ops[0].debitSource,"auto");
  assert.match(ops[0].debitReason,/алимент/);
  assert.equal(ops[4].status,"detected");
  assert.equal(ops[3].status,"ready");
});
test("manual posting edits and existing statement accounts survive recalculation",()=>{
  const x={purpose:"Аванс поставщику за товар",direction:"Исходящее",article:"Оплата поставщику",debit:"",credit:""};
  assert.equal(C.refreshSuggestedPosting(x),true);
  assert.equal(x.debit,"1610");
  assert.equal(x.credit,"1030");
  x.debit="3310";x.debitSource="manual";
  x.purpose="Комиссия за перевод";x.article="Банковские комиссии";
  C.refreshSuggestedPosting(x);
  assert.equal(x.debit,"3310");
  assert.equal(x.credit,"1030");
  const existing={...x,debit:"3390",debitSource:"statement",credit:"1030",creditSource:"statement"};
  C.refreshSuggestedPosting(existing);
  assert.equal(existing.debit,"3390");
  assert.equal(existing.credit,"1030");
  const oldDraft={purpose:"Банковская комиссия",direction:"Исходящее",article:"Банковские комиссии",debit:"3310",credit:"1030"};
  C.refreshSuggestedPosting(oldDraft);
  assert.equal(oldDraft.debit,"3310");
  assert.equal(oldDraft.credit,"1030");
});

test("detects specific tax and social-payment ledger accounts but not generic descriptions",()=>{
  const rows=[
    ["Обязательные пенсионные взносы за октябрь","010","3220"],
    ["Обязательные пенсионные взносы работодателя за октябрь","089","3250"],
    ["Социальные отчисления за октябрь, НДС не облагается","012","3211"],
    ["Взносы на обязательное социальное медицинское страхование","122","3212"],
    ["Отчисления на обязательное социальное медицинское страхование","121","3213"],
    ["Индивидуальный подоходный налог за полугодие, НДС не облагается","911","3120"],
    ["Корпоративный подоходный налог за год","911","3110"],
    ["Налог на добавленную стоимость, подлежащий уплате в бюджет","911","3130"],
    ["Социальный налог, подлежащий уплате в бюджет","911","3150"],
    ["Земельный налог за период","911","3160"]
  ];
  for(const [purpose,knp,expected] of rows) {
    const article=C.suggestArticle(purpose,"Исходящее",knp);
    const posting=C.suggestPosting({purpose,direction:"Исходящее",article,knp});
    assert.equal(posting.debit,expected,purpose);
    assert.equal(posting.credit,"1030",purpose);
    assert.match(posting.debitReason,/проверьте/i);
  }
  assert.equal(C.suggestPosting({purpose:"Уплата налогов в бюджет",direction:"Исходящее",article:"Налоги и отчисления",knp:"911"}).debit,"");
  assert.equal(C.suggestPosting({purpose:"Комиссия за перевод ОПВ, НДС 16%",direction:"Исходящее",article:"Банковские комиссии",knp:"841"}).debit,"7210");
  assert.equal(C.suggestPosting({purpose:"Услуги погрузчика, в т.ч. НДС 16%",direction:"Входящее",article:"Оплата от покупателя",knp:"859"}).credit,"");
});

test("filled-out operations still flag unverified automatic postings for 1C reconciliation",()=>{
  const x={direction:"Исходящее",purpose:"Перечисление алиментов",article:"Алименты",
    debit:"3390",credit:"1030",debitSource:"auto",creditSource:"auto",articleSource:"auto",docTypeSource:"auto"};
  const notes=C.reconciliationNotes(x);
  assert.ok(notes.some(note=>note.includes("Дт/Кт")));
  assert.ok(notes.some(note=>note.includes("ДДС")));
  assert.ok(notes.some(note=>note.includes("задолженность")));
  const manual={...x,debitSource:"manual",creditSource:"manual",articleSource:"manual",docTypeSource:"manual"};
  const manualNotes=C.reconciliationNotes(manual);
  assert.ok(!manualNotes.some(note=>note.includes("Автоматический Дт/Кт")));
  assert.ok(manualNotes.some(note=>note.includes("задолженность")));
});

test("fuel purchases are recognized from DT-L, DTL and diesel text before generic KNP",()=>{
  const examples=[
    "Приобретение ДТ-Л дизельное топливо по договору",
    "Приобретение ДТЛ 500 литров",
    "Покупка дизтоплива на АЗС",
    "Оплата ГСМ за ноябрь",
    "Оплата АИ-92 по карте"
  ];
  for(const purpose of examples){
    const match=C.suggestArticleDetailed(purpose,"Исходящее","859");
    assert.equal(match.article,"Приобретение ГСМ",purpose);
    assert.equal(match.confidence,"review",purpose);
    const posting=C.suggestPosting({purpose,direction:"Исходящее",article:match.article,knp:"859"});
    assert.equal(posting.credit,"1030");
    assert.equal(posting.debit,"", "Don't invent a debit for fuel without supporting documents");
  }
  assert.equal(C.suggestArticle("Комиссия банка за оплату ДТ-Л","Исходящее","841"),"Банковские комиссии");
  assert.notEqual(C.suggestArticle("Приобретение ДТЛ","Входящее","859"),"Приобретение ГСМ");
  const notes=C.reconciliationNotes({article:"Приобретение ГСМ",purpose:"Приобретение ДТ-Л"});
  assert.ok(notes.some(x=>x.includes("Покупка ГСМ")));
  const rows=[
    ["Дата","Дебет","Кредит","КНП","Назначение платежа","Контрагент"],
    ["20.11.2026",15000,"",859,"Приобретение ДТ-Л дизельное топливо","АЗС"]
  ];
  const [operation]=C.parseRows(rows);
  assert.equal(operation.article,"Приобретение ГСМ");
  assert.equal(operation.debit,"");
  assert.equal(operation.credit,"1030");
});

test("diesel grade details distinguish summer, winter, off-season and arctic",()=>{
  const cases=[
    ["ДТ-Л","летнее"],["ДТЛ","летнее"],
    ["ДТ-З-К5","зимнее"],["ДТЗ","зимнее"],
    ["ДТ-Е","межсезонное"],["ДТ-А","арктическое"]
  ];
  for(const [grade,meaning] of cases){
    const proposal=C.suggestArticleDetailed("Приобретение "+grade,"Исходящее","859");
    assert.equal(proposal.article,"Приобретение ГСМ");
    assert.ok(proposal.reason.includes(meaning),grade+" should mean "+meaning);
  }
});

test("inline table editing only changes the selected debit or credit account",()=>{
  const x={
    date:"20.11.2026",name:"ТОО Тест",purpose:"Оплата поставщику",
    amount:1000,direction:"Исходящее",docType:"Платёжное поручение исходящее",
    article:"Оплата поставщику",debit:"",credit:"1030",creditSource:"auto"
  };
  assert.equal(C.setManualPostingAccount(x,"debit","3310"),true);
  assert.equal(x.debit,"3310");
  assert.equal(x.credit,"1030");
  assert.equal(x.debitSource,"manual");
  assert.equal(x.creditSource,"auto");
  assert.equal(x.status,"ready");
  C.refreshSuggestedPosting(x);
  assert.equal(x.debit,"3310","automatic suggestions do not overwrite accountant choice");
  assert.equal(C.setManualPostingAccount(x,"credit","1010"),true);
  assert.equal(x.credit,"1010");
  assert.equal(x.debit,"3310");
  assert.equal(C.setManualPostingAccount(x,"debit","9999"),true,"allow any valid custom 4-digit account");
  assert.equal(x.debit,"9999");
  assert.equal(C.setManualPostingAccount(x,"debit","13<script>"),false);
  assert.equal(C.setManualPostingAccount(x,"not-a-side","1310"),false);
  assert.equal(x.debit,"9999");
  assert.equal(C.setManualPostingAccount(x,"debit",""),true,"account can be intentionally cleared");
  assert.equal(x.debit,"");
  assert.equal(x.debitSource,"manual");
  assert.notEqual(x.status,"ready");
});
