# Note to TA

## Tech Stack Choice

The assignment specified PHP Laravel. I used Node.js and Express instead.

I, of course, used AI tools to assist me for this assignment, but I wanted to understand the generated code without having to learn another stack. I hope that is acceptable. I am fully ready to discuss my implementation at any time.

I have no intention of learning PHP Laravel, and since the requirements are entirely framework-agnostic — endpoints, structured logs, Prometheus metrics, Grafana dashboards — there's no reason the implementation language should matter. Everything asked for is here, just built with different tools.

---

## My Understanding of the Project

The core idea is simulating a real production application with multiple API endpoints that behave differently — some fast, some slow, some that always fail, some that hit a database. The point isn't the endpoints themselves, it's what happens around them.

**Prometheus** scrapes the `/metrics` endpoint on a fixed interval (every 10 seconds in our setup). The app uses `prom-client` to maintain counters and histograms in memory, and `/metrics` just serialises them into a plain-text format Prometheus understands. Prometheus stores all of that as time-series data — every metric, every label combination, timestamped.

**Grafana** sits on top of Prometheus and turns those time-series numbers into graphs. You write PromQL queries (Prometheus's query language) and Grafana plots them as panels on a dashboard. So when you see the error rate spiking or P99 latency climbing, that's Grafana reading from Prometheus's stored data and rendering it visually in near real-time.

The structured logs (Winston → `aiops.log` → `logs.json`) are a parallel stream — they capture the same events at the individual request level with full context (correlation ID, error category, client IP, etc.), whereas Prometheus only sees aggregated numbers. Together they give you both the macro view (dashboards) and the micro view (individual request logs) of what the system is doing.

The traffic generator and anomaly injection are there to see the observability stack in action — that a real spike in errors or latency shows up clearly and quickly in both the logs and the dashboard, with machine-readable ground truth to verify against.

---

_Youssef Ali Elsayed Ahmed — 20100251_
