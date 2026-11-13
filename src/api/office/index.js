const express = require("express");
const router = express.Router();

// STOLDOM OFFICE API namespace.
// Each domain has its own router so storage and external providers can be added independently.
const organizations = require("./organizations");
const documents = require("./documents");
const reports = require("./reports");
const tasks = require("./tasks");
const integrations = require("./integrations");
const settings = require("./settings");

router.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, module: "STOLDOM OFFICE", apiVersion: "v1", domains: ["organizations", "documents", "reports", "tasks", "integrations", "settings"] });
});

router.use("/organizations", organizations);
router.use("/documents", documents);
router.use("/reports", reports);
router.use("/tasks", tasks);
router.use("/integrations", integrations);
router.use("/settings", settings);

module.exports = router;
