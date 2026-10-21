#!/usr/bin/env python3
"""One-time test plan generator: writes data/test_plan.json (every test case, MTBF + KPI plans)."""
import json, random, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from catalog import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENARIOS = [
    "basic operation", "parameter boundary: minimum", "parameter boundary: maximum",
    "invalid parameter rejection", "state transition idle to active", "state transition active to idle",
    "repeat x{n} loop", "concurrent with second link", "after HCI reset", "low battery mode",
    "interference at -{n} dBm", "timeout and retry handling", "spec compliance check", "link loss recovery",
]
SPEC_VOL = {"HCI": "Vol 4 Part E", "AUDIO": "Vol 6 Part G", "LM": "Vol 6 Part B", "PHY": "Vol 6 Part A",
            "HOST": "Vol 3 Part G", "SEC": "Vol 3 Part H", "PWR": "Vol 2 Part C"}
PRIORITIES = ["P0", "P1", "P2", "P3"]
PREFIX = {"HCI_REGRESSION": "HCI", "PHONE_TESTING": "PHN"}


def build_domain(rng, domain, features):
    cases, feat_meta = [], {}
    for name, code, n, _f, _b, sub, cov in features:
        feat_meta[name] = {"code": code, "total_tests": n, "requirement_coverage_pct": cov,
                           "spec_reference": f"BT Core 5.2 {SPEC_VOL[sub]}"}
        for i in range(1, n + 1):
            sc = SCENARIOS[(i - 1) % len(SCENARIOS)].format(n=rng.choice([10, 50, 100, 500, 85, 92]))
            sec = f"{rng.randint(1, 9)}.{rng.randint(1, 12)}.{rng.randint(1, 20)}"
            cases.append({
                "test_id": f"{PREFIX[domain]}-{code}-{i:04d}",
                "feature": name,
                "title": f"{name.replace('_', ' ')} - {sc} (case {i})",
                "priority": rng.choices(PRIORITIES, [12, 38, 36, 14])[0],
                "spec_ref": f"BT Core 5.2 {SPEC_VOL[sub]} s{sec}",
                "est_duration_s": rng.choice([30, 45, 60, 90, 120, 180, 240]),
                "automated": True,
            })
    return {"total_tests": len(cases), "features": feat_meta, "test_cases": cases}


def main():
    rng = random.Random(SEED)
    plan = {
        "plan_id": "BT_TESTPLAN_v5.2_REV_C2",
        "generated_by": "generator/generate_test_plan.py (one-time)",
        "seed": SEED,
        "chipset": "Custom Bluetooth Chipset for Mobile Platforms",
        "domains": {
            "HCI_REGRESSION": build_domain(rng, "HCI_REGRESSION", HCI_FEATURES),
            "PHONE_TESTING": build_domain(rng, "PHONE_TESTING", PHONE_FEATURES),
            "MTBF": {
                "duts": [{"dut_id": d, "platform": p} for d, p in DUT_PLATFORM.items()],
                "planned_hours_per_dut": 120,
                "workload": "continuous mixed profile: A2DP + LE Audio + GATT + inquiry",
            },
            "KPI_AUDIO": {"sample_interval_hours": 6, "duration_hours": 72, "matrix_features": [
                "A2DP", "LE_Audio_Unicast", "LE_Audio_Broadcast", "BLE_Throughput", "BR_EDR_Throughput",
                "Connection_Setup", "Power"]},
        },
    }
    assert plan["domains"]["HCI_REGRESSION"]["total_tests"] == 5000
    assert plan["domains"]["PHONE_TESTING"]["total_tests"] == 1000
    assert len(HCI_FEATURES) == 25 and len(PHONE_FEATURES) == 15
    out = os.path.join(ROOT, "data", "test_plan.json")
    with open(out, "w") as fh:
        json.dump(plan, fh, separators=(",", ":"))
    print(f"wrote {out}: HCI 5000 tests / 25 features, Phone 1000 tests / 15 features")


if __name__ == "__main__":
    main()
