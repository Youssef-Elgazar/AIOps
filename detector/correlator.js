function countSignals(signals) {
  const counts = {
    LATENCY_ANOMALY: 0,
    ERROR_RATE_ANOMALY: 0,
    TRAFFIC_ANOMALY: 0,
    ENDPOINT_FAILURE: 0,
  };

  for (const signal of signals) {
    const type = signal.signal_type;
    if (Object.prototype.hasOwnProperty.call(counts, type)) {
      counts[type] += 1;
    }
  }

  return counts;
}

function correlateSignals(signals) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return null;
  }

  const endpointCount = new Set(signals.map((signal) => signal.endpoint)).size;
  const counts = countSignals(signals);

  if (signals.length >= 3 && endpointCount >= 2) {
    return "SERVICE_DEGRADATION";
  }

  const errorDominant = counts.ERROR_RATE_ANOMALY + counts.ENDPOINT_FAILURE;
  const latencyDominant = counts.LATENCY_ANOMALY;
  const trafficDominant = counts.TRAFFIC_ANOMALY;

  if (
    errorDominant > 0 &&
    (signals.length > 1 || endpointCount > 1) &&
    errorDominant >= latencyDominant &&
    errorDominant >= trafficDominant
  ) {
    return "ERROR_STORM";
  }

  if (
    latencyDominant > 0 &&
    latencyDominant >= errorDominant &&
    latencyDominant >= trafficDominant
  ) {
    return "LATENCY_SPIKE";
  }

  if (
    trafficDominant > 0 &&
    trafficDominant >= errorDominant &&
    trafficDominant >= latencyDominant
  ) {
    return "TRAFFIC_SURGE";
  }

  if (endpointCount === 1 && counts.ENDPOINT_FAILURE > 0) {
    return "LOCALIZED_ENDPOINT_FAILURE";
  }

  return null;
}

module.exports = {
  correlateSignals,
};
