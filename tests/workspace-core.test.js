"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const C=require("../workspace-core.js");

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
