const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const QRCode = require("qrcode");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const KGD_PORTAL_HOST = (process.env.KGD_PORTAL_HOST || "https://portal.kgd.gov.kz").replace(/\/$/, "");
const KGD_API_TOKEN = process.env.KGD_API_TOKEN;
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://stoldom.site").replace(/\/$/, "");
const allowedOrigins = (process.env.CORS_ORIGINS || PUBLIC_APP_URL)
  .split(",").map(value => value.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "STOLDOM.SITE", integrationConfigured: Boolean(KGD_API_TOKEN) });
});

app.post("/api/counterparty", async (req, res) => {
  const xin = String(req.body?.xin || "").trim();
  if (!/^\d{12}$/.test(xin)) {
    return res.status(400).json({ error: "Введите корректный БИН из 12 цифр." });
  }
  if (!KGD_API_TOKEN) {
    return res.status(503).json({ error: "Интеграция КГД ещё не настроена: на сервере отсутствует KGD_API_TOKEN." });
  }

  try {
    const response = await fetch(\`\${KGD_PORTAL_HOST}/services/isnaportal/public/get-sur-data\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Portal-Token": KGD_API_TOKEN
      },
      body: JSON.stringify({ xin }),
      signal: AbortSignal.timeout(20_000)
    });

    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { message: "КГД вернул ответ в неизвестном формате." }; }

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

    if (data.xin && String(data.xin) !== xin) {
      return res.status(502).json({ error: "БИН в ответе КГД не совпадает с запрошенным. Данные не показаны." });
    }

    return res.json({ source: "КГД МФ РК — открытые данные", retrievedAt: new Date().toISOString(), data });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return res.status(502).json({
      error: timeout ? "КГД не ответил за отведённое время. Попробуйте ещё раз." : "Не удалось связаться с сервисом КГД."
    });
  }
});

app.get("/api/counterparty/:xin/qr", async (req, res) => {
  const xin = String(req.params.xin || "");
  if (!/^\d{12}$/.test(xin)) return res.status(400).json({ error: "Некорректный БИН." });
  try {
    const target = \`\${PUBLIC_APP_URL}/?bin=\${encodeURIComponent(xin)}\`;
    const png = await QRCode.toBuffer(target, { type: "png", width: 360, margin: 2, errorCorrectionLevel: "M" });
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-store" });
    return res.send(png);
  } catch {
    return res.status(500).json({ error: "Не удалось сформировать QR-код." });
  }
});

app.get("/", (_req, res) => res.status(200).send("STOLDOM.SITE API is running."));
app.listen(PORT, () => console.log(\`STOLDOM API listening on port \${PORT}\`));
