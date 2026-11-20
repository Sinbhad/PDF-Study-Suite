#!/usr/bin/env python3
"""
Composite quality check runner for PDF Study Suite.

Runs up to 6 stages in order:
  1. Static module graph & runtime IR contracts (`node tools/check-contracts.js`)
  2. Deterministic unit/manifest/HTTP/smoke suite (`python tests/verify_suite.py`)
  3. Question-quality Pareto gate (`node tools/eval-quiz.js --pareto --baseline=...`) on public + local corpus
  4. Summary-quality gate (`node tools/eval-summary.js --baseline=...`) on public + local corpus
  5. Saved graded-question replay (`node tools/eval-quiz-grades.js`) against saved replay baseline
  6. Headless browser UI E2E & WCAG 2.2 AA gate (`node tools/eval-ui-e2e.js`)

Usage:
  python tools/check-all.py [--e2e] [--skip-e2e] [--skip-local] [--waive-yield=id1,id2] [--json-out=gate.json]
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_VM_SPEC = importlib.util.spec_from_file_location("verify_manifest", os.path.join(ROOT, "tests", "verify_manifest.py"))
_VM_MOD = importlib.util.module_from_spec(_VM_SPEC)
_VM_SPEC.loader.exec_module(_VM_MOD)
find_node = _VM_MOD.find_node

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")


def run_step(name: str, cmd: list[str], timeout: int = 300):
    t0 = time.monotonic()
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    dt = round(time.monotonic() - t0, 2)
    return {
        "name": name,
        "cmd": " ".join(cmd),
        "returncode": proc.returncode,
        "seconds": dt,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def ui_changed() -> bool:
    proc = subprocess.run(["git", "diff", "--name-only", "HEAD"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    proc2 = subprocess.run(["git", "diff", "--name-only", "--cached"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    files = (proc.stdout + "\n" + proc2.stdout).splitlines()
    return any(f.startswith(("src/ui/", "styles/")) or f == "index.html" for f in files)


def check_local_pdfs_present(manifest_path: str) -> bool:
    if not os.path.exists(manifest_path):
        return False
    try:
        m = json.loads(open(manifest_path, "r", encoding="utf-8").read())
        return all(os.path.exists(os.path.join(ROOT, e["path"])) if not os.path.isabs(e["path"]) else os.path.exists(e["path"])
                   for e in m.get("entries", []))
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="PDF Study Suite Composite Quality Checks")
    ap.add_argument("--e2e", action="store_true", help="Always run headless UI E2E suite")
    ap.add_argument("--skip-e2e", action="store_true", help="Skip UI E2E suite")
    ap.add_argument("--skip-local", action="store_true", help="Skip local 12-PDF corpus & grade replay")
    ap.add_argument("--waive-yield", default="", help="Comma-separated doc IDs waived from per-doc yield floor")
    ap.add_argument("--json-out", default="", help="Write structured gate summary JSON")
    args = ap.parse_args()

    node = find_node()
    if not node:
        print("FAIL: Node.js binary not found", file=sys.stderr)
        return 2

    results = []
    waive_flag = [f"--waive-yield={args.waive_yield}"] if args.waive_yield else []

    with tempfile.TemporaryDirectory() as tmp:
        # 1. Contracts
        r = run_step("contracts", [node, "tools/check-contracts.js"])
        results.append(r)

        # 2. Verify suite
        r = run_step("verify_suite", [sys.executable, "tests/verify_suite.py"], timeout=600)
        results.append(r)

        # 3. Public Quiz Pareto Gate
        pub_q_base = os.path.join(ROOT, "tests/corpus/baseline.json")
        pub_q_out = os.path.join(tmp, "pub-quiz.json")
        cmd = [node, "tools/eval-quiz.js", f"--out={pub_q_out}", *waive_flag]
        if os.path.exists(pub_q_base):
            cmd.extend(["--pareto", f"--baseline={pub_q_base}"])
        results.append(run_step("quiz_public", cmd))

        # 4. Public Summary Gate
        pub_s_base = os.path.join(ROOT, "tests/corpus/summary-baseline.json")
        pub_s_out = os.path.join(tmp, "pub-summary.json")
        cmd = [node, "tools/eval-summary.js", f"--out={pub_s_out}"]
        if os.path.exists(pub_s_base):
            cmd.append(f"--baseline={pub_s_base}")
        results.append(run_step("summary_public", cmd))

        # Optional Local 12-PDF gates (skipped cleanly when absent or --skip-local)
        local_manifest = os.path.join(ROOT, "tests/corpus/local/manifest.json")
        if not args.skip_local and check_local_pdfs_present(local_manifest):
            loc_q_base = os.path.join(ROOT, "tests/corpus/local/baseline.json")
            loc_q_out = os.path.join(tmp, "loc-quiz.json")
            cmd = [node, "tools/eval-quiz.js", f"--corpus={local_manifest}", f"--out={loc_q_out}", *waive_flag]
            if os.path.exists(loc_q_base):
                cmd.extend(["--pareto", f"--baseline={loc_q_base}"])
            results.append(run_step("quiz_local", cmd, timeout=300))

            loc_s_base = os.path.join(ROOT, "tests/corpus/local/summary-baseline.json")
            loc_s_out = os.path.join(tmp, "loc-summary.json")
            cmd = [node, "tools/eval-summary.js", f"--corpus={local_manifest}", f"--out={loc_s_out}"]
            if os.path.exists(loc_s_base):
                cmd.append(f"--baseline={loc_s_base}")
            results.append(run_step("summary_local", cmd, timeout=300))

            # 5. Saved graded-question replay
            local_dir = os.path.join(ROOT, "tests/corpus/local")
            grade_files = sorted(f for f in os.listdir(local_dir) if f.startswith("grades-") and f.endswith(".json") and "replay" not in f)
            replay_base_path = os.path.join(local_dir, "grades-replay-baseline.json")
            if grade_files:
                latest_grades = os.path.join(local_dir, grade_files[-1])
                gr = run_step("grades_replay", [node, "tools/eval-quiz-grades.js", f"--grades={latest_grades}", f"--corpus={local_manifest}", "--show"])
                # Enforce zero BAD regressions against grades-replay-baseline.json when present
                if gr["returncode"] == 0 and os.path.exists(replay_base_path):
                    rb = json.loads(open(replay_base_path, "r", encoding="utf-8").read())
                    total_line = next((l for l in gr["stdout"].splitlines() if l.startswith("TOTAL")), "")
                    # Parse: TOTAL  GOOD x/y  OK a/b  BAD m/n
                    import re
                    gm = re.search(r"GOOD\s+(\d+)/(\d+)\s+OK\s+\d+/\d+\s+BAD\s+(\d+)/(\d+)", total_line)
                    if gm:
                        good_now, good_tot, bad_now, _ = map(int, gm.groups())
                        bad_base = int(rb.get("badStill", bad_now))
                        good_base = int(rb.get("goodStill", good_now))
                        if bad_now > bad_base:
                            gr["returncode"] = 1
                            gr["stderr"] += f"\nFAIL: still-BAD count rose from {bad_base} to {bad_now}"
                        if good_base > 0 and (good_base - good_now) / good_base > 0.05:
                            gr["returncode"] = 1
                            gr["stderr"] += f"\nFAIL: retained GOOD dropped >5% ({good_base} -> {good_now})"
                results.append(gr)
        else:
            reason = "--skip-local" if args.skip_local else "local corpus PDFs not present"
            results.append({"name": "local_corpus", "cmd": "skipped", "returncode": 0, "seconds": 0.0, "stdout": f"[SKIPPED] {reason}", "stderr": "", "skipped": True})

        # 6. Headless browser UI E2E
        run_e2e = not args.skip_e2e and (args.e2e or ui_changed())
        if run_e2e:
            results.append(run_step("ui_e2e", [node, "tools/eval-ui-e2e.js"], timeout=300))
        else:
            results.append({"name": "ui_e2e", "cmd": "skipped", "returncode": 0, "seconds": 0.0, "stdout": "[SKIPPED] pass --e2e or touch UI files", "stderr": "", "skipped": True})

    print("\n" + "=" * 78)
    print(f"{'STEP':18s} {'STATUS':10s} {'TIME':8s} DETAIL")
    print("-" * 78)
    failed = False
    for r in results:
        if r.get("skipped"):
            status = "SKIP"
        elif r["returncode"] == 0:
            status = "PASS"
        else:
            status = "FAIL"
            failed = True
        lines = [l.strip() for l in (r["stdout"] + "\n" + r["stderr"]).splitlines() if l.strip()]
        detail = lines[-1][:44] if lines else ""
        if status == "PASS":
            # Prefer TOTAL / [OK] / pareto summary lines
            for cand in reversed(lines):
                if cand.startswith(("[OK]", "TOTAL", "pareto", "baseline", "ALL VERIFICATION")):
                    detail = cand[:60]
                    break
        print(f"{r['name']:18s} {status:10s} {r['seconds']:6.2f}s  {detail}")
    print("=" * 78)

    if failed:
        print("\nFAILURE DETAILS:")
        for r in results:
            if not r.get("skipped") and r["returncode"] != 0:
                print(f"\n--- {r['name']} (exit {r['returncode']}) ---")
                print((r["stdout"] + "\n" + r["stderr"]).strip()[-3000:])

    if args.json_out:
        summary = [{k: v for k, v in r.items() if k not in ("stdout", "stderr")} for r in results]
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"passed": not failed, "steps": summary}, f, indent=2)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
