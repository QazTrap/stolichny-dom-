const express = require("express");
const router = express.Router();

function notConfigured(_req, res) {
  res.status(501).json({
    ok: false,
    code: "MODULE_NOT_CONFIGURED",
    module: "integrations",
    message: "Модуль integrations подготовлен, но хранилище и бизнес-логика ещё не подключены."
  });
}

router.get("/", notConfigured);
router.get("/:provider/status", notConfigured);
router.post("/:provider/connect", notConfigured);

module.exports = router;
