// scripts/export_logs.js
// Reads the structured aiops.log (newline-delimited JSON) and exports it as logs.json
const fs = require("fs");
const path = require("path");

const LOG_PATH =
  process.env.LOG_PATH ||
  path.join(__dirname, "..", "storage", "logs", "aiops.log");
const OUTPUT_PATH = path.join(__dirname, "..", "logs.json");

if (!fs.existsSync(LOG_PATH)) {
  console.error(`Log file not found: ${LOG_PATH}`);
  process.exit(1);
}

const raw = fs.readFileSync(LOG_PATH, "utf-8");
const lines = raw.trim().split("\n").filter(Boolean);

const records = [];
for (const line of lines) {
  try {
    records.push(JSON.parse(line));
  } catch {
    // skip malformed lines
  }
}

// Filter to only request_completed / request_error log entries
const requestLogs = records.filter(
  (r) => r.message === "request_completed" || r.message === "request_error",
);

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(requestLogs, null, 2));

console.log(`Exported ${requestLogs.length} log entries to ${OUTPUT_PATH}`);
console.log(`  Total records parsed: ${records.length}`);
console.log(`  Request logs:         ${requestLogs.length}`);
console.log(
  `  Error records:        ${requestLogs.filter((r) => r.severity === "error").length}`,
);
