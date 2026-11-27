"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {report,docx,imagePdf}=require("../kgd-export");
test("report preserves leading zero, zero amounts and statistics",()=>{
 const r=report({xin:"012345678901",name:{ru:"ТОО «Тест»"},taxDebt:0,statistics:[{year:2026,taxIn:0}]},[["xin","БИН"],["taxDebt","Долг"]],new Date("2026-11-27T00:00:00Z"));
 assert.equal(r.rows[1][1],"012345678901");
 assert.equal(r.rows[2][1],"0 ₸");
 assert.equal(r.statistics[0][2],0);
 assert.match(r.filename,/012345678901/);
 const zip=Buffer.from(docx(r));
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 assert.ok(zip.includes(Buffer.from("word/document.xml")));
 assert.ok(zip.includes(Buffer.from("ТОО «Тест»")));
});
test("PDF has correct xref offsets and page count",()=>{
 const bytes=Buffer.from(imagePdf([Uint8Array.from([255,216,255,217]),Uint8Array.from([255,216,255,217])],1240,1754));
 const pdf=bytes.toString("latin1");
 assert.match(pdf,/^%PDF-1.4/);
 assert.match(pdf,/\/Count 2/);
 const pos=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(pos,pos+4),"xref");
 const entries=pdf.slice(pos).split("\n").slice(3,11);
 entries.forEach((line,i)=>assert.equal(pdf.slice(Number(line.slice(0,10)),Number(line.slice(0,10))+7),(i+1)+" 0 obj"));
});
