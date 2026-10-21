/* LLM layer: OpenAI Chat Completions called from the browser with a key the user types in.
   The key is never embedded in the file. Output is validated; failures fall back to the rule engine. */
(function (root) {
'use strict';
const E = root.Engine;
const KEY_NAME = 'bt_dash_openai';
const ROLES = ['Firmware Team', 'RF / PHY Team', 'Host Stack Team', 'Platform / Hardware', 'QA / Test Automation', 'Release Management'];

function loadConfig() {
  const cfg = { key: '', model: 'gpt-4o-mini', remember: false };
  try { const l = JSON.parse(localStorage.getItem(KEY_NAME) || 'null'); if (l) return { ...cfg, ...l, remember: true }; } catch (e) { /* storage blocked */ }
  try { const s = JSON.parse(sessionStorage.getItem(KEY_NAME) || 'null'); if (s) return { ...cfg, ...s }; } catch (e) { /* storage blocked */ }
  return cfg;
}
function saveConfig(cfg) {
  try { localStorage.removeItem(KEY_NAME); sessionStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ }
  try { (cfg.remember ? localStorage : sessionStorage).setItem(KEY_NAME, JSON.stringify({ key: cfg.key, model: cfg.model })); } catch (e) { /* ignore */ }
}
function clearConfig() { try { localStorage.removeItem(KEY_NAME); sessionStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ } }

async function chat(cfg, system, user, signal) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'Request timed out' : 'Network error - could not reach api.openai.com (offline, blocked, or CORS).'); }
  if (!res.ok) {
    let msg = ''; try { msg = (await res.json()).error.message; } catch (e) { /* ignore */ }
    if (res.status === 401) throw new Error('OpenAI rejected the API key (401).');
    if (res.status === 429) throw new Error('OpenAI rate limit or quota reached (429). ' + msg);
    if (res.status === 404) throw new Error('Model not found or not available to this key: ' + cfg.model);
    throw new Error(`OpenAI error ${res.status}. ${msg}`);
  }
  const body = await res.json();
  try { return JSON.parse(body.choices[0].message.content); } catch (e) { throw new Error('Model returned invalid JSON.'); }
}

function buildFacts(A) {
  const r = E.round, t = A.totals;
  const brief = (x) => ({ id: x.id, severity: x.severity, status: x.status, summary: x.summary, failed: x.linked_failed_tests, blocked: x.linked_blocked_tests, crashes: x.linked_crash_events });
  return {
    build: A.meta.firmware_build, chipset: A.meta.chipset_revision, run_id: A.meta.run_id,
    totals: { total: t.total, passed: t.passed, failed: t.failed, blocked: t.blocked, pass_rate_pct: r(t.passRate, 2), recovered_on_retry: t.recovered },
    cycle: { duration_hours: r(A.duration.hours, 1), baseline_hours: A.duration.baseline, delta_hours: r(A.duration.deltaH, 1), by_domain: A.duration.byDomain.map((d) => ({ domain: d.domain, hours: d.hours, extension_hours: r(d.ext, 1) })) },
    health: { score: A.health.score, band: A.health.label, components: Object.fromEntries(Object.entries(A.health.parts).map(([k, v]) => [k, r(v, 1)])) },
    release_gates: A.gates.map((g) => ({ gate: g.label, actual: g.actual, limit: `${g.op} ${g.limit}`, status: g.status, builds_to_clear: Number.isFinite(g.builds.builds) ? g.builds.builds : 'not converging' })),
    forecast: { target_date: A.forecast.target, milestone: A.forecast.milestone, verdict: A.verdict.label, scenarios: A.forecast.scenarios },
    mtbf: { fleet_hours: r(A.stab.fleetMtbf, 1), total_crashes: A.stab.crashes, unique_signatures: A.stab.unique, per_dut: A.stab.perDut.map((d) => ({ dut: d.dut_id, platform: d.platform, crashes: d.crashes })) },
    kpi_not_passing: A.kpi.metrics.filter((m) => m.status !== 'PASS').map((m) => ({ metric: m.metric_name, target: m.target, measured: m.measured_avg, status: m.status, previous_build: m.previous_build_avg_value })),
    open_blockers: A.open.blockers.map(brief),
    top_open_criticals: A.open.criticals.slice().sort((a, b) => (b.linked_failed_tests + b.linked_blocked_tests + b.linked_crash_events) - (a.linked_failed_tests + a.linked_blocked_tests + a.linked_crash_events)).slice(0, 10).map(brief),
    anomalies: A.anomalies.map((a) => ({ type: a.type, level: a.level, title: a.title, detail: a.detail })),
    bug_clusters: A.cluster.map((c) => ({ subsystem: c.name, tickets: c.count, open: c.open, failed_tests: c.failedTests, blocked_tests: c.blockedTests, crash_occurrences: c.crashes, recurring: c.recurring.length, single_instance: c.single.length })),
    coverage_gaps: A.blindspots.map((b) => ({ feature: b.feature, effective_coverage_pct: b.effective })),
    rule_based_actions: A.actions.map((a) => ({ role: a.role, priority: a.priority, title: a.title, detail: a.detail, jira: a.jira })),
  };
}

