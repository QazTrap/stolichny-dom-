const express = require("express");
const router = express.Router();

function notConfigured(_req, res) {
  res.status(501).json({
    ok: false,
    code: "MODULE_NOT_CONFIGURED",
    module: "reports",
    message: "Модуль reports подготовлен, но хранилище и бизнес-логика ещё не подключены."
  });
}

router.get("/", notConfigured);
router.get("/calendar", notConfigured);

module.exports = router;
