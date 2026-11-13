const express = require("express");
const router = express.Router();

function notConfigured(_req, res) {
  res.status(501).json({
    ok: false,
    code: "MODULE_NOT_CONFIGURED",
    module: "documents",
    message: "Модуль documents подготовлен, но хранилище и бизнес-логика ещё не подключены."
  });
}

router.get("/", notConfigured);
router.post("/", notConfigured);
router.get("/:id", notConfigured);

module.exports = router;
