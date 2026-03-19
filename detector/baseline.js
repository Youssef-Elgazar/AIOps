const fs = require("fs");
const path = require("path");

const DEFAULT_ALPHA = 0.1;

function ensureNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyBaseline() {
  return {
    avgLatency: 0,
    requestRate: 0,
    errorRate: 0,
    sampleCount: 0,
  };
}

class BaselineModel {
  constructor(options = {}) {
    this.filePath =
      options.filePath ||
      path.join(process.cwd(), "detector", "baselines.json");
    this.alpha = Number.isFinite(options.alpha) ? options.alpha : DEFAULT_ALPHA;
    this.baselines = {};
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.baselines = {};
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.baselines = parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      console.error(
        "[baseline] failed to load baselines file, starting fresh:",
        error.message,
      );
      this.baselines = {};
    }
  }

  save() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.baselines, null, 2));
  }

  hasBaseline(endpoint) {
    return Boolean(this.baselines[endpoint]);
  }

  getBaseline(endpoint) {
    const baseline = this.baselines[endpoint];
    if (!baseline) {
      return emptyBaseline();
    }

    return {
      avgLatency: ensureNumber(baseline.avgLatency),
      requestRate: ensureNumber(baseline.requestRate),
      errorRate: ensureNumber(baseline.errorRate),
      sampleCount: Number.isFinite(baseline.sampleCount)
        ? baseline.sampleCount
        : 0,
    };
  }

  getBaselinesSnapshot() {
    const snapshot = {};

    for (const endpoint of Object.keys(this.baselines)) {
      snapshot[endpoint] = this.getBaseline(endpoint);
    }

    return snapshot;
  }

  initializeFromSamples(endpoint, samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      this.baselines[endpoint] = emptyBaseline();
      return;
    }

    const aggregate = samples.reduce(
      (acc, sample) => {
        acc.latency += ensureNumber(sample.avgLatency);
        acc.requestRate += ensureNumber(sample.requestRate);
        acc.errorRate += ensureNumber(sample.errorRate);
        return acc;
      },
      { latency: 0, requestRate: 0, errorRate: 0 },
    );

    this.baselines[endpoint] = {
      avgLatency: aggregate.latency / samples.length,
      requestRate: aggregate.requestRate / samples.length,
      errorRate: aggregate.errorRate / samples.length,
      sampleCount: samples.length,
    };
  }

  updateWithEma(endpoint, currentValues) {
    const current = {
      avgLatency: ensureNumber(currentValues.avgLatency),
      requestRate: ensureNumber(currentValues.requestRate),
      errorRate: ensureNumber(currentValues.errorRate),
    };

    if (!this.hasBaseline(endpoint)) {
      this.baselines[endpoint] = {
        ...current,
        sampleCount: 1,
      };
      return;
    }

    const previous = this.getBaseline(endpoint);

    this.baselines[endpoint] = {
      avgLatency:
        this.alpha * current.avgLatency +
        (1 - this.alpha) * previous.avgLatency,
      requestRate:
        this.alpha * current.requestRate +
        (1 - this.alpha) * previous.requestRate,
      errorRate:
        this.alpha * current.errorRate + (1 - this.alpha) * previous.errorRate,
      sampleCount: (previous.sampleCount || 0) + 1,
    };
  }
}

module.exports = {
  BaselineModel,
};
