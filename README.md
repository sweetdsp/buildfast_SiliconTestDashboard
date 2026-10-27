# Bluetooth Silicon Test Dashboard

AI-assisted dashboard for a custom Bluetooth 5.2 chipset validation cycle (HCI Regression, Phone Testing, HCI MTBF, KPI & Performance). There is no real test infrastructure: a deterministic generator produces the test plan and one full-cycle run, and the dashboard analyses it.

**Open `dashboard/index.html` in a browser.** It is a single self-contained file (no server, no CDN).

## Pipeline

```
python3 generator/generate_test_plan.py   # one-time: 5,000 HCI + 1,000 phone test cases -> data/test_plan.json
python3 generator/generate_run_data.py    # run telemetry (seeded)                      -> data/test_run_data.json
python3 build.py                          # inlines CSS/JS/data                         -> dashboard/index.html
```

Output is deterministic (seed `20261020`). Only the Python standard library is needed.

## What the dashboard shows

1. **Executive TL;DR** - pass rate across all test cases, cycle duration and delta vs the 7-day baseline, 0-100 health index.
2. **Risk and milestone forecast** - Blocker/Critical Jiras against release gates, MTBF stability, slippage estimate (optimistic / expected / pessimistic) from build burn-down.
3. **Anomalies and blind spots** - DUT variance, hardware-dependent clusters, LE Audio vs A2DP cross-talk, blocked-test concentration, coverage gaps.
4. **Semantic bug clustering** - Jiras grouped by firmware subsystem; recurring vs single-instance signatures.
5. **Next actions** - tasks by role with targeted re-run subsets (copyable test-ID lists).
6. Supporting views: per-suite execution with 25 + 15 feature breakdowns, every failed/blocked test, MTBF heat map and crash-to-Jira mapping, KPI table, Jira explorer, build-over-build trends.

Dark and light blue themes (toggle in the header). Charts have hover tooltips and a "Table view" for accessibility.

## LLM mode (OpenAI)

Click **AI insights (OpenAI)** and enter an API key. The key is typed at runtime, sent only to `api.openai.com` from your browser, and never written to a file in this repo (kept in `sessionStorage`, or `localStorage` if you tick "Remember"). The model rewrites the TL;DR, risk and anomaly commentary, re-classifies Jiras semantically and prioritises next actions. Output is validated against the computed facts (pass rate present, valid role/priority, no unknown Jira IDs, >=90% Jira coverage); anything invalid falls back to the built-in rule engine. Without a key the dashboard is fully functional using the deterministic rules.

Because the key is used client-side, use a restricted, low-limit key and do not publish a page with a key saved in your browser.

## Layout

- `generator/` - catalog, test plan generator, run-data generator
- `dashboard/src/` - `engine.js` (analysis), `llm.js`, `charts.js`, `render.js`, `styles.css`, `template.html`
- `data/` - generated JSON
- `build.py` - bundles `dashboard/src` + data into `dashboard/index.html`
