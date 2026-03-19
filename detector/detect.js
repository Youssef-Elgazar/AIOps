const {
  getRequestRate,
  getErrorRate,
  getLatencyPercentile,
  getErrorCategoryRate,
} = require("./prometheusClient");
const { BaselineModel } = require("./baseline");
const { detectAnomalies } = require("./anomalyDetector");
const { correlateSignals } = require("./correlator");
const { createIncident, appendIncident } = require("./incidentStore");
const { Alerter } = require("./alerter");

const ENDPOINTS = [
  "/api/normal",
  "/api/slow",
  "/api/db",
  "/api/error",
  "/api/validate",
];
const ERROR_CATEGORIES = [
  "VALIDATION_ERROR",
  "DATABASE_ERROR",
  "SYSTEM_ERROR",
  "TIMEOUT_ERROR",
  "UNKNOWN",
];

const WARMUP_SAMPLES = 3;
const WARMUP_INTERVAL_MS = 20000;
const LOOP_INTERVAL_MS = 20000;

const baselineModel = new BaselineModel();
const alerter = new Alerter();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectMetricsSnapshot() {
  const endpointEntries = await Promise.all(
    ENDPOINTS.map(async (endpoint) => {
      const [requestRate, errorRate, latencyP95] = await Promise.all([
        getRequestRate(endpoint),
        getErrorRate(endpoint),
        getLatencyPercentile(endpoint, 0.95),
      ]);

      return [
        endpoint,
        {
          avgLatency: latencyP95,
          requestRate,
          errorRate,
        },
      ];
    }),
  );

  const errorCategoryEntries = await Promise.all(
    ERROR_CATEGORIES.map(async (category) => {
      const rate = await getErrorCategoryRate(category);
      return [category, rate];
    }),
  );

  const endpoints = Object.fromEntries(endpointEntries);
  const errorCategories = Object.fromEntries(errorCategoryEntries);

  return {
    endpoints,
    errorCategories,
  };
}

function printCycleLog({ timestamp, snapshot, signals, incident }) {
  console.log("\n------------------------------------------------------------");
  console.log(`[cycle] ${timestamp}`);
  console.log(
    "[metrics] endpoints snapshot:",
    JSON.stringify(snapshot.endpoints, null, 2),
  );
  console.log(
    "[metrics] error category rates:",
    JSON.stringify(snapshot.errorCategories, null, 2),
  );

  if (signals.length === 0) {
    console.log("[signals] none");
  } else {
    console.log("[signals] active:", JSON.stringify(signals, null, 2));
  }

  if (!incident) {
    console.log("[incident] none");
  } else {
    console.log(
      `[incident] ${incident.incident_type} | severity=${incident.severity} | id=${incident.incident_id}`,
    );
  }

  console.log("------------------------------------------------------------");
}

async function init() {
  baselineModel.load();

  console.log(
    `[init] warming baselines with ${WARMUP_SAMPLES} samples, interval ${WARMUP_INTERVAL_MS}ms`,
  );

  const warmupByEndpoint = {};
  for (const endpoint of ENDPOINTS) {
    warmupByEndpoint[endpoint] = [];
  }

  for (let index = 0; index < WARMUP_SAMPLES; index += 1) {
    const timestamp = new Date().toISOString();
    const snapshot = await collectMetricsSnapshot();

    for (const endpoint of ENDPOINTS) {
      warmupByEndpoint[endpoint].push(snapshot.endpoints[endpoint]);
    }

    console.log(
      `[init] warmup sample ${index + 1}/${WARMUP_SAMPLES} collected at ${timestamp}`,
    );

    if (index < WARMUP_SAMPLES - 1) {
      await sleep(WARMUP_INTERVAL_MS);
    }
  }

  for (const endpoint of ENDPOINTS) {
    if (!baselineModel.hasBaseline(endpoint)) {
      baselineModel.initializeFromSamples(endpoint, warmupByEndpoint[endpoint]);
      continue;
    }

    for (const sample of warmupByEndpoint[endpoint]) {
      baselineModel.updateWithEma(endpoint, sample);
    }
  }

  baselineModel.save();
  console.log("[init] baseline warmup complete");
}

async function runDetectionLoop() {
  while (true) {
    const timestamp = new Date().toISOString();
    const snapshot = await collectMetricsSnapshot();

    const baselineSnapshot = baselineModel.getBaselinesSnapshot();
    const signals = detectAnomalies({
      currentMetrics: snapshot.endpoints,
      baselineMetrics: baselineSnapshot,
    });

    const incidentType = correlateSignals(signals);
    let incident = null;

    if (incidentType) {
      incident = createIncident({
        incidentType,
        triggeringSignals: signals,
        baselineValues: baselineSnapshot,
        observedValues: snapshot.endpoints,
      });

      appendIncident(incident);
      alerter.alertIncident(incident);
    }

    for (const endpoint of ENDPOINTS) {
      baselineModel.updateWithEma(endpoint, snapshot.endpoints[endpoint]);
    }
    baselineModel.save();

    printCycleLog({ timestamp, snapshot, signals, incident });
    await sleep(LOOP_INTERVAL_MS);
  }
}

async function main() {
  try {
    await init();
    await runDetectionLoop();
  } catch (error) {
    console.error("[detector] fatal error:", error);
    process.exit(1);
  }
}

main();
