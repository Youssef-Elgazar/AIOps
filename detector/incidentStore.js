const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const INCIDENTS_PATH = path.join(
  process.cwd(),
  "storage",
  "aiops",
  "incidents.json",
);

function ensureStorage() {
  const dir = path.dirname(INCIDENTS_PATH);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(INCIDENTS_PATH)) {
    fs.writeFileSync(INCIDENTS_PATH, JSON.stringify([], null, 2));
  }
}

function readIncidents() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(INCIDENTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(
      "[incidentStore] failed to read incidents file:",
      error.message,
    );
    return [];
  }
}

function writeIncidents(incidents) {
  ensureStorage();
  fs.writeFileSync(INCIDENTS_PATH, JSON.stringify(incidents, null, 2));
}

function calculateSeverity(signalCount) {
  if (signalCount >= 4) return "critical";
  if (signalCount === 3) return "high";
  if (signalCount === 2) return "medium";
  return "low";
}

function uniqueEndpoints(signals) {
  const set = new Set();
  for (const signal of signals) {
    if (signal && signal.endpoint) {
      set.add(signal.endpoint);
    }
  }
  return Array.from(set);
}

function buildSummary(incidentType, signals, endpoints) {
  const signalCount = signals.length;
  const endpointList =
    endpoints.length > 0 ? endpoints.join(", ") : "unknown endpoints";
  return `${incidentType} detected with ${signalCount} signal(s) affecting ${endpointList}.`;
}

function createIncident({
  incidentType,
  triggeringSignals,
  baselineValues,
  observedValues,
}) {
  const signals = Array.isArray(triggeringSignals) ? triggeringSignals : [];
  const endpoints = uniqueEndpoints(signals);
  const severity = calculateSeverity(signals.length);
  const detectedAt = new Date().toISOString();

  return {
    incident_id: uuidv4(),
    incident_type: incidentType || null,
    severity,
    status: "open",
    detected_at: detectedAt,
    affected_service: "aiops-api",
    affected_endpoints: endpoints,
    triggering_signals: signals,
    baseline_values: baselineValues || null,
    observed_values: observedValues || null,
    summary: buildSummary(
      incidentType || "UNKNOWN_INCIDENT",
      signals,
      endpoints,
    ),
  };
}

function appendIncident(incident) {
  const incidents = readIncidents();
  incidents.push(incident);
  writeIncidents(incidents);
}

module.exports = {
  createIncident,
  appendIncident,
};
