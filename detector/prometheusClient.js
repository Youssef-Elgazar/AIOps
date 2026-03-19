const PROMETHEUS_BASE_URL =
  process.env.PROMETHEUS_URL || "http://localhost:9090";

function toSafeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseVectorResult(result) {
  if (!Array.isArray(result) || result.length === 0) {
    return 0;
  }

  return result.reduce((sum, item) => {
    const value = item && Array.isArray(item.value) ? item.value[1] : 0;
    return sum + toSafeNumber(value);
  }, 0);
}

async function queryInstant(promQl) {
  const url = `${PROMETHEUS_BASE_URL}/api/v1/query?query=${encodeURIComponent(promQl)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Prometheus query failed (${response.status}): ${promQl}`);
  }

  const payload = await response.json();
  if (payload.status !== "success") {
    throw new Error(
      `Prometheus returned non-success response for query: ${promQl}`,
    );
  }

  return payload.data && payload.data.result ? payload.data.result : [];
}

async function getScalar(promQl) {
  try {
    const result = await queryInstant(promQl);
    return parseVectorResult(result);
  } catch (error) {
    console.error("[prometheusClient] query error:", error.message);
    return 0;
  }
}

function quoteLabelValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function getRequestRate(endpoint) {
  const path = quoteLabelValue(endpoint);
  const query = `sum(rate(http_requests_total{path=\"${path}\"}[2m]))`;
  return getScalar(query);
}

async function getErrorRate(endpoint) {
  const path = quoteLabelValue(endpoint);
  const query = `sum(rate(http_errors_total{path=\"${path}\"}[2m])) / clamp_min(sum(rate(http_requests_total{path=\"${path}\"}[2m])), 0.000001)`;
  const value = await getScalar(query);
  return Number.isFinite(value) ? value : 0;
}

async function getLatencyPercentile(endpoint, percentile) {
  const path = quoteLabelValue(endpoint);
  const q = Number(percentile);
  const quantile = Number.isFinite(q) ? q : 0.95;
  const query = `histogram_quantile(${quantile}, sum by (le) (rate(http_request_duration_seconds_bucket{path=\"${path}\"}[2m])))`;
  const value = await getScalar(query);
  return Number.isFinite(value) ? value : 0;
}

async function getErrorCategoryRate(category) {
  const errorCategory = quoteLabelValue(category);
  const query = `sum(rate(http_errors_total{error_category=\"${errorCategory}\"}[2m]))`;
  return getScalar(query);
}

module.exports = {
  getRequestRate,
  getErrorRate,
  getLatencyPercentile,
  getErrorCategoryRate,
};
