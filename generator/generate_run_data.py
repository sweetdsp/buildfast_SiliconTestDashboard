#!/usr/bin/env python3
"""Deterministic SampleTestRunGenerator: reads data/test_plan.json, writes data/test_run_data.json."""
import json, math, os, random, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UTC = timezone.utc
START = datetime(2026, 10, 13, 0, 0, tzinfo=UTC)
RUN_ID = "BT_FULL_CYCLE_20261020_01"
FIRMWARE = "FW_v14.2.109_RC3"

HISTORY = [  # build, date, failed, blocked, blockers, criticals, uniq crashes, total crashes, kpi p/d/f, cycle h
    ("FW_v14.0.77_RC1", "2026-08-25", 590, 211, 9, 60, 16, 71, (5, 4, 4), 214),
    ("FW_v14.1.88_RC2", "2026-09-04", 468, 172, 7, 50, 15, 58, (6, 4, 3), 205),
    ("FW_v14.1.97_RC3", "2026-09-14", 381, 140, 6, 42, 14, 49, (8, 3, 2), 198),
    ("FW_v14.2.101_RC1", "2026-09-24", 327, 120, 5, 35, 13, 41, (8, 4, 1), 192),
    ("FW_v14.2.105_RC2", "2026-10-04", 284, 102, 5, 29, 12, 36, (9, 3, 1), 188),
]
KPI_SPECS = [  # name, feature, unit, cmp, target, desired avg, corr, decimals
    ("A2DP_Latency_ms", "A2DP", "ms", "<", 100, 125, 0.13, 0),
    ("LE_Audio_THD", "LE_Audio_Unicast", "%", "<", 0.5, 0.3, 0.0, 2),
    ("Connect_Time_ms", "Connection_Setup", "ms", "<", 400, 380, 0.0, 0),
    ("LE_Audio_Latency_ms", "LE_Audio_Unicast", "ms", "<", 40, 50, 0.12, 1),
    ("A2DP_SNR_dB", "A2DP", "dB", ">", 90, 94, 0.0, 1),
    ("LE_Audio_Packet_Loss_pct", "LE_Audio_Unicast", "%", "<", 1.0, 0.8, 0.10, 2),
    ("LE_Audio_Jitter_ms", "LE_Audio_Broadcast", "ms", "<", 5, 7.8, 0.15, 1),
    ("BLE_Throughput_kbps", "BLE_Throughput", "kbps", ">", 1400, 1480, 0.0, 0),
    ("BR_EDR_Throughput_kbps", "BR_EDR_Throughput", "kbps", ">", 2000, 2110, 0.0, 0),
    ("Reconnect_Time_ms", "Connection_Setup", "ms", "<", 1200, 1090, 0.0, 0),
    ("A2DP_Power_mW", "Power", "mW", "<", 35, 33.5, 0.0, 1),
    ("LE_Audio_Power_mW", "Power", "mW", "<", 28, 31.2, 0.05, 1),
    ("Idle_Current_uA", "Power", "uA", "<", 180, 172, 0.0, 0),
]
KPI_PREV = {"A2DP_Latency_ms": 96, "LE_Audio_Latency_ms": 41, "LE_Audio_Jitter_ms": 4.2, "LE_Audio_Power_mW": 27.1}
KPI_SEV = {"A2DP_Latency_ms": "Critical", "LE_Audio_Jitter_ms": "Critical"}
KPI_SUB = {"A2DP_Latency_ms": "AUDIO", "LE_Audio_Latency_ms": "AUDIO", "LE_Audio_Jitter_ms": "AUDIO", "LE_Audio_Power_mW": "PWR"}


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_val(v, dec):
    return f"{v:.{dec}f}" if dec else str(int(round(v)))


def pretty(name):
    return name.replace("_", " ")


