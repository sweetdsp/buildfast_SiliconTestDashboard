/* Intelligence engine: deterministic analysis of the test-run JSON (no network). */
(function (root) {
'use strict';
const HOUR = 3600000, DAY = 86400000;
const OPEN_STATES = ['Open', 'In Progress'];
const SEV_RANK = { Blocker: 0, Critical: 1, Medium: 2, Trivial: 3 };
const SEV_WEIGHT = { Blocker: 8, Critical: 4, Medium: 1, Trivial: 0.25 };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const ms = (s) => Date.parse(s);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const pretty = (s) => String(s).replace(/_/g, ' ');

const SUBSYSTEMS = {
  HCI: 'Host-Controller Interface (HCI)', AUDIO: 'Audio Codec / LC3 & ISO', LM: 'Link Manager / Link Layer',
  PHY: 'PHY & Baseband', HOST: 'Host Stack (L2CAP / GATT / ATT)', SEC: 'Security (SMP / SSP)',
  PWR: 'Coexistence & Power Management', OTHER: 'Unclassified',
};
const OWNER = { HCI: 'Firmware Team', AUDIO: 'Firmware Team', LM: 'Firmware Team', SEC: 'Firmware Team', PWR: 'Firmware Team',
  PHY: 'RF / PHY Team', HOST: 'Host Stack Team', OTHER: 'Firmware Team' };

const RULES = {
  HCI: [[/\bhci\b|hci_/i, 3], [/command (complete|status)/i, 3], [/opcode/i, 2], [/vendor[- ]specific/i, 3], [/completed[_ ]packets/i, 3], [/event ordering/i, 3], [/transport/i, 1.5]],
  AUDIO: [[/lc3/i, 4], [/codec/i, 2], [/\b(cis|bis|big|cig)\b/i, 3], [/isochronous|\biso\b/i, 3], [/\bsdu\b/i, 2], [/a2dp|\bsbc\b|esco|cvsd/i, 2.5], [/audio (glitch|dropout|stutter)|presentation delay|unicast/i, 2], [/audio/i, 1]],
  LM: [[/link manager|link layer|\blmp\b|\bll_/i, 3], [/role switch/i, 3], [/supervision/i, 2], [/connection (parameter )?update/i, 2.5], [/advertising set|advertising report|scan window|scanner/i, 2], [/piconet|control pdu|procedure collision/i, 2]],
  PHY: [[/\bphy\b|baseband/i, 2], [/\bagc\b|gain/i, 3], [/\brssi\b|sensitivity|packet error rate|\bper\b/i, 3], [/frequency offset|oscillator/i, 3], [/tx power|\bpa\b|rf (front|calibration)|calibration/i, 2.5], [/\bafh\b|channel map/i, 1.5]],
  HOST: [[/l2cap/i, 3], [/\bgatt\b|\batt\b|\bmtu\b/i, 3], [/\bsdp\b|avrcp|obex|rfcomm/i, 2.5], [/credit/i, 1.5], [/notification|read blob|service discovery/i, 1.5], [/host stack/i, 3]],
  SEC: [[/\bsmp\b|pairing/i, 3], [/bonding|link key|key distribution|encryption key/i, 3], [/\brpa\b|resolvable|resolving/i, 3], [/\bssp\b|secure simple|numeric comparison|authentication/i, 2.5]],
  PWR: [[/coex/i, 3.5], [/wi-?fi|antenna|arbiter/i, 2], [/suspend|resume|wake lock|wake from/i, 3], [/low power|clock gating|sniff|current (consumption|draw)|idle current|\bua\b/i, 2.5], [/watchdog/i, 1], [/power/i, 1]],
};

function classifyTicket(t) {
  const sumTxt = t.summary + ' ' + (t.crash_signature || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  let best = 'OTHER', bestScore = 0;
  for (const [key, rules] of Object.entries(RULES)) {
    let s = 0;
    for (const [re, w] of rules) {
      if (re.test(sumTxt)) s += 2 * w;
      if (re.test(t.description)) s += w;
    }
    if (s > bestScore) { bestScore = s; best = key; }
  }
  return best;
}

function pearson(a, b) {
  const n = a.length; if (n < 3) return 0;
  const ma = sum(a) / n, mb = sum(b) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function healthIndex(m, minMtbf) {
  const parts = {
    tests: clamp((m.passRate - 85) / 15) * 35,
    blocked: clamp(1 - m.blockedPct / 3) * 10,
    defects: Math.exp(-(m.blockers * 0.25 + m.criticals * 0.04)) * 20,
    stability: clamp(m.mtbf / (minMtbf * 1.2)) * 20,
    kpi: clamp((m.kpiPass + 0.5 * m.kpiDeg) / Math.max(1, m.kpiPass + m.kpiDeg + m.kpiFail)) * 15,
  };
  const score = sum(Object.values(parts));
  return { score: round(score, 1), parts };
}
function healthBand(score) {
  if (score >= 85) return { label: 'Release ready', level: 'good' };
  if (score >= 70) return { label: 'Stable', level: 'good' };
  if (score >= 50) return { label: 'At risk', level: 'warning' };
  return { label: 'Critical', level: 'critical' };
}

function fmtDuration(h) {
  const d = Math.floor(h / 24), hh = Math.floor(h - d * 24), mm = Math.round((h - Math.floor(h)) * 60);
  return `${d}d ${hh}h ${String(mm).padStart(2, '0')}m`;
}
function fmtDate(msv) { return new Date(msv).toISOString().slice(0, 10); }

function logSlopeRatio(series) {
  const pts = series.map((v, i) => [i, Math.log(Math.max(v, 0.5))]);
  const n = pts.length, mx = sum(pts.map((p) => p[0])) / n, my = sum(pts.map((p) => p[1])) / n;
  let num = 0, den = 0; pts.forEach(([x, y]) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return Math.exp(num / den);
}
function buildsGeometric(series, limit) {
  const cur = series[series.length - 1];
  if (cur <= limit) return { builds: 0, ratio: null };
  const r = logSlopeRatio(series);
  if (r >= 0.999) return { builds: Infinity, ratio: r };
  return { builds: Math.ceil(Math.log(limit / cur) / Math.log(r)), ratio: r };
}
function buildsLinear(series, limit) {
  const cur = series[series.length - 1];
  if (cur <= limit) return { builds: 0, drop: null };
  const drop = (series[0] - cur) / (series.length - 1);
  return { builds: drop > 0 ? Math.ceil((cur - limit) / drop) : Infinity, drop };
}

function analyze(data) {
  const meta = data.test_run_metadata, ctx = data.release_context, gates = ctx.release_gates;
  const dom = (n) => data.domain_summaries.find((d) => d.domain === n);
  const hci = dom('HCI_REGRESSION'), phone = dom('PHONE_TESTING'), mtbf = dom('MTBF'), kpi = dom('KPI_AUDIO');
  const tickets = data.jira_telemetry.tickets, byId = Object.fromEntries(tickets.map((t) => [t.id, t]));
  const A = { meta, ctx, hci, phone, mtbf, kpi, tickets, byId };

  // ---- totals ----
  const total = hci.total_tests + phone.total_tests;
  const passed = hci.passed + phone.passed, failed = hci.failed + phone.failed, blocked = hci.blocked + phone.blocked;
  A.totals = { total, passed, failed, blocked, passRate: passed / total * 100, executedPassRate: passed / (total - blocked) * 100,
    blockedPct: blocked / total * 100, hciPassRate: hci.passed / hci.total_tests * 100, phonePassRate: phone.passed / phone.total_tests * 100,
    recovered: hci.rerun_log.recovered_on_retry + phone.rerun_log.recovered_on_retry };

  // ---- duration ----
  const durH = (ms(meta.end_time) - ms(meta.start_time)) / HOUR;
  A.duration = { hours: durH, baseline: meta.baseline_cycle_hours, deltaH: durH - meta.baseline_cycle_hours,
    text: fmtDuration(durH), deltaText: `${durH >= meta.baseline_cycle_hours ? '+' : ''}${round(durH - meta.baseline_cycle_hours, 1)} h (${round((durH - meta.baseline_cycle_hours) / 24, 2)} d)`,
    byDomain: [hci, phone, mtbf, kpi].map((d) => ({ domain: d.domain, hours: d.execution_duration_hours, baseline: d.baseline_duration_hours, ext: d.execution_duration_hours - d.baseline_duration_hours })) };

  // ---- defects / KPI / MTBF ----
  const open = (s) => tickets.filter((t) => t.severity === s && OPEN_STATES.includes(t.status));
  A.open = { blockers: open('Blocker'), criticals: open('Critical') };
  const kpiCounts = { pass: 0, deg: 0, fail: 0 };
  kpi.metrics.forEach((m) => { if (m.status === 'PASS') kpiCounts.pass++; else if (m.status === 'DEGRADED') kpiCounts.deg++; else kpiCounts.fail++; });
  A.kpiCounts = kpiCounts;
  const perDut = mtbf.dut_inventory.map((d) => ({ ...d, mtbfHours: d.crashes ? mtbf.planned_hours_per_dut / d.crashes : null }));
  const fleetMtbf = mtbf.total_crashes ? mtbf.total_operational_hours / mtbf.total_crashes : mtbf.total_operational_hours;
  const histBuckets = [0, 0, 0, 0, 0];
  mtbf.crash_events.forEach((e) => { histBuckets[Math.min(4, Math.floor(e.hours_into_run / 24))]++; });
  A.stab = { perDut, fleetMtbf, dayBuckets: histBuckets, crashes: mtbf.total_crashes, unique: mtbf.unique_crashes,
    recurring: data.jira_telemetry.crash_mapping.filter((c) => c.occurrences >= 3 && c.affected_duts.length >= 2),
    single: data.jira_telemetry.crash_mapping.filter((c) => c.occurrences === 1) };

  // ---- health ----
  const cur = { passRate: A.totals.passRate, blockedPct: A.totals.blockedPct, blockers: A.open.blockers.length, criticals: A.open.criticals.length,
    mtbf: fleetMtbf, kpiPass: kpiCounts.pass, kpiDeg: kpiCounts.deg, kpiFail: kpiCounts.fail };
  A.health = { ...healthIndex(cur, gates.min_fleet_mtbf_hours), ...healthBand(healthIndex(cur, gates.min_fleet_mtbf_hours).score) };
  const hist = data.build_history.map((h) => {
    const m = { passRate: h.pass_rate_pct, blockedPct: h.blocked / 6000 * 100, blockers: h.open_blockers, criticals: h.open_criticals,
      mtbf: h.fleet_mtbf_hours, kpiPass: h.kpi_pass, kpiDeg: h.kpi_degraded, kpiFail: h.kpi_fail };
    return { build: h.build, date: h.date, nonpass: h.failed + h.blocked, blocked: h.blocked, blockers: h.open_blockers, criticals: h.open_criticals,
      totalCrashes: h.total_crashes, uniqueCrashes: h.unique_crashes, mtbf: h.fleet_mtbf_hours, kpiFail: h.kpi_fail, kpiDeg: h.kpi_degraded,
      passRate: h.pass_rate_pct, health: healthIndex(m, gates.min_fleet_mtbf_hours).score };
  });
  hist.push({ build: meta.firmware_build, date: fmtDate(ms(meta.end_time)), nonpass: failed + blocked, blocked, blockers: cur.blockers, criticals: cur.criticals,
    totalCrashes: mtbf.total_crashes, uniqueCrashes: mtbf.unique_crashes, mtbf: fleetMtbf, kpiFail: kpiCounts.fail, kpiDeg: kpiCounts.deg,
    passRate: A.totals.passRate, health: A.health.score, current: true });
  A.series = hist;

  // ---- gates ----
  const mk = (key, label, actual, op, limit, unit, builds) => {
    const ok = op === '<=' ? actual <= limit : actual >= limit;
    const margin = op === '<=' ? (limit ? (limit - actual) / limit : (actual === 0 ? 1 : -1)) : (actual - limit) / limit;
    return { key, label, actual, op, limit, unit, status: ok ? (margin < 0.15 ? 'WATCH' : 'PASS') : 'FAIL', builds };
  };
  const S = (k) => hist.map((h) => h[k]);
  const nonpassLimit = (1 - gates.min_pass_rate_pct / 100) * total, blockedLimit = gates.max_blocked_pct / 100 * total;
  const crashLimit = mtbf.total_operational_hours / gates.min_fleet_mtbf_hours;
  const bPass = buildsGeometric(S('nonpass'), nonpassLimit), bBlocked = buildsGeometric(S('blocked'), blockedLimit);
  const bBlockers = buildsLinear(S('blockers'), gates.max_open_blockers), bCrit = buildsLinear(S('criticals'), gates.max_open_criticals);
  const bMtbf = buildsGeometric(S('totalCrashes'), crashLimit), bKf = buildsLinear(S('kpiFail'), gates.max_kpi_failed), bKd = buildsLinear(S('kpiDeg'), gates.max_kpi_degraded);
  A.gates = [
    mk('blockers', 'Open Blocker Jiras', cur.blockers, '<=', gates.max_open_blockers, '', bBlockers),
    mk('criticals', 'Open Critical Jiras', cur.criticals, '<=', gates.max_open_criticals, '', bCrit),
    mk('passRate', 'Overall pass rate', round(cur.passRate, 2), '>=', gates.min_pass_rate_pct, '%', bPass),
    mk('blocked', 'Blocked test cases', round(cur.blockedPct, 2), '<=', gates.max_blocked_pct, '%', bBlocked),
    mk('mtbf', 'Fleet MTBF', round(fleetMtbf, 1), '>=', gates.min_fleet_mtbf_hours, ' h', bMtbf),
    mk('kpiFail', 'KPI metrics FAILED', cur.kpiFail, '<=', gates.max_kpi_failed, '', bKf),
    mk('kpiDeg', 'KPI metrics DEGRADED', cur.kpiDeg, '<=', gates.max_kpi_degraded, '', bKd),
  ];

  // ---- slippage forecast ----
  const finite = A.gates.map((g) => g.builds.builds);
  const worst = Math.max(...finite);
  const bottleneck = A.gates.filter((g) => g.builds.builds === worst).map((g) => g.label);
  const cadence = ctx.build_cadence_days, runEnd = ms(meta.end_time), target = ms(ctx.target_date + 'T00:00:00Z');
  const scen = (name, n) => { const date = runEnd + n * cadence * DAY; return { name, builds: n, date: fmtDate(date), slipDays: Math.ceil((date - target) / DAY) }; };
  A.forecast = {
    target: ctx.target_date, milestone: ctx.milestone, cadence, daysToTarget: Math.ceil((target - runEnd) / DAY), bottleneck, expectedBuilds: worst,
    scenarios: Number.isFinite(worst) ? [scen('Optimistic', Math.max(worst > 0 ? 1 : 0, Math.ceil(worst * 0.75))), scen('Expected', worst), scen('Pessimistic', Math.ceil(worst * 1.5))] : [],
    ratio: bPass.ratio, nonpassLimit: round(nonpassLimit, 0),
    projection: (() => { const pts = []; let v = cur.passRate >= 0 ? failed + blocked : 0; const r = bPass.ratio || 1; for (let i = 1; i <= Math.max(2, Math.min(8, (worst || 0) + 1)); i++) { v = v * r; pts.push(round(v, 0)); } return pts; })(),
  };
  const allPass = A.gates.every((g) => g.status !== 'FAIL');
  A.verdict = allPass ? { label: 'GO', level: 'good' } : (Number.isFinite(worst) && A.forecast.scenarios[1].slipDays <= 0 ? { label: 'AT RISK - recoverable', level: 'warning' } : { label: 'NO-GO - slip expected', level: 'critical' });
  A.failingGates = A.gates.filter((g) => g.status === 'FAIL');

  // ---- clustering (rules) ----
  A.cluster = clusterTickets(tickets, null);
  // ---- anomalies ----
  A.anomalies = detectAnomalies(A);
  // ---- actions ----
  A.actions = buildActions(A);
  A.insightSource = 'rules';
  A.tldr = buildTldr(A);
  A.riskNarrative = buildRiskNarrative(A);
  return A;
}

function clusterTickets(tickets, assignments) {
  const groups = {};
  tickets.forEach((t) => {
    const key = (assignments && assignments[t.id]) || classifyTicket(t);
    (groups[key] = groups[key] || []).push(t);
  });
  const out = Object.entries(groups).map(([key, ts]) => {
    const occ = (t) => t.linked_failed_tests + t.linked_blocked_tests + t.linked_crash_events;
    const isOpen = (t) => OPEN_STATES.includes(t.status);
    return {
      key, name: SUBSYSTEMS[key], count: ts.length, tickets: ts.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || occ(b) - occ(a)),
      bySev: Object.fromEntries(['Blocker', 'Critical', 'Medium', 'Trivial'].map((s) => [s, ts.filter((t) => t.severity === s).length])),
      open: ts.filter(isOpen).length, failedTests: sum(ts.map((t) => t.linked_failed_tests)), blockedTests: sum(ts.map((t) => t.linked_blocked_tests)),
      crashes: sum(ts.map((t) => t.linked_crash_events)),
      recurring: ts.filter((t) => (t.crash_signature && t.linked_crash_events >= 2) || t.linked_failed_tests + t.linked_blocked_tests >= 3),
      single: ts.filter((t) => occ(t) === 1), idle: ts.filter((t) => occ(t) === 0).length,
      score: sum(ts.filter(isOpen).map((t) => SEV_WEIGHT[t.severity] * (1 + Math.log1p(occ(t))))),
    };
  });
  return out.sort((a, b) => b.score - a.score);
}

function detectAnomalies(A) {
  const out = [];
  const { mtbf, kpi, hci, phone } = A;
  const add = (o) => out.push(o);

  // 1. DUT variance
  const crashes = A.stab.perDut.map((d) => d.crashes), mean = sum(crashes) / crashes.length;
  const sd = Math.sqrt(sum(crashes.map((c) => (c - mean) ** 2)) / crashes.length) || 1;
  const minCrash = Math.min(...crashes.filter((c) => c > 0)), best = A.stab.perDut.find((d) => d.crashes === minCrash);
  A.stab.perDut.filter((d) => (d.crashes - mean) / sd >= 1.5).sort((a, b) => b.crashes - a.crashes).forEach((d) => {
    const jiras = [...new Set(mtbf.crash_events.filter((e) => e.dut_id === d.dut_id).map((e) => e.jira_id))];
    add({ type: 'DUT variance', level: 'high', title: `${d.dut_id} crashed ${round(d.crashes / minCrash, 1)}x more than ${best.dut_id}`,
      detail: `${d.dut_id} (${pretty(d.platform)}, ${d.rf_frontend_rev}) logged ${d.crashes} crashes vs ${best.crashes} on ${best.dut_id} and a fleet mean of ${round(mean, 1)} (z = ${round((d.crashes - mean) / sd, 1)}). Distinct signatures: ${jiras.length}.`,
      jira: jiras });
  });
  // 1b. platform concentration (hardware dependent)
  const platOf = (id) => mtbf.dut_inventory.find((d) => d.dut_id === id).platform;
  const byPlat = {}, dutShare = {};
  mtbf.crash_events.forEach((e) => { const p = platOf(e.dut_id); byPlat[p] = (byPlat[p] || 0) + 1; });
  mtbf.dut_inventory.forEach((d) => { dutShare[d.platform] = (dutShare[d.platform] || 0) + 1; });
  const sigPlats = {};
  mtbf.crash_events.forEach((e) => { (sigPlats[e.crash_signature] = sigPlats[e.crash_signature] || new Set()).add(platOf(e.dut_id)); });
  Object.entries(byPlat).forEach(([p, n]) => {
    const share = n / mtbf.total_crashes, exp = dutShare[p] / mtbf.dut_inventory.length;
    if (share >= 1.5 * exp && n >= 8) {
      const only = Object.entries(sigPlats).filter(([, st]) => st.size === 1 && st.has(p)).map(([k]) => k);
      const jiras = [...new Set(mtbf.crash_events.filter((e) => only.includes(e.crash_signature)).map((e) => e.jira_id))];
      add({ type: 'Hardware dependent', level: 'high', title: `${pretty(p)} DUTs hold ${round(share * 100, 0)}% of MTBF crashes`,
        detail: `${dutShare[p]} of ${mtbf.dut_inventory.length} DUTs (${round(exp * 100, 0)}%) produce ${n} of ${mtbf.total_crashes} crashes. ${only.length ? 'Signatures seen only on this platform: ' + only.join(', ') + '. ' : ''}Suggests an RF front-end or platform-specific trigger rather than pure firmware logic.`,
        jira: jiras });
    }
  });
  // 1c. phone failures by platform for audio features
  const audioF = ['LE_Audio_Headset', 'LE_Audio_Broadcast', 'A2DP_Streaming'];
  const pf = phone.failed_tests.filter((t) => audioF.includes(t.feature)), pc = {}; pf.forEach((t) => { pc[t.platform] = (pc[t.platform] || 0) + 1; });
  const top = Object.entries(pc).sort((a, b) => b[1] - a[1])[0];
  if (top && pf.length >= 8 && top[1] / pf.length >= 0.55) add({ type: 'Hardware dependent', level: 'medium',
    title: `Phone audio failures skew to ${pretty(top[0])} (${round(top[1] / pf.length * 100, 0)}%)`,
    detail: `${top[1]} of ${pf.length} failed/blocked LE Audio and A2DP phone tests ran on ${pretty(top[0])} versus an even 33% split expected.`, jira: [] });

  // 2. cross-talk
  const kStart = ms(kpi.start_time), le = new Array(12).fill(0);
  hci.failed_tests.filter((t) => t.status === 'FAILED' && /LE_Audio|Isochronous/.test(t.feature)).forEach((t) => { const h = (ms(t.timestamp) - kStart) / HOUR; if (h >= 0 && h < 72) le[Math.floor(h / 6)]++; });
  A.crosstalk = { buckets: le, labels: kpi.metrics[0].samples.map((s) => s.timestamp), series: [] };
  const lm = sum(le) / 12, lsd = Math.sqrt(sum(le.map((c) => (c - lm) ** 2)) / 12) || 1;
  const peaks = le.map((c, i) => [c, i]).filter(([c]) => (c - lm) / lsd >= 1.0).map(([, i]) => i);
  kpi.metrics.forEach((m) => {
    const r = pearson(le, m.samples.map((s) => s.value));
    A.crosstalk.series.push({ name: m.metric_name, r, status: m.status });
  });
  const hits = A.crosstalk.series.filter((s) => s.r >= 0.6 && s.status !== 'PASS').sort((a, b) => b.r - a.r);
  if (hits.length && peaks.length) {
    const w0 = new Date(kStart + Math.min(...peaks) * 6 * HOUR).toISOString().slice(5, 16).replace('T', ' '), w1 = new Date(kStart + (Math.max(...peaks) + 1) * 6 * HOUR).toISOString().slice(5, 16).replace('T', ' ');
    add({ type: 'Feature cross-talk', level: 'high', title: `LE Audio failure spike coincides with ${hits.slice(0, 3).map((h) => pretty(h.name)).join(', ')} degradation`,
      detail: `LE Audio / ISO failures peak at ${Math.max(...le)} per 6 h window between ${w0} and ${w1} UTC. Per-window correlation with KPI samples: ${hits.map((h) => `${pretty(h.name)} r=${round(h.r, 2)}`).join('; ')}. Common cause in the ISO scheduler / codec buffering path is likely.`,
      jira: ['BTFW-4012', 'BTFW-4027', 'BTFW-4057'].filter((j) => A.byId[j]) });
  }
  // KPI regression vs previous build
  const reg = kpi.metrics.filter((m) => m.status !== 'PASS').map((m) => ({ m, d: Math.abs(m.measured_avg_value - m.previous_build_avg_value) / m.previous_build_avg_value * 100 })).filter((x) => x.d > 15);
  if (reg.length) add({ type: 'KPI regression', level: 'medium', title: `${reg.length} KPI metrics regressed more than 15% vs previous build`,
    detail: reg.map((x) => `${pretty(x.m.metric_name)} ${x.m.previous_build_avg_value} -> ${x.m.measured_avg_value} (${round(x.d, 0)}%)`).join('; ') + '.', jira: kpi.metrics.length ? A.tickets.filter((t) => t.source_domain === 'KPI_AUDIO' && t.linked_metric).map((t) => t.id) : [] });

  // 3. blocked concentration
  const gate = {};
  [hci, phone].forEach((d) => d.failed_tests.filter((t) => t.status === 'BLOCKED').forEach((t) => { const g = gate[t.blocked_by] = gate[t.blocked_by] || { id: t.blocked_by, n: 0, features: {} }; g.n++; g.features[t.feature] = (g.features[t.feature] || 0) + 1; }));
  A.blockedGates = Object.values(gate).sort((a, b) => b.n - a.n);
  A.blockedGates.filter((g) => g.n >= 10).forEach((g) => {
    const t = A.byId[g.id], feats = Object.entries(g.features).sort((a, b) => b[1] - a[1]);
    add({ type: 'Blocked concentration', level: g.n >= 30 ? 'high' : 'medium', title: `${g.id} gates ${g.n} blocked tests (${round(g.n / A.totals.blocked * 100, 0)}% of all blocked)`,
      detail: `${t.summary}. Blocked tests: ${feats.map(([f, n]) => `${pretty(f)} ${n}`).join(', ')}. These tests are not failing - they cannot run - so true quality in these areas is unknown until the driver bug is fixed.`, jira: [g.id] });
  });
  // 4. coverage blind spots
  A.blindspots = [];
  [['HCI Regression', hci], ['Phone Testing', phone]].forEach(([label, d]) => Object.entries(d.feature_breakdown).forEach(([f, v]) => {
    const eff = v.requirement_coverage_pct * (1 - v.blocked / v.total);
    if (eff < 75) A.blindspots.push({ domain: label, feature: f, coverage: v.requirement_coverage_pct, blocked: v.blocked, total: v.total, effective: round(eff, 1) });
  }));
  A.blindspots.sort((a, b) => a.effective - b.effective);
  if (A.blindspots.length) add({ type: 'Untested gap', level: 'medium', title: `${A.blindspots.length} features have effective requirement coverage below 75%`,
    detail: A.blindspots.slice(0, 6).map((b) => `${pretty(b.feature)} ${b.effective}% (${b.domain.split(' ')[0]})`).join('; ') + '. Effective coverage = spec requirement coverage reduced by blocked tests.', jira: [] });
  // 5. late crashes
  const late = mtbf.crash_events.filter((e) => e.hours_into_run >= 96);
  if (late.length) add({ type: 'Stability', level: 'medium', title: `${late.length} crash(es) still occurring in the final 24 h of MTBF`,
    detail: `${late.map((e) => `${e.dut_id} ${e.crash_signature}`).join('; ')}. Early crashes decay (${A.stab.dayBuckets[0]} in day 1 vs ${A.stab.dayBuckets[4]} in day 5) but the fleet is not yet crash-free.`, jira: [...new Set(late.map((e) => e.jira_id))] });
  // 6. flaky hot-spots
  const flaky = [];
  [hci, phone].forEach((d) => Object.entries(d.feature_breakdown).forEach(([f, v]) => { if (v.recovered_on_retry >= 4) flaky.push([f, v.recovered_on_retry, v.total]); }));
  flaky.sort((a, b) => b[1] - a[1]);
  A.flaky = flaky;
  if (flaky.length) add({ type: 'Transient failures', level: 'low', title: `${A.totals.recovered} tests passed only after automatic retry`,
    detail: `Most retry-recovered tests sit in ${flaky.slice(0, 3).map((f) => `${pretty(f[0])} (${f[1]})`).join(', ')} - the same areas with persistent failures, so these are likely timing-sensitive defects, not bench flakiness.`, jira: [] });
  const lv = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => lv[a.level] - lv[b.level]);
}
function buildActions(A) {
  const acts = []; let n = 0;
  const share = (t) => t.linked_failed_tests + t.linked_blocked_tests + t.linked_crash_events;
  const sub = (t) => classifyTicket(t);
  const short = (t) => t.summary.replace(/^Controller crash: /, '').replace(/^Auto-filed performance regression: /, '');
  const hciRate = A.hci.baseline_duration_hours / A.hci.total_tests, phRate = A.phone.baseline_duration_hours / A.phone.total_tests;
  const rerunEst = (ids) => ids.reduce((s, id) => s + (id.startsWith('HCI') ? hciRate : phRate), 0);
  const push = (a) => acts.push({ id: 'A' + String(++n).padStart(2, '0'), ...a });

  A.open.blockers.sort((a, b) => share(b) - share(a)).forEach((t) => {
    const k = sub(t);
    push({ role: OWNER[k], area: SUBSYSTEMS[k], priority: 'P0', jira: [t.id], impact: t.linked_blocked_tests + t.linked_failed_tests,
      title: `Fix ${t.id} (${short(t)}) immediately`,
      detail: `Unblocks ${t.linked_blocked_tests} blocked tests and clears ${t.linked_failed_tests} failures${t.linked_crash_events ? `; removes ${t.linked_crash_events} MTBF crash occurrences across ${new Set(A.mtbf.crash_events.filter((e) => e.jira_id === t.id).map((e) => e.dut_id)).size} DUTs` : ''}. Status: ${t.status}.` });
  });
  A.open.criticals.filter((t) => share(t) >= 3).sort((a, b) => share(b) - share(a)).slice(0, 5).forEach((t) => {
    const k = sub(t);
    push({ role: OWNER[k], area: SUBSYSTEMS[k], priority: 'P1', jira: [t.id], impact: share(t),
      title: `Root-cause ${t.id}: ${short(t)}`,
      detail: `${t.linked_failed_tests} failed, ${t.linked_blocked_tests} blocked test(s)${t.linked_crash_events ? `, ${t.linked_crash_events} crash occurrence(s)` : ''}. Status: ${t.status}.` });
  });
  // targeted re-run subsets
  const rerunTickets = [...A.open.blockers, ...A.open.criticals].filter((t) => t.linked_test_ids.length >= 5).sort((a, b) => b.linked_test_ids.length - a.linked_test_ids.length).slice(0, 4);
  rerunTickets.forEach((t) => {
    const ids = t.linked_test_ids, est = rerunEst(ids), feats = [...new Set(ids.map((id) => id.split('-')[1]))];
    push({ role: 'QA / Test Automation', area: 'Targeted re-run', priority: t.severity === 'Blocker' ? 'P1' : 'P2', jira: [t.id], impact: ids.length,
      title: `After ${t.id} fix, re-run only ${ids.length} tests (not the ${A.totals.total}-case cycle)`,
      detail: `Subset covers ${feats.length} feature group(s) and is about ${round(ids.length / A.totals.total * 100, 1)}% of the plan - roughly ${round(est, 1)} h of bench time at baseline throughput versus ${A.duration.baseline} h for a full cycle.`,
      rerun: { ticket: t.id, ids, estHours: round(est, 1) } });
  });
  // KPI
  const badK = A.kpi.metrics.filter((m) => m.status !== 'PASS');
  if (badK.length) push({ role: 'Firmware Team', area: SUBSYSTEMS.AUDIO, priority: 'P1', jira: A.tickets.filter((t) => t.linked_metric).map((t) => t.id), impact: badK.length,
    title: `Investigate audio latency / jitter regression (${badK.map((m) => pretty(m.metric_name)).join(', ')})`,
    detail: 'KPI degradation tracks the LE Audio failure spike, pointing at ISO scheduling or codec buffering contention. Profile the ISO scheduler under concurrent CIG + A2DP load.' });
  if (badK.length) push({ role: 'QA / Test Automation', area: 'Targeted re-run', priority: 'P2', jira: [], impact: badK.length,
    title: `Re-run the KPI sub-matrix only (${badK.length} of ${A.kpi.metrics.length} metrics)`,
    detail: `Repeat ${badK.map((m) => pretty(m.metric_name)).join(', ')} after the audio fixes: about ${Math.max(6, Math.round(72 * badK.length / A.kpi.metrics.length))} h versus the 72 h full KPI run.` });
  // hardware-dependent
  const hw = A.anomalies.find((a) => a.type === 'Hardware dependent' && a.level === 'high');
  if (hw) push({ role: 'Platform / Hardware', area: 'Bring-up', priority: 'P1', jira: hw.jira || [], impact: 8,
    title: 'Isolate the hardware-dependent crash cluster on MobilePlatform-B',
    detail: 'Swap the highest-crash DUT onto an RF-FE rev3 board and run the same build for 24 h; if crashes follow the board, escalate to RF/PHY, otherwise to firmware.' });
  // blindspots
  if (A.blindspots.length) push({ role: 'QA / Test Automation', area: 'Coverage', priority: 'P2', jira: [], impact: A.blindspots.length,
    title: `Close coverage gaps in ${A.blindspots.slice(0, 3).map((b) => pretty(b.feature)).join(', ')}`,
    detail: `Effective requirement coverage is ${A.blindspots.slice(0, 3).map((b) => b.effective + '%').join(' / ')}. Add test cases for uncovered spec requirements and unblock the gated ones.` });
  // flaky
  if (A.flaky.length) push({ role: 'QA / Test Automation', area: 'Stability of tests', priority: 'P2', jira: [], impact: A.totals.recovered,
    title: `Triage ${A.totals.recovered} retry-recovered tests`,
    detail: `Largest groups: ${A.flaky.slice(0, 3).map((f) => `${pretty(f[0])} (${f[1]})`).join(', ')}. Treat as latent timing defects; file Jiras instead of relying on retry.` });
  // program
  const f = A.forecast;
  push({ role: 'Release Management', area: 'Schedule', priority: A.verdict.level === 'critical' ? 'P0' : 'P1', jira: A.open.blockers.map((t) => t.id), impact: A.failingGates.length,
    title: Number.isFinite(f.expectedBuilds) ? `Re-baseline sign-off: gates projected to clear ${f.scenarios[1].date} (${f.scenarios[1].slipDays > 0 ? '+' : ''}${f.scenarios[1].slipDays} d vs ${f.target})` : 'Gates not converging - escalate',
    detail: `${A.failingGates.length} of ${A.gates.length} release gates fail; bottleneck: ${f.bottleneck.join(', ')}. Hold the next RC until all ${A.open.blockers.length} Blocker fixes are merged and run targeted re-runs first.` });
  const pr = { P0: 0, P1: 1, P2: 2 };
  return acts.sort((a, b) => pr[a.priority] - pr[b.priority] || b.impact - a.impact).map((a, i) => ({ ...a, id: 'A' + String(i + 1).padStart(2, '0') }));
}

function buildTldr(A) {
  const t = A.totals, d = A.duration, h = A.health, f = A.forecast;
  const worstB = A.open.blockers.slice().sort((a, b) => b.linked_blocked_tests - a.linked_blocked_tests)[0];
  return `Build ${A.meta.firmware_build} on ${A.meta.chipset_revision} passed ${t.passed.toLocaleString()} of ${t.total.toLocaleString()} test cases (${round(t.passRate, 1)}%), with ${t.failed} failed and ${t.blocked} blocked. ` +
    `The cycle took ${d.text}, ${round(d.deltaH, 1)} h over the ${d.baseline / 24}-day baseline because of failure re-runs. ` +
    `Health index is ${Math.round(h.score)}/100 (${h.label}). ${A.open.blockers.length} Blocker and ${A.open.criticals.length} Critical Jiras remain open` +
    (worstB ? `; ${worstB.id} alone gates ${worstB.linked_blocked_tests} tests` : '') + `. ` +
    `Fleet MTBF is ${round(A.stab.fleetMtbf, 1)} h (${A.stab.crashes} crashes, ${A.stab.unique} unique signatures) and ${A.kpiCounts.deg + A.kpiCounts.fail} of ${A.kpi.metrics.length} KPI metrics miss target. ` +
    `Verdict: ${A.verdict.label}${Number.isFinite(f.expectedBuilds) ? `; gates are projected to clear around ${f.scenarios[1].date}` : ''}.`;
}
function buildRiskNarrative(A) {
  const f = A.forecast, s = f.scenarios[1];
  return `${A.failingGates.length} of ${A.gates.length} release gates currently fail (${A.failingGates.map((g) => g.label).join(', ') || 'none'}). ` +
    (s ? `At the observed burn-down the slowest gate${f.bottleneck.length > 1 ? 's' : ''} (${f.bottleneck.join(', ')}) need${f.bottleneck.length > 1 ? '' : 's'} about ${f.expectedBuilds} more builds at a ${f.cadence}-day cadence, giving ${s.date} versus the ${f.target} target for ${f.milestone} (${s.slipDays > 0 ? '+' : ''}${s.slipDays} days).` : 'Burn-down has stalled; no convergence date can be projected.');
}

const api = { analyze, clusterTickets, classifyTicket, healthIndex, healthBand, buildTldr, buildRiskNarrative, buildActions, SUBSYSTEMS, OWNER, OPEN_STATES, SEV_RANK, fmtDuration, pearson, round, pretty };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
