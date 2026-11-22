"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const C=require("../workspace-core.js");

function zeroMovementAlatauPage(){
  // Representative coordinates in a synthetic Alatau-style statement.
  // The PDF owner name spans three separate text items.
  return [
    {s:"АО «Alatau City Bank»",x:729.8,y:27.2},
    {s:"За период с 01.09.2026 по 30.09.2026",x:316,y:63.7},
    {s:"Лицевой счет:",x:14,y:129.2},
    {s:"KZ123456789012345678 KZT",x:117.9,y:126.2},
    {s:"Клиент:",x:14,y:144.2},
    {s:"Индивидуальный",x:117.9,y:144.2},
    {s:"предприниматель Примерова",x:117.9,y:154.2},
    {s:"Алина Примеровна Цветы",x:117.9,y:164.2},
    {s:"ИИН (БИН):",x:14,y:179.2},
    {s:"123456789012",x:117.9,y:176.2},
    {s:"Обороты по кредиту:",x:14,y:194.2},
    {s:"0,00",x:111.7,y:191.2},
    {s:"Обороты по дебету:",x:14,y:209.2},
    {s:"0,00",x:117.9,y:206.2},
    {s:"Входящий остаток: 12 345,67",x:11,y:241.8},
    {s:"Исходящий остаток: 12 345,67",x:11,y:271.8},
    {s:"Дата операции",x:12.7,y:320},
    {s:"Кредит",x:205.6,y:320},
    {s:"ИТОГО:",x:11,y:359},
    {s:"0,00",x:150.6,y:359},
    {s:"0,00",x:197.1,y:359}
  ];
}

test("accepts Alatau statement with zero operations and updates bank identity",async()=>{
  const {parseAlatauPages}=await import("../alatau-pdf.mjs");
  const result=parseAlatauPages([zeroMovementAlatauPage()],C);
  assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.balances,[12345.67,12345.67]);
  assert.deepEqual(result.company,{
    name:"Индивидуальный предприниматель Примерова Алина Примеровна Цветы",
    bin:"123456789012",
    bank:"Alatau City Bank",
    account:"KZ123456789012345678",
    period:"01.09.2026 — 30.09.2026",
    currency:"KZT"
  });
});

test("rejects zero-operation PDF if its claimed turnover is nonzero",async()=>{
  const {parseAlatauPages}=await import("../alatau-pdf.mjs");
  const page=zeroMovementAlatauPage();
  page.find(x=>x.x===117.9&&x.y===206.2).s="100,00";
  assert.throws(()=>parseAlatauPages([page],C),/не сошлись/);
});

test("rejects zero-operation PDF if its end balance does not reconcile",async()=>{
  const {parseAlatauPages}=await import("../alatau-pdf.mjs");
  const page=zeroMovementAlatauPage();
  page.find(x=>x.s==="Исходящий остаток: 12 345,67").s="Исходящий остаток: 12 344,67";
  assert.throws(()=>parseAlatauPages([page],C),/не сошлись/);
});


test("imports multi-page USD statement as USD, not tenge, with reconciled operations",async()=>{
  const {parseAlatauPages}=await import("../alatau-pdf.mjs");
  const first=zeroMovementAlatauPage().filter(p=>p.s!=="ИТОГО:"&&!(p.y===359));
  first.find(p=>p.s.includes("KZ123456789012345678")).s="KZ123456789012345678 USD";
  first.find(p=>p.s==="Обороты по кредиту:").s="Обороты по кредиту:";
  first.find(p=>p.s==="Обороты по дебету:").s="Обороты по дебету:";
  first.find(p=>p.y===191.2).s="9 000,00";
  first.find(p=>p.y===206.2).s="9 000,00";
  first.push(
    {s:"20.11.2023",x:11,y:356.4},
    {s:"1",x:120,y:356.4},
    {s:"0,00",x:151,y:356.4},
    {s:"9 000,00",x:197,y:356.4},
    {s:"213",x:375,y:356.4},
    {s:"Зачисление купленной валюты",x:419,y:358.8},
    {s:"ТОО Пример",x:520,y:358.8},
    {s:"123456789012",x:620,y:356.4}
  );
  const second=[
    {s:"Дата операции",x:12.7,y:27},
    {s:"Кредит",x:205.6,y:27},
    {s:"20.11.2023",x:11,y:58.4},
    {s:"2",x:120,y:58.4},
    {s:"9 000,00",x:151,y:58.4},
    {s:"0,00",x:197,y:58.4},
    {s:"710",x:375,y:58.4},
    {s:"Payment for goods",x:419,y:60.8},
    {s:"DOLINA TEST LTD",x:520,y:60.8},
    {s:"ИТОГО:",x:11,y:259}
  ];
  const result=parseAlatauPages([first,second],C);
  assert.equal(result.company.currency,"USD");
  assert.equal(result.operations.length,2);
  assert.equal(result.operations[0].direction,"Входящее");
  assert.equal(result.operations[1].direction,"Исходящее");
  assert.deepEqual(C.totals(result.operations),{incoming:9000,outgoing:9000,net:0,count:2,unknown:0});
});

test("rejects multi-page USD statement if even one bank turnover differs",async()=>{
  const {parseAlatauPages}=await import("../alatau-pdf.mjs");
  const first=zeroMovementAlatauPage();
  first.find(p=>p.s.includes("KZ123456789012345678")).s="KZ123456789012345678 USD";
  first.find(p=>p.y===191.2).s="9 000,00";
  assert.throws(()=>parseAlatauPages([first],C),/не сошлись/);
});