def build_tickets(rng):
    """Create ticket shells (ground-truth subsystem kept private with leading underscore)."""
    tickets = {}
    for jira, sig, sev, sub, duts, summ, desc in CRASH_DEFECTS:
        tickets[jira] = dict(id=jira, severity=sev, _sub=sub, summary=summ, description=desc,
                             source_domain="MTBF", crash_signature=sig, _w={}, _kind="explicit")
    j, sev, sub, summ, desc = EXTRA_BLOCKER
    tickets[j] = dict(id=j, severity=sev, _sub=sub, summary=summ, description=desc,
                      source_domain="PHONE_TESTING", _w={}, _kind="explicit")
    for key, lst in EXPLICIT_MAP.items():
        for jira, w in lst:
            tickets[jira]["_w"][key] = w
    for i, m in enumerate(["A2DP_Latency_ms", "LE_Audio_Latency_ms", "LE_Audio_Jitter_ms", "LE_Audio_Power_mW"]):
        tickets[KPI_TICKET_IDS[i]] = dict(id=KPI_TICKET_IDS[i], severity=KPI_SEV.get(m, "Medium"), _sub=KPI_SUB[m],
                                          summary="", description="", source_domain="KPI_AUDIO", linked_metric=m,
                                          _w={}, _kind="explicit")
    # generated feature-linked slots
    slots = []
    for dom, feats in (("HCI_REGRESSION", HCI_FEATURES), ("PHONE_TESTING", PHONE_FEATURES)):
        for name, _c, _n, fail, blocked, sub, _cov in feats:
            if fail == 0:
                continue
            g = max(1, min(6, math.ceil(fail / 5)))
            has_gate = (dom, name) in GATING
            for rank in range(1, g + 1):
                s = sub if rng.random() < 0.85 else rng.choice(list(SUBSYSTEMS))
                feats_l = [(dom, name)]
                if rng.random() < 0.25:
                    sibs = [f[0] for f in feats if f[5] == sub and f[0] != name and f[3] > 0]
                    if sibs:
                        feats_l.append((dom, rng.choice(sibs)))
                imp = fail / rank ** 1.1 + rng.random()
                if blocked and not has_gate and rank == 1:
                    imp += 100
                slots.append(dict(domain=dom, feats=feats_l, sub=s, imp=imp, rank=rank, linked=True))
    n_explicit = len(tickets)
    pad = TOTAL_TICKETS - n_explicit - len(slots)
    for _ in range(pad):
        dom = rng.choices(["HCI_REGRESSION", "PHONE_TESTING", "MTBF", "KPI_AUDIO"], [55, 20, 10, 15])[0]
        feats = HCI_FEATURES if dom == "HCI_REGRESSION" else PHONE_FEATURES
        f = rng.choice(feats)
        slots.append(dict(domain=dom, feats=[(dom, f[0])], sub=rng.choice(list(SUBSYSTEMS)) if dom in ("MTBF", "KPI_AUDIO") else f[5],
                          imp=rng.random() * 0.5, rank=0, linked=False))
    explicit_cnt = {}
    for t in tickets.values():
        explicit_cnt[t["severity"]] = explicit_cnt.get(t["severity"], 0) + 1
    sevs = []
    for sv in ("Critical", "Medium", "Trivial"):
        sevs += [sv] * (SEVERITY_QUOTA[sv] - explicit_cnt.get(sv, 0))
    assert explicit_cnt.get("Blocker") == SEVERITY_QUOTA["Blocker"], explicit_cnt
    assert len(sevs) == len(slots), (len(sevs), len(slots))
    slots.sort(key=lambda s: -s["imp"])
    used = {int(t["id"].split("-")[1]) for t in tickets.values()}
    nums = rng.sample([n for n in range(3900, 4301) if n not in used], len(slots))
    nums.sort()
    nums_shuffled = nums[:]
    rng.shuffle(nums_shuffled)
    for slot, sv, num in zip(slots, sevs, nums_shuffled):
        sub = slot["sub"]
        tpl = rng.choice(BUG_TEMPLATES[sub])
        f = pretty(slot["feats"][0][1])
        fmtd = dict(f=f, n=rng.randint(12, 480))
        tid = f"BTFW-{num}"
        w = {k: 2.0 / (slot["rank"] or 1) ** 1.1 for k in slot["feats"]} if slot["linked"] else {}
        tickets[tid] = dict(id=tid, severity=sv, _sub=sub, summary=tpl[0].format(**fmtd),
                            description=tpl[1].format(**fmtd), source_domain=slot["domain"], _w=w, _kind="generated")
    assert len(tickets) == TOTAL_TICKETS
    return tickets


