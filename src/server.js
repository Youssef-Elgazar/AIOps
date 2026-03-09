// src/server.js
require("dotenv").config();
const app = require("./app");
const logger = require("./logger");
const dbModule = require("./db");

const PORT = parseInt(process.env.PORT || "3000", 10);

// Wait for DB to initialise before accepting traffic
dbModule.ready
  .then(() => {
    app.listen(PORT, () => {
      logger.info("server_started", {
        port: PORT,
        build_version: process.env.BUILD_VERSION || "unknown",
        node_env: process.env.NODE_ENV || "development",
        pid: process.pid,
      });
    });
  })
  .catch((err) => {
    logger.error("db_init_failed", { message: err.message });
    process.exit(1);
  });

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", { reason: String(reason) });
});

process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
