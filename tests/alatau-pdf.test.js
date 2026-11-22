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
