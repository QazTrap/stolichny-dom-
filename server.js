const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const QRCode = require("qrcode");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const KGD_PORTAL_HOST = (process.env.KGD_PORTAL_HOST || "https://portal.kgd.gov.kz").replace(/\/$/, "");
const KGD_API_TOKEN = process.env.KGD_API_TOKEN;
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://stoldom.site").replace(/\/$/, "");

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 }
});

function parseWorkbook(file) {
  if (!file || !file.buffer) throw new Error("Загрузите оба файла.");
  const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В файле не найден лист с данными.");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd"
  });
  if (!matrix.length) throw new Error("Файл пустой.");
  let headerIndex = 0;
  let bestScore = -1;
  const hints = /номер|№|invoice|document|эсф|сф|бин|иин|дата|сумма|amount|vat|ндс|контрагент|поставщик|покупатель/i;
  matrix.slice(0, 15).forEach((row, index) => {
    const score = row.filter(v => hints.test(String(v || ""))).length;
    if (score > bestScore) { bestScore = score; headerIndex = index; }
  });
  const headers = (matrix[headerIndex] || []).map((v, i) => String(v || "").trim() || "Колонка " + (i + 1));
  const rows = matrix.slice(headerIndex + 1).filter(row => row.some(v => String(v ?? "").trim() !== ""));
  return {
    sheetName,
    headers,
    rows: rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))),
    rowCount: rows.length
  };
}

function normText(value) {
  return String(value ?? "").trim().toLocaleUpperCase("ru-RU").replace(/[№#]/g, "").replace(/\s+/g, "").replace(/[–—]/g, "-");
}
function normBin(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 12 ? digits : normText(value);
}
function normAmount(value) {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  let s = String(value ?? "").replace(/\s/g, "").replace(/[₸тг]/gi, "").replace(",", ".");
  s = s.replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function normDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  return s;
}
function valueOf(row, field, mapping) {
  const key = mapping?.[field];
  return key ? row[key] : "";
}
function makeKey(row, mapping) {
  const number = normText(valueOf(row, "number", mapping));
  const bin = normBin(valueOf(row, "bin", mapping));
  if (!number) return "";
  return bin + "|" + number;
}
function compareRows(esf, oneC, mapping) {
  const index1C = new Map();
  const duplicates = [];
  oneC.rows.forEach((row, i) => {
    const key = makeKey(row, mapping.oneC);
    if (!key) return;
    if (index1C.has(key)) duplicates.push({ source: "1С", row: i + 2, key });
    else index1C.set(key, { row, index: i });
  });
  const used = new Set();
  const result = [];
  const add = (status, esfRow, oneCRow, details) => result.push({
    status, number: normText(valueOf(esfRow || oneCRow || {}, "number", esfRow ? mapping.esf : mapping.oneC)),
    bin: normBin(valueOf(esfRow || oneCRow || {}, "bin", esfRow ? mapping.esf : mapping.oneC)),
    esfDate: esfRow ? normDate(valueOf(esfRow, "date", mapping.esf)) : "",
    oneCDate: oneCRow ? normDate(valueOf(oneCRow, "date", mapping.oneC)) : "",
    esfAmount: esfRow ? normAmount(valueOf(esfRow, "amount", mapping.esf)) : null,
    oneCAmount: oneCRow ? normAmount(valueOf(oneCRow, "amount", mapping.oneC)) : null,
    esfVat: esfRow ? normAmount(valueOf(esfRow, "vat", mapping.esf)) : null,
    oneCVat: oneCRow ? normAmount(valueOf(oneCRow, "vat", mapping.oneC)) : null,
    details
  });
  esf.rows.forEach((row, i) => {
    const key = makeKey(row, mapping.esf);
    if (!key) { add("needs_review", row, null, "Не удалось определить номер ЭСФ или БИН — проверьте сопоставление колонок."); return; }
    const found = index1C.get(key);
    if (!found) { add("missing_1c", row, null, "Документ есть в выгрузке ЭСФ, но не найден в выгрузке 1С."); return; }
    used.add(key);
    const other = found.row;
    const diffs = [];
    const a = normAmount(valueOf(row, "amount", mapping.esf));
    const b = normAmount(valueOf(other, "amount", mapping.oneC));
    if (a !== null && b !== null && a !== b) diffs.push("Сумма: ЭСФ " + a + " / 1С " + b);
    const da = normDate(valueOf(row, "date", mapping.esf));
    const db = normDate(valueOf(other, "date", mapping.oneC));
    if (da && db && da !== db) diffs.push("Дата: ЭСФ " + da + " / 1С " + db);
    const va = normAmount(valueOf(row, "vat", mapping.esf));
    const vb = normAmount(valueOf(other, "vat", mapping.oneC));
    if (va !== null && vb !== null && va !== vb) diffs.push("НДС: ЭСФ " + va + " / 1С " + vb);
    add(diffs.length ? "mismatch" : "matched", row, other, diffs.length ? diffs.join("; ") : "Номер и БИН совпадают; проверенные суммы и даты совпадают.");
  });
  oneC.rows.forEach(row => {
    const key = makeKey(row, mapping.oneC);
    if (key && !used.has(key) && !esf.rows.some(e => makeKey(e, mapping.esf) === key)) {
      add("missing_esf", null, row, "Документ есть в выгрузке 1С, но не найден в выгрузке ЭСФ.");
    }
  });
  return { rows: result, duplicates };
}

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "STOLDOM.SITE", integrationConfigured: Boolean(KGD_API_TOKEN) });
});

