const express = require("express");
const router = express.Router();

const KGD_PORTAL_HOST = (process.env.KGD_PORTAL_HOST || "https://portal.kgd.gov.kz").replace(/\\/$/, "");
const KGD_API_TOKEN = process.env.KGD_API_TOKEN;

// Real KGD open counterparty data API.
// POST /api/office/organizations/lookup/:bin
router.get("/lookup/:bin", async (req, res) => {
  const xin = String(req.params.bin || "").trim();
  if (!/^\\d{12}$/.test(xin)) {
    return res.status(400).json({ ok: false, error: "БИН должен состоять ровно из 12 цифр." });
  }
  if (!KGD_API_TOKEN) {
    return res.status(503).json({
      ok: false,
      code: "KGD_TOKEN_MISSING",
      error: "Для интеграции с КГД на сервере не настроен KGD_API_TOKEN."
    });
  }

  try {
    const upstream = await fetch(`${KGD_PORTAL_HOST}/services/isnaportal/public/get-sur-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Portal-Token": KGD_API_TOKEN
      },
      body: JSON.stringify({ xin }),
      signal: AbortSignal.timeout(20000)
    });

    const raw = await upstream.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { return res.status(502).json({ ok: false, code: "KGD_INVALID_RESPONSE", error: "КГД вернул ответ не в JSON." }); }

    if (!upstream.ok) {
      return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({
        ok: false,
        code: "KGD_UPSTREAM_ERROR",
        error: "КГД отклонил запрос.",
        upstreamStatus: upstream.status
      });
    }
    if (data.xin && String(data.xin) !== xin) {
      return res.status(502).json({ ok: false, code: "KGD_BIN_MISMATCH", error: "БИН в ответе КГД не совпадает с запрошенным." });
    }

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      source: "КГД МФ РК — API сведений по контрагентам (открытые данные)",
      retrievedAt: new Date().toISOString(),
      data
    });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return res.status(502).json({
      ok: false,
      code: timeout ? "KGD_TIMEOUT" : "KGD_CONNECTION_ERROR",
      error: timeout ? "КГД не ответил за 20 секунд." : "Не удалось связаться с API КГД."
    });
  }
});

// Remaining organization endpoints need database persistence and authentication.
function notConfigured(_req, res) {
  res.status(501).json({
    ok: false,
    code: "MODULE_NOT_CONFIGURED",
    module: "organizations",
    message: "Хранилище карточек организаций и права доступа ещё не подключены."
  });
}
router.get("/", notConfigured);
router.post("/", notConfigured);
router.get("/:id", notConfigured);

module.exports = router;