const INSIGHT_SYSTEM = `You are the Bluetooth Test Infrastructure Dashboard Agent for a custom Bluetooth 5.2 chipset for mobile platforms. You write for Engineering Managers and Release Leads.
Use ONLY the facts in the user's JSON. Never invent numbers, dates, DUTs or Jira IDs. Be specific and concise.
Return a JSON object with exactly these keys:
- "tldr": string, max 120 words, plain prose. Must state the overall pass rate, the total cycle duration with its delta versus the 7-day baseline, the health index (0-100), and the biggest risk.
- "risk_commentary": string, max 90 words: release-gate readiness, MTBF stability, schedule slippage versus the target date.
- "anomaly_commentary": string, max 90 words: the most important non-obvious findings (DUT variance, hardware dependence, cross-talk between features, blocked-test concentration, untested gaps).
- "next_actions": array of 6 to 10 objects {"role","priority","title","detail","jira","rerun_subset"}. role is one of: ${ROLES.join(' | ')}. priority is "P0", "P1" or "P2". jira is an array of Jira IDs taken from the facts. rerun_subset is a short string naming the targeted re-run (specific features or tests) or null. Always recommend targeted re-run subsets rather than a full 6000-test cycle. Order by priority.`;

const CLUSTER_SYSTEM = `You classify Bluetooth firmware Jira tickets into the underlying firmware subsystem that most likely owns the root cause.
Allowed subsystem keys (use exactly one per ticket):
HCI = Host-Controller Interface: HCI commands/events, transport, flow control, vendor commands
AUDIO = Audio Codec / LC3 & ISO: LC3, codec buffers, CIS/BIS/BIG/CIG, isochronous data, A2DP codec, eSCO voice
LM = Link Manager / Link Layer: LMP, role switch, connection parameters, supervision, advertising/scanning scheduling
PHY = PHY & Baseband: radio, AGC/gain, RSSI, frequency offset, TX power, sensitivity/PER
HOST = Host Stack: L2CAP, GATT, ATT, SDP, AVRCP, OBEX
SEC = Security: SMP pairing, SSP, bonding, link keys, RPA
PWR = Coexistence & Power Management: WiFi coexistence, sniff/low power, suspend/resume, current draw
Decide from the root cause described, not from the test feature mentioned in the title. Return JSON {"assignments": {"<ticket id>": "<key>", ...}} covering every ticket given.`;

function validActions(list, validJira) {
  if (!Array.isArray(list)) return null;
  const out = [];
  list.forEach((a) => {
    if (!a || typeof a.title !== 'string' || typeof a.detail !== 'string') return;
    const role = ROLES.includes(a.role) ? a.role : null, pr = ['P0', 'P1', 'P2'].includes(a.priority) ? a.priority : null;
    if (!role || !pr) return;
    const mentioned = (a.title + ' ' + a.detail).match(/BTFW-\d+/g) || [];
    if (mentioned.some((j) => !validJira.has(j))) return;
    const jira = (Array.isArray(a.jira) ? a.jira : []).filter((j) => validJira.has(j));
    out.push({ role, priority: pr, title: a.title.slice(0, 220), detail: a.detail.slice(0, 600), jira, rerunSubset: typeof a.rerun_subset === 'string' ? a.rerun_subset.slice(0, 200) : null, source: 'llm' });
  });
  return out.length >= 3 ? out : null;
}

async function enrich(A, cfg, onProgress) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 90000);
  const validJira = new Set(A.tickets.map((t) => t.id));
  const res = { model: cfg.model, at: new Date().toISOString(), notes: [] };
  try {
    onProgress && onProgress('Writing executive insights...');
    const ins = await chat(cfg, INSIGHT_SYSTEM, JSON.stringify(buildFacts(A)), ctl.signal);
    const pr = Math.floor(A.totals.passRate) + '.';
    if (typeof ins.tldr === 'string' && ins.tldr.includes(pr)) res.tldr = ins.tldr; else res.notes.push('TL;DR failed validation (pass rate mismatch); using rule-based text.');
    if (typeof ins.risk_commentary === 'string') res.risk = ins.risk_commentary;
    if (typeof ins.anomaly_commentary === 'string') res.anomaly = ins.anomaly_commentary;
    const acts = validActions(ins.next_actions, validJira);
    if (acts) res.actions = acts; else res.notes.push('Next actions failed validation; using rule-based actions.');

    onProgress && onProgress('Clustering Jiras semantically...');
    const assign = {}, tickets = A.tickets.map((t) => ({ id: t.id, summary: t.summary, description: t.description.slice(0, 220) }));
    for (let i = 0; i < tickets.length; i += 90) {
      const out = await chat(cfg, CLUSTER_SYSTEM, JSON.stringify(tickets.slice(i, i + 90)), ctl.signal);
      Object.entries(out.assignments || {}).forEach(([id, k]) => { if (validJira.has(id) && E.SUBSYSTEMS[k] && k !== 'OTHER') assign[id] = k; });
    }
    const n = Object.keys(assign).length;
    if (n >= A.tickets.length * 0.9) res.assignments = assign; else res.notes.push(`Clustering covered only ${n}/${A.tickets.length} tickets; using rule-based clusters.`);
    return res;
  } finally { clearTimeout(timer); }
}

root.LLM = { loadConfig, saveConfig, clearConfig, enrich, ROLES };
})(window);
