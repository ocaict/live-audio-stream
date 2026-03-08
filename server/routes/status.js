const express = require("express");
const router = express.Router();
const statusController = require("../controllers/statusController");

router.get("/", statusController.getStatus);
router.get("/rtc-config", statusController.getRTCConfig);

module.exports = router;
