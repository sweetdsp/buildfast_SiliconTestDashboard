/* Dashboard controller: builds every section from the analysis object and wires interactions. */
(function () {
'use strict';
const C = window.Charts, E = window.Engine, LLM = window.LLM;
const { esc, nf, chip, tip } = C;
const r1 = (x) => E.round(x, 1), pretty = E.pretty;
const DATA = JSON.parse(document.getElementById('run-data').textContent);
const A = E.analyze(DATA);
const RULES = { tldr: A.tldr, risk: A.riskNarrative, anomaly: null, actions: A.actions, cluster: A.cluster };
let LLMINS = null, source = 'rules', llmMeta = null;
const cur = () => (source === 'llm' && LLMINS ? LLMINS : RULES);
const CL_COLOR = { HCI: 'var(--s1)', AUDIO: 'var(--s2)', LM: 'var(--s3)', PHY: 'var(--s4)', HOST: 'var(--s5)', SEC: 'var(--s7)', PWR: 'var(--s8)', OTHER: 'var(--muted)' };
const SEV_CHIP = { Blocker: 'critical', Critical: 'serious', Medium: 'info', Trivial: 'muted' };
const SEV_COLOR = { Blocker: 'var(--crit)', Critical: 'var(--serious)', Medium: 'var(--s1)', Trivial: 'var(--muted)' };
const PLAT_COLOR = { 'MobilePlatform-A': 'var(--s1)', 'MobilePlatform-B': 'var(--s2)', 'MobilePlatform-C': 'var(--s3)' };
const dt = (s) => s.slice(5, 16).replace('T', ' ');
const secHead = (id, title, sub, extra = '') => `<div class="sec-head"><h2 id="h-${id}">${title}</h2>${extra}<p>${sub}</p></div>`;
const tile = (k, v, d, lvl) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${lvl ? chip(lvl, d) : d}</div></div>`;
const srcChip = () => (source === 'llm' && LLMINS ? chip('info', `LLM: ${llmMeta.model}`) : chip('muted', 'Rule-based engine'));
const ckeyMap = () => { const m = {}; cur().cluster.forEach((c) => c.tickets.forEach((t) => { m[t.id] = c.key; })); return m; };
const jiraTags = (ids) => (ids || []).map((j) => `<span class="tag mono" ${A.byId[j] ? tip(`<b>${j}</b> ${esc(A.byId[j].severity)} &middot; ${esc(A.byId[j].status)}<br>${esc(A.byId[j].summary)}`) : ''}>${esc(j)}</span>`).join(' ');

/* ---------------- 1. summary ---------------- */
function summary() {
  const t = A.totals, h = A.health, d = A.duration, p = h.parts;
  const comp = [['Test pass rate', p.tests, 35], ['Blocked tests', p.blocked, 10], ['Open Blocker/Critical Jiras', p.defects, 20], ['MTBF stability', p.stability, 20], ['KPI targets', p.kpi, 15]];
  return `<section class="sec" id="summary">${secHead('summary', 'Executive summary (TL;DR)', 'Automated synthesis for Engineering Managers and Release Leads.', srcChip())}
  <div class="card"><div class="hero"><div class="ring">${C.ring(h.score, h.level)}<div class="c"><div class="big">${Math.round(h.score)}</div><div class="lbl">health index / 100</div></div></div>
  <div><div class="badge-row">${chip(h.level, h.label)}${chip(A.verdict.level, 'Release: ' + A.verdict.label)}<span class="muted small">${esc(A.meta.firmware_build)} &middot; ${esc(A.meta.chipset_revision)}</span></div>
  <p class="tldr">${esc(cur().tldr)}</p></div></div>
  <div class="tiles">
   ${tile('Pass rate (all ' + nf(t.total) + ' test cases)', r1(t.passRate) + '%', `${nf(t.passed)} passed &middot; ${r1(t.executedPassRate)}% of executed`)}
   ${tile('Total cycle duration', d.text, `${d.deltaText} vs ${d.baseline / 24}-day baseline`, d.deltaH > 0 ? 'warning' : 'good')}
   ${tile('Failed / Blocked tests', `${t.failed} / ${t.blocked}`, `${t.recovered} more passed only after retry`)}
   ${tile('Open Blocker Jiras', A.open.blockers.length, 'gate: 0', A.open.blockers.length ? 'critical' : 'good')}
   ${tile('Open Critical Jiras', A.open.criticals.length, `gate: \u2264 ${A.ctx.release_gates.max_open_criticals}`, A.open.criticals.length > A.ctx.release_gates.max_open_criticals ? 'serious' : 'good')}
   ${tile('Fleet MTBF', r1(A.stab.fleetMtbf) + ' h', `${A.stab.crashes} crashes / ${A.mtbf.total_operational_hours} DUT-hours`)}
   ${tile('KPI targets met', `${A.kpiCounts.pass} / ${A.kpi.metrics.length}`, `${A.kpiCounts.deg} degraded, ${A.kpiCounts.fail} failed`)}
   ${A.forecast.scenarios.length ? tile('Projected gate clearance', A.forecast.scenarios[1].date, `${A.forecast.scenarios[1].slipDays > 0 ? '+' : ''}${A.forecast.scenarios[1].slipDays} days vs ${A.forecast.target} target`, A.forecast.scenarios[1].slipDays > 0 ? 'critical' : 'good') : tile('Projected gate clearance', 'n/a', 'burn-down not converging', 'critical')}
  </div>
  <details class="tv"><summary>How the health index is computed</summary><div class="scroll"><table class="t"><thead><tr><th>Component</th><th class="r">Points</th><th class="r">Max</th></tr></thead><tbody>${comp.map((c) => `<tr><td>${c[0]}</td><td class="r">${r1(c[1])}</td><td class="r">${c[2]}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="r"><b>${h.score}</b></td><td class="r">100</td></tr></tbody></table></div>
  <p class="small muted">Pass rate scales 85% to 100%; blocked share scales 0% to 3%; defects decay exponentially with open Blockers (x0.25) and Criticals (x0.04); MTBF is measured against 120% of the gate; KPI counts degraded metrics as half.</p></details></div></section>`;
}

/* ---------------- 2. risk ---------------- */
function risk() {
  const f = A.forecast, gl = A.ctx.release_gates;
  const gateRows = A.gates.map((g) => `<tr><td>${esc(g.label)}</td><td class="r"><b>${g.actual}${esc(g.unit)}</b></td><td class="r">${g.op === '<=' ? '&le;' : '&ge;'} ${g.limit}${esc(g.unit)}</td><td>${chip(g.status === 'PASS' ? 'good' : g.status === 'WATCH' ? 'warning' : 'critical', g.status)}</td><td class="r">${g.builds.builds === 0 ? '-' : Number.isFinite(g.builds.builds) ? g.builds.builds : 'n/a'}</td></tr>`).join('');
  const hist = A.series, end = Date.parse(A.meta.end_time);
  const proj = f.projection, xs = hist.map((h) => h.date.slice(5)).concat(proj.map((_, i) => new Date(end + (i + 1) * f.cadence * 86400000).toISOString().slice(5, 10)));
  const actual = hist.map((h) => h.nonpass).concat(proj.map(() => null));
  const projS = hist.map((_, i) => (i === hist.length - 1 ? hist[i].nonpass : null)).concat(proj);
  const burn = C.lineChart({ xs, series: [{ name: 'Failed + blocked (actual)', color: 'var(--s1)', values: actual }, { name: 'Projection at current burn-down', color: 'var(--s2)', values: projS, dash: true }], hlines: [{ y: f.nonpassLimit, label: `${gl.min_pass_rate_pct}% pass-rate gate (${f.nonpassLimit})` }], height: 215, aria: 'Failed plus blocked tests per build with projection' });
  const sc = f.scenarios.length ? f.scenarios.map((s) => `<div class="tile"><div class="k">${s.name} &middot; ${s.builds} build${s.builds === 1 ? '' : 's'}</div><div class="v" style="font-size:20px">${s.date}</div><div class="d">${chip(s.slipDays > 0 ? (s.slipDays > 14 ? 'critical' : 'warning') : 'good', (s.slipDays > 0 ? '+' : '') + s.slipDays + ' days vs target')}</div></div>`).join('') : '<p class="muted">Burn-down is not converging; no date can be projected.</p>';
  const blk = [...A.open.blockers, ...A.open.criticals.slice().sort((a, b) => (b.linked_blocked_tests + b.linked_failed_tests + b.linked_crash_events) - (a.linked_blocked_tests + a.linked_failed_tests + a.linked_crash_events)).slice(0, 6)];
  const dutRows = A.stab.perDut.slice().sort((a, b) => b.crashes - a.crashes).map((d) => ({ label: `${d.dut_id}`, value: d.crashes, color: PLAT_COLOR[d.platform], text: d.mtbfHours ? r1(d.mtbfHours) + ' h' : '>120 h', tip: `<b>${d.dut_id}</b> &middot; ${esc(pretty(d.platform))}<br>${d.crashes} crashes &middot; MTBF ${d.mtbfHours ? r1(d.mtbfHours) + ' h' : 'no crash in 120 h'}` }));
  return `<section class="sec" id="risk">${secHead('risk', 'Risk assessment &amp; milestone forecast', `Readiness against <b>${esc(f.milestone)}</b> (target ${f.target}, ${f.daysToTarget} days after this cycle ended).`, chip(A.verdict.level, A.verdict.label))}
  <div class="card" style="margin-bottom:14px"><p style="margin:0">${esc(cur().risk)}</p></div>
  <div class="grid g-12"><div class="card"><h3>Release gates</h3><div class="scroll"><table class="t"><thead><tr><th>Gate</th><th class="r">Current</th><th class="r">Required</th><th>Status</th><th class="r" ${tip('Builds needed to clear the gate, extrapolated from the last 6 builds')}>Builds to clear</th></tr></thead><tbody>${gateRows}</tbody></table></div><p class="small muted" style="margin-bottom:0">WATCH = passing with under 15% margin. Build count uses geometric burn-down for volumes and linear burn-down for counts that must reach a limit.</p></div>
  <div class="card"><h3>Schedule slippage estimate</h3><div class="grid g3" style="margin-bottom:10px">${sc}</div>${burn}<p class="small muted" style="margin:6px 0 0">Bottleneck: ${esc(f.bottleneck.join(', ') || 'none')}. Cadence ${f.cadence} days per build; failure volume falls by about ${f.ratio ? Math.round((1 - f.ratio) * 100) : 0}% per build.</p></div></div>
  <div class="grid g2" style="margin-top:14px"><div class="card"><h3>Blocker &amp; top Critical Jiras against the gate</h3><div class="scroll"><table class="t"><thead><tr><th>Jira</th><th>Severity</th><th>Status</th><th>Summary</th><th class="r">Fail</th><th class="r">Blocked</th><th class="r">Crash</th></tr></thead><tbody>${blk.map((t) => `<tr><td class="mono nowrap">${t.id}</td><td>${chip(SEV_CHIP[t.severity], t.severity)}</td><td class="nowrap">${esc(t.status)}</td><td>${esc(t.summary)}</td><td class="r">${t.linked_failed_tests}</td><td class="r">${t.linked_blocked_tests}</td><td class="r">${t.linked_crash_events}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><h3>MTBF stability per DUT <span class="muted small">(crashes in 120 h, MTBF at right)</span></h3>${C.legend(Object.entries(PLAT_COLOR).map(([k, v]) => ({ name: pretty(k), color: v })))}${C.hbars(dutRows, { max: Math.max(...dutRows.map((d) => d.value)) })}<p class="small muted" style="margin:8px 0 0">Fleet MTBF ${r1(A.stab.fleetMtbf)} h versus the ${gl.min_fleet_mtbf_hours} h gate.</p></div></div></section>`;
}

/* ---------------- 3. anomalies ---------------- */
function anomalies() {
  const lvChip = { high: 'critical', medium: 'warning', low: 'info' };
  const items = A.anomalies.map((a) => `<div class="item lv-${a.level}"><div class="hd">${chip(lvChip[a.level], a.level.toUpperCase())}<span class="tag">${esc(a.type)}</span><span class="tt">${esc(a.title)}</span></div><p>${esc(a.detail)}</p>${a.jira && a.jira.length ? `<div style="margin-top:6px">${jiraTags(a.jira)}</div>` : ''}</div>`).join('');
  const ct = A.crosstalk, kM = (n) => A.kpi.metrics.find((m) => m.metric_name === n), xs = ct.labels.map(dt);
  const a2 = kM('A2DP_Latency_ms');
  const cLE = C.lineChart({ xs, series: [{ name: 'LE Audio / ISO failures per 6 h (HCI regression)', color: 'var(--crit)', values: ct.buckets }], height: 150, yFmt: (v) => nf(v), forceLegend: true, area: true, aria: 'LE Audio failures per six hours' });
  const cA2 = C.lineChart({ xs, series: [{ name: 'A2DP latency ms (KPI)', color: 'var(--s1)', values: a2.samples.map((s) => s.value) }], hlines: [{ y: a2.target_value, label: 'target < ' + a2.target_value }], height: 170, yMin: 60, forceLegend: true, aria: 'A2DP latency per six hours' });
  const corr = ct.series.filter((s) => s.r >= 0.5).sort((a, b) => b.r - a.r).map((s) => ({ label: pretty(s.name), value: s.r, color: s.status === 'PASS' ? 'var(--muted)' : 'var(--s2)', text: 'r=' + s.r.toFixed(2), tip: `<b>${esc(pretty(s.name))}</b> correlation with LE Audio failures: r = ${s.r.toFixed(2)} (${esc(s.status)})` }));
  const gate = A.blockedGates.slice(0, 8).map((g) => ({ label: g.id, value: g.n, color: 'var(--warn)', tip: `<b>${g.id}</b> blocks ${g.n} tests<br>${Object.entries(g.features).map(([f, n]) => `${esc(pretty(f))}: ${n}`).join('<br>')}<br>${esc(A.byId[g.id].summary)}` }));
  const bs = A.blindspots.map((b) => `<tr><td>${esc(pretty(b.feature))}</td><td>${esc(b.domain.split(' ')[0])}</td><td class="r">${b.coverage}%</td><td class="r">${b.blocked}</td><td class="r"><b>${b.effective}%</b></td></tr>`).join('');
  return `<section class="sec" id="anomalies">${secHead('anomalies', 'Anomaly detection &amp; blind spots', 'Non-obvious defects, hardware-dependent behaviour, feature cross-talk and untested gaps.')}
  ${cur().anomaly ? `<div class="card" style="margin-bottom:14px"><p style="margin:0">${esc(cur().anomaly)}</p></div>` : ''}
  <div class="grid g-21"><div>${items}</div>
  <div class="grid" style="align-content:start"><div class="card"><h3>Cross-talk: LE Audio failures vs A2DP latency</h3>${cLE}<div style="height:8px"></div>${cA2}<h4 style="margin:12px 0 4px">Correlation of LE Audio failures with KPI samples</h4>${C.hbars(corr, { max: 1 })}</div>
  <div class="card"><h3>Blocked-test concentration by gating Jira</h3>${C.hbars(gate)}</div>
  <div class="card"><h3>Untested gaps</h3><div class="scroll"><table class="t"><thead><tr><th>Feature</th><th>Suite</th><th class="r">Spec cov.</th><th class="r">Blocked</th><th class="r">Effective</th></tr></thead><tbody>${bs}</tbody></table></div></div></div></div></section>`;
}

/* ---------------- 4. clusters ---------------- */
function clusters() {
  const cl = cur().cluster, total = A.tickets.length;
  const cards = cl.map((c) => {
    const col = CL_COLOR[c.key], sevbar = ['Blocker', 'Critical', 'Medium', 'Trivial'].map((s) => (c.bySev[s] ? `<span style="flex:${c.bySev[s]};background:${SEV_COLOR[s]}" ${tip(`${s}: <b>${c.bySev[s]}</b>`)}></span>` : '')).join('');
    const li = (ts) => ts.slice(0, 4).map((t) => `<li><span class="mono">${t.id}</span> ${chip(SEV_CHIP[t.severity], t.severity)} ${esc(t.summary)}</li>`).join('');
    return `<div class="card cluster" style="--c:${col}"><h3><span class="sw" style="background:${col}"></span>${esc(c.name)} <span class="tag">${c.count} Jiras</span></h3>
    <div class="sevbar">${sevbar}</div>
    <div class="kv"><span>Open <b>${c.open}</b></span><span>Failed tests <b>${c.failedTests}</b></span><span>Blocked <b>${c.blockedTests}</b></span><span>Crashes <b>${c.crashes}</b></span><span class="muted">Blocker ${c.bySev.Blocker} &middot; Critical ${c.bySev.Critical} &middot; Medium ${c.bySev.Medium} &middot; Trivial ${c.bySev.Trivial}</span></div>
    <details class="tv" open><summary>Recurring signatures (${c.recurring.length}) &middot; single-instance (${c.single.length}) &middot; no hit this run (${c.idle})</summary>
    ${c.recurring.length ? `<h4 style="margin:8px 0 2px">Recurring</h4><ul class="small" style="margin:0;padding-left:18px">${li(c.recurring)}</ul>` : ''}
    ${c.single.length ? `<h4 style="margin:8px 0 2px">Single-instance</h4><ul class="small" style="margin:0;padding-left:18px">${li(c.single)}</ul>` : ''}</details></div>`;
  }).join('');
  const bars = cl.map((c) => ({ label: c.name.split(' (')[0].split(' / ')[0], value: c.count, color: CL_COLOR[c.key], text: `${c.count} (${c.open} open)`, tip: `<b>${esc(c.name)}</b><br>${c.count} Jiras, ${c.open} open` }));
  return `<section class="sec" id="clusters">${secHead('clusters', 'Semantic bug clustering', `${total} Jiras grouped into root-cause buckets by firmware subsystem, ranked by open severity-weighted impact.`, chip(source === 'llm' && LLMINS && llmMeta.clustered ? 'info' : 'muted', source === 'llm' && LLMINS && llmMeta.clustered ? 'LLM classification' : 'Keyword classifier'))}
  <div class="card" style="margin-bottom:14px"><h3>Jiras per subsystem</h3>${C.hbars(bars)}</div><div class="grid g2">${cards}</div></section>`;
}

/* ---------------- 5. actions ---------------- */
let roleFilter = 'All';
function actions() {
  const acts = cur().actions, roles = ['All', ...LLM.ROLES.filter((r) => acts.some((a) => a.role === r))];
  const rerunById = {}; RULES.actions.forEach((a) => { if (a.rerun) rerunById[a.rerun.ticket] = a.rerun; });
  const list = acts.filter((a) => roleFilter === 'All' || a.role === roleFilter);
  const byRole = {}; list.forEach((a) => { (byRole[a.role] = byRole[a.role] || []).push(a); });
  const body = Object.entries(byRole).map(([role, as]) => `<div class="role-h"><h3>${esc(role)}</h3><span class="tag">${as.length}</span></div>` + as.map((a) => {
    const rr = a.rerun || (a.source === 'llm' && a.rerunSubset ? (a.jira || []).map((j) => rerunById[j]).find(Boolean) : null);
    return `<div class="item pr-${a.priority}"><label class="chk"><input type="checkbox" aria-label="Mark done"><div><div class="hd">${chip(a.priority === 'P0' ? 'critical' : a.priority === 'P1' ? 'warning' : 'info', a.priority)}${a.area ? `<span class="tag">${esc(a.area)}</span>` : ''}${a.source === 'llm' ? '<span class="tag">LLM</span>' : ''}<span class="tt">${esc(a.title)}</span></div><p>${esc(a.detail)}</p>${a.rerunSubset ? `<p><b>Re-run subset:</b> ${esc(a.rerunSubset)}</p>` : ''}<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${jiraTags(a.jira)}${rr ? `<button class="btn small" data-act="copy" data-ids="${esc(rr.ids.join('\n'))}">Copy ${rr.ids.length} re-run test IDs (~${rr.estHours} h)</button>` : ''}</div></div></label></div>`;
  }).join('')).join('');
  return `<section class="sec" id="actions">${secHead('actions', 'Next actions', 'Prescriptive tasks by developer role, with targeted re-run subsets instead of full-cycle executions.', srcChip())}
  <div class="tabs" role="group" aria-label="Filter by role">${roles.map((r) => `<button data-act="role" data-role="${esc(r)}" aria-pressed="${r === roleFilter}">${esc(r)}</button>`).join('')}</div><div class="card">${body || '<p class="muted">No actions for this role.</p>'}</div></section>`;
}

/* ---------------- 6. execution ---------------- */
function domainCard(d, label, bucketLabel) {
  const f = d.rerun_log, pr = d.passed / d.total_tests * 100;
  const rows = Object.entries(d.feature_breakdown).map(([n, v]) => ({ name: n, total: v.total, pass: v.pass, fail: v.fail, blocked: v.blocked, coverage: v.requirement_coverage_pct, recovered: v.recovered_on_retry })).sort((a, b) => (b.fail + b.blocked) - (a.fail + a.blocked) || a.name.localeCompare(b.name));
  const prog = C.lineChart({ xs: d.progress.map((p, i) => bucketLabel(i)), series: [{ name: 'Failed', color: 'var(--crit)', values: d.progress.map((p) => p.failed) }, { name: 'Blocked', color: 'var(--warn)', values: d.progress.map((p) => p.blocked) }], height: 170, aria: label + ' failures over time' });
  return `<div class="card"><h3>${label} <span class="tag">${nf(d.total_tests)} tests &middot; ${rows.length} features</span></h3>
  <div class="grid" style="grid-template-columns:150px minmax(0,1fr);align-items:center">${C.donut({ parts: [{ label: 'Passed', value: d.passed, color: C.STATE.pass }, { label: 'Failed', value: d.failed, color: C.STATE.fail }, { label: 'Blocked', value: d.blocked, color: C.STATE.blocked }], center: r1(pr) + '%', sub: 'pass rate', aria: label + ' result split' })}
  <div class="kv" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px"><span>Passed <b>${nf(d.passed)}</b></span><span>Failed <b>${d.failed}</b></span><span>Blocked <b>${d.blocked}</b></span><span>Retry-recovered <b>${f.recovered_on_retry}</b></span><span>Duration <b>${d.execution_duration_hours} h</b></span><span>Re-run extension <b>+${r1(d.duration_extension_hours)} h</b></span><span>Retry executions <b>${f.retry_executions}</b></span><span>Baseline <b>${d.baseline_duration_hours} h</b></span></div></div>
  <h4 style="margin:14px 0 4px">Failures and blocked tests over time</h4>${prog}
  <h4 style="margin:14px 0 4px">Feature breakdown (${rows.length} features)</h4>${C.featureBars(rows)}</div>`;
}
let EXP = { domain: 'All', status: 'All', feature: 'All', q: '', n: 40 };
function allTests() { return [...A.hci.failed_tests.map((t) => ({ ...t, suite: 'HCI' })), ...A.phone.failed_tests.map((t) => ({ ...t, suite: 'Phone' }))].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)); }
function explorerRows() {
  const q = EXP.q.toLowerCase();
  const rows = allTests().filter((t) => (EXP.domain === 'All' || t.suite === EXP.domain) && (EXP.status === 'All' || t.status === EXP.status) && (EXP.feature === 'All' || t.feature === EXP.feature) && (!q || (t.test_id + ' ' + t.title + ' ' + t.jira_id + ' ' + t.failure_message).toLowerCase().includes(q)));
  return { rows, html: rows.slice(0, EXP.n).map((t) => `<tr><td class="mono nowrap">${t.test_id}</td><td>${esc(pretty(t.feature))}</td><td>${chip(t.status === 'FAILED' ? 'critical' : 'warning', t.status)}</td><td class="mono nowrap">${jiraTags([t.jira_id])}</td><td class="nowrap">${dt(t.timestamp)}</td><td>${esc(t.failure_message)}${t.platform ? ` <span class="tag">${esc(pretty(t.platform))}</span>` : ''}</td></tr>`).join('') };
}
function execution() {
  const feats = [...new Set(allTests().map((t) => t.feature))].sort();
  const e = explorerRows();
  return `<section class="sec" id="execution">${secHead('execution', 'Test execution', 'Per-suite results, feature breakdown and every failed or blocked test case in the cycle.')}
  <div class="grid g2">${domainCard(A.hci, 'HCI Regression', (i) => 'Day ' + (i + 1))}${domainCard(A.phone, 'Phone Testing', (i) => `${i * 6}-${i * 6 + 6} h`)}</div>
  <div class="card" style="margin-top:14px"><h3>Failed &amp; blocked test cases <span class="tag" id="exp-count">${e.rows.length} shown of ${A.totals.failed + A.totals.blocked}</span></h3>
  <div class="filters"><select data-exp="domain" aria-label="Suite"><option>All</option><option>HCI</option><option>Phone</option></select><select data-exp="status" aria-label="Status"><option>All</option><option>FAILED</option><option>BLOCKED</option></select><select data-exp="feature" aria-label="Feature"><option>All</option>${feats.map((f) => `<option value="${esc(f)}">${esc(pretty(f))}</option>`).join('')}</select><input type="search" data-exp="q" placeholder="Search test id, title, Jira, message" aria-label="Search"></div>
  <div class="scroll" style="max-height:480px;overflow:auto"><table class="t"><thead><tr><th>Test</th><th>Feature</th><th>Status</th><th>Jira</th><th>Time (UTC)</th><th>Failure / blocked reason</th></tr></thead><tbody id="exp-body">${e.html}</tbody></table></div>
  <div style="margin-top:10px"><button class="btn" data-act="more-exp" id="exp-more" ${e.rows.length > EXP.n ? '' : 'hidden'}>Show more</button></div></div></section>`;
}

/* ---------------- 7. stability ---------------- */
function stability() {
  const m = A.mtbf, days = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'], duts = A.stab.perDut.map((d) => d.dut_id);
  const mat = duts.map((id) => { const row = [0, 0, 0, 0, 0]; m.crash_events.filter((e) => e.dut_id === id).forEach((e) => { row[Math.min(4, Math.floor(e.hours_into_run / 24))]++; }); return row; });
  const dec = C.lineChart({ xs: days, series: [{ name: 'Crashes per day (all DUTs)', color: 'var(--s2)', values: A.stab.dayBuckets }], height: 160, yFmt: (v) => nf(v), forceLegend: true, area: true, aria: 'Crashes per day' });
  const sigRows = DATA.jira_telemetry.crash_mapping.slice().sort((a, b) => b.occurrences - a.occurrences).map((c) => {
    const plats = [...new Set(c.affected_duts.map((d) => A.mtbf.dut_inventory.find((x) => x.dut_id === d).platform))].map((p) => p.replace('MobilePlatform-', 'P-')).join(', ');
    const rec = c.occurrences >= 3 && c.affected_duts.length >= 2;
    return `<tr><td class="mono nowrap">${c.jira_id}</td><td class="mono">${esc(c.crash_signature)}</td><td>${chip(SEV_CHIP[c.severity], c.severity)}</td><td class="r">${c.occurrences}</td><td>${c.affected_duts.map((d) => d.replace('DUT-', '')).join(', ')}</td><td>${esc(plats)}</td><td>${rec ? chip('warning', 'Recurring') : c.occurrences === 1 ? chip('muted', 'Single') : chip('info', 'Repeat')}</td></tr>`;
  }).join('');
  return `<section class="sec" id="stability">${secHead('stability', 'MTBF stress &amp; reliability', `${m.duts_active} DUTs x ${m.planned_hours_per_dut} h continuous. Crashes are auto-recovered, de-duplicated by stack trace and mapped to unique Jiras.`)}
  <div class="tiles" style="margin:0 0 14px">${tile('DUT-hours', nf(m.total_operational_hours), `${m.duts_active} DUTs x ${m.planned_hours_per_dut} h`)}${tile('Total crashes', m.total_crashes, `${m.unique_crashes} unique signatures`)}${tile('Auto-recovery', m.recovery_success_rate_percent + '%', `${r1(m.total_downtime_minutes)} min total downtime`)}${tile('Fleet MTBF', r1(A.stab.fleetMtbf) + ' h', `gate \u2265 ${A.ctx.release_gates.min_fleet_mtbf_hours} h`, A.stab.fleetMtbf >= A.ctx.release_gates.min_fleet_mtbf_hours ? 'good' : 'critical')}</div>
  <div class="card"><h3>Crash signatures &rarr; Jira (de-duplicated)</h3><div class="scroll"><table class="t"><thead><tr><th>Jira</th><th>Signature</th><th>Severity</th><th class="r">Count</th><th>DUTs</th><th>Platform</th><th>Pattern</th></tr></thead><tbody>${sigRows}</tbody></table></div><p class="small muted" style="margin:8px 0 0">Recurring = 3+ occurrences on 2+ DUTs. ${DATA.jira_telemetry.auto_dedup.crash_events_total} raw crash events collapsed into ${DATA.jira_telemetry.auto_dedup.unique_crash_signatures} Jiras.</p></div>
  <div class="grid g2" style="margin-top:14px"><div class="card"><h3>Crash decay over the run</h3>${dec}</div><div class="card"><h3>Crashes by DUT and day</h3>${C.heat(duts, days, mat, { aria: 'Crash heat map by DUT and day' })}</div></div></div></section>`;
}

/* ---------------- 8. KPI ---------------- */
function kpi() {
  const rows = A.kpi.metrics.map((m) => {
    const lvl = m.status === 'PASS' ? 'good' : m.status === 'DEGRADED' ? 'warning' : 'critical';
    const delta = (m.measured_avg_value - m.previous_build_avg_value) / m.previous_build_avg_value * 100;
    const worse = m.comparator === '<' ? delta > 0 : delta < 0;
    return `<tr><td><b>${esc(pretty(m.metric_name))}</b><div class="small muted">${esc(pretty(m.feature))}</div></td><td class="r">${esc(m.target)}</td><td class="r"><b>${esc(m.measured_avg)}</b></td><td style="min-width:130px">${C.bullet(m.measured_avg_value, m.target_value, m.comparator, m.status)}</td><td>${chip(lvl, m.status)}</td><td class="r ${worse && Math.abs(delta) > 5 ? '' : 'muted'}">${delta > 0 ? '+' : ''}${r1(delta)}%${worse && Math.abs(delta) > 5 ? ' &#9650;' : ''}</td><td>${C.sparkline(m.samples.map((s) => s.value), m.target_value, 110, 28, m.status !== 'PASS')}</td></tr>`;
  }).join('');
  return `<section class="sec" id="kpi">${secHead('kpi', 'KPI &amp; performance', 'Audio quality, latency, throughput, connection setup and power versus targets (72 h run, 6 h samples). Threshold breaches auto-file performance Jiras.')}
  <div class="card"><div class="scroll"><table class="t"><thead><tr><th>Metric</th><th class="r">Target</th><th class="r">Measured</th><th>Measured vs target</th><th>Status</th><th class="r">vs prev. build</th><th>Trend (dashed = target)</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

/* ---------------- 9. jira ---------------- */
let JQ = { sev: 'All', status: 'All', cluster: 'All', q: '', n: 40 };
function jiraRows() {
  const ck = ckeyMap(), q = JQ.q.toLowerCase();
  const rows = A.tickets.filter((t) => (JQ.sev === 'All' || t.severity === JQ.sev) && (JQ.status === 'All' || t.status === JQ.status) && (JQ.cluster === 'All' || ck[t.id] === JQ.cluster) && (!q || (t.id + ' ' + t.summary + ' ' + t.description).toLowerCase().includes(q)))
    .sort((a, b) => E.SEV_RANK[a.severity] - E.SEV_RANK[b.severity] || (b.linked_failed_tests + b.linked_blocked_tests) - (a.linked_failed_tests + a.linked_blocked_tests));
  const end = Date.parse(A.meta.end_time);
  return { rows, html: rows.slice(0, JQ.n).map((t) => `<tr><td class="mono nowrap">${t.id}</td><td>${chip(SEV_CHIP[t.severity], t.severity)}</td><td class="nowrap">${esc(t.status)}</td><td>${esc(t.summary)}</td><td class="nowrap"><span class="sw" style="background:${CL_COLOR[ck[t.id]]}"></span>${esc(E.SUBSYSTEMS[ck[t.id]].split(' (')[0].split(' / ')[0])}</td><td class="r">${t.linked_failed_tests}/${t.linked_blocked_tests}</td><td class="r">${t.linked_crash_events}</td><td class="r">${Math.max(0, Math.round((end - Date.parse(t.created)) / 86400000))} d</td></tr>`).join('') };
}
function jira() {
  const sd = DATA.jira_telemetry.severity_distribution, st = DATA.jira_telemetry.status_distribution, j = jiraRows();
  const parts = Object.entries(sd).map(([k, v]) => ({ label: k, value: v, color: SEV_COLOR[k] }));
  return `<section class="sec" id="jira">${secHead('jira', 'Jira telemetry', `${DATA.jira_telemetry.total_tickets_linked} tickets linked to this build; 100% of failures are auto-ticketed and mapped.`)}
  <div class="grid g-side"><div class="card"><h3>Severity distribution</h3>${C.donut({ parts, center: String(DATA.jira_telemetry.total_tickets_linked), sub: 'Jiras', size: 170, aria: 'Jira severity distribution' })}${C.legend(parts.map((p) => ({ name: `${p.label} ${p.value}`, color: p.color })))}<h4 style="margin:12px 0 4px">Status</h4>${C.hbars(Object.entries(st).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: 'var(--s1)' })))}</div>
  <div class="card"><h3>All Jiras <span class="tag" id="jq-count">${j.rows.length} shown</span></h3><div class="filters"><select data-jq="sev" aria-label="Severity"><option>All</option>${Object.keys(sd).map((s) => `<option>${s}</option>`).join('')}</select><select data-jq="status" aria-label="Status"><option>All</option>${Object.keys(st).map((s) => `<option>${s}</option>`).join('')}</select><select data-jq="cluster" aria-label="Cluster"><option value="All">All subsystems</option>${Object.entries(E.SUBSYSTEMS).filter(([k]) => cur().cluster.some((c) => c.key === k)).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><input type="search" data-jq="q" placeholder="Search Jira id or text" aria-label="Search"></div>
  <div class="scroll" style="max-height:520px;overflow:auto"><table class="t"><thead><tr><th>Jira</th><th>Severity</th><th>Status</th><th>Summary</th><th>Subsystem</th><th class="r" ${tip('Failed / blocked tests linked in this run')}>F/B</th><th class="r">Crash</th><th class="r">Age</th></tr></thead><tbody id="jq-body">${j.html}</tbody></table></div>
  <div style="margin-top:10px"><button class="btn" data-act="more-jq" id="jq-more" ${j.rows.length > JQ.n ? '' : 'hidden'}>Show more</button></div></div></div></section>`;
}

/* ---------------- 10. trend ---------------- */
function trend() {
  const s = A.series, xs = s.map((x) => x.build.replace('FW_', '').replace(/^v14\./, '')), ch = (series, o = {}) => C.lineChart({ xs, series, height: 175, ...o });
  return `<section class="sec" id="trend">${secHead('trend', 'Build-over-build trend', 'Six builds, oldest to newest. Health improves, but burn-down is slower than the milestone needs.')}
  <div class="grid g2"><div class="card"><h3>Health index</h3>${ch([{ name: 'Health index', color: 'var(--s1)', values: s.map((x) => x.health) }], { yMin: 0, yMax: 100, yFmt: (v) => nf(v), hlines: [{ y: 85, label: 'release ready 85' }], forceLegend: true })}</div>
  <div class="card"><h3>Failed + blocked tests</h3>${ch([{ name: 'Failed + blocked', color: 'var(--crit)', values: s.map((x) => x.nonpass) }, { name: 'Blocked', color: 'var(--warn)', values: s.map((x) => x.blocked) }], { yFmt: (v) => nf(v) })}</div>
  <div class="card"><h3>Open Blocker / Critical Jiras</h3>${ch([{ name: 'Critical', color: 'var(--serious)', values: s.map((x) => x.criticals) }, { name: 'Blocker', color: 'var(--crit)', values: s.map((x) => x.blockers) }], { yFmt: (v) => nf(v) })}</div>
  <div class="card"><h3>MTBF crashes</h3>${ch([{ name: 'Total crashes', color: 'var(--s2)', values: s.map((x) => x.totalCrashes) }, { name: 'Unique signatures', color: 'var(--s7)', values: s.map((x) => x.uniqueCrashes) }], { yFmt: (v) => nf(v) })}</div></div></section>`;
}

function footer() {
  return `<div class="foot">Synthetic data generated by <span class="mono">generator/</span> (${esc(A.meta.generated_by)}), test plan <span class="mono">${esc(A.meta.test_plan_id)}</span>, run <span class="mono">${esc(A.meta.run_id)}</span>. No real test infrastructure was used. Insights are computed in this page; the optional LLM only rewrites narrative and re-classifies Jiras from the computed facts.</div>`;
}

/* ---------------- render + wiring ---------------- */
function render() {
  const y = window.scrollY;
  document.getElementById('app').innerHTML = summary() + risk() + anomalies() + clusters() + actions() + execution() + stability() + kpi() + jira() + trend() + footer();
  ['domain', 'status', 'feature'].forEach((k) => { const el = document.querySelector(`[data-exp="${k}"]`); if (el) el.value = EXP[k]; });
  ['sev', 'status', 'cluster'].forEach((k) => { const el = document.querySelector(`[data-jq="${k}"]`); if (el) el.value = JQ[k]; });
  const qe = document.querySelector('[data-exp="q"]'); if (qe) qe.value = EXP.q;
  const qj = document.querySelector('[data-jq="q"]'); if (qj) qj.value = JQ.q;
  document.getElementById('meta').innerHTML = `${esc(A.meta.run_id)} &middot; ${esc(A.meta.chipset_revision)} &middot; ${esc(A.meta.firmware_build)} &middot; ${A.meta.start_time.slice(0, 10)} to ${A.meta.end_time.slice(0, 10)}`;
  const chipEl = document.getElementById('insight-chip'); chipEl.textContent = source === 'llm' && LLMINS ? `Insights: LLM (${llmMeta.model})` : 'Insights: rule-based';
  window.scrollTo(0, y);
}
function refreshExplorer() { const e = explorerRows(); document.getElementById('exp-body').innerHTML = e.html; document.getElementById('exp-count').textContent = `${Math.min(e.rows.length, EXP.n)} shown of ${e.rows.length}`; document.getElementById('exp-more').hidden = e.rows.length <= EXP.n; }
function refreshJira() { const j = jiraRows(); document.getElementById('jq-body').innerHTML = j.html; document.getElementById('jq-count').textContent = `${Math.min(j.rows.length, JQ.n)} shown of ${j.rows.length}`; document.getElementById('jq-more').hidden = j.rows.length <= JQ.n; }

const tipEl = document.getElementById('tip');
document.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) { tipEl.innerHTML = t.getAttribute('data-tip'); tipEl.style.display = 'block'; } });
document.addEventListener('mousemove', (e) => { if (tipEl.style.display === 'block') { const w = tipEl.offsetWidth, h = tipEl.offsetHeight; tipEl.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px'; tipEl.style.top = (e.clientY + h + 24 > window.innerHeight ? e.clientY - h - 12 : e.clientY + 16) + 'px'; } });
document.addEventListener('mouseout', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) tipEl.style.display = 'none'; });

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'role') { roleFilter = b.dataset.role; render(); }
  else if (a === 'more-exp') { EXP.n += 40; refreshExplorer(); }
  else if (a === 'more-jq') { JQ.n += 40; refreshJira(); }
  else if (a === 'copy') { const txt = b.dataset.ids; const done = () => { const o = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = o; }, 1400); }; if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done)); else fallbackCopy(txt, done); }
});
function fallbackCopy(txt, done) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ } ta.remove(); }
document.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.exp; const j = e.target.dataset && e.target.dataset.jq; if (k) { EXP[k] = e.target.value; EXP.n = 40; refreshExplorer(); } if (j) { JQ[j] = e.target.value; JQ.n = 40; refreshJira(); } });

