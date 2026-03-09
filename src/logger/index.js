// src/logger/index.js
const winston = require("winston");
const path = require("path");
const fs = require("fs");

const LOG_PATH = process.env.LOG_PATH || "./storage/logs/aiops.log";

// Ensure log directory exists
const logDir = path.dirname(LOG_PATH);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: {},
  transports: [
    // Write all logs to the structured log file
    new winston.transports.File({ filename: LOG_PATH }),
  ],
});

// In development, also log to console
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  );
}

module.exports = logger;