app.post("/api/counterparty", async (req, res) => {
  const xin = String(req.body?.xin || "").trim();
  if (!/^\d{12}$/.test(xin)) return res.status(400).json({ error: "Введите корректный БИН из 12 цифр." });
  if (!KGD_API_TOKEN) return res.status(503).json({ error: "Интеграция КГД ещё не настроена: на сервере отсутствует KGD_API_TOKEN." });
  try {
    const response = await fetch(`${KGD_PORTAL_HOST}/services/isnaportal/public/get-sur-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Portal-Token": KGD_API_TOKEN },
      body: JSON.stringify({ xin }), signal: AbortSignal.timeout(20_000)
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: "КГД вернул ответ в неизвестном формате." }; }
    if (!response.ok) {
      const messages = {
        400: "КГД отклонил запрос: проверьте БИН и формат данных.",
        401: "КГД не авторизовал запрос. Проверьте токен X-Portal-Token.",
        404: "КГД запретил доступ к сервису для данного пользователя.",
        500: "На стороне КГД произошла ошибка. Попробуйте позже."
      };
      return res.status(response.status >= 400 && response.status < 600 ? response.status : 502)
        .json({ error: messages[response.status] || "Не удалось получить сведения от КГД.", kgdStatus: response.status });
    }
    if (data.xin && String(data.xin) !== xin) return res.status(502).json({ error: "БИН в ответе КГД не совпадает с запрошенным. Данные не показаны." });
    res.set("Cache-Control", "no-store");
    return res.json({ source: "КГД МФ РК — открытые данные", retrievedAt: new Date().toISOString(), data });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return res.status(502).json({ error: timeout ? "КГД не ответил за отведённое время. Попробуйте ещё раз." : "Не удалось связаться с сервисом КГД." });
  }
});

app.post("/api/reconciliation/preview", upload.fields([{ name: "esf", maxCount: 1 }, { name: "oneC", maxCount: 1 }]), (req, res) => {
  try {
    const esf = parseWorkbook(req.files?.esf?.[0]);
    const oneC = parseWorkbook(req.files?.oneC?.[0]);
    res.set("Cache-Control", "no-store");
    res.json({
      esf: { fileName: req.files.esf[0].originalname, sheetName: esf.sheetName, headers: esf.headers, rowCount: esf.rowCount, sample: esf.rows.slice(0, 3) },
      oneC: { fileName: req.files.oneC[0].originalname, sheetName: oneC.sheetName, headers: oneC.headers, rowCount: oneC.rowCount, sample: oneC.rows.slice(0, 3) }
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Не удалось прочитать файлы." });
  }
});

app.post("/api/reconciliation/compare", upload.fields([{ name: "esf", maxCount: 1 }, { name: "oneC", maxCount: 1 }]), (req, res) => {
  try {
    const esf = parseWorkbook(req.files?.esf?.[0]);
    const oneC = parseWorkbook(req.files?.oneC?.[0]);
    const mapping = JSON.parse(req.body.mapping || "{}");
    for (const source of ["esf", "oneC"]) {
      for (const field of ["number", "bin"]) {
        if (!mapping[source]?.[field]) throw new Error("Выберите колонку для поля «" + (field === "number" ? "Номер документа" : "БИН") + "» в обоих файлах.");
      }
    }
    const dateFrom = String(req.body.dateFrom || "");
    const dateTo = String(req.body.dateTo || "");
    if (dateFrom || dateTo) {
      if (!mapping.esf.date || !mapping.oneC.date) throw new Error("Для фильтрации по периоду выберите колонку «Дата совершения оборота» в обоих файлах.");
      const inPeriod = (row, source) => {
        const date = normDate(valueOf(row, "date", mapping[source]));
        return Boolean(date) && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
      };
      esf.rows = esf.rows.filter(row => inPeriod(row, "esf"));
      oneC.rows = oneC.rows.filter(row => inPeriod(row, "oneC"));
      esf.rowCount = esf.rows.length;
      oneC.rowCount = oneC.rows.length;
    }
    const compared = compareRows(esf, oneC, mapping);
    const counts = compared.rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
    res.set("Cache-Control", "no-store");
    res.json({
      period: req.body.period || "",
      files: { esf: req.files.esf[0].originalname, oneC: req.files.oneC[0].originalname },
      totals: { esf: esf.rowCount, oneC: oneC.rowCount, ...counts, duplicates: compared.duplicates.length },
      rows: compared.rows,
      duplicates: compared.duplicates
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Не удалось выполнить сверку." });
  }
});

app.get("/api/counterparty/:xin/qr", async (req, res) => {
  const xin = String(req.params.xin || "");
  if (!/^\d{12}$/.test(xin)) return res.status(400).json({ error: "Некорректный БИН." });
  try {
    const target = `${PUBLIC_APP_URL}/?bin=${encodeURIComponent(xin)}`;
    const png = await QRCode.toBuffer(target, { type: "png", width: 360, margin: 2, errorCorrectionLevel: "M" });
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-store" });
    return res.send(png);
  } catch { return res.status(500).json({ error: "Не удалось сформировать QR-код." }); }
});

app.get("/reconciliation", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "reconciliation.html"));
});
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "index.html"));
});
app.listen(PORT, () => console.log(`STOLDOM.SITE listening on port ${PORT}`));