/* theme */
const root = document.documentElement;
function setTheme(t) { root.setAttribute('data-theme', t); try { localStorage.setItem('bt_dash_theme', t); } catch (e) { /* ignore */ } document.getElementById('theme-btn').textContent = t === 'dark' ? 'Light blue' : 'Dark blue'; }
let saved = null; try { saved = localStorage.getItem('bt_dash_theme'); } catch (e) { /* ignore */ }
setTheme(saved || 'dark');
document.getElementById('theme-btn').addEventListener('click', () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

/* LLM dialog */
const dlg = document.getElementById('llm-dlg'), statusEl = document.getElementById('llm-status');
const setStatus = (m, err) => { statusEl.className = err ? 'err' : 'note'; statusEl.textContent = m; statusEl.hidden = !m; };
document.getElementById('llm-open').addEventListener('click', () => { const c = LLM.loadConfig(); document.getElementById('llm-key').value = c.key; document.getElementById('llm-model').value = c.model; document.getElementById('llm-remember').checked = c.remember; setStatus(''); dlg.showModal(); });
document.getElementById('llm-close').addEventListener('click', () => dlg.close());
document.getElementById('llm-rules').addEventListener('click', () => { source = 'rules'; render(); dlg.close(); });
document.getElementById('llm-clear').addEventListener('click', () => { LLM.clearConfig(); document.getElementById('llm-key').value = ''; document.getElementById('llm-remember').checked = false; setStatus('Saved key removed from this browser.'); });
document.getElementById('llm-run').addEventListener('click', async () => {
  const cfg = { key: document.getElementById('llm-key').value.trim(), model: document.getElementById('llm-model').value.trim() || 'gpt-4o-mini', remember: document.getElementById('llm-remember').checked };
  if (!cfg.key) { setStatus('Enter your OpenAI API key first.', true); return; }
  LLM.saveConfig(cfg);
  const btn = document.getElementById('llm-run'); btn.disabled = true;
  try {
    const res = await LLM.enrich(A, cfg, (m) => setStatus(m));
    const rerunById = {}; RULES.actions.forEach((a) => { if (a.rerun) rerunById[a.rerun.ticket] = a.rerun; });
    LLMINS = {
      tldr: res.tldr || RULES.tldr, risk: res.risk || RULES.risk, anomaly: res.anomaly || null,
      actions: res.actions ? res.actions.map((a, i) => ({ ...a, id: 'L' + (i + 1), area: '', impact: 0 })) : RULES.actions,
      cluster: res.assignments ? E.clusterTickets(A.tickets, res.assignments) : RULES.cluster,
    };
    llmMeta = { model: res.model, clustered: !!res.assignments };
    source = 'llm'; render();
    setStatus(res.notes.length ? 'Done with fallbacks: ' + res.notes.join(' ') : 'Done. Insights, Jira clusters and next actions now come from the LLM and were validated against the computed facts.');
    if (!res.notes.length) setTimeout(() => dlg.close(), 900);
  } catch (e) { setStatus(e.message, true); } finally { btn.disabled = false; }
});

/* active nav */
const links = [...document.querySelectorAll('.nav a')];
const io = new IntersectionObserver((es) => { es.forEach((en) => { if (en.isIntersecting) links.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + en.target.id)); }); }, { rootMargin: '-30% 0px -65% 0px' });
render();
document.querySelectorAll('section.sec').forEach((s) => io.observe(s));
window.__dashboard = { A, render };
})();