def weighted_choice(rng, items):
    tot = sum(w for _, w in items)
    r = rng.random() * tot
    for it, w in items:
        r -= w
        if r <= 0:
            return it
    return items[-1][0]


def failure_message(rng, ticket, status):
    if status == "BLOCKED":
        return f"Blocked: prerequisite setup cannot complete because of {ticket['id']}"
    tpl = rng.choice(FAILURE_SIGNATURES[ticket["_sub"]])
    return tpl.format(n=rng.randint(3, 480), m=rng.randint(1, 99), n2=rng.randint(80, 98))


def gen_domain_tests(rng, domain, feats, plan_cases, tickets, window_h, platform_fn, testbed_fn):
    by_feat = {}
    for c in plan_cases:
        by_feat.setdefault(c["feature"], []).append(c)
    failed_tests, feature_breakdown = [], {}
    for name, code, n, fail, blocked, sub, cov in feats:
        key = (domain, name)
        pool = [(t, t["_w"][key]) for t in tickets.values() if key in t["_w"]]
        assert pool or (fail + blocked) == 0, key
        pool.sort(key=lambda p: -p[1])
        gate_id = GATING.get(key)
        if blocked and gate_id is None:
            order = {"Blocker": 0, "Critical": 1, "Medium": 2, "Trivial": 3}
            gate = sorted(pool, key=lambda p: (order[p[0]["severity"]], -p[1]))[0][0]
        else:
            gate = tickets[gate_id] if gate_id else None
        chosen = rng.sample(by_feat[name], fail + blocked)
        for i, case in enumerate(chosen):
            is_block = i >= fail
            status = "BLOCKED" if is_block else "FAILED"
            if is_block:
                t = gate
                hrs = 0.25 * window_h + 0.75 * window_h * math.sqrt(rng.random())
            else:
                t = weighted_choice(rng, pool)
                hrs = rng.random() * window_h
                if domain == "HCI_REGRESSION" and name in ("LE_Audio_CIS_BIS", "LE_Isochronous_Channels") and rng.random() < 0.55:
                    hrs = 48 + rng.random() * 72
            ts = START + timedelta(hours=hrs)
            attempts = 0 if is_block else rng.choice([2, 3, 3, 4]) if domain == "HCI_REGRESSION" else rng.choice([2, 2, 3])
            rec = {
                "test_id": case["test_id"], "title": case["title"], "feature": name, "priority": case["priority"],
                "status": status, "timestamp": iso(ts), "jira_id": t["id"],
                "failure_message": failure_message(rng, t, status),
                "attempts": attempts, "retry_outcomes": ["FAIL"] * max(0, attempts - 1),
                "duration_s": case["est_duration_s"] + rng.randint(5, 90),
            }
            if is_block:
                rec["blocked_by"] = t["id"]
            rec.update(platform_fn(rng, name, status))
            rec.update(testbed_fn(rng))
            failed_tests.append(rec)
            t.setdefault("_tests", []).append(rec)
        feature_breakdown[name] = {"pass": n - fail - blocked, "fail": fail, "blocked": blocked, "total": n,
                                   "requirement_coverage_pct": cov}
    failed_tests.sort(key=lambda r: r["timestamp"])
    return failed_tests, feature_breakdown


