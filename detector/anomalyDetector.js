function safeRatio(currentValue, baselineValue) {
  const current = Number.parseFloat(currentValue) || 0;
  const baseline = Number.parseFloat(baselineValue) || 0;

  if (baseline <= 0) {
    return current > 0 ? Number.POSITIVE_INFINITY : 1;
  }

  return current / baseline;
}

function buildSignal(signalType, endpoint, currentValue, baselineValue) {
  const ratio = safeRatio(currentValue, baselineValue);
  return {
    signal_type: signalType,
    endpoint,
    current_value: currentValue,
    baseline_value: baselineValue,
    ratio,
  };
}

function detectAnomalies({ currentMetrics, baselineMetrics }) {
  const signals = [];

  for (const endpoint of Object.keys(currentMetrics)) {
    const current = currentMetrics[endpoint] || {};
    const baseline = baselineMetrics[endpoint] || {
      avgLatency: 0,
      requestRate: 0,
      errorRate: 0,
    };

    const currentLatency = Number.parseFloat(current.avgLatency) || 0;
    const currentRequestRate = Number.parseFloat(current.requestRate) || 0;
    const currentErrorRate = Number.parseFloat(current.errorRate) || 0;

    const baselineLatency = Number.parseFloat(baseline.avgLatency) || 0;
    const baselineRequestRate = Number.parseFloat(baseline.requestRate) || 0;
    const baselineErrorRate = Number.parseFloat(baseline.errorRate) || 0;

    if (baselineLatency > 0 && currentLatency > 3 * baselineLatency) {
      signals.push(
        buildSignal(
          "LATENCY_ANOMALY",
          endpoint,
          currentLatency,
          baselineLatency,
        ),
      );
    }

    if (currentErrorRate > 0.1 && currentErrorRate > 2 * baselineErrorRate) {
      signals.push(
        buildSignal(
          "ERROR_RATE_ANOMALY",
          endpoint,
          currentErrorRate,
          baselineErrorRate,
        ),
      );
    }

    if (
      baselineRequestRate > 0 &&
      currentRequestRate > 2 * baselineRequestRate
    ) {
      signals.push(
        buildSignal(
          "TRAFFIC_ANOMALY",
          endpoint,
          currentRequestRate,
          baselineRequestRate,
        ),
      );
    }

    if (currentErrorRate > 0.8) {
      signals.push(
        buildSignal(
          "ENDPOINT_FAILURE",
          endpoint,
          currentErrorRate,
          baselineErrorRate,
        ),
      );
    }
  }

  return signals;
}

module.exports = {
  detectAnomalies,
};
