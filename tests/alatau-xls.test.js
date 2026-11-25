const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const C = require("../workspace-core.js");

const headers = ["Дата, время\nоперации", "№ документа", "Расход (дебет)", "Приход (кредит)",
  "Комиссия", "Корреспондент", "ИИН (БИН)", "БИК", "Cчет", "Назначения платежа", "КНП"];
const iban = "KZ000000000000000001";
const payment = ["13.01.2026 14:03", "000123", 0, "3 246 443,38", 0, "Покупатель",
  "001234567890", "TESTKZKX", iban, "Оплата услуг", "710"];

function roundTrip(rows, bookType) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Выписка");
  const bytes = XLSX.write(book, {bookType, type:"buffer"});
  if (bookType === "biff8") assert.equal(Buffer.from(bytes.subarray(0,8)).toString("hex"), "d0cf11e0a1b11ae1");
  const parsed = XLSX.read(bytes, {type:"array", cellDates:true}).Sheets["Выписка"];
  const matrix = XLSX.utils.sheet_to_json(parsed, {header:1, defval:"", raw:true});
  return C.parseAlatauSheet(matrix, "Выписка", (r,c)=>parsed[XLSX.utils.encode_cell({r,c})]?.w);
}

for (const format of ["biff8","xlsx"]) {
  test(format + " identifies the header, reads metadata and splits fees", () => {
    const outgoing = [...payment];
    outgoing.splice(2,3,"2 957 000,00",0,"40,00");
    const fee = [...payment];
    fee.splice(2,3,0,0,"13\u202f800,00");
    const parsed = roundTrip([
      ["Клиент:", "", "Первый клиент"], ["Текущий счет:", iban], ["ИИН (БИН):", "001234567890"],
      ["За период:", "01.01.2026 - 31.10.2026"], ["Входящий:", "201 121,39"],
      ["Исходящий:", "476 724,77"], ["Комиссия","13 840,00"], [], headers, payment, outgoing, fee,
      ["Общая сумма по расходу (дебету):", "", "2 957 000,00 ₸"]
    ], format);
    const ops = parsed.operations;
    assert.deepEqual(ops.map(x=>x.amount), [3246443.38,2957000,40,13800]);
    assert.deepEqual(ops.map(x=>x.direction), ["Входящее","Исходящее","Исходящее","Исходящее"]);
    assert.deepEqual(ops.filter(x=>x.isBankFee).map(x=>x.article), ["Банковские комиссии","Банковские комиссии"]);
    assert.deepEqual([ops[0].bin,ops[0].docNumber,ops[0].bik,ops[0].counterpartyAccount,ops[0].purpose],
      ["001234567890","000123","TESTKZKX",iban,"Оплата услуг"]);
    assert.equal(parsed.company.period, "01.01.2026 - 31.10.2026");
    assert.equal(parsed.company.bin, "001234567890");
    assert.equal(parsed.company.account, iban);
    assert.deepEqual(parsed.balances,[201121.39,476724.77]);
    const next = roundTrip([["Клиент:", "Второй клиент"], headers], format);
    assert.equal(next.company.name, "Второй клиент");
    assert.equal(next.company.account, "");
    assert.equal(next.company.period, "");
    assert.deepEqual(next.operations, []);
    assert.deepEqual(next.balances, [null,null]);
  });
}
test("ordinary debit and credit tables keep the generic import path", () => {
  assert.equal(C.parseAlatauSheet([["Дата", "Дебет", "Кредит", "Комиссия"]], "Sheet"), null);
});
