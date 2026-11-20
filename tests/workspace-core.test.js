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