def progress(domain_total, tests, bucket_h, n_buckets, rng):
    wts = [1.0 + 0.08 * math.sin(i * 1.7) for i in range(n_buckets)]
    tot = sum(wts)
    ex = [int(domain_total * w / tot) for w in wts]
    ex[-1] += domain_total - sum(ex)
    out = []
    for i in range(n_buckets):
        b0 = START + timedelta(hours=i * bucket_h)
        f = sum(1 for t in tests if t["status"] == "FAILED" and 0 <= (datetime.strptime(t["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) - b0).total_seconds() < bucket_h * 3600)
        b = sum(1 for t in tests if t["status"] == "BLOCKED" and 0 <= (datetime.strptime(t["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) - b0).total_seconds() < bucket_h * 3600)
        out.append({"bucket_start": iso(b0), "executed": ex[i], "passed": ex[i] - f - b, "failed": f, "blocked": b})
    return out


def recovered_tests(rng, feats, plan_cases, taken, count):
    wts = {f[0]: 1 + f[3] for f in feats}
    by_feat = {}
    for c in plan_cases:
        if c["test_id"] not in taken:
            by_feat.setdefault(c["feature"], []).append(c)
    out = []
    for _ in range(count):
        fname = weighted_choice(rng, [(k, w) for k, w in wts.items()])
        c = by_feat[fname].pop(rng.randrange(len(by_feat[fname])))
        out.append({"test_id": c["test_id"], "feature": fname, "attempts": rng.choice([2, 2, 3])})
    return out


def main():
    rng = random.Random(SEED)
    with open(os.path.join(ROOT, "data", "test_plan.json")) as fh:
        plan = json.load(fh)
    tickets = build_tickets(rng)

    # ---------------- HCI + Phone ----------------
    hci_tests, hci_fb = gen_domain_tests(
        rng, "HCI_REGRESSION", HCI_FEATURES, plan["domains"]["HCI_REGRESSION"]["test_cases"], tickets, 168,
        lambda r, f, s: {}, lambda r: {"testbed": f"BENCH-{r.randint(1, 8):02d}"})

    def phone_platform(r, feat, status):
        if feat in ("LE_Audio_Headset", "LE_Audio_Broadcast", "A2DP_Streaming"):
            return {"platform": r.choices(PLATFORMS, [15, 70, 15])[0]}
        return {"platform": r.choice(PLATFORMS)}
    phone_tests, phone_fb = gen_domain_tests(
        rng, "PHONE_TESTING", PHONE_FEATURES, plan["domains"]["PHONE_TESTING"]["test_cases"], tickets, 24,
        phone_platform, lambda r: {})

    def summarize(domain, feats, tests, fb, total, bucket_h, n_buckets, recovered_n, window_h):
        failed = sum(1 for t in tests if t["status"] == "FAILED")
        blocked = sum(1 for t in tests if t["status"] == "BLOCKED")
        taken = {t["test_id"] for t in tests}
        rec = recovered_tests(rng, feats, plan["domains"][domain]["test_cases"], taken, recovered_n)
        retry_runs = sum(t["attempts"] - 1 for t in tests) + sum(r["attempts"] - 1 for r in rec)
        per = {"HCI_REGRESSION": (0.045, 0.06, 0.02), "PHONE_TESTING": (0.06, 0.08, 0.03)}[domain]
        ext = round(per[0] * failed + per[1] * blocked + per[2] * len(rec), 1)
        dur = round(window_h + ext, 1)
        for name, f in fb.items():
            f["recovered_on_retry"] = sum(1 for r in rec if r["feature"] == name)
        return {
            "domain": domain, "total_tests": total, "passed": total - failed - blocked, "failed": failed, "blocked": blocked,
            "start_time": iso(START), "end_time": iso(START + timedelta(hours=dur)),
            "baseline_duration_hours": window_h, "execution_duration_hours": dur, "duration_extension_hours": ext,
            "rerun_log": {"retry_executions": retry_runs, "recovered_on_retry": len(rec), "persistent_failures": failed,
                          "recovered_tests": rec},
            "feature_breakdown": fb, "progress": progress(total, tests, bucket_h, n_buckets, rng),
            "failed_tests": tests,
        }
    hci = summarize("HCI_REGRESSION", HCI_FEATURES, hci_tests, hci_fb, 5000, 24, 7, 41, 168)
    phone = summarize("PHONE_TESTING", PHONE_FEATURES, phone_tests, phone_fb, 1000, 6, 4, 17, 24)

    # ---------------- MTBF ----------------
    mtbf_start = START + timedelta(days=1)
    events, per_dut_down = [], {d: 0 for d in DUT_PLATFORM}
    tau = 36.0
    eid = 0
    for jira, sig, sev, sub, duts, *_ in CRASH_DEFECTS:
        for dut, cnt in duts.items():
            for _ in range(cnt):
                u = rng.random()
                h = -math.log(1 - u * (1 - math.exp(-120 / tau))) * tau
                rec_s = rng.randint(38, 150)
                per_dut_down[dut] += rec_s
                events.append({"timestamp": iso(mtbf_start + timedelta(hours=h)), "hours_into_run": round(h, 2),
                               "dut_id": dut, "jira_id": jira, "crash_signature": sig,
                               "recovery_seconds": rec_s, "recovered": True})
    events.sort(key=lambda e: e["hours_into_run"])
    for i, e in enumerate(events, 1):
        e["event_id"] = f"CRASH-{i:03d}"
    crash_mapping = []
    for jira, sig, sev, sub, duts, *_ in CRASH_DEFECTS:
        crash_mapping.append({"jira_id": jira, "crash_signature": sig,
                              "occurrences": sum(duts.values()), "affected_duts": sorted(duts), "severity": sev})
        tickets[jira]["_crashes"] = sum(duts.values())
    max_down_h = max(per_dut_down.values()) / 3600
    mtbf_dur = round(120 + max_down_h, 1)
    mtbf = {
        "domain": "MTBF", "duts_active": 16, "planned_hours_per_dut": 120, "total_operational_hours": 1920,
        "total_crashes": len(events), "unique_crashes": len(crash_mapping), "recovery_success_rate_percent": 100,
        "start_time": iso(mtbf_start), "end_time": iso(mtbf_start + timedelta(hours=mtbf_dur)),
        "baseline_duration_hours": 120, "execution_duration_hours": mtbf_dur,
        "total_downtime_minutes": round(sum(per_dut_down.values()) / 60, 1),
        "dut_inventory": [{"dut_id": d, "platform": DUT_PLATFORM[d],
                           "rf_frontend_rev": "RF-FE rev2" if DUT_PLATFORM[d] == "MobilePlatform-B" else "RF-FE rev3",
                           "crashes": sum(1 for e in events if e["dut_id"] == d),
                           "downtime_seconds": per_dut_down[d]} for d in DUT_PLATFORM],
        "crash_events": events,
    }

    # ---------------- KPI ----------------
    kpi_start = START + timedelta(days=2)
    counts = [0] * 12
    for t in hci_tests:
        if t["status"] == "FAILED" and t["feature"] in ("LE_Audio_CIS_BIS", "LE_Isochronous_Channels"):
            h = (datetime.strptime(t["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) - kpi_start).total_seconds() / 3600
            if 0 <= h < 72:
                counts[int(h // 6)] += 1
    mean_c = sum(counts) / 12
    std_c = math.sqrt(sum((c - mean_c) ** 2 for c in counts) / 12) or 1.0
    z = [(c - mean_c) / std_c for c in counts]
    metrics = []
    for name, feat, unit, cmp_, target, avg, a, dec in KPI_SPECS:
        raw = [max(0.05, 1 + a * z[i] + rng.gauss(0, 0.06 if a else 0.02)) for i in range(12)]
        k = avg / (sum(raw) / 12)
        samples = [round(v * k, dec + 2) for v in raw]
        m_avg = sum(samples) / 12
        worst = max(samples) if cmp_ == "<" else min(samples)
        breach = (m_avg - target) / target if cmp_ == "<" else (target - m_avg) / target
        status = "PASS" if breach <= 0 else "DEGRADED" if breach <= 0.30 else "FAIL"
        prev = KPI_PREV.get(name, avg * (1 + rng.uniform(-0.03, 0.03)))
        suffix = "%" if unit == "%" else ""
        metrics.append({
            "metric_name": name, "feature": feat, "unit": unit,
            "target": f"{cmp_} {fmt_val(target, dec)}{suffix}", "measured_avg": f"{fmt_val(m_avg, dec)}{suffix}",
            "comparator": cmp_, "target_value": target, "measured_avg_value": round(m_avg, dec + 1),
            "measured_worst_value": round(worst, dec + 1), "previous_build_avg_value": round(prev, dec + 1),
            "deviation_pct": round(breach * 100, 1), "status": status,
            "samples": [{"timestamp": iso(kpi_start + timedelta(hours=6 * i)), "value": samples[i]} for i in range(12)],
        })
    nonpass = [m["metric_name"] for m in metrics if m["status"] != "PASS"]
    assert nonpass == ["A2DP_Latency_ms", "LE_Audio_Latency_ms", "LE_Audio_Jitter_ms", "LE_Audio_Power_mW"], nonpass
    for tid in KPI_TICKET_IDS[:4]:
        t = tickets[tid]
        m = next(x for x in metrics if x["metric_name"] == t["linked_metric"])
        t["summary"] = f"Auto-filed performance regression: {m['metric_name']} avg {m['measured_avg']} vs target {m['target']}"
        t["description"] = (f"Auto-generated performance bug report. {m['metric_name']} measured {m['measured_avg']} "
                            f"(target {m['target']}, previous build {m['previous_build_avg_value']}); status {m['status']}. "
                            f"Degraded trend over the 72 h KPI window; audio streaming quality and latency impacted.")
    kpi = {"domain": "KPI_AUDIO", "start_time": iso(kpi_start), "end_time": iso(kpi_start + timedelta(hours=72)),
           "baseline_duration_hours": 72, "execution_duration_hours": 72, "sample_interval_hours": 6, "metrics": metrics}

    # ---------------- finalize tickets ----------------
    d0 = datetime(2026, 8, 20, tzinfo=UTC)
    hist_dates = [datetime.strptime(h[1], "%Y-%m-%d").replace(tzinfo=UTC) for h in HISTORY]
    out_tickets = []
    for t in sorted(tickets.values(), key=lambda x: int(x["id"].split("-")[1])):
        num = int(t["id"].split("-")[1])
        created = d0 + timedelta(days=(num - 3900) / 400 * 59)
        tests = t.get("_tests", [])
        if t["source_domain"] == "KPI_AUDIO" and t["id"] in KPI_TICKET_IDS:
            created = kpi_start + timedelta(hours=72, minutes=rng.randint(5, 50))
        if tests:
            first = min(datetime.strptime(x["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) for x in tests)
            if created > first:
                created = first + timedelta(minutes=rng.randint(3, 55))
        if t["id"] in [c[0] for c in CRASH_DEFECTS] and t.get("_crashes"):
            first_c = min(e["timestamp"] for e in events if e["jira_id"] == t["id"])
            fc = datetime.strptime(first_c, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
            if created > fc:
                created = fc + timedelta(minutes=rng.randint(3, 55))
        linked = bool(tests) or t.get("_crashes") or t.get("linked_metric")
        if t["id"] in ("BTFW-4012", "BTFW-4044"):
            status = "In Progress"
        elif t["id"] in ("BTFW-4027", "BTFW-4057"):
            status = "Open"
        elif linked:
            status = rng.choices(["Open", "In Progress", "Fix Committed"], [50, 40, 10])[0]
        else:
            status = rng.choices(["Verified", "Closed", "Fix Committed", "Open"], [45, 30, 10, 15])[0]
        fsb = next((HISTORY[i][0] for i in range(len(HISTORY) - 1, -1, -1) if hist_dates[i] <= created),
                   "FW_v14.0.77_RC1" if created < hist_dates[0] else FIRMWARE)
        if created >= START:
            fsb = FIRMWARE
        out = {k: v for k, v in t.items() if not k.startswith("_")}
        out.update({
            "status": status, "created": iso(created), "first_seen_build": fsb, "reporter": "auto-triage-bot",
            "labels": ["auto-filed", "bt-5.2"] + (["regression"] if created < START and linked else []),
            "linked_test_ids": [x["test_id"] for x in tests],
            "linked_failed_tests": sum(1 for x in tests if x["status"] == "FAILED"),
            "linked_blocked_tests": sum(1 for x in tests if x["status"] == "BLOCKED"),
            "linked_crash_events": t.get("_crashes", 0),
        })
        out_tickets.append(out)
    sev_dist = {s: sum(1 for t in out_tickets if t["severity"] == s) for s in ("Blocker", "Critical", "Medium", "Trivial")}
    assert sev_dist == SEVERITY_QUOTA, sev_dist
    status_dist = {}
    for t in out_tickets:
        status_dist[t["status"]] = status_dist.get(t["status"], 0) + 1

    # ---------------- assemble ----------------
    end = max(datetime.strptime(d["end_time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) for d in (hci, phone, mtbf, kpi))
    history = []
    for (b, date, f, bl, nb, nc, uq, tc, (kp, kd, kf), cyc), n in zip(HISTORY, range(1, 6)):
        history.append({"build": b, "run_id": f"BT_FULL_CYCLE_{date.replace('-', '')}_01", "date": date, "failed": f, "blocked": bl,
                        "pass_rate_pct": round((6000 - f - bl) / 6000 * 100, 2), "open_blockers": nb, "open_criticals": nc,
                        "unique_crashes": uq, "total_crashes": tc, "fleet_mtbf_hours": round(1920 / tc, 1),
                        "kpi_pass": kp, "kpi_degraded": kd, "kpi_fail": kf, "cycle_duration_hours": cyc})
    data = {
        "test_run_metadata": {
            "run_id": RUN_ID, "chipset_revision": "BT_5_2_REV_C2", "firmware_build": FIRMWARE,
            "start_time": iso(START), "end_time": iso(end), "cycle_type": "FULL_CYCLE",
            "baseline_cycle_hours": 168, "test_plan_id": plan["plan_id"], "previous_run_id": history[-1]["run_id"],
            "generated_by": "SampleTestRunGenerator (synthetic data, seed %d)" % SEED,
            "generated_at": "2026-10-21T00:00:00Z",
        },
        "release_context": {
            "milestone": "RC Sign-off / Tape-out Readiness Gate",
            "target_date": "2026-11-13",
            "build_cadence_days": 10,
            "release_gates": {"max_open_blockers": 0, "max_open_criticals": 5, "min_pass_rate_pct": 97.0,
                              "max_blocked_pct": 2.0, "min_fleet_mtbf_hours": 100,
                              "max_kpi_failed": 0, "max_kpi_degraded": 3},
        },
        "domain_summaries": [hci, phone, mtbf, kpi],
        "jira_telemetry": {
            "total_tickets_linked": len(out_tickets), "severity_distribution": sev_dist, "status_distribution": status_dist,
            "auto_dedup": {"crash_events_total": len(events), "unique_crash_signatures": len(crash_mapping)},
            "crash_mapping": crash_mapping, "tickets": out_tickets,
        },
        "build_history": history,
    }
    if os.environ.get("BT_DUMP_TRUTH"):
        with open(os.environ["BT_DUMP_TRUTH"], "w") as fh:
            json.dump({t["id"]: t["_sub"] for t in tickets.values()}, fh)
    # consistency checks
    for d in (hci, phone):
        assert d["passed"] + d["failed"] + d["blocked"] == d["total_tests"]
        assert sum(f["pass"] + f["fail"] + f["blocked"] for f in d["feature_breakdown"].values()) == d["total_tests"]
        assert all(t["jira_id"] in tickets for t in d["failed_tests"])
    assert len(hci["feature_breakdown"]) == 25 and len(phone["feature_breakdown"]) == 15
    assert sum(c["occurrences"] for c in crash_mapping) == len(events) and len(crash_mapping) >= 10
    out = os.path.join(ROOT, "data", "test_run_data.json")
    with open(out, "w") as fh:
        json.dump(data, fh, indent=1)
    tot_np = sum(d["failed"] + d["blocked"] for d in (hci, phone))
    print(f"wrote {out}")
    print(f"HCI  pass {hci['passed']} fail {hci['failed']} blocked {hci['blocked']} dur {hci['execution_duration_hours']}h")
    print(f"PHN  pass {phone['passed']} fail {phone['failed']} blocked {phone['blocked']} dur {phone['execution_duration_hours']}h")
    print(f"MTBF crashes {len(events)} unique {len(crash_mapping)}; KPI nonpass {nonpass}")
    print(f"non-pass total {tot_np} -> pass rate {(6000 - tot_np) / 60:.2f}%; run end {iso(end)}; tickets {sev_dist} {status_dist}")


if __name__ == "__main__":
    main()
