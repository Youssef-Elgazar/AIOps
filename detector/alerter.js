const fs = require("fs");
const path = require("path");

const ALERTS_PATH = path.join(process.cwd(), "storage", "aiops", "alerts.json");

function ensureAlertsStorage() {
  const dir = path.dirname(ALERTS_PATH);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(ALERTS_PATH)) {
    fs.writeFileSync(ALERTS_PATH, JSON.stringify([], null, 2));
  }
}

function readAlerts() {
  ensureAlertsStorage();

  try {
    const raw = fs.readFileSync(ALERTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[alerter] failed to read alerts file:", error.message);
    return [];
  }
}

function appendAlert(alertObject) {
  const existing = readAlerts();
  existing.push(alertObject);
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(existing, null, 2));
}

class Alerter {
  constructor() {
    this.alertedIncidentIds = new Set();
    this.hydrateFromDisk();
  }

  hydrateFromDisk() {
    const alerts = readAlerts();
    for (const alert of alerts) {
      if (alert && alert.incident_id) {
        this.alertedIncidentIds.add(alert.incident_id);
      }
    }
  }

  alertIncident(incident) {
    if (!incident || !incident.incident_id) {
      return null;
    }

    if (this.alertedIncidentIds.has(incident.incident_id)) {
      return null;
    }

    const alertObject = {
      incident_id: incident.incident_id,
      incident_type: incident.incident_type,
      severity: incident.severity,
      timestamp: new Date().toISOString(),
      summary: incident.summary,
    };

    console.log("================ AIOPS ALERT ================");
    console.log(`Incident ID : ${alertObject.incident_id}`);
    console.log(`Type        : ${alertObject.incident_type}`);
    console.log(`Severity    : ${alertObject.severity}`);
    console.log(`Time        : ${alertObject.timestamp}`);
    console.log(`Summary     : ${alertObject.summary}`);
    console.log("============================================");

    appendAlert(alertObject);
    this.alertedIncidentIds.add(incident.incident_id);
    return alertObject;
  }
}

module.exports = {
  Alerter,
};
