"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {create}=require("../stoldom-exchange");
const row={date:"27.11.2026",direction:"Исходящее",amount:150000.01,name:"ТОО Пример",bin:"012345678901",debit:"3310",credit:"1030",article:"Оплата поставщику",docType:"Платёжное поручение исходящее",status:"ready"};
test("preserves accounting fields, minor units and identifiers; never asserts a contract or posting",()=>{
 const d=create([row],{bin:"000000000001",account:"KZ123",currency:"KZT"},{now:new Date("2026-11-27T00:00:00Z")});
 assert.equal(d.format,"STOLDOM-1C");assert.equal(d.schemaVersion,1);
 assert.equal(d.operations[0].amount,"15000001");assert.equal(d.totals.outgoing,"15000001");assert.equal(d.totals.incoming,"0");
 assert.equal(d.operations[0].counterparty.bin,"012345678901");assert.equal(d.operations[0].accounting.debit,"3310");assert.equal(d.operations[0].accounting.contract,null);assert.equal(d.operations[0].review.requiresReview,true);assert.equal(d.importPolicy.createUnposted,true);
});
test("unknown organization and currency remain unknown, incomplete operations flagged",()=>{
 const d=create([{...row,status:"review",possibleDuplicate:true}],{},{reviewNotes:()=>["Договор проверить"]});
 assert.equal(d.operations[0].currency,null);assert.equal(d.operations[0].review.fieldsFilled,false);assert.equal(d.operations[0].review.possibleDuplicate,true);assert.deepEqual(d.operations[0].review.notes,["Договор проверить"]);
});
test("rejects ambiguous direction and invalid money",()=>{
 assert.throws(()=>create([{...row,direction:""}]));assert.throws(()=>create([{...row,amount:0}]));assert.throws(()=>create([{...row,amount:0.123}]));
});
